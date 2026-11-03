import { _decorator, Component, Node, Prefab, Sprite, Color, Collider2D, Contact2DType, IPhysics2DContact, Vec2, find, instantiate, director } from 'cc';
import { DEFAULT_ENEMY_ID, EnemyConfig, EnemyId, getEnemyConfigOrDefault } from './EnemyConfig';
import { ConfigManager } from './ConfigManager';
import { getNodeDistanceSq } from './utils/MathUtils';
import { EnemyBullet } from './EnemyBullet';
import { DissolveEffect } from './DissolveEffect';
import { AudioManager, SfxType } from './AudioManager';
import { HealthComponent } from './HealthComponent';
import { MovementComponent } from './MovementComponent';
import { EventBus } from './EventBus';
import {
    DAMAGE_ENEMY,
    DAMAGE_PLAYER,
    ENEMY_KILLED,
    ENTITY_DIED,
    GAME_PAUSE_CHANGE,
    HEALTH_CHANGED,
    SHAKE_REQUEST,
    DamageEnemyPayload,
    DamagePlayerPayload,
    EnemyKilledPayload,
    EntityDiedPayload,
    HealthChangedPayload,
    ShakePayload,
} from './GameEvents';
const { ccclass, property } = _decorator;

/** 场景中玩家节点的默认路径 */
const PLAYER_PATH = 'Canvas/Player';

/** 敌人子弹默认挂载的容器节点路径 */
const BULLET_CONTAINER_PATH = 'Canvas/BulletContainer';

/** 受击闪烁时 Sprite 染成的颜色 */
const HIT_FLASH_COLOR = new Color(255, 90, 80, 255);

/**
 * 追踪目标的重算间隔（帧）：
 * 指向玩家的方向与距离每 RETARGET_FRAME_INTERVAL 帧才重算一次，
 * 中间那些帧直接沿用上一次缓存的方向继续移动，省掉每帧的世界坐标读取与开方。
 */
const RETARGET_FRAME_INTERVAL = 3;

/**
 * 敌人：挂载在 Slime 等各类敌人预制件的根节点上，所有敌人共用本脚本。
 * 具体数值（名称 / 生命值 / 移动速度 / 伤害 / 掉落经验）由 `EnemyConfig` 按 `enemyId` 提供，
 * 生成时（onEnable）自动读取并写入自身，因此新增敌人种类只需加配置 + 预制件，无需改动本脚本。
 * 激活时自动查找场景中的玩家并持续追击，撞到玩家时发出 `DAMAGE_PLAYER` 与 `SHAKE_REQUEST` 事件；
 * 被子弹命中时由 `DAMAGE_ENEMY` 事件驱动，敌人认领打在自己身上的那份伤害后走 takeHit()
 * 结算并附带击退/减速，生命值归零后发出 `ENEMY_KILLED` 并销毁敌人节点。
 * 受到伤害时 Sprite 会闪红 `hitFlashDuration` 秒后恢复原色，闪烁期间再次受伤则重新计时。
 * 行为分支由配置决定：配置 ranged 的敌人靠近到保持距离后停下射击；
 * 配置 phase 的敌人（Boss）生命值低于比例后进入第二阶段，加速并定时向四周环形射击。
 *
 * 生命值与移动已分别交给 `HealthComponent` 与 `MovementComponent`：
 * 受伤走生命值组件、位移走移动组件，本脚本只负责 AI、开火与受击表现。
 *
 * 本脚本只 import 事件字典，不认识玩家脚本、摄像机脚本与任何 UI 脚本。
 */
@ccclass('Enemy')
export class Enemy extends Component {
    @property({ tooltip: '敌人 ID，决定生成时从 EnemyConfig 读取哪一份配置' })
    enemyId: EnemyId = DEFAULT_ENEMY_ID;

    @property({ tooltip: '玩家子弹所在分组（PLAYER_BULLET 的分组掩码，默认 8）' })
    bulletGroup: number = 8;

    @property({ type: Node, tooltip: '玩家节点，留空则自动查找 Canvas/Player' })
    player: Node | null = null;

    @property({ tooltip: '被击退时的位移速度（像素/秒）' })
    knockbackSpeed: number = 800;

    @property({ tooltip: '是否为远程敌人：开启后靠近到 keepDistance 即停下并定时射击，由配置的 ranged 字段决定' })
    ranged: boolean = false;

    @property({ tooltip: '远程敌人与玩家保持的距离（像素），小于等于该距离时停止移动并射击' })
    keepDistance: number = 300;

    @property({ tooltip: '远程敌人的射击间隔（秒）' })
    fireInterval: number = 1.8;

    @property({ type: Prefab, tooltip: '远程敌人发射的子弹预制件（EnemyBullet）' })
    bulletPrefab: Prefab | null = null;

    @property({ tooltip: '远程敌人子弹的飞行速度（像素/秒）' })
    bulletSpeed: number = 300;

    @property({ tooltip: '远程敌人子弹命中玩家造成的伤害' })
    bulletDamage: number = 8;

    @property({ type: Node, tooltip: '敌人子弹挂载的容器节点，留空则自动查找 Canvas/BulletContainer' })
    bulletContainer: Node | null = null;

    @property({ tooltip: '玩家所在分组（PLAYER 的分组掩码，默认 2），用于接触玩家时结算伤害' })
    playerGroup: number = 2;

    @property({ tooltip: '受击时闪红的持续时间（秒），闪烁期间再次受到伤害会重置计时' })
    hitFlashDuration: number = 0.1;

    @property({ tooltip: '生命值低于该比例（0~1）时进入第二阶段，<=0 表示不分段' })
    phaseHpRatio: number = 0;

    @property({ tooltip: '第二阶段的移动速度倍率' })
    phaseMoveSpeedMultiplier: number = 1;

    @property({ tooltip: '第二阶段环形射击的间隔（秒）' })
    phaseFireInterval: number = 0;

    @property({ tooltip: '第二阶段每次环形射击发射的子弹数量' })
    phaseBulletCount: number = 0;

    /** 敌人名称，来自配置 */
    enemyName: string = '';

    /** 当前生命值，转发 HealthComponent（数值来自 EnemyConfig） */
    public get hp(): number {
        return this.getHealth()?.hp ?? 0;
    }
    public set hp(value: number) {
        const health = this.getHealth();
        if (health) health.setHp(value);
    }

    /** 追踪玩家的移动速度（像素/秒），转发 MovementComponent（数值来自 EnemyConfig） */
    public get moveSpeed(): number {
        return this.getMovement()?.speed ?? 0;
    }
    public set moveSpeed(value: number) {
        const movement = this.getMovement();
        if (movement) movement.speed = value;
    }

    /** 接触玩家时造成的伤害，来自配置 */
    damage: number = 0;

    /** 击败该敌人后玩家获得的经验值，来自配置 */
    exp: number = 0;

    /** 当前生效的配置，由 enemyId 决定 */
    private _config: EnemyConfig | null = null;

    private _collider: Collider2D | null = null;
    private _target: Node | null = null;
    private _dead: boolean = false;

    /** 溶解控制组件，阵亡时播放溶解动画，缺省时直接销毁节点 */
    private _dissolve: DissolveEffect | null = null;

    /** 受击描红用的 Sprite，位于敌人自身节点上 */
    private _sprite: Sprite | null = null;
    /** Sprite 原本的颜色，闪烁结束后恢复为该值 */
    private readonly _spriteColor: Color = new Color(255, 255, 255, 255);
    /** 受击闪烁的剩余时间（秒），大于 0 表示正在闪红 */
    private _flashTimer: number = 0;

    /** 游戏暂停时为 true，此时敌人停止行动 */
    private _paused: boolean = false;

    /** 当前减速比例（0~1）与剩余持续时间（秒） */
    private _slowRate: number = 0;
    private _slowTimer: number = 0;

    /** 击退方向与剩余击退距离 */
    private readonly _knockbackDir: Vec2 = new Vec2();
    private _knockbackRemain: number = 0;

    /** 远程敌人的射击倒计时（秒），归零时发射一颗子弹 */
    private _fireTimer: number = 0;

    /** 生命值上限，用于判断是否进入第二阶段 */
    private _maxHp: number = 0;

    /** 当前阶段：1 为初始阶段，2 为强化阶段 */
    private _phase: number = 1;

    /** 第二阶段环形射击的倒计时（秒） */
    private _phaseFireTimer: number = 0;

    /** 自动查找到的敌人子弹容器，避免每次开火都做一次查找 */
    private _bulletContainer: Node | null = null;

    /** 缓存的指向玩家的方向（玩家世界坐标 - 自身世界坐标，未归一化） */
    private readonly _cachedDir: Vec2 = new Vec2();

    /** 缓存的与玩家之间的距离平方，与 `_cachedDir` 同时刷新 */
    private _cachedDistanceSq: number = 0;

    /** 方向 / 距离缓存是否已生效，未生效时敌人不移动、不判断射击距离 */
    private _hasChaseCache: boolean = false;

    /** 重算节拍计数，每帧 +1，用于按 RETARGET_FRAME_INTERVAL 节流 */
    private _retargetTick: number = 0;

    /** 生命值组件：血量的读写全部转发给它 */
    private _health: HealthComponent | null = null;

    /** 移动组件：位移全部转发给它 */
    private _movement: MovementComponent | null = null;

    /** 生命值组件，节点上未挂载时自动补挂一个 */
    public getHealth(): HealthComponent | null {
        if (this._health?.isValid) return this._health;
        if (!this.node?.isValid) return null;

        this._health = this.getComponent(HealthComponent) ?? this.node.addComponent(HealthComponent);
        return this._health;
    }

    /** 移动组件，节点上未挂载时自动补挂一个 */
    public getMovement(): MovementComponent | null {
        if (this._movement?.isValid) return this._movement;
        if (!this.node?.isValid) return null;

        this._movement = this.getComponent(MovementComponent) ?? this.node.addComponent(MovementComponent);
        return this._movement;
    }

    onLoad() {
        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        // 只处理打在自己身上的伤害：命中事件由子弹发出，敌人自行认领
        EventBus.on<DamageEnemyPayload>(DAMAGE_ENEMY, this.onDamageEnemy, this);
        EventBus.on<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.on<EntityDiedPayload>(ENTITY_DIED, this.onEntityDied, this);

        // 组件缺省时自动补挂，保证旧预制件也能直接运行
        this.getHealth();
        this.getMovement();
    }

    /** 被玩家子弹命中：只认领打在自己身上的伤害，再走原有结算流程 */
    private onDamageEnemy(payload: DamageEnemyPayload) {
        if (!payload || payload.node !== this.node) return;

        this.takeHit(
            payload.damage,
            payload.dirX,
            payload.dirY,
            payload.knockback,
            payload.slowRate,
            payload.slowDuration
        );
    }

    /** 生命值变化：只处理自己的，掉血时闪红 */
    private onHealthChanged(payload: HealthChangedPayload) {
        if (!payload || payload.node !== this.node) return;
        if (payload.delta >= 0) return;

        this.startFlash();
    }

    /** 阵亡：只处理自己的 */
    private onEntityDied(payload: EntityDiedPayload) {
        if (!payload || payload.node !== this.node) return;

        this.die();
    }

    onEnable() {
        this._dead = false;
        this._slowRate = 0;
        this._slowTimer = 0;
        this._knockbackRemain = 0;
        this._fireTimer = 0;
        this._bulletContainer = null;
        this._dissolve = null;

        // 追踪缓存复位：下次 update 会立刻重算一次方向与距离
        this.resetChaseCache();

        // 生成时先按配置初始化属性，之后才开始行动
        this.applyConfig(this.enemyId);

        // 玩家节点只在初始化时查找一次并缓存，update 中不再反复查找
        this._target = this.findPlayer();

        this._collider = this.getComponent(Collider2D);
        if (this._collider) {
            this._collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }

        // 记录 Sprite 原本的颜色，作为闪烁结束后恢复的基准
        this._flashTimer = 0;
        this._sprite = this.getComponent(Sprite);
        if (this._sprite) {
            const color = this._sprite.color;
            this._spriteColor.set(color.r, color.g, color.b, color.a);
        }
    }

    onDisable() {
        if (this._collider) {
            this._collider.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
            this._collider = null;
        }
        this._target = null;
        this._bulletContainer = null;
        this.resetChaseCache();
    }

    onDestroy() {
        EventBus.off<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        EventBus.off<DamageEnemyPayload>(DAMAGE_ENEMY, this.onDamageEnemy, this);
        EventBus.off<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.off<EntityDiedPayload>(ENTITY_DIED, this.onEntityDied, this);
    }

    /** 游戏暂停状态变化：暂停时敌人停止行动 */
    private onPauseChange(paused: boolean) {
        this._paused = paused;

        // 阵亡后的溶解动画同样随暂停冻结，避免暂停期间敌人自己烧完
        if (!this._dead) return;
        if (!this._dissolve) this._dissolve = this.getComponent(DissolveEffect);
        if (!this._dissolve) return;

        if (paused) {
            this._dissolve.pause();
        } else {
            this._dissolve.resume();
        }
    }

    /**
     * 按敌人 ID 读取 EnemyConfig 中的配置，并把数值写入自身。
     * 生成时（onEnable）按 `enemyId` 自动调用一次；
     * 也可以在 instantiate 之后手动调用，把预制件切换成另一种敌人。
     * @param id 敌人配置 ID，非法或缺失时回退到默认配置
     */
    /**
     * 取指定敌人的配置：优先取 ConfigManager 读到的 `enemy.json`，
     * 没有 ConfigManager 时回退到脚本内置的 `EnemyConfig`（两者数值一致，故开局表现不变）。
     */
    private resolveConfig(id: EnemyId): EnemyConfig | null {
        const remote = ConfigManager.instance?.getEnemyConfigById(id as string);
        if (!remote) return getEnemyConfigOrDefault(id);

        return {
            id,
            name: remote.name,
            hp: remote.hp,
            moveSpeed: remote.moveSpeed,
            damage: remote.damage,
            exp: remote.exp,
            ranged: remote.ranged ? { ...remote.ranged } : undefined,
            phase: remote.phase ? { ...remote.phase } : undefined,
        };
    }

    public applyConfig(id: EnemyId) {
        const config = this.resolveConfig(id);
        if (!config) return;

        this._config = config;
        this.enemyId = config.id;
        this.enemyName = config.name;
        // 生命值与移动速度写入各自的组件，Enemy 只保留对外的读写入口
        const maxHp = Math.max(1, Math.round(config.hp));
        const health = this.getHealth();
        if (health) health.reset(maxHp, maxHp);

        const movement = this.getMovement();
        if (movement) movement.speed = Math.max(0, config.moveSpeed);

        this.damage = Math.max(0, config.damage);
        this.exp = Math.max(0, config.exp);
        this._maxHp = this.hp;

        // 远程参数：配置带 ranged 即为远程敌人，否则按近战处理
        const ranged = config.ranged;
        this.ranged = !!ranged;
        if (ranged) {
            this.keepDistance = Math.max(0, ranged.keepDistance);
            this.fireInterval = Math.max(0, ranged.fireInterval);
            this.bulletSpeed = Math.max(0, ranged.bulletSpeed);
            this.bulletDamage = Math.max(0, ranged.bulletDamage);
        }

        // 第二阶段参数：配置带 phase 的敌人在生命值过低时进入强化阶段
        const phase = config.phase;
        if (phase) {
            this.phaseHpRatio = Math.min(1, Math.max(0, phase.hpRatio));
            this.phaseMoveSpeedMultiplier = Math.max(1, phase.moveSpeedMultiplier);
            this.phaseFireInterval = Math.max(0, phase.fireInterval);
            this.phaseBulletCount = Math.max(0, Math.round(phase.bulletCount));
            this.bulletSpeed = Math.max(0, phase.bulletSpeed);
            this.bulletDamage = Math.max(0, phase.bulletDamage);
        } else {
            this.phaseHpRatio = 0;
            this.phaseMoveSpeedMultiplier = 1;
            this.phaseFireInterval = 0;
            this.phaseBulletCount = 0;
        }

        this._fireTimer = 0;
        this._phaseFireTimer = 0;
        this._phase = 1;
    }

    /** 当前生效的敌人配置，未初始化时为 null */
    public getConfig(): EnemyConfig | null {
        return this._config ?? getEnemyConfigOrDefault(this.enemyId);
    }

    update(dt: number) {
        if (this._dead || this._paused) return;

        // 生成后可能再叠加属性倍率，取出现过的最大生命值作为阶段判定基准
        if (this.hp > this._maxHp) this._maxHp = this.hp;

        this.updateFlash(dt);
        this.updateSlow(dt);

        // 击退位移期间不追击玩家
        if (this.updateKnockback(dt)) return;

        // 按帧刷新「指向玩家的方向 + 距离」缓存，未刷新的帧沿用上一次的结果
        this.updateChaseCache();

        // 远程敌人进入保持距离后停下射击，近战敌人一路追击
        if (this.ranged) {
            this.updateRanged(dt);
        } else {
            this.chase(dt);
        }

        // 第二阶段：在追击的同时定时向四周发射多发子弹
        if (this._phase >= 2) {
            this.updatePhaseFire(dt);
        }
    }

    /** 递减减速计时，到期后恢复原速 */
    private updateSlow(dt: number) {
        if (this._slowTimer <= 0) return;

        this._slowTimer -= dt;
        if (this._slowTimer <= 0) {
            this._slowTimer = 0;
            this._slowRate = 0;
        }
    }

    /**
     * 按剩余距离沿击退方向移动，本帧正在被击退时返回 true。
     */
    private updateKnockback(dt: number): boolean {
        if (this._knockbackRemain <= 0) return false;

        const step = Math.min(Math.max(0, this.knockbackSpeed) * dt, this._knockbackRemain);
        this.getMovement()?.translate(this._knockbackDir.x * step, this._knockbackDir.y * step);

        this._knockbackRemain -= step;
        if (this._knockbackRemain <= 0) this._knockbackRemain = 0;
        return true;
    }

    /** 自动查找玩家：优先使用路径，其次按节点名在场景中兜底查找，不依赖任何玩家脚本类型 */
    private findPlayer(): Node | null {
        if (this.player?.isValid) return this.player;

        const byPath = find(PLAYER_PATH);
        if (byPath) {
            this.player = byPath;
            return byPath;
        }

        const scene = director.getScene();
        if (!scene) return null;

        let found: Node | null = null;
        scene.walk((node: Node) => {
            if (!found && node.name === 'Player') found = node;
        });

        this.player = found;
        return found;
    }

    /**
     * 远程敌人的行为：
     * 与玩家的距离大于 `keepDistance` 时朝玩家靠近；
     * 距离小于等于 `keepDistance` 时停止移动，并按 `fireInterval` 定时向玩家发射子弹。
     */
    private updateRanged(dt: number) {
        // 方向与距离取自按帧节流维护的缓存，未缓存时（尚未算出过 / 玩家丢失）不行动
        if (!this._hasChaseCache) return;

        const keep = Math.max(0, this.keepDistance);
        const dir = this._cachedDir;

        // 距离玩家较远：继续靠近，最多前进到保持距离处，避免越过后抖动
        if (this._cachedDistanceSq > keep * keep) {
            this.getMovement()?.moveToward(dir.x, dir.y, keep, dt, this.getSpeedScale());
            return;
        }

        // 已进入保持距离：停止移动，按间隔开火
        this._fireTimer -= dt;
        if (this._fireTimer > 0) return;

        this._fireTimer = Math.max(0.05, this.fireInterval);
        const distance = Math.sqrt(this._cachedDistanceSq);
        this.fire(distance > 0 ? dir.x / distance : 0, distance > 0 ? dir.y / distance : 0);
    }

    /** 向给定方向发射一颗敌人子弹 */
    private fire(dirX: number, dirY: number) {
        if (!this.bulletPrefab) return;

        const node = instantiate(this.bulletPrefab);
        if (!node?.isValid) return;

        node.setWorldPosition(this.node.worldPosition);
        node.setParent(this.getBulletContainer());

        const bullet = node.getComponent(EnemyBullet);
        if (!bullet) return;

        bullet.setDirection(dirX, dirY);
        bullet.speed = Math.max(0, this.bulletSpeed);
        bullet.damage = Math.max(0, this.bulletDamage);
    }

    /**
     * 第二阶段：按 `phaseFireInterval` 定时向四周环形发射多发子弹。
     * 追击行为不受影响，与近战追击同时进行。
     */
    private updatePhaseFire(dt: number) {
        if (this.phaseFireInterval <= 0 || this.phaseBulletCount <= 0) return;

        this._phaseFireTimer -= dt;
        if (this._phaseFireTimer > 0) return;

        this._phaseFireTimer = Math.max(0.05, this.phaseFireInterval);
        this.fireRing(this.phaseBulletCount);
    }

    /** 以自身为圆心，等角度向四周发射 count 发子弹 */
    private fireRing(count: number) {
        if (!this.bulletPrefab || count <= 0) return;

        const total = Math.max(1, Math.round(count));
        const step = (Math.PI * 2) / total;
        for (let i = 0; i < total; i++) {
            const angle = step * i;
            this.fire(Math.cos(angle), Math.sin(angle));
        }
    }

    /**
     * 生命值低于 `phaseHpRatio` 时进入第二阶段：
     * 移动速度按倍率提升，并开始定时环形射击。
     */
    private checkPhase() {
        if (this._phase >= 2) return;

        const ratio = Math.min(1, Math.max(0, this.phaseHpRatio));
        if (ratio <= 0 || this._maxHp <= 0) return;
        if (this.hp > this._maxHp * ratio) return;

        this._phase = 2;
        this.moveSpeed *= Math.max(1, this.phaseMoveSpeedMultiplier);
        // 进入第二阶段立刻打出一轮，之后按间隔循环
        this._phaseFireTimer = Math.max(0.05, this.phaseFireInterval);
    }

    /** 敌人子弹的挂载容器：优先使用指定节点，其次 Canvas/BulletContainer，最后退回敌人所在父节点 */
    private getBulletContainer(): Node | null {
        if (this.bulletContainer?.isValid) return this.bulletContainer;
        if (this._bulletContainer?.isValid) return this._bulletContainer;

        const found = find(BULLET_CONTAINER_PATH);
        if (found?.isValid) {
            this._bulletContainer = found;
            return found;
        }
        return this.node.parent?.isValid ? this.node.parent : director.getScene();
    }

    /** 每帧朝玩家所在方向移动（近战敌人的行为）：方向取自按帧节流维护的缓存 */
    private chase(dt: number) {
        if (!this._hasChaseCache) return;

        const dir = this._cachedDir;
        this.getMovement()?.moveToward(dir.x, dir.y, 0, dt, this.getSpeedScale());
    }

    /**
     * 按帧刷新「指向玩家的方向 + 距离平方」缓存：
     * 每 `RETARGET_FRAME_INTERVAL` 帧才重新算一次，中间的帧直接沿用上次结果，
     * 由追击与远程判定共用；首次调用（刚生成）与缓存尚未生成时立即重算。
     */
    private updateChaseCache(): void {
        const due = this.consumeRetargetTick();
        if (!due && this._hasChaseCache) return;

        // 玩家引用失效时（例如玩家节点被销毁）按同样的节流间隔补查一次，而非每帧查找
        if (!this._target?.isValid) {
            this._target = this.findPlayer();
        }

        const target = this._target;
        if (!target?.isValid) {
            this._hasChaseCache = false;
            return;
        }

        const selfPos = this.node.worldPosition;
        const targetPos = target.worldPosition;
        this._cachedDir.set(targetPos.x - selfPos.x, targetPos.y - selfPos.y);
        this._cachedDistanceSq = getNodeDistanceSq(this.node, target);
        this._hasChaseCache = true;
    }

    /**
     * 每帧调用一次并推进节拍计数，间隔 `RETARGET_FRAME_INTERVAL` 帧返回一次 true。
     * 计数从 0 开始，因此刚生成的那一帧必定返回 true（立即算出首份缓存）。
     */
    private consumeRetargetTick(): boolean {
        const tick = this._retargetTick;
        ++this._retargetTick;
        return tick % RETARGET_FRAME_INTERVAL === 0;
    }

    /** 清空方向与距离缓存，使下一次 update 立即重新计算 */
    private resetChaseCache(): void {
        this._cachedDir.set(0, 0);
        this._cachedDistanceSq = 0;
        this._hasChaseCache = false;
        this._retargetTick = 0;
    }

    /** 当前移动速度倍率：减速比例越高走得越慢，交给移动组件按比例缩放速度 */
    private getSpeedScale(): number {
        return Math.max(0, 1 - this._slowRate);
    }

    /**
     * 碰撞开始回调。
     * 撞到玩家时按配置的 `damage` 对玩家结算伤害；
     * 被玩家子弹命中时不在此处理，伤害数值由子弹按玩家技能等级计算并调用 `takeHit()` 结算。
     */
    private onBeginContact(selfCollider: Collider2D, otherCollider: Collider2D, contact: IPhysics2DContact | null) {
        if (this._dead || !otherCollider?.isValid) return;
        if (otherCollider.group !== this.playerGroup) return;

        const damage = Math.max(0, this.damage);
        if (damage <= 0) return;

        // 撞到玩家：伤害结算与镜头震动都通过事件发出，敌人不再持有玩家与摄像机组件
        const damagePayload: DamagePlayerPayload = { damage };
        EventBus.emit<DamagePlayerPayload>(DAMAGE_PLAYER, damagePayload);
        EventBus.emit<ShakePayload>(SHAKE_REQUEST, {});
    }

    /**
     * 被子弹命中：先施加击退与减速，再结算伤害。
     * @param damage 本次命中的伤害（暴击伤害已由子弹计算）
     * @param dirX / dirY 子弹飞行方向，决定击退方向
     * @param knockback 击退距离（像素），小于等于 0 表示不击退
     * @param slowRate 减速比例（0~1），小于等于 0 表示不减速
     * @param slowDuration 减速持续时间（秒）
     */
    public takeHit(damage: number, dirX: number, dirY: number, knockback: number, slowRate: number, slowDuration: number) {
        if (this._dead || !this.isValid) return;

        if (knockback > 0) {
            this._knockbackDir.set(dirX, dirY);
            if (this._knockbackDir.lengthSqr() > 0) {
                this._knockbackDir.normalize();
                this._knockbackRemain = Math.max(this._knockbackRemain, knockback);
            }
        }

        if (slowRate > 0 && slowDuration > 0) {
            this._slowRate = Math.min(1, Math.max(this._slowRate, slowRate));
            this._slowTimer = Math.max(this._slowTimer, slowDuration);
        }

        this.takeDamage(damage);
    }

    /**
     * 扣除生命值：结算交给生命值组件完成，
     * 组件回调中触发闪红并在归零时进入阵亡流程，未阵亡则检查是否进入第二阶段。
     */
    public takeDamage(amount: number) {
        if (this._dead || !this.isValid) return;

        const health = this.getHealth();
        if (!health) return;

        health.takeDamage(amount);
        if (health.isDead()) return;

        // 未阵亡时检查是否需要进入第二阶段
        this.checkPhase();
    }

    /**
     * 受击闪烁：计时未归零时保持闪红，归零后把 Sprite 颜色恢复原样。
     * 与减速/击退计时一样受暂停影响，暂停时冻结，不再推进。
     */
    private updateFlash(dt: number) {
        if (this._flashTimer <= 0) return;

        this._flashTimer -= dt;
        if (this._flashTimer > 0) return;

        this._flashTimer = 0;
        this.restoreSpriteColor();
    }

    /**
     * 开始闪烁：把 Sprite 染成受击色并重新计时。
     * 闪烁期间再次受伤时调用本方法即可重置计时，结束后自然会一次性恢复。
     */
    private startFlash() {
        const sprite = this._sprite;
        if (!sprite?.isValid) return;

        // 走 color 的 setter：引擎会同步刷新渲染顶点色，直接改 color 内部数值不会生效
        sprite.color = HIT_FLASH_COLOR;

        this._flashTimer = Math.max(0, this.hitFlashDuration);
        if (this._flashTimer <= 0) {
            this.restoreSpriteColor();
        }
    }

    /** 把 Sprite 颜色恢复为初始记录的原色 */
    private restoreSpriteColor() {
        const sprite = this._sprite;
        if (!sprite?.isValid) return;

        sprite.color = this._spriteColor;
    }

    /**
     * 阵亡：停止一切行动（移动 / 击退 / 减速 / 开火），发出 ENEMY_KILLED 事件
     * （携带本敌人提供的经验值），然后播放溶解动画，动画播完再销毁敌人节点。
     * 没有溶解组件时退化为原来的立即销毁。
     */
    private die() {
        if (this._dead) return;
        this._dead = true;

        const payload: EnemyKilledPayload = {
            node: this.node,
            enemyId: this.enemyId,
            exp: Math.max(0, this.exp),
        };
        EventBus.emit<EnemyKilledPayload>(ENEMY_KILLED, payload);

        // 敌人消散：碎裂声
        AudioManager.play(SfxType.Death);

        // 停止移动：_dead 已让 update 不再推进，这里清掉残留的击退与减速
        this._knockbackRemain = 0;
        this._slowRate = 0;
        this._slowTimer = 0;
        this.restoreSpriteColor();

        if (!this._dissolve) this._dissolve = this.getComponent(DissolveEffect);
        const dissolve = this._dissolve;
        if (!dissolve) {
            this.destroySelf();
            return;
        }

        dissolve.onFinishCallback = () => this.destroySelf();
        dissolve.play();
    }

    /** 销毁敌人节点 */
    private destroySelf() {
        if (this.node?.isValid) {
            this.node.destroy();
        }
    }
}
