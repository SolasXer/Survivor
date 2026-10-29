import { _decorator, Component, Node, Prefab, instantiate, Label, Graphics, Color, Layers, director } from 'cc';
import { GameManager, GameState, GAME_STATE_CHANGE } from './GameManager';
import { EventBus } from './EventBus';
import {
    PLAYER_LEVEL_UP,
    PLAYER_SKILLS_CHANGED,
    SKILL_SELECTED,
    PlayerLevelUpPayload,
    PlayerSkillsChangedPayload,
    SkillSelectedPayload,
} from './GameEvents';
import { SkillCard } from './SkillCard';
import { BULLET_SKILL_CONFIGS, BulletSkillId, createBulletSkillLevels, formatBulletSkillDesc, rollUpgradeSkillIds } from './SkillConfig';
const { ccclass, property } = _decorator;

/**
 * 升级界面：挂载在 Main 场景的 LevelUpUI 节点上（该节点常驻激活，界面本体默认隐藏）。
 *
 * 工作流程：
 * 1. 监听 PLAYER_LEVEL_UP 事件，玩家升级时记为一次待处理的升级；
 * 2. 界面展示期间用的技能等级来自 PLAYER_SKILLS_CHANGED 事件同步过来的本地快照，
 *    弹出前先暂停游戏，从 SkillConfig 的技能列表里随机抽取 3 个互不重复
 *    且未满级的技能，用 SkillCard 预制件生成三张卡片；
 * 3. 玩家点击某张卡片后只发出 SKILL_SELECTED 事件，由玩家侧自行提升技能等级；
 * 4. 隐藏界面、恢复游戏；若还有未处理的升级则继续弹下一轮。
 *
 * 本界面不再持有玩家组件：只读事件快照、只发意图事件。
 */
@ccclass('LevelUpPanel')
export class LevelUpPanel extends Component {
    @property({ type: Node, tooltip: '升级界面根节点（平时隐藏，升级时显示）' })
    panel: Node | null = null;

    @property({ type: Node, tooltip: '技能卡片容器，生成的卡片统一挂在该节点下' })
    cardContainer: Node | null = null;

    @property({ type: Prefab, tooltip: '技能卡片预制件（SkillCard）' })
    skillCardPrefab: Prefab | null = null;

    @property({ type: Label, tooltip: '界面标题文本' })
    titleLabel: Label | null = null;

    @property({ type: GameManager, tooltip: '游戏管理组件，用于暂停与恢复游戏' })
    gameManager: GameManager | null = null;

    @property({ tooltip: '一次展示的技能卡片数量' })
    cardCount: number = 3;

    @property({ tooltip: '相邻卡片中心的水平间距（像素）' })
    cardSpacing: number = 340;

    /** 遮罩尺寸，与界面根节点保持一致 */
    @property({ tooltip: '半透明遮罩的宽高，覆盖整个界面' })
    maskSize: number = 1280;

    @property({ tooltip: '半透明遮罩的高度，覆盖整个界面' })
    maskHeight: number = 720;

    /** 尚未处理的升级次数 */
    private _pendingLevelUps: number = 0;
    /** 界面当前是否正在展示 */
    private _showing: boolean = false;
    /** 本轮生成的卡片节点 */
    private _cards: Node[] = [];

    /** 玩家技能等级表快照：由 PLAYER_SKILLS_CHANGED 事件同步，界面不直接读玩家组件 */
    private _skillLevels: Record<BulletSkillId, number> = createBulletSkillLevels();

    /** 最近一次收到的玩家等级，用于界面标题 */
    private _playerLevel: number = 1;

    onLoad() {
        EventBus.on<PlayerLevelUpPayload>(PLAYER_LEVEL_UP, this.onPlayerLevelUp, this);
        EventBus.on<PlayerSkillsChangedPayload>(PLAYER_SKILLS_CHANGED, this.onPlayerSkillsChanged, this);

        this.resolveGameManager();
        if (this.gameManager?.node?.isValid) {
            this.gameManager.node.on(GAME_STATE_CHANGE, this.onGameStateChange, this);
        }

        this.createMask();
        this.hidePanel();
    }

    onDestroy() {
        EventBus.off<PlayerLevelUpPayload>(PLAYER_LEVEL_UP, this.onPlayerLevelUp, this);
        EventBus.off<PlayerSkillsChangedPayload>(PLAYER_SKILLS_CHANGED, this.onPlayerSkillsChanged, this);

        if (this.gameManager?.node?.isValid) {
            this.gameManager.node.off(GAME_STATE_CHANGE, this.onGameStateChange, this);
        }
        this.gameManager = null;
    }

    /** 未绑定时自动查找场景中的 GameManager */
    private resolveGameManager() {
        if (!this.gameManager?.isValid) {
            const scene = director.getScene();
            this.gameManager = scene ? scene.getComponentInChildren(GameManager) : null;
        }
    }

    /** 技能等级表变化：刷新本地快照，供抽卡与卡片文案使用 */
    private onPlayerSkillsChanged(payload: PlayerSkillsChangedPayload) {
        if (!payload?.levels) return;

        this._skillLevels = payload.levels as Record<BulletSkillId, number>;
    }

    /** 取快照中某个技能的等级，未记录时按 0（未学习）处理 */
    private getSkillLevel(id: BulletSkillId): number {
        const level = this._skillLevels ? this._skillLevels[id] : 0;
        return Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    }

    /** 在界面最底层画一层半透明遮罩，把游戏画面压暗 */
    private createMask() {
        if (!this.panel) return;

        const node = new Node('Mask');
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(0, 0, 0, 180);
        graphics.rect(-this.maskSize / 2, -this.maskHeight / 2, this.maskSize, this.maskHeight);
        graphics.fill();

        node.setParent(this.panel);
        node.setSiblingIndex(0);
        node.setPosition(0, 0, 0);
        node.layer = Layers.Enum.UI_2D;
    }

    /** 玩家升级：累计待处理的升级次数并尝试弹窗 */
    private onPlayerLevelUp(payload: PlayerLevelUpPayload) {
        this._playerLevel = payload ? payload.level : this._playerLevel;
        this._pendingLevelUps += 1;
        this.showNext(this._playerLevel);
    }

    /** 游戏结束：直接关闭界面，清空未处理的升级 */
    private onGameStateChange(state: GameState) {
        if (state !== GameState.Over) return;

        this._pendingLevelUps = 0;
        this._showing = false;
        this.clearCards();
        this.hidePanel();
    }

    /**
     * 弹一次升级界面：暂停游戏、随机抽取技能并生成卡片。
     * 已经在展示中或没有待处理的升级时直接返回。
     */
    private showNext(level: number) {
        if (this._showing) return;
        if (this._pendingLevelUps <= 0) return;
        if (!this.panel || !this.skillCardPrefab) return;

        this.resolveGameManager();

        // 抽取未满级且互不重复的技能：用本地快照，不读玩家组件
        const ids = rollUpgradeSkillIds(this._skillLevels, this.cardCount);
        if (ids.length <= 0) {
            // 所有技能都已满级，直接结束本次升级
            this._pendingLevelUps = 0;
            this.hidePanel();
            this.resumeGame();
            return;
        }

        this._showing = true;
        this.pauseGame();

        if (this.titleLabel) {
            this.titleLabel.string = `等级 ${level}！选择一项强化`;
        }

        this.clearCards();
        const offsetBase = (ids.length - 1) / 2;
        for (let i = 0; i < ids.length; i++) {
            const card = this.createCard(ids[i]);
            if (!card) continue;

            card.setPosition((i - offsetBase) * this.cardSpacing, 0, 0);
            this._cards.push(card);
        }

        this.panel.active = true;
    }

    /** 用 SkillCard 预制件生成一张卡片，展示该技能升到下一级后的效果 */
    private createCard(id: BulletSkillId): Node | null {
        const prefab = this.skillCardPrefab;
        if (!prefab) return null;

        const config = BULLET_SKILL_CONFIGS[id];
        if (!config) return null;

        const nextLevel = this.getSkillLevel(id) + 1;

        const node = instantiate(prefab);
        node.setParent(this.cardContainer ?? this.panel);

        const card = node.getComponent(SkillCard);
        if (!card) {
            node.destroy();
            return null;
        }

        card.setSkill(id, `${config.name} Lv.${nextLevel}`, formatBulletSkillDesc(id, nextLevel));
        card.onClick = () => this.onCardClicked(id);

        // 卡片来自预制件，默认在 DEFAULT 层，需要切到 UI_2D 层才能被界面摄像机渲染
        node.walk((child) => {
            child.layer = Layers.Enum.UI_2D;
        });

        return node;
    }

    /** 卡片被点击：提升对应技能等级，然后关闭界面 */
    private onCardClicked(id: BulletSkillId) {
        if (!this._showing) return;

        this.resolveGameManager();

        // 只发出「选中了哪个技能」的意图，真正提升等级由玩家侧监听事件完成
        EventBus.emit<SkillSelectedPayload>(SKILL_SELECTED, { skillId: id });

        this._pendingLevelUps = Math.max(0, this._pendingLevelUps - 1);
        this._showing = false;

        this.clearCards();
        this.hidePanel();

        // 一次获得大量经验可能连升多级，处理完还有剩余就继续弹下一轮
        if (this._pendingLevelUps > 0) {
            this.showNext(this._playerLevel);
            return;
        }

        this.resumeGame();
    }

    /** 销毁本轮生成的全部卡片 */
    private clearCards() {
        for (const card of this._cards) {
            if (card?.isValid) card.destroy();
        }
        this._cards.length = 0;
    }

    /** 隐藏界面本体 */
    private hidePanel() {
        if (this.panel) this.panel.active = false;
    }

    /** 暂停游戏 */
    private pauseGame() {
        this.gameManager?.pauseGame();
    }

    /** 恢复游戏 */
    private resumeGame() {
        this.gameManager?.resumeGame();
    }
}
