import { _decorator, Component, Node, Label, EventTouch } from 'cc';
import { EventBus } from './EventBus';
import { SKILL_CARD_CLICK } from './GameEvents';
const { ccclass, property } = _decorator;

/** 点击事件随附的数据 */
export interface SkillCardClickData {
    /** 被点击的卡片节点 */
    node: Node;
    /** 卡片绑定的技能 ID */
    skillId: string;
    /** 技能名称 */
    skillName: string;
    /** 技能描述 */
    skillDesc: string;
}

/**
 * 技能卡片组件：挂载在 SkillCard 预制体的根节点上。
 *
 * 结构约定（对应预制体）：
 * - 根节点：280×500，挂 Sprite（skill_card_bg 底图）+ 本组件；
 * - `nameLabel`：卡片顶部的技能名称（加粗）；
 * - `descLabel`：名称下方的技能描述。
 *
 * 点击行为：在 TOUCH_END 时把事件向外传递
 * 1. 全局广播：`EventBus.emit(SKILL_CARD_CLICK, data)`；
 * 2. 若设置了 `onClick` 回调，则再回调一次。
 *
 * 监听示例：
 * ```ts
 * EventBus.on<SkillCardClickData>(SKILL_CARD_CLICK, (data) => { ... }, this);
 * ```
 */
@ccclass('SkillCard')
export class SkillCard extends Component {
    @property({ type: Label, tooltip: '顶部技能名称文本（加粗）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '下方技能描述文本' })
    descLabel: Label = null!;

    @property({ tooltip: '技能 ID，点击时随事件一起抛出' })
    skillId: string = '';

    @property({ tooltip: '技能名称' })
    skillName: string = '技能名称';

    @property({ tooltip: '技能描述' })
    skillDesc: string = '技能描述';

    @property({ tooltip: '是否可点击；关闭后不派发点击事件' })
    interactable: boolean = true;

    /** 可选的点击回调，外部可直接赋值；与 director 广播同时生效 */
    onClick: ((data: SkillCardClickData) => void) | null = null;

    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    }

    start() {
        this.refreshView();
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    }

    /**
     * 设置卡片数据并刷新文本；省略的参数保持原值。
     * @param id 技能 ID
     * @param name 技能名称，不传则不改动
     * @param desc 技能描述，不传则不改动
     */
    setSkill(id: string, name?: string, desc?: string): void {
        this.skillId = id;
        if (name !== undefined) this.skillName = name;
        if (desc !== undefined) this.skillDesc = desc;
        this.refreshView();
    }

    /** 把当前数据刷到两个文本上 */
    refreshView(): void {
        if (this.nameLabel) this.nameLabel.string = this.skillName;
        if (this.descLabel) this.descLabel.string = this.skillDesc;
    }

    private _onTouchEnd(event: EventTouch): void {
        if (!this.interactable) return;

        const data: SkillCardClickData = {
            node: this.node,
            skillId: this.skillId,
            skillName: this.skillName,
            skillDesc: this.skillDesc,
        };

        EventBus.emit<SkillCardClickData>(SKILL_CARD_CLICK, data);
        this.onClick?.(data);
    }
}
