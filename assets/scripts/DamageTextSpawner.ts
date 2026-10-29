import { _decorator, Component, Node, Prefab, UITransform, Vec3, instantiate } from 'cc';
import { EventBus } from './EventBus';
import { DamageTextPayload, DAMAGE_TEXT_REQUEST } from './GameEvents';
import { DamageText } from './DamageText';
const { ccclass, property } = _decorator;

/**
 * 伤害飘字生成器：挂载在 Canvas 上，统一处理飘字的实例化。
 *
 * 伤害来源（子弹等）不再自己去 instantiate 飘字，而是发一个 `DAMAGE_TEXT_REQUEST`
 * 事件（带世界坐标与伤害数值），由本组件转成容器内的局部坐标后生成飘字。
 * 这样子弹既不依赖 DamageText 脚本，也不需要持有飘字预制件与容器引用。
 */
@ccclass('DamageTextSpawner')
export class DamageTextSpawner extends Component {
    @property({ type: Prefab, tooltip: '伤害飘字预制件（DamageText）' })
    damageTextPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '飘字挂载的容器节点，留空时挂到自身节点下' })
    container: Node | null = null;

    private readonly _tmpPos: Vec3 = new Vec3();

    onLoad() {
        EventBus.on<DamageTextPayload>(DAMAGE_TEXT_REQUEST, this.onDamageTextRequest, this);
    }

    onDestroy() {
        EventBus.off<DamageTextPayload>(DAMAGE_TEXT_REQUEST, this.onDamageTextRequest, this);
    }

    /**
     * 生成一处伤害飘字：把事件携带的世界坐标换算到容器节点的局部坐标后实例化，
     * 与子弹原先「挂同一父节点、直接复制局部坐标」的做法等价，不受 Canvas 自身偏移影响。
     */
    private onDamageTextRequest(payload: DamageTextPayload) {
        const prefab = this.damageTextPrefab;
        if (!prefab || !payload) return;

        const parent = this.getContainer();
        if (!parent?.isValid) return;

        const node = instantiate(prefab);
        if (!node?.isValid) return;

        node.setParent(parent);

        this._tmpPos.set(payload.x, payload.y, 0);
        const transform = parent.getComponent(UITransform);
        const local = transform ? transform.convertToNodeSpaceAR(this._tmpPos) : this._tmpPos;
        node.setPosition(local.x, local.y, 0);

        const damageText = node.getComponent(DamageText);
        if (!damageText) {
            node.destroy();
            return;
        }

        damageText.show(payload.damage);
    }

    /** 飘字容器：优先使用配置的容器，未配置或失效时用自身节点兜底 */
    private getContainer(): Node | null {
        return this.container?.isValid ? this.container : this.node;
    }
}
