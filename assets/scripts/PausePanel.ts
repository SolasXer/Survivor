import { _decorator, Component, Node, find } from 'cc';
import { GameManager } from './GameManager';
import { AudioManager, SfxType } from './AudioManager';
import { EventBus } from './EventBus';
import { UI_PAUSE_REQUESTED } from './GameEvents';
const { ccclass, property } = _decorator;

/** Canvas 的默认路径，用于自动查找 GameManager */
const CANVAS_PATH = 'Canvas';

/**
 * 暂停界面：挂载在 Canvas/PausePanel 节点上，默认隐藏。
 * 收到 HUD 发出的 `UI_PAUSE_REQUESTED` 事件后自行显示（HUD 已先调用
 * `GameManager.pauseGame()` 暂停对局），两者之间没有直接引用。
 * - 点击「继续游戏」：恢复对局并隐藏本界面；
 * - 点击「退出游戏」：结束对局并回到开始界面。
 *
 * 注意：Cocos 不会为未激活节点调用 `onLoad`，因此 PausePanel 在场景里保持激活，
 * 由本组件在 `onLoad` 末尾自行隐藏；否则监听注册不上，点暂停按钮界面永远打不开。
 */
@ccclass('PausePanel')
export class PausePanel extends Component {
    @property({ type: GameManager, tooltip: '游戏管理器，留空时自动查找 Canvas 上的 GameManager' })
    gameManager: GameManager | null = null;

    @property({ type: Node, tooltip: '“继续游戏”按钮节点' })
    resumeButton: Node | null = null;

    @property({ type: Node, tooltip: '“退出游戏”按钮节点' })
    quitButton: Node | null = null;

    @property({ type: Node, tooltip: '开始界面节点，退出游戏时重新显示' })
    startPanel: Node | null = null;

    onLoad() {
        if (!this.gameManager?.isValid) {
            const canvas = find(CANVAS_PATH);
            this.gameManager = canvas ? canvas.getComponent(GameManager) : null;
        }

        if (this.resumeButton?.isValid) {
            this.resumeButton.on(Node.EventType.TOUCH_END, this.onResumeClick, this);
        }
        if (this.quitButton?.isValid) {
            this.quitButton.on(Node.EventType.TOUCH_END, this.onQuitClick, this);
        }

        EventBus.on(UI_PAUSE_REQUESTED, this.show, this);

        // 默认隐藏：节点在场景中保持激活（否则 onLoad 不会执行），显示与隐藏统一由本组件控制
        this.node.active = false;
    }

    onDestroy() {
        EventBus.off(UI_PAUSE_REQUESTED, this.show, this);

        if (this.resumeButton?.isValid) {
            this.resumeButton.off(Node.EventType.TOUCH_END, this.onResumeClick, this);
        }
        if (this.quitButton?.isValid) {
            this.quitButton.off(Node.EventType.TOUCH_END, this.onQuitClick, this);
        }
    }

    /** 显示暂停界面（由 UI_PAUSE_REQUESTED 事件驱动） */
    public show() {
        this.node.active = true;
    }

    /** 点击「继续游戏」：播放 UI 音效、恢复对局并隐藏界面 */
    private onResumeClick() {
        AudioManager.play(SfxType.UiClick);
        this.gameManager?.resumeGame();
        this.node.active = false;
    }

    /** 点击「退出游戏」：结束对局并返回开始界面 */
    private onQuitClick() {
        AudioManager.play(SfxType.UiClick);

        // 先解除暂停，避免退出后各逻辑仍处于冻结状态
        this.gameManager?.resumeGame();
        // 主动退出按失败结束，且不展示结算界面
        this.gameManager?.quitGame();

        this.node.active = false;
        if (this.startPanel?.isValid) {
            this.startPanel.active = true;
        }
    }
}
