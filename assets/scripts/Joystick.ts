import { _decorator, Component, Node, Vec2, Vec3, UITransform, EventTouch, Input } from 'cc';
import { EventBus } from './EventBus';
import { JOYSTICK_MOVE, JOYSTICK_MOVE_END, JOYSTICK_MOVE_START } from './GameEvents';
const { ccclass, property } = _decorator;

/**
 * 摇杆组件：挂载在 Joystick 节点上。
 * 触摸开始：记录触摸、手柄开始跟随；
 * 触摸移动：计算相对摇杆中心的方向（归一化），手柄限制在底座半径内；
 * 触摸结束/取消：方向归零、手柄复位，并广播结束事件。
 *
 * 输入通过全局事件总线发出（事件名见 GameEvents），载荷为归一化的 Vec2 方向：
 *   EventBus.emit(JOYSTICK_MOVE_START, dir)
 *   EventBus.emit(JOYSTICK_MOVE, dir)
 *   EventBus.emit(JOYSTICK_MOVE_END, dir)  // dir 为 (0, 0)
 *
 * 摇杆不认识任何角色脚本，谁想移动就自己去订阅这些事件。
 */
@ccclass('Joystick')
export class Joystick extends Component {
    @property({ type: Node, tooltip: '摇杆底座节点（决定触摸中心与最大半径）' })
    background: Node = null!;

    @property({ type: Node, tooltip: '摇杆手柄节点（跟随触摸位置移动）' })
    handle: Node = null!;

    @property({ tooltip: '手柄可移动的最大半径；<=0 时自动取底座宽的一半' })
    radius: number = 0;

    private _moveRadius: number = 0;
    private _active: boolean = false;
    private _dir: Vec2 = new Vec2(0, 0);
    private _uiTransform: UITransform = null!;

    private readonly _tmpLocal: Vec3 = new Vec3();
    private readonly _tmpHandle: Vec3 = new Vec3();

    onLoad() {
        this._uiTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);

        // 默认半径取底座宽度的一半
        const bgSize = this.background?.getComponent(UITransform)?.contentSize;
        const autoRadius = bgSize ? bgSize.width * 0.5 : 70;
        this._moveRadius = this.radius > 0 ? this.radius : autoRadius;

        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onTouchStart(event: EventTouch) {
        this._active = true;
        this.updateHandleAndDirection(event);
        EventBus.emit<Vec2>(JOYSTICK_MOVE_START, this._dir.clone());
    }

    private onTouchMove(event: EventTouch) {
        if (!this._active) {
            // 某些情况下可能先收到 MOVE，兜底激活
            this._active = true;
            EventBus.emit<Vec2>(JOYSTICK_MOVE_START, this._dir.clone());
        }
        this.updateHandleAndDirection(event);
        EventBus.emit<Vec2>(JOYSTICK_MOVE, this._dir.clone());
    }

    private onTouchEnd(_event: EventTouch) {
        if (!this._active) return;
        this._active = false;

        // 方向归零、手柄复位
        this._dir.set(0, 0);
        if (this.handle) {
            this._tmpHandle.set(0, 0, 0);
            this.handle.setPosition(this._tmpHandle);
        }

        EventBus.emit<Vec2>(JOYSTICK_MOVE_END, this._dir.clone());
    }

    /**
     * 将触摸的世界坐标转换到 Joystick 节点本地坐标，
     * 限制手柄在半径内，并计算归一化方向。
     */
    private updateHandleAndDirection(event: EventTouch) {
        const worldPos = event.getUILocation();
        this._uiTransform.convertToNodeSpaceAR(
            new Vec3(worldPos.x, worldPos.y, 0),
            this._tmpLocal
        );

        let x = this._tmpLocal.x;
        let y = this._tmpLocal.y;

        const distSq = x * x + y * y;
        const r = this._moveRadius;
        if (distSq > r * r) {
            const dist = Math.sqrt(distSq) || 1;
            x = (x / dist) * r;
            y = (y / dist) * r;
        }

        if (this.handle) {
            this._tmpHandle.set(x, y, 0);
            this.handle.setPosition(this._tmpHandle);
        }

        // 归一化方向（触摸点距中心过近时视为无方向，避免抖动）
        const len = Math.sqrt(x * x + y * y);
        if (len > 0.0001) {
            this._dir.set(x / r, y / r);
        } else {
            this._dir.set(0, 0);
        }
    }
}
