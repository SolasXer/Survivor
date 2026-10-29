import { EventTarget } from 'cc';

/** 事件回调：统一只接收一个 payload 对象 */
export type EventCallback<T> = (payload: T) => void;

/**
 * 全局事件总线：对 Cocos 内置 `EventTarget` 的薄封装，取代散落各处的 `director.on/emit`。
 *
 * 与直接用 `director` 相比：
 * - 独立的事件通道，不会与引擎自身的 director 事件（场景加载等）混在一起；
 * - 回调签名统一为 `(payload) => void`，payload 类型由 `GameEvents.ts` 登记，
 *   调用处写 `EventBus.on<PlayerHpChangedPayload>(PLAYER_HP_CHANGED, (p) => ...)` 即可获得类型提示；
 * - 事件名集中在 `GameEvents.ts`，配合本总线即可做到发送方与接收方零 import。
 *
 * 注意：总线是全局的，监听不会随节点销毁自动解绑。
 * 组件请在 `onLoad` 中 `on()`、在 `onDestroy` 中 `off()`（本项目现有脚本均遵循该写法）。
 */
export class EventBus {
    private static readonly _target: EventTarget = new EventTarget();

    /**
     * 监听事件。
     * @param type 事件名，取 `GameEvents.ts` 中的常量
     * @param callback 回调，接收一个 payload
     * @param target 回调的 this，通常传组件实例，解绑时需传同一个对象
     */
    public static on<T>(type: string, callback: EventCallback<T>, target?: unknown): void {
        EventBus._target.on(type, callback as unknown as (...args: unknown[]) => void, target);
    }

    /** 监听一次，触发后自动解绑 */
    public static once<T>(type: string, callback: EventCallback<T>, target?: unknown): void {
        EventBus._target.once(type, callback as unknown as (...args: unknown[]) => void, target);
    }

    /** 解绑事件，参数需与 `on()` 时完全一致 */
    public static off<T>(type: string, callback: EventCallback<T>, target?: unknown): void {
        EventBus._target.off(type, callback as unknown as (...args: unknown[]) => void, target);
    }

    /** 派发事件，payload 为 `GameEvents.ts` 中登记的类型 */
    public static emit<T>(type: string, payload?: T): void {
        EventBus._target.emit(type, payload);
    }
}
