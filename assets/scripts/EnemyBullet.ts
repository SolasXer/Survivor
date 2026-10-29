import { _decorator, Component, Node, Camera, Collider2D, Contact2DType, IPhysics2DContact, UITransform, Vec2, Vec3, view, find } from 'cc';
import { EventBus } from './EventBus';
import { DamagePlayerPayload, DAMAGE_PLAYER, GAME_PAUSE_CHANGE } from './GameEvents';
const { ccclass, property } = _decorator;

/** 场景中摄像机的路径，用于按可视范围判断子弹是否飞出屏幕 */
const CAMERA_PATH = 'Canvas/Camera';

/**
 * 敌人子弹：挂载在 EnemyBullet 预制件根节点上。
 * 由远程敌人（Goblin）发射，设定方向后按该方向持续飞行；
 * 命中玩家（分组 PLAYER）时结算伤害并销毁自身；
 * 飞出地图/屏幕范围后自动销毁。
 *
 * 飞行方向由发射者在 instantiate 之后通过 `setDirection()` 写入，
 * 速度与伤害由发射者按 EnemyConfig 中的 ranged 配置写入。
 */
@ccclass('EnemyBullet')
export class EnemyBullet extends Component {
    @property({ tooltip: '飞行速度（像素/秒）' })
    speed: number = 300;

    @property({ tooltip: '命中玩家造成的伤害值' })
    damage: number = 8;

    @property({ type: Vec2, tooltip: '飞行方向，会自动归一化' })
    direction: Vec2 = new Vec2(1, 0);

    @property({ tooltip: '玩家所在分组（PLAYER 的分组掩码，默认 2）' })
    playerGroup: number = 2;

    @property({ type: Node, tooltip: '地图边界节点（Background），留空则按摄像机可视范围判断' })
    bounds: Node | null = null;

    @property({ tooltip: '允许超出边界多少距离后才销毁（像素）' })
    destroyMargin: number = 120;

    private static _camera: Camera | null = null;

    private _dir: Vec2 = new Vec2(1, 0);
    private _collider: Collider2D | null = null;

    private _centerX: number = 0;
    private _centerY: number = 0;
    private _halfX: number = 0;
    private _halfY: number = 0;
    private _followCamera: boolean = false;

    /** 游戏暂停时为 true，此时子弹停止飞行 */
    private _paused: boolean = false;

    private _dead: boolean = false;

    private readonly _tmpPos: Vec3 = new Vec3();

    onLoad() {
        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
    }

    onEnable() {
        this._dead = false;
        this._dir.set(this.direction).normalize();
        this.refreshRange();

        this._collider = this.getComponent(Collider2D);
        if (this._collider) {
            this._collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }
    }

    onDisable() {
        if (this._collider) {
            this._collider.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
            this._collider = null;
        }
    }

    onDestroy() {
        EventBus.off<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
    }

    /** 游戏暂停状态变化：暂停时子弹停止飞行 */
    private onPauseChange(paused: boolean) {
        this._paused = paused;
    }

    update(dt: number) {
        if (this._dead || this._paused) return;
        if (this._dir.x === 0 && this._dir.y === 0) return;

        const pos = this.node.worldPosition;
        this._tmpPos.set(
            pos.x + this._dir.x * this.speed * dt,
            pos.y + this._dir.y * this.speed * dt,
            pos.z
        );
        this.node.setWorldPosition(this._tmpPos);

        if (this.isOutOfRange()) {
            this.destroySelf();
        }
    }

    /** 设定飞行方向（内部归一化） */
    public setDirection(dirX: number, dirY: number) {
        this.direction.set(dirX, dirY);
        this._dir.set(dirX, dirY).normalize();
    }

    /** 计算销毁范围：优先使用地图边界节点，否则使用摄像机可视范围 */
    private refreshRange() {
        const ui = this.bounds ? this.bounds.getComponent(UITransform) : null;
        if (this.bounds && ui) {
            const rect = ui.getBoundingBoxToWorld();
            this._centerX = rect.x + rect.width * 0.5;
            this._centerY = rect.y + rect.height * 0.5;
            this._halfX = rect.width * 0.5;
            this._halfY = rect.height * 0.5;
            this._followCamera = false;
            return;
        }

        const camera = EnemyBullet.getCamera();
        const visible = view.getVisibleSize();
        const halfH = camera ? Math.abs(camera.orthoHeight) : visible.height * 0.5;
        const aspect = visible.height > 0 ? visible.width / visible.height : 16 / 9;

        this._halfX = halfH * aspect;
        this._halfY = halfH;
        this._followCamera = true;
    }

    /** 是否已飞出有效范围 */
    private isOutOfRange(): boolean {
        if (this._halfX <= 0 || this._halfY <= 0) return false;

        let centerX = this._centerX;
        let centerY = this._centerY;
        if (this._followCamera) {
            const camera = EnemyBullet.getCamera();
            if (!camera) return false;

            const cameraPos = camera.node.worldPosition;
            centerX = cameraPos.x;
            centerY = cameraPos.y;
        }

        const pos = this.node.worldPosition;
        const margin = Math.abs(this.destroyMargin);
        return Math.abs(pos.x - centerX) > this._halfX + margin
            || Math.abs(pos.y - centerY) > this._halfY + margin;
    }

    /** 碰撞开始回调：命中玩家后结算伤害并销毁自身 */
    private onBeginContact(selfCollider: Collider2D, otherCollider: Collider2D, contact: IPhysics2DContact | null) {
        if (this._dead || !otherCollider?.isValid) return;
        if (otherCollider.group !== this.playerGroup) return;

        // 伤害通过事件发出，由玩家侧自行结算，子弹不需要认识玩家脚本
        const payload: DamagePlayerPayload = { damage: Math.max(0, this.damage) };
        EventBus.emit<DamagePlayerPayload>(DAMAGE_PLAYER, payload);

        this.destroySelf();
    }

    private destroySelf() {
        if (this._dead) return;
        this._dead = true;

        if (this.node?.isValid) {
            this.node.destroy();
        }
    }

    private static getCamera(): Camera | null {
        if (EnemyBullet._camera?.isValid) return EnemyBullet._camera;

        const node = find(CAMERA_PATH);
        EnemyBullet._camera = node ? node.getComponent(Camera) : null;
        return EnemyBullet._camera;
    }
}
