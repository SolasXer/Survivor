/**
 * 敌人配置（纯数据脚本，不挂载到节点，不含 cc 依赖）。
 *
 * 组织方式：
 * - `EnemyId`：敌人唯一 ID，作为所有读写接口的键；
 * - `EnemyConfig`：单个敌人的定义（ID / 名称 / 生命值 / 移动速度 / 伤害 / 掉落经验）；
 * - `ENEMY_CONFIGS`：以 ID 为键的配置表，新增敌人种类只需在这里追加一条；
 * - `getEnemyConfig()` 等工具函数用于按 ID 取值。
 *
 * 使用方式：
 * - Enemy 组件暴露 `enemyId`，生成时（onEnable）按该 ID 读取配置并把数值写入自身；
 * - 也可以在 instantiate 之后调用 `Enemy.applyConfig(id)` 主动切换敌人种类；
 * - ID 非法或配置缺失时回退到 `DEFAULT_ENEMY_ID` 对应的配置。
 */

/** 敌人的唯一 ID */
export enum EnemyId {
    /** 史莱姆：基础近战敌人 */
    Slime = 'slime',
    /** 哥布林：远程敌人，靠近到一定距离后停下射击 */
    Goblin = 'goblin',
    /** 恶龙：Boss，血量过半后进入强化阶段 */
    Boss = 'boss',
}

/** Boss 类敌人第二阶段的强化参数，配置了该字段的敌人具备两阶段行为 */
export interface EnemyPhaseConfig {
    /** 生命值低于该比例（0~1）时进入第二阶段 */
    hpRatio: number;
    /** 第二阶段的移动速度倍率 */
    moveSpeedMultiplier: number;
    /** 第二阶段向四周环形射击的间隔（秒） */
    fireInterval: number;
    /** 第二阶段每次环形射击的子弹数量 */
    bulletCount: number;
    /** 第二阶段子弹的飞行速度（像素/秒） */
    bulletSpeed: number;
    /** 第二阶段子弹命中玩家造成的伤害 */
    bulletDamage: number;
}

/** 远程敌人的攻击参数，只有远程敌人才需要配置 */
export interface EnemyRangedConfig {
    /** 与玩家保持的距离（像素）：大于该距离时朝玩家靠近，小于等于时停止移动并射击 */
    keepDistance: number;
    /** 射击间隔（秒） */
    fireInterval: number;
    /** 子弹飞行速度（像素/秒） */
    bulletSpeed: number;
    /** 子弹命中玩家造成的伤害 */
    bulletDamage: number;
    /**
     * 开火射程相对 keepDistance 的倍数（可选，默认 2）：
     * 追击途中与玩家的距离小于等于 keepDistance × 该倍数时就允许边追边打，
     * 否则敌人（尤其是移速低于玩家时）可能永远追不进 keepDistance，一发子弹都打不出来。
     */
    fireRangeScale?: number;
}

/** 单个敌人的配置 */
export interface EnemyConfig {
    /** 敌人 ID，与 `EnemyId` 对应 */
    id: EnemyId;
    /** 敌人名称，用于调试与后续 UI 展示 */
    name: string;
    /** 生命值 */
    hp: number;
    /** 移动速度（像素/秒） */
    moveSpeed: number;
    /** 接触玩家时造成的伤害 */
    damage: number;
    /** 被击败后掉落的经验值 */
    exp: number;
    /** 远程攻击参数，存在则该敌人为远程敌人（靠近到保持距离后停下射击） */
    ranged?: EnemyRangedConfig;
    /** 第二阶段参数，存在则该敌人生命值过低时进入强化阶段 */
    phase?: EnemyPhaseConfig;
}

/** 默认敌人 ID：未指定 enemyId 或配置缺失时使用 */
export const DEFAULT_ENEMY_ID = EnemyId.Slime;

/** 敌人配置表：新增敌人种类时在此追加一条即可 */
export const ENEMY_CONFIGS: Record<EnemyId, EnemyConfig> = {
    [EnemyId.Slime]: {
        id: EnemyId.Slime,
        name: '史莱姆',
        hp: 30,
        moveSpeed: 105,
        damage: 8,
        exp: 10,
    },
    [EnemyId.Goblin]: {
        id: EnemyId.Goblin,
        name: '哥布林',
        hp: 40,
        moveSpeed: 95,
        damage: 10,
        exp: 18,
        ranged: {
            keepDistance: 320,
            fireInterval: 2,
            bulletSpeed: 280,
            bulletDamage: 8,
        },
    },
    [EnemyId.Boss]: {
        id: EnemyId.Boss,
        name: '恶龙',
        hp: 3000,
        moveSpeed: 70,
        damage: 20,
        exp: 300,
        phase: {
            hpRatio: 0.5,
            moveSpeedMultiplier: 1.6,
            fireInterval: 2.2,
            bulletCount: 12,
            bulletSpeed: 260,
            bulletDamage: 10,
        },
    },
};

/** 所有敌人 ID 的列表，便于遍历或随机抽取 */
export const ENEMY_IDS: EnemyId[] = Object.keys(ENEMY_CONFIGS) as EnemyId[];

/** 取指定敌人的配置，不存在时返回 null */
export function getEnemyConfig(id: EnemyId): EnemyConfig | null {
    return ENEMY_CONFIGS[id] ?? null;
}

/** 取指定敌人的配置，不存在时返回默认配置 */
export function getEnemyConfigOrDefault(id: EnemyId): EnemyConfig | null {
    return getEnemyConfig(id) ?? getEnemyConfig(DEFAULT_ENEMY_ID);
}
