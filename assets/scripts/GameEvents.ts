import { Node } from 'cc';

/**
 * 全局事件字典：事件名常量与事件负载（payload）类型集中在此登记。
 *
 * 本文件只依赖引擎类型，不 import 任何业务脚本，
 * 因此「为了拿一个事件名常量而 import 业务类」造成的循环依赖从根上消失：
 * 监听方与发送方都只认识事件名与 payload，互不认识对方的类型。
 *
 * 约定：
 * - 事件名一律使用 `域/动作` 形式，禁止在业务脚本里写裸字符串；
 * - 每个事件只携带一个 payload 对象（EventBus 的回调签名统一为 `(payload) => void`）；
 * - 需要区分实体的事件一律带 `node` 字段，由接收方自行过滤，总线不区分实体。
 */

// ---------------------------------------------------------------- 实体生命值

/** 任意实体的生命值发生变化（受伤 / 治疗 / 重置），携带变化量与变化后的数值 */
export const HEALTH_CHANGED = 'entity/health-changed';

/** 任意实体生命值归零（阵亡），由 HealthComponent 发出，同一实体只发一次 */
export const ENTITY_DIED = 'entity/died';

// ---------------------------------------------------------------- 玩家域

/** 玩家生命值变化：由 PlayerController 把 HEALTH_CHANGED 翻译成玩家域事件 */
export const PLAYER_HP_CHANGED = 'player/hp-changed';

/** 玩家经验值变化（含当前等级与升级所需经验） */
export const PLAYER_EXP_CHANGED = 'player/exp-changed';

/** 玩家升级 */
export const PLAYER_LEVEL_UP = 'player/level-up';

/** 玩家技能等级表变化：初始化与每次升级后发出，供升级界面取当前等级 */
export const PLAYER_SKILLS_CHANGED = 'player/skills-changed';

/** 玩家阵亡：由 GameManager 监听并判定失败 */
export const PLAYER_DEAD = 'player/dead';

// ---------------------------------------------------------------- 敌人域

/** 敌人被击败：携带该敌人提供的经验值 */
export const ENEMY_KILLED = 'enemy/killed';

// ---------------------------------------------------------------- 伤害

/** 对玩家造成伤害的请求：由敌人接触伤害 / 敌人子弹发出，玩家自行结算 */
export const DAMAGE_PLAYER = 'damage/player';

/** 对敌人造成伤害的请求：由玩家子弹发出，命中的敌人自行结算 */
export const DAMAGE_ENEMY = 'damage/enemy';

// ---------------------------------------------------------------- 表现层

/** 生成伤害飘字的请求：携带世界坐标与伤害数值 */
export const DAMAGE_TEXT_REQUEST = 'fx/damage-text';

/** 触发屏幕震动的请求 */
export const SHAKE_REQUEST = 'fx/shake';

// ---------------------------------------------------------------- 界面交互

/** 技能卡被选中：升级界面发出，玩家侧提升对应技能等级 */
export const SKILL_SELECTED = 'skill/selected';

/** 技能卡点击事件（SkillCard 自身发出，供外部按需监听） */
export const SKILL_CARD_CLICK = 'skill/card-click';

/** 请求显示暂停界面：HUD 的暂停按钮发出，暂停界面自行显示 */
export const UI_PAUSE_REQUESTED = 'ui/pause-requested';

// ---------------------------------------------------------------- 游戏流程

/** 暂停状态变化：回调参数为是否暂停（boolean） */
export const GAME_PAUSE_CHANGE = 'game/pause-change';

/** 对局结束：携带胜负与统计，供结算界面显示 */
export const GAME_OVER = 'game/over';

/** 玩家复活：由 GameManager 在广告复活成功后发出，玩家侧据此恢复生命值 */
export const PLAYER_REVIVE = 'player/revive';

// ---------------------------------------------------------------- 输入

/** 摇杆按下：回调参数为方向向量（Vec2） */
export const JOYSTICK_MOVE_START = 'input/joystick-start';

/** 摇杆移动：回调参数为方向向量（Vec2） */
export const JOYSTICK_MOVE = 'input/joystick-move';

/** 摇杆松开：回调参数为方向向量（Vec2，归零） */
export const JOYSTICK_MOVE_END = 'input/joystick-end';

// ---------------------------------------------------------------- 负载类型

/** 生命值变化：delta 为本次变化量，受伤为负、治疗为正 */
export interface HealthChangedPayload {
    /** 生命值组件所在节点 */
    node: Node | null;
    /** 变化后的当前生命值 */
    hp: number;
    /** 生命值上限 */
    maxHp: number;
    /** 生命值比例（0~1） */
    ratio: number;
    /** 本次变化量 */
    delta: number;
}

/** 实体阵亡 */
export interface EntityDiedPayload {
    /** 阵亡实体所在节点 */
    node: Node | null;
}

/** 玩家复活：hpRatio 为复活后恢复的生命值比例（0~1） */
export interface PlayerRevivePayload {
    /** 复活后恢复的生命值比例（0~1） */
    hpRatio: number;
}

/** 玩家生命值 */
export interface PlayerHpChangedPayload {
    hp: number;
    maxHp: number;
    ratio: number;
}

/** 玩家经验与等级 */
export interface PlayerExpChangedPayload {
    /** 当前等级已累积的经验值 */
    exp: number;
    /** 升到下一级所需经验值 */
    needed: number;
    /** 经验条比例（0~1） */
    ratio: number;
    /** 当前等级 */
    level: number;
}

/** 玩家升级 */
export interface PlayerLevelUpPayload {
    /** 升级后的等级 */
    level: number;
}

/** 玩家技能等级表：键为技能 ID */
export interface PlayerSkillsChangedPayload {
    levels: Record<string, number>;
}

/** 敌人被击败 */
export interface EnemyKilledPayload {
    /** 敌人节点 */
    node: Node | null;
    /** 敌人 ID */
    enemyId: string;
    /** 该敌人提供的经验值 */
    exp: number;
}

/** 对玩家造成伤害 */
export interface DamagePlayerPayload {
    damage: number;
}

/** 对敌人造成伤害 */
export interface DamageEnemyPayload {
    /** 被命中的敌人节点，敌人据此判断是否是打自己 */
    node: Node | null;
    /** 伤害数值（暴击已由子弹结算） */
    damage: number;
    /** 命中方向，决定击退方向 */
    dirX: number;
    dirY: number;
    /** 击退距离（像素），小于等于 0 表示不击退 */
    knockback: number;
    /** 减速比例（0~1），小于等于 0 表示不减速 */
    slowRate: number;
    /** 减速持续时间（秒） */
    slowDuration: number;
}

/** 伤害飘字：世界坐标 + 伤害数值 */
export interface DamageTextPayload {
    /** 飘字出现的世界坐标 X */
    x: number;
    /** 飘字出现的世界坐标 Y */
    y: number;
    /** 显示的伤害数值 */
    damage: number;
    /** 是否为暴击 */
    crit: boolean;
}

/** 屏幕震动 */
export interface ShakePayload {
    /** 震动幅度（像素），省略时使用 ScreenShake 自身的配置 */
    amplitude?: number;
}

/** 技能卡被选中 */
export interface SkillSelectedPayload {
    /** 技能 ID */
    skillId: string;
}

/** 对局结束统计 */
export interface GameOverPayload {
    /** true 为胜利（击败 Boss） */
    win: boolean;
    /** 坚持时间（秒） */
    time: number;
    /** 结束时达到的等级 */
    level: number;
    /** 累计击败的敌人数量 */
    kills: number;
    /** 是否由玩家主动退出结束（主动退出不展示结算界面） */
    quitted: boolean;
}
