import { _decorator, Component, Graphics, Color, find } from 'cc';
import { GameManager, GameState, GAME_STATE_CHANGE } from './GameManager';
const { ccclass, property } = _decorator;

/** Canvas 的默认路径，用于自动查找 GameManager */
const CANVAS_PATH = 'Canvas';

/** 引导圆圈的描边色与填充色 */
const CIRCLE_STROKE_COLOR = new Color(255, 236, 180, 255);
const CIRCLE_FILL_COLOR = new Color(255, 236, 180, 64);

/**
 * 新手引导：挂载在 Canvas/GuidePanel 节点上。
 * 通过子节点上的 Graphics 组件在摇杆位置绘制一个圆圈，并从圆圈右边缘画一条直线指向右侧，
 * 用于提示玩家拖动摇杆；直线末端由场景中的文本节点给出说明。
 * 界面默认隐藏；游戏开始（GameManager 进入 Running）时显示，持续 `duration` 秒后自动隐藏。
 *
 * 注意：Cocos 不会为场景中未激活的节点调用 `onLoad`，
 * 因此 GuidePanel 在场景里保持激活状态，由本组件在 `onLoad` 中自行隐藏，
 * 这样既能默认隐藏，又能正常监听 GameManager 的状态变化。
 */
@ccclass('GuideManager')
export class GuideManager extends Component {
    @property({ type: GameManager, tooltip: '游戏管理器，留空时自动查找 Canvas 上的 GameManager' })
    gameManager: GameManager | null = null;

    @property({ type: Graphics, tooltip: '绘制引导手势的 Graphics 组件' })
    graphics: Graphics | null = null;

    @property({ tooltip: '引导显示的持续时间（秒），到时间自动隐藏' })
    duration: number = 3;

    @property({ tooltip: '引导圆圈的半径（像素）' })
    circleRadius: number = 52;

    @property({ tooltip: '指引线的长度（像素）' })
    lineLength: number = 180;

    @property({ tooltip: '圆圈与指引线的线宽（像素）' })
    lineWidth: number = 6;

    onLoad() {
        if (!this.gameManager?.isValid) {
            const canvas = find(CANVAS_PATH);
            this.gameManager = canvas ? canvas.getComponent(GameManager) : null;
        }

        this.gameManager?.node.on(GAME_STATE_CHANGE, this.onGameStateChange, this);

        this.drawGuide();
        this.node.active = false;
    }

    onEnable() {
        // 每次显示时重绘，避免渲染数据丢失
        this.drawGuide();
    }

    onDestroy() {
        this.unschedule(this.hideGuide);
        this.gameManager?.node.off(GAME_STATE_CHANGE, this.onGameStateChange, this);
    }

    /** 显示引导，并在指定时间后自动隐藏 */
    public showGuide() {
        this.node.active = true;

        this.unschedule(this.hideGuide);
        this.scheduleOnce(this.hideGuide, Math.max(0, this.duration));
    }

    /** 游戏开始：显示引导 */
    private onGameStateChange(state: GameState) {
        if (state === GameState.Running) {
            this.showGuide();
        }
    }

    private hideGuide() {
        this.node.active = false;
    }

    /**
     * 用 Graphics 绘制引导手势：
     * 以自身节点为圆心画一个圆圈，再从圆圈右边缘向右画一条直线。
     */
    private drawGuide() {
        const graphics = this.graphics;
        if (!graphics?.isValid) return;

        const radius = Math.max(1, this.circleRadius);

        graphics.clear();
        graphics.lineWidth = Math.max(1, this.lineWidth);
        graphics.lineCap = Graphics.LineCap.ROUND;
        graphics.lineJoin = Graphics.LineJoin.ROUND;
        graphics.strokeColor = CIRCLE_STROKE_COLOR;
        graphics.fillColor = CIRCLE_FILL_COLOR;

        // 圆圈
        graphics.circle(0, 0, radius);
        graphics.fill();
        graphics.stroke();

        // 从圆圈右边缘指向右侧的直线
        graphics.moveTo(radius, 0);
        graphics.lineTo(radius + Math.max(0, this.lineLength), 0);
        graphics.stroke();
    }
}
