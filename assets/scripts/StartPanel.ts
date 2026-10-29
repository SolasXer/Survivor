import { _decorator, Component, Node, find } from 'cc';
import { GameManager, GameState, GAME_STATE_CHANGE } from './GameManager';
import { AudioManager, SfxType } from './AudioManager';
const { ccclass, property } = _decorator;

/** Canvas 的默认路径，用于自动查找 GameManager */
const CANVAS_PATH = 'Canvas';

/**
 * 开始界面：挂载在 Canvas/StartPanel 节点上。
 * 游戏启动后节点默认显示；点击「开始游戏」按钮时隐藏本界面，
 * 并调用 `GameManager.startGame()` 通知游戏开始。
 * 另外监听 GameManager 的状态变化：状态一旦变为 Running 就隐藏界面，
 * 这样无论开始游戏由哪个入口触发，开始界面都不会残留在画面上。
 */
@ccclass('StartPanel')
export class StartPanel extends Component {
    @property({ type: GameManager, tooltip: '游戏管理器，留空时自动查找 Canvas 上的 GameManager' })
    gameManager: GameManager | null = null;

    @property({ type: Node, tooltip: '“开始游戏”按钮节点' })
    startButton: Node | null = null;

    onLoad() {
        if (!this.gameManager?.isValid) {
            const canvas = find(CANVAS_PATH);
            this.gameManager = canvas ? canvas.getComponent(GameManager) : null;
        }

        if (this.startButton?.isValid) {
            this.startButton.on(Node.EventType.TOUCH_END, this.onStartClick, this);
        }
        this.gameManager?.node.on(GAME_STATE_CHANGE, this.onGameStateChange, this);

        // 若进入场景时游戏已在运行，则不再显示开始界面
        if (this.gameManager?.getState() === GameState.Running) {
            this.node.active = false;
        }
    }

    onDestroy() {
        if (this.startButton?.isValid) {
            this.startButton.off(Node.EventType.TOUCH_END, this.onStartClick, this);
        }
        this.gameManager?.node.off(GAME_STATE_CHANGE, this.onGameStateChange, this);
    }

    /** 点击开始按钮：播放 UI 音效、通知 GameManager 开始游戏并隐藏界面 */
    public onStartClick() {
        AudioManager.play(SfxType.UiClick);
        this.gameManager?.startGame();
        this.node.active = false;
    }

    /** 游戏进入运行状态时隐藏开始界面 */
    private onGameStateChange(state: GameState) {
        if (state === GameState.Running) {
            this.node.active = false;
        }
    }
}
