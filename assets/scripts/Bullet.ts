import { _decorator, Component, Node, Camera, Collider2D, Contact2DType, IPhysics2DContact, UITransform, Vec2, Vec3, view, find } from 'cc';
import { BulletSkillStats, CRIT_DAMAGE_MULTIPLIER } from './SkillConfig';
import { AudioManager, SfxType } from './AudioManager';
import { EventBus } from './EventBus';
import { BulletPool } from './BulletPool';
import {
    DAMAGE_ENEMY,
    DAMAGE_TEXT_REQUEST,
    GAME_PAUSE_CHANGE,
    DamageEnemyPayload,
    DamageTextPayload,
} from './GameEvents';
const { ccclass, property } = _decorator;

/** 场景中摄像机的路径，用于按可视范围判断子弹是否飞出屏幕 */
const CAMERA_PATH = 'Canvas/Camera';

/** 弧度转角度 */
const RAD_TO_DEG = 180 / Math.PI;

/**
 * 子弹：挂载在 Bullet 预制件根节点上。
 * 设定方向后按该方向持续飞行；
 * 命中敌人（分组 ENEMY）时结算伤害，之后把自身归还对象池（触发穿透则继续飞行）；
 * 飞出地图/屏幕范围后同样归还对象池，而不是销毁节点，以便下次发射时直接复用。
 *
 * 节点在启用时会自行绑定到当前默认的对象池（见 `BulletPool.defaultPool`），
 * 未被对象池接管的节点（例如池容量用尽时的临时节点）仍按原逻辑销毁。
 *
 * 伤害、速度、穿透、暴击、击退、减速等数值由玩家发射时通过
 * `applySkillStats()` 按当前技能等级表写入。
 */
@ccclass('Bullet')
export class Bullet extends Component {
    @property({ tooltip: '飞行速度（像素/秒）' })
    speed: number = 600;

    @property({ tooltip: '命中敌人造成的伤害值' })
    damage: number = 12;

    @property({ type: Vec2, tooltip: '飞行方向，会自动归一化' })
    direction: Vec2 = new Vec2(1, 0);

    @property({ tooltip: '穿透概率（0~1），命中敌人后按该概率继续飞行' })
    pierceRate: number = 0;

    @property({ tooltip: '暴击概率（0~1），触发暴击时伤害翻倍' })
    critRate: number = 0;

    @property({ tooltip: '命中时击退敌人的距离（像素），0 表示不击退' })
    knockback: number = 0;

    @property({ tooltip: '命中时敌人减速比例（0~1），0 表示不减速' })
    slowRate: number = 0;

    @property({ tooltip: '减速持续时间（秒）' })
    slowDuration: number = 0;

    @property({ tooltip: '敌人所在分组（ENEMY 的分组掩码，默认 4）' })
    enemyGroup: number = 4;

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
    /** 本次飞行中已经命中过的敌人，穿透时避免对同一敌人重复结算 */
    private _hitNodes: Node[] = [];

    /** 所属对象池：结束时把节点归还给它；没有对象池（临时节点）时按原逻辑销毁 */
    private _pool: BulletPool | null = null;
    private readonly _tmpPos: Vec3 = new Vec3();

    onLoad() {
        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
    }

    onEnable() {
        // 每次启用都重新绑定当前默认的对象池：节点是复用的，所属池可能已重建
        this._pool = BulletPool.defaultPool;

        this._dead = false;
        this._hitNodes.length = 0;
        this._dir.set(this.direction).normalize();
        this.refreshRange();
        this.updateFacing();

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

    /**
     * 让子弹节点朝向飞行方向。
     * 拖尾粒子挂在名为 Trail 的子节点上（位于节点局部 -X 侧即尾部），
     * 节点转向后子节点才会始终落在子弹尾部，喷射方向也随之朝后。
     */
    private updateFacing() {
        if (this._dir.x === 0 && this._dir.y === 0) return;
        this.node.setRotationFromEuler(0, 0, Math.atan2(this._dir.y, this._dir.x) * RAD_TO_DEG);
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

        // 飞出屏幕：归还对象池而不是销毁节点
        if (this.isOutOfRange()) {
            this.returnToPool();
        }
    }

    /** 设定飞行方向（内部归一化） */
    public setDirection(dir: Vec2) {
        this.direction.set(dir);
        this._dir.set(dir).normalize();
        this.updateFacing();
    }

    /**
     * 把玩家当前的技能增强效果写入子弹。
     * 玩家每次攻击前按技能等级表计算出属性集合并调用此方法。
     */
    public applySkillStats(stats: BulletSkillStats) {
        this.speed = stats.speed;
        this.damage = stats.damage;
        this.pierceRate = stats.pierceRate;
        this.critRate = stats.critRate;
        this.knockback = stats.knockback;
        this.slowRate = stats.slowRate;
        this.slowDuration = stats.slowDuration;
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

        const camera = Bullet.getCamera();
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
            const camera = Bullet.getCamera();
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

    /**
     * 碰撞开始回调：命中敌人后结算伤害与附加效果，
     * 未触发穿透则销毁自身，触发穿透则继续飞行。
     */
    private onBeginContact(selfCollider: Collider2D, otherCollider: Collider2D, contact: IPhysics2DContact | null) {
        if (this._dead || !otherCollider?.isValid) return;
        if (otherCollider.group !== this.enemyGroup) return;

        const enemyNode = otherCollider.node;
        if (enemyNode && this._hitNodes.indexOf(enemyNode) < 0) {
            this._hitNodes.push(enemyNode);

            const isCrit = Math.random() < Math.max(0, this.critRate);
            const damage = Math.max(0, this.damage) * (isCrit ? CRIT_DAMAGE_MULTIPLIER : 1);

            // 伤害结算与飘字都通过事件发出：子弹不再持有敌人脚本与飘字预制件
            const damagePayload: DamageEnemyPayload = {
                node: enemyNode,
                damage,
                dirX: this._dir.x,
                dirY: this._dir.y,
                knockback: this.knockback,
                slowRate: this.slowRate,
                slowDuration: this.slowDuration,
            };
            EventBus.emit<DamageEnemyPayload>(DAMAGE_ENEMY, damagePayload);

            const worldPos = this.node.worldPosition;
            const textPayload: DamageTextPayload = {
                x: worldPos.x,
                y: worldPos.y,
                damage,
                crit: isCrit,
            };
            EventBus.emit<DamageTextPayload>(DAMAGE_TEXT_REQUEST, textPayload);

            // 命中敌人：干脆的撞击声
            AudioManager.play(SfxType.Hit);
        }

        // 触发穿透时保留子弹，继续飞行攻击后续敌人
        if (Math.random() < Math.max(0, this.pierceRate)) return;

        // 命中敌人后收回对象池等待复用
        this.returnToPool();
    }

    /**
     * 结束本次飞行：由对象池接管时把节点隐藏并归还，未接管时按原逻辑销毁。
     * 归还动作会触发 `onDisable`（解绑碰撞监听），下次复用时 `onEnable` 会重新装配。
     */
    private returnToPool() {
        if (this._dead) return;
        this._dead = true;

        if (!this.node?.isValid) return;

        if (this._pool) {
            this._pool.release(this.node);
            return;
        }

        this.node.destroy();
    }

    private static getCamera(): Camera | null {
        if (Bullet._camera?.isValid) return Bullet._camera;

        const node = find(CAMERA_PATH);
        Bullet._camera = node ? node.getComponent(Camera) : null;
        return Bullet._camera;
    }
}
