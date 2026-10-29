import { _decorator, Component, Node, Sprite, SpriteFrame, UIOpacity } from 'cc';
import { EventBus } from './EventBus';
import { GAME_PAUSE_CHANGE } from './GameEvents';
const { ccclass, property } = _decorator;

/** 数字字符 '0' 的字符编码，用于把数字字符换算成 SpriteFrame 索引 */
const ZERO_CHAR_CODE = 48;

/** 透明度上限 */
const MAX_OPACITY = 255;

/**
 * 伤害飘字：挂载在 DamageText 预制件的根节点上。
 * 用 `digitFrames`（依次对应 ui_number_0 ~ ui_number_9）按位拼出数值，
 * 显示期间向上飘动 `riseHeight` 像素并逐渐透明，`duration` 秒后销毁自身。
 *
 * 使用方式：调用方实例化预制件并设置好世界坐标后，
 * 通过 `show(数值)` 启动本次飘字，未调用 `show()` 时不产生任何动画与内容。
 */
@ccclass('DamageText')
export class DamageText extends Component {
    @property({ type: [SpriteFrame], tooltip: '数字图，索引 0~9 依次对应 ui_number_0 ~ ui_number_9' })
    digitFrames: SpriteFrame[] = [];

    @property({ tooltip: '显示期间向上飘动的距离（像素）' })
    riseHeight: number = 60;

    @property({ tooltip: '显示总时长（秒），到时间后自动销毁' })
    duration: number = 0.5;

    @property({ tooltip: '相邻两个数字中心的间距（像素）' })
    charStep: number = 24;

    @property({ tooltip: '整体缩放，用于调整飘字大小' })
    textScale: number = 1;

    /** 本次飘字的起始坐标 */
    private _originX: number = 0;
    private _originY: number = 0;
    private _originZ: number = 0;

    /** 已经显示的时长（秒） */
    private _elapsed: number = 0;

    /** 是否正在展示（show 之后到销毁之前为 true） */
    private _playing: boolean = false;

    /** 本次生成的数字节点，重新显示或销毁前会清理 */
    private _digits: Node[] = [];

    /** 控制整组数字透明度，挂载在自身节点上 */
    private _uiOpacity: UIOpacity | null = null;

    /** 游戏暂停时为 true，此时飘字停止飘动，等待恢复 */
    private _paused: boolean = false;

    onLoad() {
        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        this.getUiOpacity();
    }

    /** 取（必要时补上）控制整组透明度的 UIOpacity */
    private getUiOpacity(): UIOpacity | null {
        if (!this._uiOpacity?.isValid) {
            this._uiOpacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity);
        }
        return this._uiOpacity;
    }

    onDestroy() {
        EventBus.off<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        this.clearDigits();
    }

    /** 游戏暂停状态变化：暂停时飘字保持原地不动 */
    private onPauseChange(paused: boolean) {
        this._paused = paused;
    }

    update(dt: number) {
        if (!this._playing || this._paused) return;

        // 本次飘字可能跨越生成后的第一帧，先把 elapsed 推进再判定是否结束
        this._elapsed += dt;
        const total = Math.max(0, this.duration);
        if (total <= 0) {
            this.finish();
            return;
        }

        const progress = Math.min(1, this._elapsed / total);
        this.applyProgress(progress);

        if (progress >= 1) {
            this.finish();
        }
    }

    /**
     * 显示一个数值：先按位创建数字节点，再开始向上飘动并逐渐透明。
     * @param value 要显示的伤害数值，按四舍五入取整后展示
     */
    public show(value: number) {
        this.clearDigits();

        this.createDigits(Math.max(0, Math.round(value)));

        const pos = this.node.position;
        this._originX = pos.x;
        this._originY = pos.y;
        this._originZ = pos.z;

        const scale = Math.max(0.01, this.textScale);
        this.node.setScale(scale, scale, 1);

        this._elapsed = 0;
        this._playing = true;

        this.applyProgress(0);

        // 时长为 0 时无需等待下一次 update，直接结束
        if (Math.max(0, this.duration) <= 0) {
            this.finish();
        }
    }

    /** 按进度更新位置与透明度：向上飘动，同时从完全不透明渐变到全透明 */
    private applyProgress(progress: number) {
        const t = Math.min(1, Math.max(0, progress));

        this.node.setPosition(this._originX, this._originY + Math.max(0, this.riseHeight) * t, this._originZ);

        const opacity = this.getUiOpacity();
        if (opacity?.isValid) {
            opacity.opacity = Math.round(MAX_OPACITY * (1 - t));
        }
    }

    /** 按数值的每一位创建 Sprite 节点，整体居中排列 */
    private createDigits(value: number) {
        const text = value.toString();
        if (text.length <= 0 || this.digitFrames.length <= 0) return;

        const step = Math.max(1, this.charStep);
        // 让所有数字整体以自身节点为中心：首位坐标 = -(宽度的一半) + 半个数字格
        const offset = -(text.length - 1) * step / 2;

        for (let i = 0; i < text.length; i++) {
            const index = text.charCodeAt(i) - ZERO_CHAR_CODE;
            if (index < 0 || index > 9) continue;

            const frame = this.digitFrames[index];
            if (!frame) continue;

            const node = new Node(`Digit_${text[i]}`);
            node.layer = this.node.layer;

            const sprite = node.addComponent(Sprite);
            // RAW 模式：使用数字图原始 32x32 尺寸并按未裁剪位置绘制，保证各位数字基线一致
            sprite.sizeMode = Sprite.SizeMode.RAW;
            sprite.spriteFrame = frame;

            node.parent = this.node;
            node.setPosition(offset + i * step, 0, 0);

            this._digits.push(node);
        }
    }

    /** 销毁本次创建的数字节点 */
    private clearDigits() {
        for (let i = 0; i < this._digits.length; i++) {
            const node = this._digits[i];
            if (node?.isValid) {
                node.destroy();
            }
        }
        this._digits.length = 0;
    }

    /** 结束飘字并销毁自身 */
    private finish() {
        this._playing = false;

        this.clearDigits();
        if (this.node?.isValid) {
            this.node.destroy();
        }
    }
}
