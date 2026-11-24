import { _decorator, Component, JsonAsset, resources } from 'cc';
const { ccclass } = _decorator;

/** 玩家配置：初始生命值与移动速度等玩家基础数值 */
export interface PlayerConfig {
    /** 初始生命值 */
    hp: number;
    /** 生命值上限 */
    maxHp: number;
    /** 移动速度（像素/秒） */
    moveSpeed: number;
    /** 自动攻击间隔（秒） */
    attackInterval: number;
    /** 自动攻击范围（像素） */
    attackRange: number;
    /** 初始等级 */
    level: number;
    /** 初始经验值 */
    exp: number;
    /** 升到下一级所需的经验值 */
    baseExpToLevelUp: number;
    /** 每提升一级，升级所需经验值的增量 */
    expGrowthPerLevel: number;
}

/** 远程敌人的攻击参数 */
export interface EnemyRangedConfig {
    /** 与玩家保持的距离（像素） */
    keepDistance: number;
    /** 射击间隔（秒） */
    fireInterval: number;
    /** 子弹飞行速度（像素/秒） */
    bulletSpeed: number;
    /** 子弹命中玩家造成的伤害 */
    bulletDamage: number;
}

/** Boss 第二阶段参数 */
export interface EnemyPhaseConfig {
    /** 生命值低于该比例（0~1）时进入第二阶段 */
    hpRatio: number;
    /** 第二阶段的移动速度倍率 */
    moveSpeedMultiplier: number;
    /** 第二阶段环形射击间隔（秒） */
    fireInterval: number;
    /** 第二阶段每次环形射击的子弹数量 */
    bulletCount: number;
    /** 第二阶段子弹飞行速度（像素/秒） */
    bulletSpeed: number;
    /** 第二阶段子弹命中玩家造成的伤害 */
    bulletDamage: number;
}

/** 单个敌人的配置 */
export interface EnemyEntryConfig {
    id: string;
    name: string;
    /** 生命值 */
    hp: number;
    /** 移动速度（像素/秒） */
    moveSpeed: number;
    /** 接触玩家造成的伤害 */
    damage: number;
    /** 掉落的经验值 */
    exp: number;
    ranged?: EnemyRangedConfig;
    phase?: EnemyPhaseConfig;
}

/** 敌人配置：默认敌人 ID + 以 ID 为键的敌人表 */
export interface EnemyDataConfig {
    defaultEnemyId: string;
    enemies: Record<string, EnemyEntryConfig>;
}

/** 战斗配置：刷怪节奏与难度提升参数 */
export interface BattleConfig {
    /** 初始生成间隔（秒） */
    spawnInterval: number;
    /** 最小生成间隔（秒） */
    minSpawnInterval: number;
    /** 生成间隔由初始值缩短到最小值所需时间（秒） */
    spawnIntervalRampTime: number;
    /** 敌人属性开始成长的时刻（秒） */
    statGrowthStartTime: number;
    /** 敌人属性倍率的每秒增长量 */
    statGrowthRate: number;
    /** 敌人属性倍率上限 */
    maxStatMultiplier: number;
    /** 中期开始时间（秒），之后混入远程敌人 */
    rangedPhaseTime: number;
    /** Boss 出场时间（秒） */
    bossSpawnTime: number;
    /** 中期近战敌人生成权重 */
    meleeWeight: number;
    /** 中期远程敌人生成权重 */
    rangedWeight: number;
    /** Boss 出场时是否清空普通敌人 */
    clearEnemiesOnBoss: boolean;
    /** Boss 是否套用成长倍率 */
    applyGrowthToBoss: boolean;
    /** 屏幕外生成的额外偏移（像素） */
    spawnMargin: number;
}


/** 默认玩家配置：配置文件缺失或读取失败时使用 */
const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
    hp: 120,
    maxHp: 120,
    moveSpeed: 300,
    attackInterval: 0.85,
    attackRange: 500,
    level: 1,
    exp: 0,
    baseExpToLevelUp: 36,
    expGrowthPerLevel: 25,
};

/** 默认敌人配置：配置文件缺失或读取失败时使用 */
const DEFAULT_ENEMY_CONFIG: EnemyDataConfig = {
    defaultEnemyId: 'slime',
    enemies: {
        slime: { id: 'slime', name: '史莱姆', hp: 30, moveSpeed: 105, damage: 5, exp: 10 },
        goblin: {
            id: 'goblin',
            name: '哥布林',
            hp: 40,
            moveSpeed: 95,
            damage: 6,
            exp: 18,
            ranged: { keepDistance: 320, fireInterval: 2, bulletSpeed: 280, bulletDamage: 8 },
        },
        boss: {
            id: 'boss',
            name: '恶龙',
            hp: 3000,
            moveSpeed: 70,
            damage: 20,
            exp: 300,
            phase: { hpRatio: 0.5, moveSpeedMultiplier: 1.6, fireInterval: 2.2, bulletCount: 12, bulletSpeed: 260, bulletDamage: 10 },
        },
    },
};

/** 默认战斗配置：配置文件缺失或读取失败时使用 */
const DEFAULT_BATTLE_CONFIG: BattleConfig = {
    spawnInterval: 3,
    minSpawnInterval: 0.9,
    spawnIntervalRampTime: 260,
    statGrowthStartTime: 30,
    statGrowthRate: 0.01,
    maxStatMultiplier: 3,
    rangedPhaseTime: 150,
    bossSpawnTime: 600,
    meleeWeight: 60,
    rangedWeight: 40,
    clearEnemiesOnBoss: false,
    applyGrowthToBoss: false,
    spawnMargin: 80,
};

/**
 * 配置管理：挂载在 Canvas 节点上，游戏启动时一次性读取并缓存全部配置。
 *
 * 数据来自 `assets/resources/data` 下的三个 JSON：
 * - `player.json`：玩家初始生命值、移动速度等基础数值；
 * - `enemy.json`：各类敌人的生命值、移动速度、伤害等数值；
 * - `battle.json`：刷怪间隔、难度提升速率等战斗节奏参数。
 *
 * 读取方式：用 `resources.load` 按路径（不含扩展名）加载 `cc.JsonAsset`，解析后缓存在本组件中。
 * 三个文件并行加载，全部结束后 `_ready` 置为 true；
 * 任一文件读取失败时只回退到内置默认值，不影响其他配置与游戏启动。
 *
 * 使用方式：
 * - 需要取值的脚本通过 `ConfigManager.instance` 拿到实例，再调用对应的取值方法；
 * - 也可用静态快捷方法 `ConfigManager.getPlayer()` / `getEnemy()` / `getBattle()`，
 *   组件尚未就绪时同样返回默认配置，调用方无需判空。
 * - 读取是异步的：在配置真正到位前取值只会拿到默认值（默认值与配置文件内容一致，
 *   因此初始表现不受影响）。若要在配置到位后刷新数值，用 `onConfigLoaded()` 注册回调。
 */
@ccclass('ConfigManager')
export class ConfigManager extends Component {
    /** 当前生效的配置管理实例（场景中应只挂载一个） */
    private static _instance: ConfigManager | null = null;

    /** 当前生效的配置管理实例 */
    public static get instance(): ConfigManager | null {
        return ConfigManager._instance;
    }

    private _player: PlayerConfig | null = null;
    private _enemy: EnemyDataConfig | null = null;
    private _battle: BattleConfig | null = null;

    /** 三个配置文件是否都已读取完成（失败时也会置为 true，此时返回默认值） */
    private _ready: boolean = false;

    /** 配置到位后需要执行的回调，供各脚本刷新数值 */
    private readonly _callbacks: Array<() => void> = [];

    onLoad() {
        ConfigManager._instance = this;
        this.loadAll();
    }

    onDestroy() {
        if (ConfigManager._instance === this) {
            ConfigManager._instance = null;
        }
    }

    /** 并行加载三份配置，全部结束后标记就绪 */
    public async loadAll(): Promise<void> {
        const [player, enemy, battle] = await Promise.all([
            this.loadJson<PlayerConfig>('player'),
            this.loadJson<EnemyDataConfig>('enemy'),
            this.loadJson<BattleConfig>('battle'),
        ]);

        this._player = player;
        this._enemy = enemy;
        this._battle = battle;
        this._ready = true;
        this.flushCallbacks();

        console.log('[ConfigManager] 配置加载完成', {
            player: player ? 'player.json' : '默认值',
            enemy: enemy ? 'enemy.json' : '默认值',
            battle: battle ? 'battle.json' : '默认值',
        });
    }

    /** 配置是否已加载完成 */
    public isReady(): boolean {
        return this._ready;
    }

    /**
     * 注册「配置已到位」回调：已就绪时立即执行一次，否则等加载完成后执行。
     * 用于读取是异步的、但脚本又想在配置到位后刷新数值的场景。
     */
    public onConfigLoaded(cb: () => void): void {
        if (this._ready) {
            this.invokeCallback(cb);
            return;
        }
        this._callbacks.push(cb);
    }

    /** 依次执行已注册的回调 */
    private flushCallbacks(): void {
        const callbacks = this._callbacks.slice();
        this._callbacks.length = 0;
        for (const cb of callbacks) {
            this.invokeCallback(cb);
        }
    }

    /** 执行单个回调，单个回调抛错不影响其他回调 */
    private invokeCallback(cb: () => void): void {
        try {
            cb();
        }
        catch (err) {
            console.error('[ConfigManager] 配置回调执行失败', err);
        }
    }

    /** 玩家配置：未加载完成或读取失败时返回默认配置 */
    public getPlayerConfig(): PlayerConfig {
        return this._player ?? DEFAULT_PLAYER_CONFIG;
    }

    /** 敌人配置：未加载完成或读取失败时返回默认配置 */
    public getEnemyConfig(): EnemyDataConfig {
        return this._enemy ?? DEFAULT_ENEMY_CONFIG;
    }

    /** 战斗配置：未加载完成或读取失败时返回默认配置 */
    public getBattleConfig(): BattleConfig {
        return this._battle ?? DEFAULT_BATTLE_CONFIG;
    }

    /** 按敌人 ID 取单条敌人配置，取不到时返回默认敌人（fallback）的配置 */
    public getEnemyConfigById(id: string): EnemyEntryConfig {
        const config = this.getEnemyConfig();
        return config.enemies[id] ?? config.enemies[config.defaultEnemyId] ?? DEFAULT_ENEMY_CONFIG.enemies[DEFAULT_ENEMY_CONFIG.defaultEnemyId];
    }

    /** 静态快捷方法：取玩家配置 */
    public static getPlayer(): PlayerConfig {
        return ConfigManager._instance?.getPlayerConfig() ?? DEFAULT_PLAYER_CONFIG;
    }

    /** 静态快捷方法：取敌人配置 */
    public static getEnemy(): EnemyDataConfig {
        return ConfigManager._instance?.getEnemyConfig() ?? DEFAULT_ENEMY_CONFIG;
    }

    /** 静态快捷方法：取战斗配置 */
    public static getBattle(): BattleConfig {
        return ConfigManager._instance?.getBattleConfig() ?? DEFAULT_BATTLE_CONFIG;
    }

    /** 读取 `assets/resources/<name>.json`，失败时返回 null（由调用方回退默认值） */
    private loadJson<T>(name: string): Promise<T | null> {
        return new Promise<T | null>((resolve) => {
            resources.load(name, JsonAsset, (err: Error | null, asset: JsonAsset | null) => {
                if (err || !asset) {
                    console.error(`[ConfigManager] 读取配置失败：${name}`, err ?? '资源为空');
                    resolve(null);
                    return;
                }

                const data = asset.json as unknown;
                if (!data || typeof data !== 'object') {
                    console.error(`[ConfigManager] 配置内容非法：${name}`);
                    resolve(null);
                    return;
                }

                resolve(data as T);
            });
        });
    }
}
