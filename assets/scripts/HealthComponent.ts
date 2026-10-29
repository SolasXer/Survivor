import { _decorator, Component } from 'cc';
import { EventBus } from './EventBus';
import { ConfigManager } from './ConfigManager';
import { ENTITY_DIED, EntityDiedPayload, HEALTH_CHANGED, HealthChangedPayload } from './GameEvents';
const { ccclass, property } = _decorator;

/**
 * 生命值组件：玩家与敌人共用的血量容器。
 *
 * 只负责「数值 + 状态」，不引用任何具体业务脚本：
 * - 对外提供扣血 / 回血 / 重置 / 查询接口；
 * - 生命值一发生变化就通过事件总线发出 `HEALTH_CHANGED`，
 *   归零时额外发出一次 `ENTITY_DIED`（同一实体只发一次），
 *   payload 里带上自身节点，由监听方（玩家脚本、敌人脚本、UI）自行过滤与响应。
 *
 * 挂载方式：挂到玩家 / 敌人节点上，由 `PlayerController` 或 `Enemy` 在 `onLoad` 中
 * 取用（节点上未预先挂载时会自动补挂一个）。
 */
@ccclass('HealthComponent')
export class HealthComponent extends Component {
    @property({ tooltip: '当前生命值' })
    hp: number = 100;

    @property({ tooltip: '生命值上限，作为生命值条满格的基准；敌人生成时由配置写入' })
    maxHp: number = 100;

    /** 是否已阵亡，阵亡后不再接受伤害与治疗 */
    private _dead: boolean = false;

    /** 生命值比例（0~1），用于生命值条等显示 */
    public get ratio(): number {
        const max = Math.max(1, this.maxHp);
        return Math.min(1, Math.max(0, this.hp / max));
    }

    /** 是否已阵亡 */
    public isDead(): boolean {
        return this._dead;
    }

    /**
     * 设置当前生命值，并发出变化事件。
     * 不会被上限钳制（敌人的属性成长可能临时超过上限）。
     */
    public setHp(value: number): void {
        const next = Math.max(0, value);
        const delta = next - this.hp;
        this.hp = next;
        this.notifyChanged(delta);
    }

    /** 设置生命值上限，并发出变化事件 */
    public setMaxHp(value: number): void {
        this.maxHp = Math.max(0, value);
        this.notifyChanged(0);
    }

    /**
     * 读取 ConfigManager 的玩家配置并初始化生命值（玩家节点在初始化时调用）。
     *
     * 配置尚未加载完成时 `ConfigManager.getPlayer()` 返回内置默认值，
     * 而默认值与 `player.json` 内容一致，因此初始化结果不受读取时序影响。
     */
    public applyPlayerConfig(): void {
        const config = ConfigManager.getPlayer();
        this.reset(Math.max(0, config.hp), Math.max(0, config.maxHp));
    }

    /**
     * 重置为指定生命值并清除阵亡标记，敌人生成 / 复用时调用。
     * 也会发出一次变化事件，便于监听方同步初始数值。
     * @param hp 当前生命值
     * @param maxHp 生命值上限，省略时与当前生命值相同
     */
    public reset(hp: number, maxHp?: number): void {
        const nextHp = Math.max(0, hp);
        const delta = nextHp - this.hp;

        this.hp = nextHp;
        this.maxHp = Math.max(0, maxHp === undefined ? hp : maxHp);
        this._dead = false;

        this.notifyChanged(delta);
    }

    /**
     * 扣除生命值，归零则标记阵亡并发出 `ENTITY_DIED`（仅触发一次）。
     * @param amount 伤害值，负数按 0 处理
     * @returns 实际扣除的伤害值，已阵亡时返回 0
     */
    public takeDamage(amount: number): number {
        if (this._dead || !this.isValid) return 0;

        const damage = Math.max(0, amount);
        this.hp = Math.max(0, this.hp - damage);

        this.notifyChanged(-damage);
        if (this.hp > 0) return damage;

        this._dead = true;
        this.notifyDied();
        return damage;
    }

    /**
     * 回复生命值，回复量受生命值上限约束。
     * @param amount 回复值，负数按 0 处理
     * @returns 实际回复量
     */
    public heal(amount: number): number {
        if (this._dead || !this.isValid) return 0;

        const gain = Math.min(Math.max(0, amount), Math.max(0, this.maxHp - this.hp));
        if (gain <= 0) return 0;

        this.hp += gain;
        this.notifyChanged(gain);
        return gain;
    }

    /** 直接判定阵亡：生命值清零并发出一次 `ENTITY_DIED` */
    public kill(): void {
        if (this._dead || !this.isValid) return;

        this.hp = 0;
        this._dead = true;
        this.notifyDied();
    }

    /** 发出生命值变化事件 */
    private notifyChanged(delta: number): void {
        if (!this.isValid) return;

        const payload: HealthChangedPayload = {
            node: this.node,
            hp: this.hp,
            maxHp: this.maxHp,
            ratio: this.ratio,
            delta,
        };
        EventBus.emit<HealthChangedPayload>(HEALTH_CHANGED, payload);
    }

    /** 发出阵亡事件 */
    private notifyDied(): void {
        if (!this.isValid) return;

        const payload: EntityDiedPayload = { node: this.node };
        EventBus.emit<EntityDiedPayload>(ENTITY_DIED, payload);
    }
}
