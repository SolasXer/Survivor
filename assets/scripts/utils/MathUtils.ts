import { Node } from 'cc';

/**
 * 数学工具（纯函数，不挂载到节点，不含组件逻辑）。
 *
 * 目前提供「两个节点之间的距离」计算：距离取节点的世界坐标，只算 X / Y 平面上的直线距离，
 * 与本项目 2D 玩法一致（忽略 Z 轴）。
 *
 * 用法：
 * - `getNodeDistance(a, b)`：两点间的直线距离（像素），需要比较大小或做除法时用；
 * - `getNodeDistanceSq(a, b)`：距离的平方，只做大小比较时用它，可省一次开方。
 */
export class MathUtils {
    /**
     * 两个节点之间的距离（像素）。
     * @param a 起点节点
     * @param b 终点节点
     * @returns 距离；任一节点无效时返回 0
     */
    public static getNodeDistance(a: Node | null, b: Node | null): number {
        return Math.sqrt(MathUtils.getNodeDistanceSq(a, b));
    }

    /**
     * 两个节点之间距离的平方。
     * @param a 起点节点
     * @param b 终点节点
     * @returns 距离的平方；任一节点无效时返回 0
     */
    public static getNodeDistanceSq(a: Node | null, b: Node | null): number {
        if (!a?.isValid || !b?.isValid) return 0;

        const aPos = a.worldPosition;
        const bPos = b.worldPosition;
        const dx = bPos.x - aPos.x;
        const dy = bPos.y - aPos.y;
        return dx * dx + dy * dy;
    }
}

/** 两个节点之间的距离（像素），`MathUtils.getNodeDistance` 的函数式写法 */
export function getNodeDistance(a: Node | null, b: Node | null): number {
    return MathUtils.getNodeDistance(a, b);
}

/** 两个节点之间距离的平方，`MathUtils.getNodeDistanceSq` 的函数式写法 */
export function getNodeDistanceSq(a: Node | null, b: Node | null): number {
    return MathUtils.getNodeDistanceSq(a, b);
}
