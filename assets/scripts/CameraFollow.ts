import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 摄像机跟随：挂载在 Canvas/Camera 节点上。
 * 每帧将摄像机位置同步到目标节点（Player），保持 z 轴不变。
 */
@ccclass('CameraFollow')
export class CameraFollow extends Component {
    @property({ type: Node, tooltip: '跟随目标（Player 节点）' })
    target: Node | null = null;

    private readonly _tmpPos: Vec3 = new Vec3();

    lateUpdate() {
        if (!this.target) return;

        const targetPos = this.target.position;
        const pos = this.node.position;
        this._tmpPos.set(targetPos.x, targetPos.y, pos.z);
        this.node.setPosition(this._tmpPos);
    }
}
