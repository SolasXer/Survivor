import { _decorator, Component, Node, Prefab, instantiate, Vec2, director } from 'cc';
import { Bullet } from './Bullet';
import { Enemy } from './Enemy';
import {
    BulletSkillId,
    BulletSkillStats,
    computeBulletSkillStats,
    createBulletSkillLevels,
    getBulletSkill,
} from './SkillConfig';
import { AudioManager, SfxType } from './AudioManager';
import { HealthComponent } from './HealthComponent';
import { MovementComponent } from './MovementComponent';
import { ConfigManager } from './ConfigManager';
import { BulletPool } from './BulletPool';
import { EventBus } from './EventBus';
import { getNodeDistanceSq } from './utils/MathUtils';
import {
    DAMAGE_PLAYER,
    ENEMY_KILLED,
    ENTITY_DIED,
    GAME_PAUSE_CHANGE,
    HEALTH_CHANGED,
    JOYSTICK_MOVE,
    JOYSTICK_MOVE_END,
    JOYSTICK_MOVE_START,
    PLAYER_DEAD,
    PLAYER_EXP_CHANGED,
    PLAYER_HP_CHANGED,
    PLAYER_LEVEL_UP,
    PLAYER_REVIVE,
    PLAYER_SKILLS_CHANGED,
    SKILL_SELECTED,
    DamagePlayerPayload,
    EnemyKilledPayload,
    EntityDiedPayload,
    HealthChangedPayload,
    PlayerExpChangedPayload,
    PlayerHpChangedPayload,
    PlayerLevelUpPayload,
    PlayerRevivePayload,
    PlayerSkillsChangedPayload,
    SkillSelectedPayload,
} from './GameEvents';
const { ccclass, property } = _decorator;

/** 一次攻击发射多发子弹时，相邻子弹的角度间隔（弧度） */
const MULTI_SHOT_ANGLE_STEP = 8 * Math.PI / 180;

/**
 * Player controller: listens to joystick direction events and moves the
 * player node every frame, clamped inside the Background node bounds.
 * It also fires a bullet at the nearest enemy on a fixed interval.
 *
 * 生命值与移动已分别交给 `HealthComponent` 与 `MovementComponent`，
 * 本脚本只负责装配、攻击与成长逻辑，并通过全局事件总线与外界通信：
 * - 监听 `HEALTH_CHANGED` / `ENTITY_DIED`：转发成 `PLAYER_HP_CHANGED` / `PLAYER_DEAD`；
 * - 监听 `DAMAGE_PLAYER` 结算伤害、`SKILL_SELECTED` 提升技能、`ENEMY_KILLED` 累计经验；
 * - 经验与技能变化时发出 `PLAYER_EXP_CHANGED` / `PLAYER_LEVEL_UP` / `PLAYER_SKILLS_CHANGED`；
 * - 开局（start）主动广播一次当前数值，供 HUD、升级界面等监听方拿到初始快照。
 *
 * 本脚本只 import 事件字典，不认识任何 UI 脚本；UI 也反过来不认识本脚本。
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({ tooltip: '自动攻击间隔（秒）' })
    attackInterval: number = 0.85;

    @property({ tooltip: '自动攻击范围（像素）' })
    attackRange: number = 500;

    @property({ type: Prefab, tooltip: '子弹预制件' })
    bulletPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '子弹生成后统一挂载的容器节点（Main 场景中的 BulletContainer）' })
    bulletContainer: Node | null = null;

    @property({ tooltip: '子弹对象池容量：开局预先实例化多少个子弹节点并隐藏备用' })
    bulletPoolSize: number = 30;

    @property({ tooltip: '当前等级，初始为 1 级' })
    level: number = 1;

    @property({ tooltip: '当前等级已累积的经验值，升级后扣除所需值重新累积' })
    exp: number = 0;

    @property({ tooltip: '1 级升到 2 级所需的经验值' })
    baseExpToLevelUp: number = 36;

    @property({ tooltip: '每提升一级，升级所需经验值的增量' })
    expGrowthPerLevel: number = 25;

    /**
     * 技能等级表：键为技能 ID，值为当前等级。
     * 初始为 SkillConfig 中的默认等级，玩家在升级界面选择卡片后对应等级 +1。
     * 攻击时按该表计算出子弹的增强属性。
     */
    public skillLevels: Record<BulletSkillId, number> = createBulletSkillLevels();

    private _attackTimer: number = 0;
    /** 游戏暂停时为 true，此时玩家停止移动与攻击 */
    private _paused: boolean = false;
    /** 当前等级升级所需的经验值，升级后重新计算 */
    private _expToNextLevel: number = 0;

    /** 本局累计击败的敌人数量 */
    private _kills: number = 0;

    private readonly _tmpDir: Vec2 = new Vec2();

    /** 生命值组件：血量的读写全部转发给它 */
    private _health: HealthComponent | null = null;

    /** 移动组件：方向与位移全部转发给它 */
    private _movement: MovementComponent | null = null;

    /** 子弹对象池，开局预热后供射击复用 */
    private _bulletPool: BulletPool | null = null;

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
        EventBus.on<Vec2>(JOYSTICK_MOVE_START, this.onMoveStart, this);
        EventBus.on<Vec2>(JOYSTICK_MOVE, this.onMove, this);
        EventBus.on<Vec2>(JOYSTICK_MOVE_END, this.onMoveEnd, this);
        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        EventBus.on<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.on<EntityDiedPayload>(ENTITY_DIED, this.onEntityDied, this);
        EventBus.on<DamagePlayerPayload>(DAMAGE_PLAYER, this.onDamagePlayer, this);
        EventBus.on<EnemyKilledPayload>(ENEMY_KILLED, this.onEnemyKilled, this);
        EventBus.on<SkillSelectedPayload>(SKILL_SELECTED, this.onSkillSelected, this);
        EventBus.on<PlayerRevivePayload>(PLAYER_REVIVE, this.onRevive, this);

        // 组件缺省时自动补挂，保证旧场景/预制件也能直接运行
        this.getHealth();
        this.getMovement();

        // 先从 ConfigManager 取玩家配置（未就绪时取默认值），配置到位后再刷新一次
        this.applyPlayerConfig();
        ConfigManager.instance?.onConfigLoaded(() => this.applyPlayerConfig(false));

        this.level = Math.max(1, Math.floor(this.level));
        this.exp = Math.max(0, this.exp);
        this._expToNextLevel = this.getExpToLevelUp();
        this._kills = 0;

        if (!this.skillLevels) {
            this.skillLevels = createBulletSkillLevels();
        }
    }

    /**
     * 从 ConfigManager 取玩家配置并写入自身与相关组件：
     * 生命值交给 HealthComponent、移动速度交给 MovementComponent，攻击与成长参数写在本脚本上。
     *
     * 配置尚未加载完成时取到的是内置默认值，默认值与 `player.json` 一致，故开局表现不变；
     * 配置到位后本方法会被再调用一次（此时 init=false，只刷新战斗参数，不重置等级、经验与血量）。
     * @param init 是否处于开局初始化：只有初始化时才写入等级、经验与生命值
     */
    private applyPlayerConfig(init: boolean = true) {
        const config = ConfigManager.getPlayer();

        this.attackInterval = Math.max(0.05, config.attackInterval);
        this.attackRange = Math.max(0, config.attackRange);
        this.baseExpToLevelUp = Math.max(1, config.baseExpToLevelUp);
        this.expGrowthPerLevel = Math.max(0, config.expGrowthPerLevel);

        const movement = this.getMovement();
        if (movement) movement.speed = Math.max(0, config.moveSpeed);

        if (!init) {
            this._expToNextLevel = this.getExpToLevelUp();
            return;
        }

        this.getHealth()?.applyPlayerConfig();

        this.level = Math.max(1, Math.floor(config.level));
        this.exp = Math.max(0, config.exp);
        this._expToNextLevel = this.getExpToLevelUp();
    }

    /**
     * 主动广播一次当前数值：监听方（HUD、升级界面）在 onLoad 中订阅，
     * 而玩家的 onLoad 可能早于它们执行，故在此补发一次初始快照。
     */
    start() {
        // 场景加载完成后再预热对象池，避免在 onLoad 阶段改动节点层级
        this.initBulletPool();

        this.broadcastHp();
        this.broadcastExp();
        this.broadcastSkills();
    }

    onDestroy() {
        EventBus.off<Vec2>(JOYSTICK_MOVE_START, this.onMoveStart, this);
        EventBus.off<Vec2>(JOYSTICK_MOVE, this.onMove, this);
        EventBus.off<Vec2>(JOYSTICK_MOVE_END, this.onMoveEnd, this);
        EventBus.off<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);
        EventBus.off<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.off<EntityDiedPayload>(ENTITY_DIED, this.onEntityDied, this);
        EventBus.off<DamagePlayerPayload>(DAMAGE_PLAYER, this.onDamagePlayer, this);
        EventBus.off<EnemyKilledPayload>(ENEMY_KILLED, this.onEnemyKilled, this);
        EventBus.off<SkillSelectedPayload>(SKILL_SELECTED, this.onSkillSelected, this);
        EventBus.off<PlayerRevivePayload>(PLAYER_REVIVE, this.onRevive, this);
    }

    /**
     * 生命值变化：只处理自己身上的组件，转发成玩家域事件；
     * 实际掉血时播放受击音效，未挂载 AudioManager 时静默跳过。
     */
    private onHealthChanged(payload: HealthChangedPayload) {
        if (!payload || payload.node !== this.node) return;

        if (payload.delta < 0) {
            AudioManager.play(SfxType.Hurt);
        }

        this.broadcastHp(payload.hp, payload.maxHp, payload.ratio);
    }

    /** 阵亡：只处理自己身上的组件，发出 PLAYER_DEAD 由 GameManager 判定失败 */
    private onEntityDied(payload: EntityDiedPayload) {
        if (!payload || payload.node !== this.node) return;

        EventBus.emit(PLAYER_DEAD);
    }

    /**
     * 广告复活：清除阵亡标记并按比例恢复生命值。
     * 生命值组件 reset 后会发出 HEALTH_CHANGED，HUD 随之刷新。
     */
    private onRevive(payload: PlayerRevivePayload) {
        const health = this.getHealth();
        if (!health) return;

        const ratio = Math.min(1, Math.max(0, payload?.hpRatio ?? 0.5));
        const maxHp = Math.max(1, Math.round(health.maxHp));
        health.reset(Math.max(1, Math.round(maxHp * ratio)), maxHp);
    }

    /** 受到伤害请求：由敌人接触伤害、敌人子弹发出，统一在此结算 */
    private onDamagePlayer(payload: DamagePlayerPayload) {
        if (!payload) return;

        this.takeDamage(payload.damage);
    }

    /** 技能被选中：提升对应技能等级（升级界面只负责发意图，不直接改玩家数据） */
    private onSkillSelected(payload: SkillSelectedPayload) {
        if (!payload) return;

        this.upgradeSkill(payload.skillId as BulletSkillId);
    }

    /** 广播当前生命值 */
    private broadcastHp(hp?: number, maxHp?: number, ratio?: number) {
        const health = this.getHealth();
        const payload: PlayerHpChangedPayload = {
            hp: hp ?? health?.hp ?? 0,
            maxHp: maxHp ?? health?.maxHp ?? 0,
            ratio: ratio ?? health?.ratio ?? 0,
        };
        EventBus.emit<PlayerHpChangedPayload>(PLAYER_HP_CHANGED, payload);
    }

    /** 广播当前经验与等级 */
    private broadcastExp() {
        const needed = Math.max(1, this.getExpToNextLevel());
        const payload: PlayerExpChangedPayload = {
            exp: this.exp,
            needed,
            ratio: Math.min(1, Math.max(0, this.exp / needed)),
            level: this.level,
        };
        EventBus.emit<PlayerExpChangedPayload>(PLAYER_EXP_CHANGED, payload);
    }

    /** 广播当前技能等级表 */
    private broadcastSkills() {
        const payload: PlayerSkillsChangedPayload = {
            levels: this.getSkillLevels() as Record<string, number>,
        };
        EventBus.emit<PlayerSkillsChangedPayload>(PLAYER_SKILLS_CHANGED, payload);
    }

    /** 游戏暂停状态变化：暂停时停止移动与攻击 */
    private onPauseChange(paused: boolean) {
        this._paused = paused;
        // 暂停瞬间清掉移动方向，避免恢复后玩家一直朝原方向漂移
        if (paused) this.getMovement()?.stop();
    }

    /** 当前生命值（转发 HealthComponent） */
    public get hp(): number {
        return this.getHealth()?.hp ?? 0;
    }

    /** 生命值上限（转发 HealthComponent） */
    public get maxHp(): number {
        return this.getHealth()?.maxHp ?? 0;
    }

    /** 移动速度（转发 MovementComponent） */
    public get speed(): number {
        return this.getMovement()?.speed ?? 0;
    }

    /**
     * 扣除生命值：伤害结算交给生命值组件完成，
     * 生命值组件发出 `HEALTH_CHANGED` / `ENTITY_DIED` 后由本脚本转发为玩家域事件。
     */
    public takeDamage(amount: number) {
        if (!this.isValid) return;
        this.getHealth()?.takeDamage(amount);
    }

    /** 当前生命值是否已归零 */
    public isDead(): boolean {
        return this.getHealth()?.isDead() ?? false;
    }

    /** 生命值上限，至少为 1，避免被当作除数时出错 */
    public getMaxHp(): number {
        return Math.max(1, Math.round(this.maxHp));
    }

    /** 敌人被击败：累计击杀数，并把事件携带的经验值计入玩家 */
    private onEnemyKilled(payload: EnemyKilledPayload) {
        if (!payload) return;

        this._kills += 1;
        this.addExp(payload.exp);
    }

    /** 本局累计击败的敌人数量 */
    public getKills(): number {
        return this._kills;
    }

    /** 当前等级升级所需的经验值：基础值 + (当前等级 - 1) × 每级增量，随等级递增 */
    public getExpToLevelUp(): number {
        const base = Math.max(1, Math.round(this.baseExpToLevelUp));
        const growth = Math.max(0, this.expGrowthPerLevel);
        return Math.round(base + (this.level - 1) * growth);
    }

    /** 当前等级升级所需的经验值（缓存值） */
    public getExpToNextLevel(): number {
        return this._expToNextLevel;
    }

    /**
     * 获得经验：累加到当前经验中，达到升级所需经验时升级，
     * 扣除升级所需值后重新计算下一级所需经验，一次获得大量经验可连续升级。
     */
    public addExp(amount: number) {
        if (this.isDead() || !this.isValid) return;

        const gain = Math.max(0, Math.round(amount));
        if (gain <= 0) return;

        this.exp += gain;
        this.broadcastExp();
        console.log(`[Player] 获得经验 +${gain}，当前经验 ${this.exp}/${this._expToNextLevel}（等级 ${this.level}）`);

        while (this.exp >= this._expToNextLevel) {
            this.exp -= this._expToNextLevel;
            this.levelUp();
        }
    }

    /** 升级：等级 +1，重新计算下一级所需经验，并发出 PLAYER_LEVEL_UP 事件 */
    private levelUp() {
        this.level += 1;
        this._expToNextLevel = this.getExpToLevelUp();

        console.log(`[Player] 升级！当前等级 ${this.level}，下一级所需经验 ${this._expToNextLevel}，剩余经验 ${this.exp}`);

        const payload: PlayerLevelUpPayload = { level: this.level };
        EventBus.emit<PlayerLevelUpPayload>(PLAYER_LEVEL_UP, payload);
        this.broadcastExp();
    }

    /** 取某个技能的当前等级，未记录时按 0（未学习）处理 */
    public getSkillLevel(id: BulletSkillId): number {
        const level = this.skillLevels ? this.skillLevels[id] : 0;
        return Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    }

    /** 取完整的技能等级表 */
    public getSkillLevels(): Record<BulletSkillId, number> {
        if (!this.skillLevels) this.skillLevels = createBulletSkillLevels();
        return this.skillLevels;
    }

    /**
     * 提升指定技能的等级，并写入技能等级表。
     * @returns 提升后的等级；技能已满级或不存在时返回当前等级
     */
    public upgradeSkill(id: BulletSkillId): number {
        const config = getBulletSkill(id);
        if (!config) return 0;

        const current = this.getSkillLevel(id);
        if (current >= config.maxLevel) return current;

        this.getSkillLevels()[id] = current + 1;
        this.broadcastSkills();
        return current + 1;
    }

    /** 按当前技能等级表计算出子弹的增强属性 */
    public getSkillStats(): BulletSkillStats {
        return computeBulletSkillStats(this.getSkillLevels());
    }

    update(dt: number) {
        if (this._paused) return;

        this.updateAttack(dt);

        // 移动交给移动组件：内部会跳过零方向，并在配置了边界时把结果钳制在边界内
        this.getMovement()?.move(dt);
    }

    /**
     * 自动攻击：按技能等级表算出增强属性，累计计时达到（技能缩短后的）攻击间隔后，
     * 在（技能扩大后的）攻击范围内寻找最近的敌人并射击。
     * 子弹的速度、伤害、数量、穿透、暴击、击退、减速均由增强属性决定。
     */
    private updateAttack(dt: number) {
        if (!this.bulletPrefab) return;

        const stats = this.getSkillStats();
        const interval = Math.max(0.05, this.attackInterval * stats.attackIntervalScale);
        this._attackTimer += dt;
        if (this._attackTimer < interval) return;
        this._attackTimer = 0;

        const target = this.findNearestEnemy(this.attackRange * stats.attackRangeScale);
        if (target) {
            this.shoot(target, stats);
        }
    }

    /** 在指定攻击范围内寻找距离最近的敌人，找不到则返回 null */
    private findNearestEnemy(range: number): Node | null {
        const scene = director.getScene();
        if (!scene) return null;

        const rangeValue = Math.abs(range);
        const rangeSq = rangeValue * rangeValue;

        let nearest: Node | null = null;
        let nearestDistSq = rangeSq;

        const enemies = scene.getComponentsInChildren(Enemy);
        for (const enemy of enemies) {
            const node = enemy.node;
            // 跳过阵亡但还在播放溶解动画的敌人：节点尚未销毁，但不应再成为攻击目标
            if (!enemy.isValid || !node?.isValid || enemy.isDead()) continue;

            const distSq = getNodeDistanceSq(this.node, node);
            if (distSq > nearestDistSq) continue;

            nearestDistSq = distSq;
            nearest = node;
        }

        return nearest;
    }

    /** 创建子弹对象池并预热到 `bulletPoolSize` 个隐藏节点 */
    private initBulletPool() {
        // 预热时玩家可能还没拿到容器引用，这里统一以 BulletContainer / 父节点为准
        const parent = this.bulletContainer?.isValid ? this.bulletContainer : this.node.parent;
        this._bulletPool = new BulletPool(this.bulletPrefab, parent, this.bulletPoolSize);
        this._bulletPool.prewarm();
    }

    /** 取子弹对象池，未创建时按当前配置补建一个 */
    public getBulletPool(): BulletPool | null {
        if (!this._bulletPool) this.initBulletPool();
        return this._bulletPool;
    }

    /**
     * 取一个可用的子弹节点：优先从对象池复用，池中没有闲置节点时才临时实例化。
     * 取到的节点已挂到飞行容器并处于激活状态，调用方紧接着写入位置与方向即可。
     */
    private acquireBulletNode(): Node | null {
        const pooled = this.getBulletPool()?.acquire() ?? null;
        if (pooled?.isValid) return pooled;

        const prefab = this.bulletPrefab;
        if (!prefab?.isValid) return null;

        const node = instantiate(prefab);
        node.setParent(this.bulletContainer ?? this.node.parent);
        return node;
    }

    /**
     * 发射子弹：位置为玩家当前位置，方向由玩家指向目标。
     * 发射数量由技能等级表中的「多重射击」决定，多发子弹按角度均匀散开；
     * 每发子弹拿到后立即写入当前技能等级表算出的增强属性。
     */
    private shoot(target: Node, stats: BulletSkillStats) {
        if (!this.bulletPrefab) return;

        const selfPos = this.node.worldPosition;
        const targetPos = target.worldPosition;
        const dx = targetPos.x - selfPos.x;
        const dy = targetPos.y - selfPos.y;
        if (dx === 0 && dy === 0) return;

        // 一次齐射只播一次射击音效，多重射击时不会叠加成噪音
        AudioManager.play(SfxType.Shoot);

        const baseAngle = Math.atan2(dy, dx);
        const count = Math.max(1, Math.floor(stats.count));
        const offsetBase = (count - 1) / 2;

        for (let i = 0; i < count; i++) {
            const angle = baseAngle + (i - offsetBase) * MULTI_SHOT_ANGLE_STEP;

            // 复用对象池中的节点：已激活并挂在飞行容器下，这里只写位置与方向
            const bullet = this.acquireBulletNode();
            if (!bullet?.isValid) break;

            bullet.setWorldPosition(selfPos);

            const comp = bullet.getComponent(Bullet);
            comp?.applySkillStats(stats);

            this._tmpDir.set(Math.cos(angle), Math.sin(angle));
            comp?.setDirection(this._tmpDir);
        }
    }

    /** Joystick touch start: record initial direction */
    private onMoveStart(dir: Vec2) {
        this.getMovement()?.setDirection(dir.x, dir.y);
    }

    /** Joystick move: update normalized direction */
    private onMove(dir: Vec2) {
        this.getMovement()?.setDirection(dir.x, dir.y);
    }

    /** Joystick end/cancel: reset direction, player stops */
    private onMoveEnd(dir: Vec2) {
        this.getMovement()?.setDirection(dir.x, dir.y);
    }
}