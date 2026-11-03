import { director, instantiate, Node, Prefab } from 'cc';

/** 池中闲置子弹节点的挂载根节点名：与 BulletContainer 平级，避免被容器清场时连带销毁 */
const POOL_ROOT_NAME = 'BulletPool';

/** 默认的对象池容量 */
const DEFAULT_POOL_SIZE = 30;

/**
 * 子弹对象池（纯逻辑类，不挂载到节点，由 `PlayerController` 持有）。
 *
 * 流程：
 * - 开局 `prewarm()`：按容量实例化一批子弹节点，挂到专用的 `BulletPool` 根节点下并保持隐藏；
 * - 发射：`acquire()` 取出一个闲置节点，挂回飞行用的容器并激活，交给玩家脚本写位置与方向；
 * - 命中敌人 / 飞出屏幕：子弹脚本调用 `release()`，节点被隐藏并放回 `BulletPool` 节点下等待复用。
 *
 * 这样战斗中不再反复 instantiate / destroy，避免高频射击时的抖动与 GC 压力。
 *
 * 容量用尽时会临时新建一个节点应急（保证射击不被削减），该节点归还时会被销毁而不是入池，
 * 因此池的总量始终维持在预设容量。
 */
export class BulletPool {
    /** 最近创建的对象池，供 Bullet 激活时自我绑定 */
    private static _default: BulletPool | null = null;

    /** 最近创建的对象池，没有则为 null */
    public static get defaultPool(): BulletPool | null {
        return BulletPool._default;
    }

    private _prefab: Prefab | null = null;
    private _spawnParent: Node | null = null;
    private _size: number = DEFAULT_POOL_SIZE;

    /** 闲置可复用的子弹节点 */
    private readonly _free: Node[] = [];
    /** 正在飞行中的子弹节点 */
    private readonly _used: Node[] = [];
    /** 闲置节点的挂载根节点 */
    private _root: Node | null = null;

    /**
     * @param prefab 子弹预制件
     * @param spawnParent 子弹飞行时挂载的父节点（通常是 BulletContainer）
     * @param size 池容量，即预先实例化的节点数量
     */
    constructor(prefab: Prefab | null, spawnParent: Node | null, size: number = DEFAULT_POOL_SIZE) {
        this._prefab = prefab;
        this._spawnParent = spawnParent;
        this._size = Math.max(0, Math.floor(size));
        BulletPool._default = this;
    }

    /** 池容量（预先实例化的节点数量） */
    public getCapacity(): number {
        return this._size;
    }

    /** 当前闲置节点数量（剔除已被销毁的节点后） */
    public getFreeCount(): number {
        this.prune(this._free);
        return this._free.length;
    }

    /** 当前飞行中的节点数量（剔除已被销毁的节点后） */
    public getUsedCount(): number {
        this.prune(this._used);
        return this._used.length;
    }

    /**
     * 预先实例化节点并隐藏：数量补齐到 `count`（缺省为容量）。
     * 预制件无效时会静默跳过，池保持为空（发射时仍会退化为直接实例化）。
     */
    public prewarm(count?: number): void {
        const target = Math.max(0, Math.floor(count ?? this._size));
        this.prune(this._free);

        while (this._free.length < target) {
            const node = this.createNode();
            if (!node?.isValid) return;

            node.active = false;
            this._free.push(node);
        }
    }

    /**
     * 取一个可发射的子弹节点：优先复用闲置节点，池空时临时新建一个不参与池化的节点。
     * @returns 已挂载到飞行容器且处于激活状态的节点；预制件无效时返回 null
     */
    public acquire(): Node | null {
        this.prune(this._free);
        this.prune(this._used);

        // 取自闲置节点时一定记入本池；没有闲置节点时，若总量还没到容量就补一个
        // （例如被外部清场销毁后自愈），否则临时新建一个不入池的节点应急
        let pooled = true;
        let node = this._free.pop() ?? null;
        if (!node?.isValid) {
            pooled = this._free.length + this._used.length < this._size;
            node = this.createNode();
        }
        if (!node?.isValid) return null;

        // 挂回飞行容器后激活，由调用方紧接着写入位置、技能属性与方向
        if (this._spawnParent?.isValid) node.setParent(this._spawnParent);
        node.active = true;
        if (pooled) this._used.push(node);

        return node;
    }

    /**
     * 归还节点：隐藏并放回池中等待复用。
     * 不属于本池的节点（例如容量用尽时临时新建的、或已被场景清场销毁的）会被销毁掉。
     */
    public release(node: Node | null): void {
        if (!node?.isValid) return;

        const index = this._used.indexOf(node);
        if (index < 0) {
            node.destroy();
            return;
        }
        this._used.splice(index, 1);

        node.active = false;
        if (this._root?.isValid) node.setParent(this._root);
        this._free.push(node);
    }

    /** 把当前所有飞行中的子弹收回池中隐藏起来（例如需要一次性清空画面时调用） */
    public releaseAll(): void {
        const flying = this._used.slice();
        for (const node of flying) {
            this.release(node);
        }
    }

    /** 清空对象池：销毁所有池内节点（含飞行中的），之后可重新 `prewarm()` */
    public clear(): void {
        this.prune(this._free);
        this.prune(this._used);

        for (const node of this._used.concat(this._free)) {
            if (node?.isValid) node.destroy();
        }
        this._used.length = 0;
        this._free.length = 0;
    }

    /**
     * 更新绑定的预制件 / 飞行容器（例如它们在 Inspector 上被重新赋值后调用）。
     * 已存在的闲置节点不受影响，仅影响之后新建的节点。
     */
    public rebind(prefab: Prefab | null, spawnParent: Node | null): void {
        this._prefab = prefab;
        this._spawnParent = spawnParent;
    }

    /** 实例化一个子弹节点（挂在池的根节点下，处于非激活状态） */
    private createNode(): Node | null {
        const prefab = this._prefab;
        const root = this.getRoot();
        if (!prefab?.isValid) return null;

        const node = instantiate(prefab);
        if (!node?.isValid) return null;
        if (root?.isValid) node.setParent(root);

        return node;
    }

    /** 闲置节点的挂载根节点：与飞行容器同父同级，避免在清场时被误删；拿不到父节点时挂到场景根下 */
    private getRoot(): Node | null {
        if (this._root?.isValid) return this._root;

        const parent = this._spawnParent?.isValid ? this._spawnParent.parent : null;
        this._root = new Node(POOL_ROOT_NAME);
        this._root.setParent(parent?.isValid ? parent : director.getScene());
        return this._root;
    }

    /** 剔除列表中已被销毁（失效）的节点 */
    private prune(list: Node[]): void {
        for (let i = list.length - 1; i >= 0; i--) {
            if (!list[i]?.isValid) list.splice(i, 1);
        }
    }
}
