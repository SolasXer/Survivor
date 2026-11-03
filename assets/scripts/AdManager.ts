import { _decorator, Component } from 'cc';
const { ccclass, property } = _decorator;

/** 微信广告接口返回的错误信息 */
export interface WxAdError {
    /** 错误码：1004 无合适的广告、1005 广告组件审核中、1008 广告单元已关闭、2001 触发频率限制等 */
    errCode?: number;
    /** 错误描述 */
    errMsg?: string;
}

/** 激励视频广告关闭时的回调参数 */
export interface WxRewardedVideoAdCloseResult {
    /** 用户是否完整观看了广告：true 完整观看，false 中途关闭 */
    isEnded?: boolean;
}

/** 微信激励视频广告实例：只声明本脚本用到的成员，避免引入额外类型依赖 */
export interface WxRewardedVideoAd {
    /** 拉取广告；失败时 reject，同时触发 onError */
    load(): Promise<void>;
    /** 展示广告；广告尚未加载完成时会 reject */
    show(): Promise<void>;
    /** 销毁广告实例，旧版基础库可能不存在 */
    destroy?(): void;
    onLoad(callback: () => void): void;
    offLoad?(callback: () => void): void;
    onError(callback: (err: WxAdError) => void): void;
    offError?(callback: (err: WxAdError) => void): void;
    onClose(callback: (res: WxRewardedVideoAdCloseResult) => void): void;
    offClose?(callback: (res: WxRewardedVideoAdCloseResult) => void): void;
}

/** 微信小游戏全局对象 wx 中本脚本用到的部分 */
interface WxMiniGame {
    createRewardedVideoAd(options: { adUnitId: string; multiton?: boolean }): WxRewardedVideoAd;
}

// 微信小游戏运行时由平台注入全局 wx，浏览器预览、原生平台等环境没有该对象。
// 这里只做编译期声明，运行时统一用 typeof wx 判断，缺少全局变量时不会抛错。
declare const wx: WxMiniGame;

/** 广告未能发放奖励的原因 */
export enum AdFailReason {
    /** 当前环境不支持：不是微信小游戏，或 wx 接口缺失 */
    Unsupported = 'unsupported',
    /** 尚未初始化，或广告位 ID 为空 */
    NotReady = 'not-ready',
    /** 上一次广告还未结束，需要等它关闭后再展示 */
    Busy = 'busy',
    /** 广告拉取或播放失败，err 中带有微信返回的错误码 */
    LoadFailed = 'load-failed',
    /** 用户中途关闭广告，不发放奖励 */
    ClosedEarly = 'closed-early',
}

/** 广告失败回调 */
export type AdFailCallback = (reason: AdFailReason, err?: WxAdError) => void;

/** 一次展示请求的回调集合 */
interface PendingShow {
    /** 完整观看后的奖励回调 */
    onReward: () => void;
    /** 未发放奖励时的回调，可省略 */
    onFail?: AdFailCallback | null;
}

/** 安全执行失败回调：单个回调抛错不应打断广告流程 */
function invokeFail(onFail: AdFailCallback | null | undefined, reason: AdFailReason, err?: WxAdError): void {
    if (!onFail) return;

    try {
        onFail(reason, err);
    }
    catch (callbackErr) {
        console.error('[AdManager] 广告失败回调执行出错', callbackErr);
    }
}

/**
 * 激励视频广告管理：挂载在常驻节点（如 Canvas）上，封装微信小游戏的激励视频广告。
 *
 * 用法：
 * - 在属性检查器里填好广告位 ID，组件会在 onLoad 时自动初始化；
 *   也可以运行时调用 `initAd(adUnitId)` 传入微信后台申请的广告位 ID。
 * - 需要展示广告时调用 `showAd(onReward, onFail?)`，
 *   用户完整观看后执行 `onReward`，否则执行 `onFail` 并给出原因。
 * - 其他脚本可用静态快捷方式 `AdManager.show(onReward, onFail?)`，无需持有引用。
 *
 * 失败处理：
 * - 非微信小游戏环境、未初始化：`NotReady` / `Unsupported`；
 * - 上一次广告未结束：`Busy`，避免同一次请求重复发奖；
 * - 拉取或播放失败（含首次 show 未加载完成时自动 load 重试一次）：`LoadFailed`；
 * - 用户中途关闭：`ClosedEarly`，不发奖励。
 *
 * 同一个广告实例的事件是全局的，因此事件只在初始化时注册一次，
 * 每次展示只把回调暂存在 `_pending` 中，由 onClose 统一结算，避免回调累积。
 */
@ccclass('AdManager')
export class AdManager extends Component {
    /** 当前场景内的广告管理器，未挂载时为 null */
    public static instance: AdManager | null = null;

    @property({ tooltip: '激励视频广告位 ID：填写后 onLoad 自动初始化；也可运行时调用 initAd() 传入' })
    adUnitId: string = '';

    /** 微信广告实例，未初始化或环境不支持时为 null */
    private _ad: WxRewardedVideoAd | null = null;

    /** 当前广告实例对应的广告位 ID */
    private _adUnitId: string = '';

    /** 等待结果的展示请求；同一时间只允许一个，避免奖励重复发放 */
    private _pending: PendingShow | null = null;

    /** 本次请求是否已结算，防止 onError 与 show 的 reject 重复触发回调 */
    private _settled: boolean = false;

    /** 事件回调引用：offXxx 必须传入与 onXxx 相同的引用，销毁时用于解绑 */
    private _onLoadHandler: (() => void) | null = null;
    private _onErrorHandler: ((err: WxAdError) => void) | null = null;
    private _onCloseHandler: ((res: WxRewardedVideoAdCloseResult) => void) | null = null;

    onLoad() {
        if (!AdManager.instance?.isValid) {
            AdManager.instance = this;
        }

        if (this.adUnitId) {
            this.initAd(this.adUnitId);
        }
    }

    onDestroy() {
        if (AdManager.instance === this) {
            AdManager.instance = null;
        }

        this.release();
    }

    /**
     * 初始化激励视频广告：创建广告实例、注册事件并预加载一次。
     * 用同一个广告位 ID 重复调用不会有副作用；换 ID 会先释放旧实例。
     * @param adUnitId 微信后台申请的激励视频广告位 ID
     * @returns 是否初始化成功（ID 为空、非微信小游戏环境或创建失败时返回 false）
     */
    public initAd(adUnitId: string): boolean {
        const id = (adUnitId ?? '').trim();
        if (!id) {
            console.warn('[AdManager] 广告位 ID 为空，无法初始化激励视频广告');
            return false;
        }

        if (!AdManager.isSupported()) {
            console.warn('[AdManager] 当前不是微信小游戏环境，激励视频广告不可用');
            return false;
        }

        if (this._ad && this._adUnitId === id) {
            return true;
        }

        // 换广告位或重新初始化：先释放旧实例，避免事件回调串到新的请求上
        this.release();

        try {
            const ad = wx.createRewardedVideoAd({ adUnitId: id });

            this._onLoadHandler = () => console.log('[AdManager] 激励视频广告加载完成');
            this._onErrorHandler = (err: WxAdError) => this.handleAdError(err);
            this._onCloseHandler = (res: WxRewardedVideoAdCloseResult) => this.handleAdClose(res);

            ad.onLoad(this._onLoadHandler);
            ad.onError(this._onErrorHandler);
            ad.onClose(this._onCloseHandler);

            this._ad = ad;
            this._adUnitId = id;
            this.adUnitId = id;

            // 提前拉取一次，首次点击时基本可以立即播放
            this.preload();
            console.log('[AdManager] 激励视频广告初始化完成', id);
            return true;
        }
        catch (err) {
            console.error('[AdManager] 创建激励视频广告失败', err);
            this.release();
            return false;
        }
    }

    /**
     * 展示激励视频广告，用户完整观看后执行 onReward。
     * 未发奖励时执行 onFail，并给出原因（见 AdFailReason）。
     * @param onReward 完整观看后的奖励回调
     * @param onFail 未发奖励时的回调，可省略
     */
    public showAd(onReward: () => void, onFail?: AdFailCallback | null): void {
        const ad = this._ad;
        if (!ad) {
            invokeFail(onFail, AdManager.isSupported() ? AdFailReason.NotReady : AdFailReason.Unsupported);
            return;
        }

        if (this._pending) {
            console.warn('[AdManager] 上一次广告还未结束，忽略本次展示请求');
            invokeFail(onFail, AdFailReason.Busy);
            return;
        }

        this._pending = { onReward, onFail };
        this._settled = false;

        try {
            // 广告尚未加载完成时 show 会 reject，按官方建议先 load 再重试一次
            ad.show()
                .catch(() => ad.load().then(() => ad.show()))
                .catch((err?: WxAdError) => this.settleFail(AdFailReason.LoadFailed, err));
        }
        catch (err) {
            this.settleFail(AdFailReason.LoadFailed, err as WxAdError);
        }
    }

    /** 是否已完成初始化（不代表广告已缓存好，未缓存时 show 会自动重新拉取） */
    public isAdReady(): boolean {
        return this._ad !== null;
    }

    /** 销毁广告实例并解绑事件；换广告位、场景切换或组件销毁时调用 */
    public release(): void {
        const ad = this._ad;

        // 销毁时主动丢弃等待中的请求：此时场景通常正在重置，不再回调业务逻辑
        this._pending = null;
        this._settled = true;

        if (ad) {
            if (this._onLoadHandler && ad.offLoad) {
                ad.offLoad(this._onLoadHandler);
            }
            if (this._onErrorHandler && ad.offError) {
                ad.offError(this._onErrorHandler);
            }
            if (this._onCloseHandler && ad.offClose) {
                ad.offClose(this._onCloseHandler);
            }

            try {
                ad.destroy?.();
            }
            catch (err) {
                // 实例可能已被平台回收，销毁失败不影响后续流程
            }
        }

        this._ad = null;
        this._adUnitId = '';
        this._onLoadHandler = null;
        this._onErrorHandler = null;
        this._onCloseHandler = null;
    }

    /** 当前环境是否支持激励视频广告：微信小游戏且存在 wx.createRewardedVideoAd */
    public static isSupported(): boolean {
        return typeof wx !== 'undefined' && typeof wx.createRewardedVideoAd === 'function';
    }

    /**
     * 静态快捷方式：展示激励视频广告。
     * 没有挂载 AdManager 时也会执行 onFail（NotReady / Unsupported），调用方不会永远等不到结果。
     */
    public static show(onReward: () => void, onFail?: AdFailCallback | null): void {
        const manager = AdManager.instance;
        if (!manager || !manager.isValid) {
            invokeFail(onFail, AdManager.isSupported() ? AdFailReason.NotReady : AdFailReason.Unsupported);
            return;
        }

        manager.showAd(onReward, onFail);
    }

    /** 广告事件：预加载阶段的错误没有等待中的请求，只记录日志 */
    private handleAdError(err: WxAdError): void {
        console.warn('[AdManager] 激励视频广告出错', err);

        if (this._pending && !this._settled) {
            this.settleFail(AdFailReason.LoadFailed, err);
        }
    }

    /** 广告关闭：完整观看则发奖，中途关闭按失败结算 */
    private handleAdClose(res?: WxRewardedVideoAdCloseResult): void {
        if (!this._pending || this._settled) {
            return;
        }

        // 基础库 2.1.0 起 onClose 才带 res；更老的版本没有中途退出判定，关闭即视为看完。
        // 新版本只认 isEnded === true，字段缺失按未看完处理，避免误发奖励。
        const isEnded = res ? res.isEnded === true : true;
        if (!isEnded) {
            console.log('[AdManager] 用户中途关闭广告，不发放奖励');
            this.settleFail(AdFailReason.ClosedEarly);
            return;
        }

        this.settleReward();
    }

    /** 完整观看：执行奖励回调，并重新预加载供下次展示 */
    private settleReward(): void {
        const pending = this._pending;
        this._pending = null;
        this._settled = true;
        if (!pending) return;

        try {
            pending.onReward();
        }
        catch (err) {
            console.error('[AdManager] 奖励回调执行出错', err);
        }

        // 播放结束后再拉一次，下次点击基本可以立即播放
        this.preload();
    }

    /** 未发奖励：执行失败回调；没有等待中的请求时静默忽略 */
    private settleFail(reason: AdFailReason, err?: WxAdError): void {
        const pending = this._pending;
        if (!pending) return;

        this._pending = null;
        this._settled = true;
        invokeFail(pending.onFail, reason, err);
    }

    /** 预加载广告；失败时由 onError 记录日志，这里吞掉 reject 避免未捕获异常 */
    private preload(): void {
        const ad = this._ad;
        if (!ad) return;

        ad.load().catch((err?: WxAdError) => {
            console.warn('[AdManager] 激励视频广告预加载失败，展示时会重新尝试', err);
        });
    }
}
