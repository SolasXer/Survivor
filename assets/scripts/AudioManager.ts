import { _decorator, Component, AudioSource, AudioClip, warn } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 战斗音效类型：对应属性检查器中绑定的音效资源。
 * 通过 `AudioManager.play(SfxType.Shoot)` 或实例方法 `playSfx()` 播放。
 */
export enum SfxType {
    /** 射击音效：短促的激光声 */
    Shoot = 0,
    /** 命中音效：干脆的撞击声 */
    Hit = 1,
    /** 受击音效：低沉的警示声 */
    Hurt = 2,
    /** 死亡音效：敌人消散的碎裂声 */
    Death = 3,
    /** UI 音效：清脆的按键点击声 */
    UiClick = 4,
}

/**
 * 音频管理器：挂载在 Canvas/Audio 节点上，该节点同时挂载 AudioSource 组件。
 * 作为全局音频模块统一播放战斗音效与背景音乐：
 * - 音效（射击、命中、受击、死亡、UI 点击）通过 AudioSource 的 playOneShot 一次性播放，
 *   同一帧多次触发会叠加而不互相打断；资源在属性检查器中绑定。
 * - 背景音乐占用 AudioSource 的主音轨循环播放，与音效互不影响。
 * 其他脚本可直接用静态方法 `AudioManager.play(SfxType.Hit)` 触发音效，
 * 无需持有引用；组件初始化后静态 instance 指向自身。
 */
@ccclass('AudioManager')
export class AudioManager extends Component {
    /** 当前场景内的音频管理器，未挂载时为 null */
    public static instance: AudioManager | null = null;

    @property({ type: AudioClip, tooltip: '射击音效：短促的激光声（assets/audio/shoot）' })
    shootClip: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '命中音效：干脆的撞击声（assets/audio/hit）' })
    hitClip: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '受击音效：低沉的警示声（assets/audio/hurt）' })
    hurtClip: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '死亡音效：敌人消散的碎裂声（assets/audio/death）' })
    deathClip: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'UI 音效：清脆的按键点击声（assets/audio/ui_click）' })
    uiClickClip: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '背景音乐：紧张且可无缝循环的战斗音乐（assets/audio/bgm）' })
    bgmClip: AudioClip | null = null;

    @property({ tooltip: '背景音乐音量（0-1），仅在开始播放时写入 AudioSource' })
    bgmVolume: number = 0.6;

    @property({ tooltip: '音效基础音量（0-1），与播放时传入的音量倍率相乘' })
    sfxVolume: number = 1;

    /** 节点上的 AudioSource 组件，onLoad 时获取；缺失则无法出声 */
    private _audioSource: AudioSource | null = null;

    onLoad() {
        if (!AudioManager.instance?.isValid) {
            AudioManager.instance = this;
        }

        this._audioSource = this.getComponent(AudioSource);
        if (!this._audioSource) {
            warn('[AudioManager] Audio 节点上未找到 AudioSource 组件，音频无法播放');
        }
    }

    onDestroy() {
        if (AudioManager.instance === this) {
            AudioManager.instance = null;
        }
    }

    /**
     * 播放指定类型的音效。
     * @param type 音效类型（SfxType）
     * @param volumeScale 音量倍率，默认 1，最终音量 = sfxVolume * volumeScale
     */
    public playSfx(type: SfxType, volumeScale: number = 1): void {
        this.playClip(this.getClip(type), volumeScale);
    }

    /**
     * 直接播放一段音效资源，用于类型枚举之外的临时资源。
     * @param clip 要播放的音频资源
     * @param volumeScale 音量倍率，默认 1，最终音量 = sfxVolume * volumeScale
     */
    public playClip(clip: AudioClip | null | undefined, volumeScale: number = 1): void {
        if (!clip?.isValid || !this._audioSource) return;

        // playOneShot 走一次性音轨：多个音效同时触发时叠加播放，不会打断彼此
        this._audioSource.playOneShot(clip, this.clamp01(this.sfxVolume * volumeScale));
    }

    /**
     * 循环播放背景音乐。
     * 已在播放同一段背景音乐时不会重新起播，仅同步音量，避免从头开始。
     */
    public playBgm(): void {
        const source = this._audioSource;
        if (!source || !this.bgmClip?.isValid) return;

        if (source.playing && source.clip === this.bgmClip) {
            source.volume = this.clamp01(this.bgmVolume);
            return;
        }

        source.clip = this.bgmClip;
        source.loop = true;
        source.volume = this.clamp01(this.bgmVolume);
        source.play();
    }

    /** 停止背景音乐并释放播放位置，再次调用 playBgm() 会从头开始 */
    public stopBgm(): void {
        if (!this._audioSource) return;

        this._audioSource.stop();
    }

    /** 暂停背景音乐，保留当前播放位置 */
    public pauseBgm(): void {
        if (!this._audioSource?.playing) return;

        this._audioSource.pause();
    }

    /** 从暂停位置继续播放背景音乐 */
    public resumeBgm(): void {
        if (!this._audioSource || this._audioSource.playing) return;

        this._audioSource.play();
    }

    /** 背景音乐是否正在播放（暂停时也视为正在播放） */
    public isBgmPlaying(): boolean {
        return this._audioSource ? this._audioSource.playing : false;
    }

    /** 修改背景音乐音量（0-1），正在播放时立即生效 */
    public setBgmVolume(volume: number): void {
        this.bgmVolume = this.clamp01(volume);
        if (!this._audioSource) return;

        this._audioSource.volume = this.bgmVolume;
    }

    /** 修改音效音量（0-1），对后续播放的音效生效 */
    public setSfxVolume(volume: number): void {
        this.sfxVolume = this.clamp01(volume);
    }

    /** 获取音效类型对应的音频资源 */
    public getClip(type: SfxType): AudioClip | null {
        switch (type) {
            case SfxType.Shoot:
                return this.shootClip;
            case SfxType.Hit:
                return this.hitClip;
            case SfxType.Hurt:
                return this.hurtClip;
            case SfxType.Death:
                return this.deathClip;
            case SfxType.UiClick:
                return this.uiClickClip;
            default:
                return null;
        }
    }

    /** 静态快捷方式：播放指定类型的音效，未挂载 AudioManager 时静默忽略 */
    public static play(type: SfxType, volumeScale: number = 1): void {
        AudioManager.instance?.playSfx(type, volumeScale);
    }

    /** 静态快捷方式：循环播放背景音乐 */
    public static playBgm(): void {
        AudioManager.instance?.playBgm();
    }

    /** 静态快捷方式：停止背景音乐 */
    public static stopBgm(): void {
        AudioManager.instance?.stopBgm();
    }

    /** 将音量限制在 0-1 区间 */
    private clamp01(value: number): number {
        if (!Number.isFinite(value)) return 0;

        return Math.min(1, Math.max(0, value));
    }
}
