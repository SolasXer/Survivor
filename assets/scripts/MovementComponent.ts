import { _decorator, Component, Node, UITransform, Vec2, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/** 距离小于该值（的平方）即认为已经贴近目标，停止移动，避免来回抖动 */
const MIN_DISTANCE_SQ = 0.0001;

/**
 * 移动组件：玩家与敌人共用的位移控制。
 *
 * 只负责「怎么动」，不关心为什么动：
 * - `setDirection()` + `move()`：按方向在局部坐标移动一帧，并在配置边界时钳制在边界内（玩家）；
 * - `moveToward()`：朝目标方向在世界坐标移动一帧，可按速度倍率缩放（敌人追击，受减速影响）；
 * - `translate()`：世界坐标下的直接位移，用于击退等外部推力。
 *
 * 挂载方式：挂到玩家 / 敌人节点上，由 `PlayerController` 或 `Enemy` 在 `onLoad` 中
 * 取用（节点上未预先挂载时会自动补挂一个）。
 */
@ccclass('MovementComponent')
export class MovementComponent extends Component {
    @property({ tooltip: '移动速度（像素/秒）' })
    speed: number = 300;

    @property({ type: Node, tooltip: '移动边界节点（Background），留空表示不限制移动范围' })
    bounds: Node | null = null;

    /** 当前移动方向，由外部通过 setDirection() 写入 */
    private readonly _dir: Vec2 = new Vec2(0, 0);

    private readonly _tmpPos: Vec3 = new Vec3();

    /** 边界半宽高（已换算到自身父节点坐标系），未设置边界时为 0 */
    private _halfX: number = 0;
    private _halfY: number = 0;

    onLoad() {
        this.refreshBounds();
    }

    /** 设置移动方向（不做归一化，由调用方决定是否需要） */
    public setDirection(x: number, y: number) {
        this._dir.set(x, y);
    }

    /** 当前移动方向 */
    public getDirection(): Vec2 {
        return this._dir;
    }

    /** 停止移动：方向归零 */
    public stop() {
        this._dir.set(0, 0);
    }

    /** 取当前实际速度：基础速度 × 速度倍率（倍率用于敌人的减速效果） */
    public getSpeed(speedScale: number = 1): number {
        return Math.max(0, this.speed) * Math.max(0, speedScale);
    }

    /**
     * 按当前方向移动一帧（局部坐标），配置了边界时把结果钳制在边界内。
     * @param dt 帧间隔（秒）
     * @param speedScale 速度倍率，1 表示原速
     * @returns 是否发生了移动，方向为零时返回 false
     */
    public move(dt: number, speedScale: number = 1): boolean {
        if (this._dir.x === 0 && this._dir.y === 0) return false;

        const step = this.getSpeed(speedScale) * Math.max(0, dt);
        const pos = this.node.position;

        let x = pos.x + this._dir.x * step;
        let y = pos.y + this._dir.y * step;

        const bounds = this.bounds;
        if (bounds?.isValid) {
            const center = bounds.position;
            x = clamp(x, center.x - this._halfX, center.x + this._halfX);
            y = clamp(y, center.y - this._halfY, center.y + this._halfY);
        }

        this._tmpPos.set(x, y, pos.z);
        this.node.setPosition(this._tmpPos);
        return true;
    }

    /**
     * 朝 (dx, dy) 方向移动一帧（世界坐标），距离目标不足 `stopDistance` 时不再前进。
     * @param dx / dy 指向目标的位移分量（世界坐标）
     * @param stopDistance 距离目标还剩该值（像素）时停止，0 表示一直贴到目标
     * @param dt 帧间隔（秒）
     * @param speedScale 速度倍率，敌人的减速效果通过它生效
     * @returns 是否发生了移动
     */
    public moveToward(dx: number, dy: number, stopDistance: number, dt: number, speedScale: number = 1): boolean {
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= MIN_DISTANCE_SQ) return false;

        const distance = Math.sqrt(distanceSq);
        const remain = distance - Math.max(0, stopDistance);
        if (remain <= 0) return false;

        const step = Math.min(this.getSpeed(speedScale) * Math.max(0, dt), remain);
        this.translate((dx / distance) * step, (dy / distance) * step);
        return true;
    }

    /** 在世界坐标下直接位移指定距离，用于击退等外部推力 */
    public translate(dx: number, dy: number) {
        const pos = this.node.worldPosition;
        this._tmpPos.set(pos.x + dx, pos.y + dy, pos.z);
        this.node.setWorldPosition(this._tmpPos);
    }

    /**
     * 重新计算边界半宽高：边界尺寸内缩自身尺寸的一半，并换算到自身父节点坐标系。
     * 边界节点尺寸或缩放变化后需要重新调用。
     */
    public refreshBounds() {
        const bounds = this.bounds;
        if (!bounds?.isValid) {
            this._halfX = 0;
            this._halfY = 0;
            return;
        }

        const boundsUI = bounds.getComponent(UITransform);
        const selfUI = this.node.getComponent(UITransform);

        // 内缩自身尺寸的一半，保证节点整体留在边界内
        let limitX = Math.max(0, (boundsUI ? boundsUI.width * 0.5 : 0) - (selfUI ? selfUI.width * 0.5 : 0));
        let limitY = Math.max(0, (boundsUI ? boundsUI.height * 0.5 : 0) - (selfUI ? selfUI.height * 0.5 : 0));

        const parent = this.node.parent;
        if (parent) {
            limitX *= Math.abs(bounds.scale.x) || 1;
            limitY *= Math.abs(bounds.scale.y) || 1;

            const parentScaleX = Math.abs(parent.scale.x) || 1;
            const parentScaleY = Math.abs(parent.scale.y) || 1;
            if (parentScaleX > 0) limitX /= parentScaleX;
            if (parentScaleY > 0) limitY /= parentScaleY;
        }

        this._halfX = limitX;
        this._halfY = limitY;
    }
}

function clamp(v: number, min: number, max: number): number {
    if (v < min) return min;
    if (v > max) return max;
    return v;
}
