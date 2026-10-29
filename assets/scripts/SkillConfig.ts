/**
 * 子弹技能配置（纯数据脚本，不挂载到节点，不含 cc 依赖）。
 *
 * 组织方式：
 * - `BulletSkillId`：技能唯一 ID，作为所有读写接口的键；
 * - `BulletSkillConfig`：单个技能的定义（ID / 名称 / 描述 / 等级 / 数值成长）；
 * - `BULLET_SKILL_CONFIGS`：以 ID 为键的配置表，新增技能只需在这里加一条；
 * - 一组工具函数用于按 ID、按等级取值与生成描述文本。
 *
 * 约定：
 * - 等级从 1 开始，`level` 为 0（或负数）表示尚未学习，此时数值为 0；
 * - 数值 = baseValue + valuePerLevel * (level - 1)，并受 maxValue 约束；
 * - 描述文本中的 `{value}` / `{duration}` 占位符会在取描述时被替换。
 */

/** 子弹相关技能的唯一 ID */
export enum BulletSkillId {
    /** 子弹飞行速度 */
    BulletSpeed = 'bullet_speed',
    /** 一次发射子弹个数 */
    BulletCount = 'bullet_count',
    /** 子弹攻击力 */
    BulletDamage = 'bullet_damage',
    /** 子弹穿透概率 */
    BulletPierce = 'bullet_pierce',
    /** 攻击间隔缩短 */
    AttackInterval = 'attack_interval',
    /** 攻击范围扩大 */
    AttackRange = 'attack_range',
    /** 暴击概率 */
    CritRate = 'crit_rate',
    /** 击退效果 */
    Knockback = 'knockback',
    /** 减速效果 */
    Slow = 'slow',
}

/** 数值叠加方式：绝对值（直接作为属性值）或百分比（作用于基础属性） */
export enum SkillValueType {
    /** 绝对值，如速度 600 像素/秒、子弹个数 1 个 */
    Absolute = 'absolute',
    /** 百分比，如攻击力 +20%、穿透概率 30% */
    Percent = 'percent',
}

/** 单个技能的配置 */
export interface BulletSkillConfig {
    /** 技能 ID，与 `BulletSkillId` 对应 */
    id: BulletSkillId;
    /** 技能名称 */
    name: string;
    /** 技能描述模板，支持 `{value}`、`{duration}` 占位符 */
    desc: string;
    /** 默认/当前等级，0 表示未学习 */
    level: number;
    /** 最大等级 */
    maxLevel: number;
    /** 数值单位，用于描述展示 */
    unit: string;
    /** 数值叠加方式 */
    valueType: SkillValueType;
    /** 1 级时的数值 */
    baseValue: number;
    /** 每提升一级增加的数值 */
    valuePerLevel: number;
    /** 数值上限，超出后按上限取值 */
    maxValue: number;
    /** 附带效果的持续时间（秒），仅部分技能使用（如减速） */
    durationBase?: number;
    /** 持续时间每级的增量（秒） */
    durationPerLevel?: number;
    /** 持续时间上限（秒） */
    maxDuration?: number;
}

/** 技能默认等级：1 级起，0 级视为未学习 */
export const DEFAULT_SKILL_LEVEL = 1;

/** 子弹技能配置表：新增技能时在此追加一条即可 */
export const BULLET_SKILL_CONFIGS: Record<BulletSkillId, BulletSkillConfig> = {
    [BulletSkillId.BulletSpeed]: {
        id: BulletSkillId.BulletSpeed,
        name: '子弹飞行速度',
        desc: '子弹飞行速度提升至 {value}{unit}',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '像素/秒',
        valueType: SkillValueType.Absolute,
        baseValue: 600,
        valuePerLevel: 60,
        maxValue: 1200,
    },
    [BulletSkillId.BulletCount]: {
        id: BulletSkillId.BulletCount,
        name: '多重射击',
        desc: '一次发射 {value}{unit}子弹',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '颗',
        valueType: SkillValueType.Absolute,
        baseValue: 1,
        valuePerLevel: 1,
        maxValue: 10,
    },
    [BulletSkillId.BulletDamage]: {
        id: BulletSkillId.BulletDamage,
        name: '子弹攻击力',
        desc: '子弹攻击力提升至 {value}{unit}',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '点',
        valueType: SkillValueType.Absolute,
        baseValue: 12,
        valuePerLevel: 5,
        maxValue: 100,
    },
    [BulletSkillId.BulletPierce]: {
        id: BulletSkillId.BulletPierce,
        name: '子弹穿透',
        desc: '{value}{unit}概率穿透敌人，命中后继续飞行',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '%',
        valueType: SkillValueType.Percent,
        baseValue: 0,
        valuePerLevel: 20,
        maxValue: 100,
    },
    [BulletSkillId.AttackInterval]: {
        id: BulletSkillId.AttackInterval,
        name: '急速射击',
        desc: '攻击间隔缩短 {value}{unit}',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '%',
        valueType: SkillValueType.Percent,
        baseValue: 0,
        valuePerLevel: 11,
        maxValue: 60,
    },
    [BulletSkillId.AttackRange]: {
        id: BulletSkillId.AttackRange,
        name: '攻击范围',
        desc: '攻击范围扩大 {value}{unit}',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '%',
        valueType: SkillValueType.Percent,
        baseValue: 0,
        valuePerLevel: 15,
        maxValue: 100,
    },
    [BulletSkillId.CritRate]: {
        id: BulletSkillId.CritRate,
        name: '暴击',
        desc: '{value}{unit}概率触发暴击，暴击造成双倍伤害',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '%',
        valueType: SkillValueType.Percent,
        baseValue: 0,
        valuePerLevel: 10,
        maxValue: 100,
    },
    [BulletSkillId.Knockback]: {
        id: BulletSkillId.Knockback,
        name: '击退',
        desc: '命中时将敌人击退 {value}{unit}',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '像素',
        valueType: SkillValueType.Absolute,
        baseValue: 0,
        valuePerLevel: 20,
        maxValue: 200,
    },
    [BulletSkillId.Slow]: {
        id: BulletSkillId.Slow,
        name: '减速',
        desc: '命中后使敌人移动速度降低 {value}{unit}，持续 {duration} 秒',
        level: DEFAULT_SKILL_LEVEL,
        maxLevel: 5,
        unit: '%',
        valueType: SkillValueType.Percent,
        baseValue: 0,
        valuePerLevel: 15,
        maxValue: 80,
        durationBase: 1,
        durationPerLevel: 0.5,
        maxDuration: 5,
    },
};

/** 所有子弹技能 ID 的顺序列表，便于遍历或随机抽取 */
export const BULLET_SKILL_IDS: BulletSkillId[] = Object.keys(BULLET_SKILL_CONFIGS) as BulletSkillId[];

/** 取指定技能的配置，不存在时返回 null */
export function getBulletSkill(id: BulletSkillId): BulletSkillConfig | null {
    return BULLET_SKILL_CONFIGS[id] ?? null;
}

/** 取指定技能在给定等级下的数值，未学习（level <= 0）时返回 0 */
export function getBulletSkillValue(id: BulletSkillId, level: number = DEFAULT_SKILL_LEVEL): number {
    const config = BULLET_SKILL_CONFIGS[id];
    if (!config) return 0;

    const lv = Math.max(0, Math.floor(level));
    if (lv <= 0) return 0;

    const raw = config.baseValue + config.valuePerLevel * (lv - 1);
    return Math.min(config.maxValue, raw);
}

/** 取指定技能在给定等级下的持续时间（秒），没有持续时间配置时返回 0 */
export function getBulletSkillDuration(id: BulletSkillId, level: number = DEFAULT_SKILL_LEVEL): number {
    const config = BULLET_SKILL_CONFIGS[id];
    if (!config || config.durationBase === undefined) return 0;

    const lv = Math.max(0, Math.floor(level));
    if (lv <= 0) return 0;

    const step = config.durationPerLevel ?? 0;
    const raw = config.durationBase + step * (lv - 1);
    return config.maxDuration !== undefined ? Math.min(config.maxDuration, raw) : raw;
}

/** 按等级生成技能描述文本（替换 `{value}` 与 `{duration}` 占位符） */
export function formatBulletSkillDesc(id: BulletSkillId, level: number = DEFAULT_SKILL_LEVEL): string {
    const config = BULLET_SKILL_CONFIGS[id];
    if (!config) return '';

    const value = getBulletSkillValue(id, level);
    const duration = getBulletSkillDuration(id, level);
    return config.desc
        .replace('{value}', `${value}`)
        .replace('{duration}', `${duration}`);
}

/** 生成一份默认等级表（全部为默认等级），用于存档或运行时等级数据的初始化 */
export function createBulletSkillLevels(): Record<BulletSkillId, number> {
    const levels = {} as Record<BulletSkillId, number>;
    for (const id of BULLET_SKILL_IDS) {
        levels[id] = BULLET_SKILL_CONFIGS[id].level;
    }
    return levels;
}

/** 暴击时伤害的倍率 */
export const CRIT_DAMAGE_MULTIPLIER = 2;

/**
 * 由技能等级表换算出的子弹增强属性集合。
 * 玩家每次攻击前用当前等级表计算一次，再把结果整体写入子弹。
 */
export interface BulletSkillStats {
    /** 子弹飞行速度（像素/秒） */
    speed: number;
    /** 单发子弹的伤害 */
    damage: number;
    /** 一次攻击发射的子弹数量 */
    count: number;
    /** 穿透概率（0~1），命中后按该概率继续飞行 */
    pierceRate: number;
    /** 暴击概率（0~1），暴击时伤害翻倍 */
    critRate: number;
    /** 命中时击退敌人的距离（像素），0 表示不击退 */
    knockback: number;
    /** 命中时敌人减速的比例（0~1），0 表示不减速 */
    slowRate: number;
    /** 减速持续时间（秒） */
    slowDuration: number;
    /** 攻击间隔的缩放系数（小于 1 表示攻击更快） */
    attackIntervalScale: number;
    /** 攻击范围的缩放系数（大于 1 表示范围更远） */
    attackRangeScale: number;
}

/** 从等级表中读取等级，缺失或非法时按未学习（0）处理 */
function readLevel(levels: Record<BulletSkillId, number> | null | undefined, id: BulletSkillId): number {
    const level = levels ? levels[id] : 0;
    return Number.isFinite(level) ? Math.max(0, Math.floor(level as number)) : 0;
}

/** 把配置里的百分比数值（0~100）换算成 0~1 的概率/比例 */
function percentToRate(value: number): number {
    return Math.min(1, Math.max(0, value / 100));
}

/** 按技能等级表计算出当前子弹的全部增强属性 */
export function computeBulletSkillStats(levels: Record<BulletSkillId, number>): BulletSkillStats {
    const speed = getBulletSkillValue(BulletSkillId.BulletSpeed, readLevel(levels, BulletSkillId.BulletSpeed));
    const damage = getBulletSkillValue(BulletSkillId.BulletDamage, readLevel(levels, BulletSkillId.BulletDamage));
    const count = getBulletSkillValue(BulletSkillId.BulletCount, readLevel(levels, BulletSkillId.BulletCount));
    const pierce = getBulletSkillValue(BulletSkillId.BulletPierce, readLevel(levels, BulletSkillId.BulletPierce));
    const crit = getBulletSkillValue(BulletSkillId.CritRate, readLevel(levels, BulletSkillId.CritRate));
    const knockback = getBulletSkillValue(BulletSkillId.Knockback, readLevel(levels, BulletSkillId.Knockback));

    const slowLevel = readLevel(levels, BulletSkillId.Slow);
    const slowRate = percentToRate(getBulletSkillValue(BulletSkillId.Slow, slowLevel));
    const slowDuration = getBulletSkillDuration(BulletSkillId.Slow, slowLevel);

    const intervalReduce = percentToRate(getBulletSkillValue(BulletSkillId.AttackInterval, readLevel(levels, BulletSkillId.AttackInterval)));
    const rangeBonus = percentToRate(getBulletSkillValue(BulletSkillId.AttackRange, readLevel(levels, BulletSkillId.AttackRange)));

    return {
        speed: Math.max(1, speed),
        damage: Math.max(1, damage),
        count: Math.max(1, Math.round(count)),
        pierceRate: percentToRate(pierce),
        critRate: percentToRate(crit),
        knockback: Math.max(0, knockback),
        slowRate,
        slowDuration: Math.max(0, slowDuration),
        attackIntervalScale: Math.max(0.1, 1 - intervalReduce),
        attackRangeScale: Math.max(0.1, 1 + rangeBonus),
    };
}

/**
 * 随机抽取可升级的技能 ID：只会抽到尚未满级的技能，且抽到的技能互不重复。
 * @param levels 玩家当前的技能等级表
 * @param count 需要抽取的数量，可升级技能不足时返回实际可用的数量
 */
export function rollUpgradeSkillIds(levels: Record<BulletSkillId, number>, count: number): BulletSkillId[] {
    const max = Math.max(1, Math.floor(count));

    // 先过滤出未满级的技能，避免抽到已经满级的技能
    const pool = BULLET_SKILL_IDS.filter((id) => {
        const config = BULLET_SKILL_CONFIGS[id];
        if (!config) return false;
        return readLevel(levels, id) < config.maxLevel;
    });

    // 抽中后即从候选池移除，保证同一批结果里不会出现重复的技能
    const picked: BulletSkillId[] = [];
    while (picked.length < max && pool.length > 0) {
        const index = Math.floor(Math.random() * pool.length);
        picked.push(pool[index]);
        pool.splice(index, 1);
    }

    return picked;
}
