import { _decorator, Component, Vec3 } from 'cc';
import { EventBus } from './EventBus';
import { SHAKE_REQUEST, ShakePayload } from './GameEvents';
const { ccclass, property } = _decorator;

/**
 * 屏幕震动：挂载在 Canvas/Camera 节点上，位于 CameraFollow 之后。
 * 监听 `SHAKE_REQUEST` 事件触发震动（也可直接调用 shake()）：
 * 触发后摄像机在 duration（默认 0.1 秒）内每帧产生一次小幅随机位置偏移，
 * 计时结束后撤销偏移，摄像机恢复到原始（跟随）位置。
 * 与 CameraFollow 的配合：CameraFollow 每帧在 lateUpdate 里重写摄像机位置，
 * 本组件排在其后执行，因此是在跟随位置的基础上叠加偏移，震动结束即自然复位。
 */
@ccclass('ScreenShake')
export class ScreenShake extends Component {
    @property({ tooltip: '单次震动的持续时间（秒）' })
    duration: number = 0.1;

    @property({ tooltip: '震动的随机偏移幅度（像素）' })
    amplitude: number = 8;

    /** 剩余震动时间（秒），大于 0 表示正在震动 */
    private _timer: number = 0;

    /** 本次震动使用的时长与幅度，触发时锁定，避免震动过程中改属性造成突变 */
    private _shakeDuration: number = 0;
    private _shakeAmplitude: number = 0;

    /** 上一帧实际叠加的偏移量，用于撤销 */
    private _offsetX: number = 0;
    private _offsetY: number = 0;

    /** 上一帧写入后的摄像机坐标，用于判断期间位置是否被其他脚本（CameraFollow）重写 */
    private _writtenX: number = 0;
    private _writtenY: number = 0;
    private _written: boolean = false;

    private readonly _tmpPos: Vec3 = new Vec3();

    onLoad() {
        EventBus.on<ShakePayload>(SHAKE_REQUEST, this.onShakeRequest, this);
    }

    onDestroy() {
        EventBus.off<ShakePayload>(SHAKE_REQUEST, this.onShakeRequest, this);
    }

    onDisable() {
        this.stop();
    }

    /** 收到震动请求：按请求中携带的幅度（缺省用自身配置）触发一次震动 */
    private onShakeRequest(payload: ShakePayload) {
        this.shake(payload?.amplitude);
    }

    /**
     * 触发一次屏幕震动：摄像机在 duration 秒内随机抖动后自动复位。
     * 震动期间重复调用会重新开始一轮震动。
     * @param amplitude 覆盖默认幅度的震动幅度（像素），省略时使用组件自身配置
     */
    public shake(amplitude?: number) {
        this._shakeDuration = Math.max(0, this.duration);
        this._shakeAmplitude = Math.max(0, amplitude === undefined ? this.amplitude : amplitude);
        if (this._shakeDuration <= 0 || this._shakeAmplitude <= 0) return;

        this._timer = this._shakeDuration;
    }

    /** 立即结束震动并撤销已叠加的偏移，摄像机回到原始位置 */
    public stop() {
        this._timer = 0;
        this.revertOffset();
    }

    /** 是否正在震动 */
    public isShaking(): boolean {
        return this._timer > 0;
    }

    lateUpdate(dt: number) {
        // 先撤销上一帧的偏移，回到摄像机本帧的基准位置
        this.revertOffset();

        if (this._timer <= 0) return;

        this._timer -= dt;
        if (this._timer <= 0) {
            this._timer = 0;
            return;
        }

        const amp = this._shakeAmplitude;
        this._offsetX = (Math.random() * 2 - 1) * amp;
        this._offsetY = (Math.random() * 2 - 1) * amp;

        const pos = this.node.position;
        this._tmpPos.set(pos.x + this._offsetX, pos.y + this._offsetY, pos.z);
        this.node.setPosition(this._tmpPos);

        this._writtenX = this._tmpPos.x;
        this._writtenY = this._tmpPos.y;
        this._written = true;
    }

    /**
     * 撤销上一帧叠加的偏移。
     * 只有当摄像机位置仍是本组件上一帧写入的值时才撤销：
     * 期间若被 CameraFollow 等脚本重写过，说明偏移已被覆盖，无需再撤销，
     * 否则会把摄像机多推一次，产生漂移。
     */
    private revertOffset() {
        if (!this._written) return;

        this._written = false;

        const pos = this.node.position;
        if (Math.abs(pos.x - this._writtenX) > 0.0001 || Math.abs(pos.y - this._writtenY) > 0.0001) {
            this._offsetX = 0;
            this._offsetY = 0;
            return;
        }

        this._tmpPos.set(pos.x - this._offsetX, pos.y - this._offsetY, pos.z);
        this.node.setPosition(this._tmpPos);

        this._offsetX = 0;
        this._offsetY = 0;
    }
}
