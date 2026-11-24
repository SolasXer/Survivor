import { _decorator, Component, Node, Label, UITransform, find } from 'cc';
import { GameManager, GameState } from './GameManager';
import { EventBus } from './EventBus';
import {
    HEALTH_CHANGED,
    PLAYER_EXP_CHANGED,
    UI_PAUSE_REQUESTED,
    HealthChangedPayload,
    PlayerExpChangedPayload,
} from './GameEvents';
const { ccclass, property } = _decorator;

/** 场景中 Canvas 的默认路径 */
const CANVAS_PATH = 'Canvas';

/** 场景中玩家节点的默认路径，用于过滤 HEALTH_CHANGED 事件 */
const PLAYER_PATH = 'Canvas/Player';

/** 时间文本不足两位时补零 */
function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

/**
 * HUD：挂载在 Canvas/HUD 节点上，把玩家与对局状态显示到界面上。
 * - 生命值条：订阅 `HEALTH_CHANGED` 并按节点过滤出玩家，按事件携带的比例刷新；
 * - 经验值条：订阅 `PLAYER_EXP_CHANGED`，按事件携带的比例刷新；
 * - 等级文本：随经验事件中的等级刷新；
 * - 时间文本：`mm:ss`（游戏内已进行的时间，读 GameManager 的当前时间）；
 * - 暂停按钮：只发出 `UI_PAUSE_REQUESTED` 意图事件，由暂停界面自行显示。
 *
 * 本脚本不再持有玩家组件与暂停界面：改为「订阅事件 + 发意图事件」，
 * 因此玩家节点改名、技能数据结构调整都不会影响本界面。
 *
 * 满格宽度由填充条所在血条/经验条的当前宽度减去两侧内边距算出，
 * 因此血条被 Widget 拉伸到不同屏幕宽度时，填充条也能自动适配。
 * 填充条节点的锚点在左侧，宽度变化即从左侧向右伸缩。
 */
@ccclass('HUD')
export class HUD extends Component {
    @property({ type: GameManager, tooltip: '游戏管理器，留空时自动查找 Canvas 上的 GameManager' })
    gameManager: GameManager | null = null;

    @property({ type: Node, tooltip: '生命值条的填充节点（HealthFill）' })
    healthFill: Node | null = null;

    @property({ type: Node, tooltip: '经验值条的填充节点（ExpFill）' })
    expFill: Node | null = null;

    @property({ type: Label, tooltip: '显示等级的文本' })
    levelLabel: Label | null = null;

    @property({ type: Label, tooltip: '显示游戏时间的文本' })
    timeLabel: Label | null = null;

    @property({ type: Node, tooltip: '右上角的暂停按钮' })
    pauseButton: Node | null = null;

    @property({ tooltip: '填充条与血条/经验条边框之间的内边距（像素）' })
    barPadding: number = 4;

    private _healthTransform: UITransform | null = null;
    private _expTransform: UITransform | null = null;

    /** 玩家节点引用：HEALTH_CHANGED 是全体实体共用的事件，需要按节点过滤出玩家 */
    private _playerNode: Node | null = null;

    /** 上一次写入文本的内容，内容未变化时不重复给 Label 赋值 */
    private _levelText: string = '';
    private _timeText: string = '';

    onLoad() {
        if (!this.gameManager?.isValid) {
            const canvas = find(CANVAS_PATH);
            this.gameManager = canvas ? canvas.getComponent(GameManager) : null;
        }

        this._healthTransform = this.healthFill?.getComponent(UITransform) ?? null;
        this._expTransform = this.expFill?.getComponent(UITransform) ?? null;

        if (this.pauseButton?.isValid) {
            this.pauseButton.on(Node.EventType.TOUCH_END, this.onPauseClick, this);
        }

        this._playerNode = find(PLAYER_PATH);

        EventBus.on<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.on<PlayerExpChangedPayload>(PLAYER_EXP_CHANGED, this.onPlayerExpChanged, this);
    }

    onDestroy() {
        if (this.pauseButton?.isValid) {
            this.pauseButton.off(Node.EventType.TOUCH_END, this.onPauseClick, this);
        }

        EventBus.off<HealthChangedPayload>(HEALTH_CHANGED, this.onHealthChanged, this);
        EventBus.off<PlayerExpChangedPayload>(PLAYER_EXP_CHANGED, this.onPlayerExpChanged, this);
    }

    /**
     * 点击暂停按钮：仅在对局进行中生效，
     * 先通过 GameManager 暂停对局，再发出显示暂停界面的意图事件。
     */
    public onPauseClick() {
        const manager = this.gameManager;
        if (!manager?.isValid || manager.getState() !== GameState.Running) return;

        manager.pauseGame();
        EventBus.emit(UI_PAUSE_REQUESTED);
    }

    /** 玩家生命值变化：只响应玩家节点的事件，按新比例刷新生命值条 */
    private onHealthChanged(payload: HealthChangedPayload) {
        if (!payload || payload.node !== this._playerNode) return;

        this.setFillWidth(this._healthTransform, payload.ratio);
    }

    /** 玩家经验变化：刷新经验值条与等级文本 */
    private onPlayerExpChanged(payload: PlayerExpChangedPayload) {
        if (!payload) return;

        this.setFillWidth(this._expTransform, payload.ratio);

        const levelText = `Lv.${payload.level}`;
        if (levelText !== this._levelText && this.levelLabel) {
            this._levelText = levelText;
            this.levelLabel.string = levelText;
        }
    }

    update(_dt: number) {
        this.updateTime();
    }

    /** 刷新时间文本：游戏时间由 GameManager 维护，此处只做显示 */
    private updateTime() {
        const manager = this.gameManager;
        if (!manager?.isValid) return;

        const total = Math.max(0, Math.floor(manager.getGameTime()));
        const timeText = `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
        if (timeText !== this._timeText && this.timeLabel) {
            this._timeText = timeText;
            this.timeLabel.string = timeText;
        }
    }

    /**
     * 按满格宽度的比例设置填充条：宽度取满格宽度 × 比例，
     * 同时把节点固定在血条左内侧，宽度变化即从左向右伸缩。
     */
    private setFillWidth(transform: UITransform | null, ratio: number) {
        if (!transform) return;

        const maxWidth = this.getMaxWidth(transform);
        if (maxWidth <= 0) return;

        const width = maxWidth * Math.min(1, Math.max(0, ratio));

        // 填充条锚点在左侧，其位置即左边缘：父节点左边缘 + 内边距 = -满格宽度 / 2
        transform.node.setPosition(-maxWidth / 2, transform.node.position.y);

        // 变化很小时跳过，避免每帧触发节点尺寸变更
        if (Math.abs(transform.width - width) < 0.5) return;
        transform.width = width;
    }

    /** 填充条的满格宽度 = 所在血条/经验条容器的宽度 - 两侧内边距 */
    private getMaxWidth(transform: UITransform): number {
        const parent = transform.node.parent;
        const bar = parent ? parent.getComponent(UITransform) : null;
        const barWidth = bar ? bar.width : transform.width;
        return Math.max(0, barWidth - this.getPadding() * 2);
    }

    /** 内边距，不允许为负数 */
    private getPadding(): number {
        return Math.max(0, this.barPadding);
    }
}
