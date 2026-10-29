import { _decorator, Component, Sprite, Material } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 2D 溶解特效播放器：挂在使用了 sprite-dissolve 材质（Custom Material）的
 * Sprite 节点上，控制材质的 u_progress 从 0（完整显示）推进到 1（完全溶解），
 * 呈现图片从下往上逐渐消失的效果。
 *
 * 使用步骤：
 * 1. Sprite 的 Custom Material 赋值为 assets/materials/sprite-dissolve；
 * 2. 本组件挂到同一个节点；
 * 3. 调节 duration / delay 等参数，或调用 play() / pause() / stop() 手动控制。
 */
@ccclass('DissolveEffect')
export class DissolveEffect extends Component {
    @property({ tooltip: '溶解播放时长（秒），进度从 0 到 1' })
    duration: number = 1;

    @property({ tooltip: '开始播放前的延迟（秒），循环时每轮重新等待' })
    delay: number = 0;

    @property({ tooltip: '组件启动后自动开始播放' })
    playOnStart: boolean = true;

    @property({ tooltip: '循环播放' })
    loop: boolean = false;

    @property({ tooltip: '往返播放：溶解完成后倒放复原，可与循环搭配反复来回' })
    pingpong: boolean = false;

    /** 一轮播放完成（非循环）时触发的回调，供外部（如敌人死亡后销毁节点）接续逻辑 */
    public onFinishCallback: (() => void) | null = null;

    private _sprite: Sprite | null = null;
    private _mat: Material | null = null;
    private _progress: number = 0;
    private _forward: boolean = true;
    private _playing: boolean = false;
    private _delayLeft: number = 0;
    /** 材质是否带 u_progress 属性（null 表示尚未检测） */
    private _hasProgress: boolean | null = null;

    /** 当前溶解进度：0 完整显示，1 完全溶解（可在代码里直接赋值） */
    public get progress(): number {
        return this._progress;
    }
    public set progress(v: number) {
        this._progress = v;
        this.applyProgress();
    }

    /** 是否正在播放 */
    public get playing(): boolean {
        return this._playing;
    }

    onLoad() {
        this._sprite = this.getComponent(Sprite);
    }

    start() {
        if (this.playOnStart) {
            this.play();
        } else {
            this.applyProgress();
        }
    }

    /** 从头开始播放（进度复位到 0） */
    public play() {
        this._progress = 0;
        this._forward = true;
        this._delayLeft = Math.max(0, this.delay);
        this._playing = true;
        this.applyProgress();
    }

    /** 从当前进度继续播放 */
    public resume() {
        this._playing = true;
    }

    /** 暂停，保留当前进度 */
    public pause() {
        this._playing = false;
    }

    /** 停止并复位到完整显示 */
    public stop() {
        this._playing = false;
        this.progress = 0;
    }

    /** 一轮播放完成（非循环）时回调，子类可重写 */
    protected onFinished() {
        const callback = this.onFinishCallback;
        if (callback) callback();
    }

    update(dt: number) {
        if (!this._playing) return;

        if (this._delayLeft > 0) {
            this._delayLeft -= dt;
            return;
        }

        const step = dt / Math.max(0.0001, this.duration);
        this._progress += this._forward ? step : -step;

        if (this._forward && this._progress >= 1) {
            this._progress = 1;
            if (this.pingpong) {
                this._forward = false;
            } else if (this.loop) {
                this._progress = 0;
                this._delayLeft = Math.max(0, this.delay);
            } else {
                this._playing = false;
                this.applyProgress();
                this.onFinished();
                return;
            }
        } else if (!this._forward && this._progress <= 0) {
            this._progress = 0;
            if (this.loop || this.pingpong) {
                this._forward = true;
                this._delayLeft = Math.max(0, this.delay);
            } else {
                this._playing = false;
                this.applyProgress();
                this.onFinished();
                return;
            }
        }

        this.applyProgress();
    }

    /** 把当前进度写入材质（取实例，不影响共享材质资产） */
    private applyProgress() {
        const mat = this.ensureMaterial();
        if (!mat) return;

        // 注意：不能用 Material.getProperty(name) 判断属性是否存在——
        // 引擎实现里属性还没写进 _props 时它返回 null（含义是“未设置过”，不是“不存在”），
        // 用它做判断会导致永远写不进去、进度停在 0。这里按 pass 的属性表检测一次并缓存。
        if (this._hasProgress === null) {
            const pass = mat.passes && mat.passes[0];
            this._hasProgress = !!pass && 'u_progress' in pass.properties;
        }
        if (!this._hasProgress) return;

        mat.setProperty('u_progress', this._progress, 0);
    }

    private ensureMaterial(): Material | null {
        if (this._mat?.isValid) return this._mat;
        this._sprite = this._sprite ?? this.getComponent(Sprite);
        this._mat = this._sprite ? this._sprite.getMaterialInstance(0) : null;
        this._hasProgress = null; // 换了材质就重新检测一次
        return this._mat;
    }
}
