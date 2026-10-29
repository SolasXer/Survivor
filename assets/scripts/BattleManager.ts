import { _decorator, Component, Node, Prefab, instantiate, Vec3, view, Canvas, Camera, director } from 'cc';
import { GameManager, GameState, GAME_STATE_CHANGE, GAME_TIME_LIMIT } from './GameManager';
import { Enemy } from './Enemy';
import { EventBus } from './EventBus';
import { ConfigManager } from './ConfigManager';
import { GAME_PAUSE_CHANGE } from './GameEvents';
import { EnemyId } from './EnemyConfig';
const { ccclass, property } = _decorator;

/** 生成间隔的下限保护，防止配置为 0 时出现死循环 */
const MIN_TICK_INTERVAL = 0.05;

/** 一次生成抽取的结果：预制件 + 对应敌人配置 ID */
interface SpawnPick {
    prefab: Prefab;
    enemyId: EnemyId;
}

/**
 * 战斗管理：挂载在 Canvas 节点上。
 * 持有近战（Slime）、远程（Goblin）与 Boss（恶龙）三种敌人预制件，
 * 每隔一段时间在屏幕外的随机位置生成一只敌人，生成的敌人统一挂到 EnemyContainer 节点下。
 *
 * 生成策略按时间分为三个阶段：
 * - 前期（0 ~ rangedPhaseTime）：只生成近战敌人 Slime；
 * - 中期（rangedPhaseTime ~ Boss 出场）：按权重混入远程敌人 Goblin；
 * - Boss 阶段（到达 bossSpawnTime，默认与 GameManager 的时间上限一致，即第 10 分钟）：
 *   停止生成普通敌人，在场景中央生成 Boss，Boss 被击败即判定胜利。
 *
 * 敌人生成由 GameManager 的状态事件驱动：Running 时开始，Over 时停止并清理容器。
 * 生成间隔随游戏时间线性缩短；生成敌人时按当前游戏时间计算属性倍率，作用于生命值与移动速度。
 * 敌人本身的数值不再写在本脚本或预制件上，而是在生成时把 `enemyId` 交给 Enemy 组件，
 * 由 Enemy 从 EnemyConfig 读取并初始化。
 */
@ccclass('BattleManager')
export class BattleManager extends Component {
    @property({ type: Prefab, tooltip: '近战敌人预制件（Slime），前期唯一生成的敌人' })
    slimePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '远程敌人预制件（Goblin），中期开始按权重混入' })
    goblinPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: 'Boss 预制件（恶龙），到达 bossSpawnTime 时在场景中央生成' })
    bossPrefab: Prefab | null = null;

    @property({ tooltip: '中期开始时间（秒）：到达后开始混入远程敌人' })
    rangedPhaseTime: number = 150;

    @property({ tooltip: 'Boss 出场时间（秒）：到达后停止生成普通敌人并放出 Boss，<=0 时跟随 GameManager 的时间上限' })
    bossSpawnTime: number = GAME_TIME_LIMIT;

    @property({ tooltip: '中期近战敌人的生成权重' })
    meleeWeight: number = 60;

    @property({ tooltip: '中期远程敌人的生成权重' })
    rangedWeight: number = 40;

    @property({ tooltip: 'Boss 出场时是否清空场上剩余的普通敌人' })
    clearEnemiesOnBoss: boolean = false;

    @property({ tooltip: 'Boss 是否也套用随时间成长的属性倍率' })
    applyGrowthToBoss: boolean = false;

    @property({ type: Node, tooltip: '敌人生成后统一挂载的容器节点' })
    enemyContainer: Node | null = null;

    @property({ type: Node, tooltip: '子弹统一挂载的容器节点（Main 场景中的 BulletContainer）' })
    bulletContainer: Node | null = null;

    @property({ type: GameManager, tooltip: '游戏管理组件，留空则自动从所在节点获取' })
    gameManager: GameManager | null = null;

    @property({ tooltip: '初始生成间隔（秒），游戏开始时使用的间隔' })
    spawnInterval: number = 3;

    @property({ tooltip: '最小生成间隔（秒），间隔缩短后不会低于该值' })
    minSpawnInterval: number = 0.9;

    @property({ tooltip: '生成间隔由初始值线性缩短到最小值所需的游戏时间（秒）' })
    spawnIntervalRampTime: number = 260;

    @property({ tooltip: '敌人属性开始成长的时刻（秒），在此之前保持基础值' })
    statGrowthStartTime: number = 30;

    @property({ tooltip: '敌人属性倍率的每秒增长量' })
    statGrowthRate: number = 0.01;

    @property({ tooltip: '敌人属性倍率的上限' })
    maxStatMultiplier: number = 3;

    @property({ tooltip: '在屏幕边界之外额外偏移的距离' })
    spawnMargin: number = 80;

    private _timer: number = 0;
    private _spawning: boolean = false;
    private _paused: boolean = false;
    private _camera: Camera = null!;
    private readonly _tmpPos: Vec3 = new Vec3();

    /** 是否已进入 Boss 阶段（停止生成普通敌人） */
    private _bossPhase: boolean = false;

    /** 当前场上的 Boss 节点，用于判定是否被击败 */
    private _boss: Node | null = null;

    onLoad() {
        // Canvas 上绑定的摄像机，用于计算屏幕可见范围与中心
        this._camera = this.node.getComponent(Canvas)?.cameraComponent ?? null!;

        EventBus.on<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);

        if (!this.gameManager) {
            this.gameManager = this.getComponent(GameManager);
        }
        if (this.gameManager) {
            this.gameManager.node.on(GAME_STATE_CHANGE, this.onGameStateChange, this);
        }

        // 先取 ConfigManager 的战斗配置（未就绪时取默认值），配置到位后再刷新一次
        this.applyBattleConfig();
        ConfigManager.instance?.onConfigLoaded(() => this.applyBattleConfig());
    }

    /**
     * 从 ConfigManager 取战斗配置，写入刷怪节奏与难度提升参数。
     *
     * 配置尚未加载完成时取到的是内置默认值，默认值与 `battle.json` 一致，故开局节奏不变。
     */
    private applyBattleConfig() {
        const config = ConfigManager.getBattle();

        this.spawnInterval = Math.max(0, config.spawnInterval);
        this.minSpawnInterval = Math.max(0, config.minSpawnInterval);
        this.spawnIntervalRampTime = Math.max(0, config.spawnIntervalRampTime);
        this.statGrowthStartTime = Math.max(0, config.statGrowthStartTime);
        this.statGrowthRate = Math.max(0, config.statGrowthRate);
        this.maxStatMultiplier = Math.max(1, config.maxStatMultiplier);
        this.rangedPhaseTime = Math.max(0, config.rangedPhaseTime);
        this.bossSpawnTime = config.bossSpawnTime;
        this.meleeWeight = Math.max(0, config.meleeWeight);
        this.rangedWeight = Math.max(0, config.rangedWeight);
        this.clearEnemiesOnBoss = !!config.clearEnemiesOnBoss;
        this.applyGrowthToBoss = !!config.applyGrowthToBoss;
        this.spawnMargin = config.spawnMargin;
    }

    onDestroy() {
        EventBus.off<boolean>(GAME_PAUSE_CHANGE, this.onPauseChange, this);

        if (this.gameManager?.node?.isValid) {
            this.gameManager.node.off(GAME_STATE_CHANGE, this.onGameStateChange, this);
        }
        this.gameManager = null;
    }

    /** 游戏暂停状态变化：暂停时不累计刷怪计时 */
    private onPauseChange(paused: boolean) {
        this._paused = paused;
    }

    update(dt: number) {
        if (!this._spawning || this._paused) return;

        this.updateBossPhase();
        // Boss 阶段不再生成普通敌人，只等待 Boss 被击败
        if (this._bossPhase) return;

        const interval = this.getCurrentSpawnInterval();
        this._timer += dt;
        while (this._timer >= interval) {
            this._timer -= interval;
            this.spawnEnemy();
        }
    }

    /** 游戏状态变化：Running 重置计时并开始生成，Over 停止生成并清理容器 */
    private onGameStateChange(state: GameState) {
        if (state === GameState.Running) {
            this.startSpawn();
            return;
        }
        if (state === GameState.Over) {
            this.stopSpawn();
            this.clearContainers();
        }
    }

    /**
     * Boss 阶段的推进：
     * 未进入时判断游戏时间是否到达出场时间，到达则停止普通敌人并生成 Boss；
     * 已进入时检查 Boss 节点是否还有效，失效即视为被击败，通知 GameManager 判定胜利。
     */
    private updateBossPhase() {
        if (this._bossPhase) {
            this.checkBossDefeated();
            return;
        }

        if (this.getGameTime() < this.getBossSpawnTime()) return;

        this._bossPhase = true;
        if (this.clearEnemiesOnBoss) {
            this.clearContainer(this.enemyContainer);
        }

        if (this.spawnBoss()) {
            this.gameManager?.notifyBossSpawned();
            return;
        }

        // 未配置 Boss 预制件时退回原有规则：存活满时间上限即判胜
        this.gameManager?.endGame(true);
    }

    /** Boss 节点已销毁即视为被击败 */
    private checkBossDefeated() {
        if (!this._boss || this._boss.isValid) return;

        this._boss = null;
        this.gameManager?.notifyBossDefeated();
    }

    /** Boss 出场时间：<=0 时跟随 GameManager 的时间上限，且不会超过该上限 */
    private getBossSpawnTime(): number {
        const limit = this.gameManager ? Math.max(0, this.gameManager.timeLimit) : GAME_TIME_LIMIT;
        const time = this.bossSpawnTime > 0 ? this.bossSpawnTime : limit;
        return Math.min(time, limit);
    }

    /** 重置生成计时并启动敌人生成 */
    private startSpawn() {
        this._timer = 0;
        this._spawning = true;
        this._bossPhase = false;
        this._boss = null;
    }

    /** 停止敌人生成 */
    private stopSpawn() {
        this._spawning = false;
        this._timer = 0;
    }

    /** 清理 EnemyContainer 与 BulletContainer 下的所有子节点 */
    private clearContainers() {
        this.clearContainer(this.enemyContainer);
        this.clearContainer(this.bulletContainer);
    }

    /** 销毁指定容器下的所有子节点 */
    private clearContainer(container: Node | null) {
        if (!container?.isValid) return;
        container.destroyAllChildren();
    }

    /**
     * 按当前时间阶段抽取要生成的敌人：
     * 前期只出近战，中期按权重混入远程。
     */
    private pickEnemy(): SpawnPick | null {
        const rangedReady = !!this.goblinPrefab && this.getGameTime() >= Math.max(0, this.rangedPhaseTime);

        if (!rangedReady) {
            return this.slimePrefab ? { prefab: this.slimePrefab, enemyId: EnemyId.Slime } : null;
        }

        const meleeWeight = Math.max(0, this.meleeWeight);
        const rangedWeight = Math.max(0, this.rangedWeight);
        const total = meleeWeight + rangedWeight;
        const pickRanged = total > 0 && Math.random() * total < rangedWeight;

        // 权重命中但对应预制件缺失时，退回另一种，保证仍能正常刷怪
        if (pickRanged && this.goblinPrefab) {
            return { prefab: this.goblinPrefab, enemyId: EnemyId.Goblin };
        }
        if (this.slimePrefab) {
            return { prefab: this.slimePrefab, enemyId: EnemyId.Slime };
        }
        return this.goblinPrefab ? { prefab: this.goblinPrefab, enemyId: EnemyId.Goblin } : null;
    }

    /** 生成一只普通敌人并放入敌人容器，并按当前游戏时间的属性倍率强化其生命值与移动速度 */
    private spawnEnemy() {
        const pick = this.pickEnemy();
        if (!pick) return;

        const enemy = instantiate(pick.prefab);
        enemy.setPosition(this.randomSpawnPosition());
        enemy.setParent(this.enemyContainer ?? this.node);

        // 先按敌人 ID 初始化属性，再叠加属性倍率，顺序不可颠倒
        this.initEnemy(enemy, pick.enemyId);
        this.applyStatMultiplier(enemy);
    }

    /** 在场景中央生成 Boss，成功返回 true */
    private spawnBoss(): boolean {
        if (!this.bossPrefab) return false;

        const boss = instantiate(this.bossPrefab);
        boss.setPosition(this.getScreenCenter());
        boss.setParent(this.enemyContainer ?? this.node);

        this.initEnemy(boss, EnemyId.Boss);
        if (this.applyGrowthToBoss) {
            this.applyStatMultiplier(boss);
        }

        this._boss = boss;
        return true;
    }

    /** 把敌人 ID 写入生成出来的节点，并调用 Enemy 的初始化方法读取配置 */
    private initEnemy(enemy: Node, id: EnemyId) {
        const enemyComp = enemy.getComponent(Enemy);
        if (!enemyComp) return;

        enemyComp.enemyId = id;
        enemyComp.applyConfig(id);
    }

    /** 将当前属性倍率应用到敌人的生命值与移动速度上 */
    private applyStatMultiplier(enemy: Node) {
        const multiplier = this.getCurrentStatMultiplier();
        if (multiplier <= 1) return;

        const enemyComp = enemy.getComponent(Enemy);
        if (!enemyComp) return;

        enemyComp.hp = Math.max(1, Math.round(enemyComp.hp * multiplier));
        enemyComp.moveSpeed *= multiplier;
    }

    /** 当前游戏时间（秒），取自 GameManager */
    private getGameTime(): number {
        return this.gameManager ? this.gameManager.getGameTime() : 0;
    }

    /** 当前生成间隔（秒）：随游戏时间从初始间隔线性缩短，最低不低于最小间隔 */
    private getCurrentSpawnInterval(): number {
        const start = Math.max(0, this.spawnInterval);
        const min = Math.max(0, this.minSpawnInterval);
        const rampTime = Math.max(0, this.spawnIntervalRampTime);

        let interval = start;
        if (start > min && rampTime > 0) {
            const progress = Math.min(1, this.getGameTime() / rampTime);
            interval = start - (start - min) * progress;
        }

        return Math.max(MIN_TICK_INTERVAL, Math.min(start, Math.max(min, interval)));
    }

    /** 当前属性倍率：成长开始时间之前为 1（基础值），之后随时间按比例增长，并受上限约束 */
    private getCurrentStatMultiplier(): number {
        const maxMultiplier = Math.max(1, this.maxStatMultiplier);
        const rate = Math.max(0, this.statGrowthRate);
        const growthTime = Math.max(0, this.getGameTime() - Math.max(0, this.statGrowthStartTime));

        return Math.min(maxMultiplier, 1 + growthTime * rate);
    }

    /** 屏幕外随机位置：以屏幕中心为原点，在可见半径之外取随机角度 */
    private randomSpawnPosition(): Vec3 {
        const half = this.getScreenHalfSize();
        const center = this.getScreenCenter();

        const radius = Math.sqrt(half.x * half.x + half.y * half.y) + Math.abs(this.spawnMargin);
        const angle = Math.random() * Math.PI * 2;

        this._tmpPos.set(
            center.x + Math.cos(angle) * radius,
            center.y + Math.sin(angle) * radius,
            0
        );
        return this._tmpPos;
    }

    /** 屏幕可见范围的半宽高（世界单位） */
    private getScreenHalfSize(): { x: number; y: number } {
        const visible = view.getVisibleSize();
        const halfH = this._camera ? Math.abs(this._camera.orthoHeight) : visible.height * 0.5;
        const aspect = visible.height > 0 ? visible.width / visible.height : 16 / 9;
        return { x: halfH * aspect, y: halfH };
    }

    /** 屏幕中心（摄像机位置，与敌人容器处于同一坐标系） */
    private getScreenCenter(): Vec3 {
        return this._camera ? this._camera.node.position : Vec3.ZERO;
    }
}
