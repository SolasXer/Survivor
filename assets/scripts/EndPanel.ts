import { _decorator, Component, Node, Label, Color, find } from 'cc';
import { GameManager } from './GameManager';
import { AudioManager, SfxType } from './AudioManager';
import { EventBus } from './EventBus';
import { GAME_OVER, GameOverPayload } from './GameEvents';
const { ccclass, property } = _decorator;

/** 场景中 Canvas 的默认路径 */
const CANVAS_PATH = 'Canvas';

/** 时间文本不足两位时补零 */
function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

/**
 * 结束界面：挂载在 Canvas/EndPanel 节点上，默认隐藏。
 * 对局结束时（胜利＝击败 Boss，失败＝玩家阵亡）自动显示，并刷新
 * 胜负结果与本局统计（坚持时间 / 达到等级 / 击败敌人数）。
 * 玩家从暂停界面主动退出时不展示本界面。
 * 点击「返回主界面」按钮会重新加载场景，重置全部数据并回到开始界面。
 *
 * 统计数据来源是 `GAME_OVER` 事件携带的 payload，由 GameManager 汇总后广播，
 * 本界面因此不再持有玩家组件，也不需要在结算时去读玩家身上的字段。
 */
@ccclass('EndPanel')
export class EndPanel extends Component {
    @property({ type: GameManager, tooltip: '游戏管理器，留空时自动查找 Canvas 上的 GameManager' })
    gameManager: GameManager | null = null;

    @property({ type: Label, tooltip: '显示胜负结果的大号文本' })
    resultLabel: Label | null = null;

    @property({ type: Label, tooltip: '显示本局统计的多行文本' })
    statsLabel: Label | null = null;

    @property({ type: Node, tooltip: '“返回主界面”按钮节点' })
    backButton: Node | null = null;

    /** 胜负结果文本 */
    private readonly _winText: string = '胜利';
    private readonly _loseText: string = '失败';

    /** 胜负结果配色：胜利为金色，失败为暗红 */
    private readonly _winColor: Color = new Color(240, 205, 96, 255);
    private readonly _loseColor: Color = new Color(206, 74, 66, 255);

    onLoad() {
        if (!this.gameManager?.isValid) {
            const canvas = find(CANVAS_PATH);
            this.gameManager = canvas ? canvas.getComponent(GameManager) : null;
        }

        if (this.backButton?.isValid) {
            this.backButton.on(Node.EventType.TOUCH_END, this.onBackClick, this);
        }
        EventBus.on<GameOverPayload>(GAME_OVER, this.onGameOver, this);

        // 默认隐藏：Cocos 不会为未激活节点调用 onLoad，故节点在场景中保持激活，由脚本在此处隐藏，
        // 否则本组件收不到状态变化事件，结束界面永远不会显示
        this.node.active = false;
    }

    onDestroy() {
        if (this.backButton?.isValid) {
            this.backButton.off(Node.EventType.TOUCH_END, this.onBackClick, this);
        }
        EventBus.off<GameOverPayload>(GAME_OVER, this.onGameOver, this);
    }

    /** 对局结束：用事件携带的统计刷新并显示；玩家主动退出时不显示 */
    private onGameOver(payload: GameOverPayload) {
        if (!payload || payload.quitted) return;

        this.refresh(payload);
        this.node.active = true;
    }

    /** 刷新结果文本与统计文本 */
    private refresh(payload: GameOverPayload) {
        const win = !!payload.win;

        if (this.resultLabel) {
            this.resultLabel.string = win ? this._winText : this._loseText;
            this.resultLabel.color = win ? this._winColor : this._loseColor;
        }
        if (!this.statsLabel) return;

        const total = Math.max(0, Math.floor(payload.time));
        const level = Math.max(1, Math.floor(payload.level));
        const kills = Math.max(0, Math.floor(payload.kills));

        this.statsLabel.string =
            `坚持时间 ${pad2(Math.floor(total / 60))}:${pad2(total % 60)}\n` +
            `达到等级 Lv.${level}\n` +
            `击败敌人 ${kills}`;
    }

    /** 点击「返回主界面」：播放 UI 音效、重新加载场景重置对局，回到开始界面 */
    private onBackClick() {
        AudioManager.play(SfxType.UiClick);
        this.node.active = false;
        this.gameManager?.restartGame();
    }
}
