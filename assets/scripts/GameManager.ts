import { _decorator, Component, director } from 'cc';
import { AudioManager } from './AudioManager';
import { EventBus } from './EventBus';
import {
    ENEMY_KILLED,
    GAME_OVER,
    GAME_PAUSE_CHANGE,
    PLAYER_DEAD,
    PLAYER_LEVEL_UP,
    PLAYER_REVIVE,
    EnemyKilledPayload,
    GameOverPayload,
    PlayerLevelUpPayload,
    PlayerRevivePayload,
} from './GameEvents';
const { ccclass, property } = _decorator;

/** 游戏状态：准备 / 运行 / 结束 */
export enum GameState {
    /** 准备：游戏刚启动，尚未开始 */
    Ready = 0,
    /** 运行：游戏进行中，游戏时间正常累加 */
    Running = 1,
    /** 结束：游戏已结束 */
    Over = 2,
}

/** 状态变化事件名，回调参数为新的状态值（GameState） */
export const GAME_STATE_CHANGE = 'game-state-change';

/** 默认游戏时间上限（秒），即 10 分钟；到达该时间后进入 Boss 阶段 */
export const GAME_TIME_LIMIT = 600;

/** 广告复活后恢复的生命值比例（占生命值上限） */
export const REVIVE_HP_RATIO = 0.5;

/**
 * 游戏管理：挂载在 Main 场景的 Canvas 节点上。
 * 游戏启动后处于 Ready 状态，由开始界面（StartPanel）点击「开始游戏」按钮调用
 * `startGame()` 后才进入 Running；开始之前不累计时间、不刷新敌人。
 * 记录游戏时间（仅 Running 状态累加，上限 timeLimit）并维护游戏状态，
 * 状态发生变化时通过自身节点派发 GAME_STATE_CHANGE 事件。
 * 胜负判定统一在此处理：击败 Boss 判胜，在此之前玩家生命值归零判负。
 * Boss 由 BattleManager 在时间到达上限时生成，生成与击败分别通过
 * `notifyBossSpawned()` / `notifyBossDefeated()` 回报给本组件。
 * 另外提供暂停能力：暂停时通过 director 派发 GAME_PAUSE_CHANGE 全局事件，
 * 玩家、敌人、子弹、刷怪逻辑各自监听该事件冻结自身行为。
 * 失败结算后还支持一次广告复活：`canRevive()` 判断本局是否还能复活，
 * `reviveGame()` 把状态切回 Running 并发 PLAYER_REVIVE 让玩家按比例恢复生命值。
 */
@ccclass('GameManager')
export class GameManager extends Component {
    @property({ tooltip: '游戏时间上限（秒），到达后 BattleManager 停止生成普通敌人并放出 Boss' })
    timeLimit: number = GAME_TIME_LIMIT;

    /** 游戏时间（秒），游戏开始时归零 */
    private _gameTime: number = 0;

    /** 当前游戏状态，游戏启动时为 Ready */
    private _state: GameState = GameState.Ready;

    /** 结束游戏时记录的胜负结果 */
    private _isWin: boolean = false;

    /** Boss 是否已生成 */
    private _bossSpawned: boolean = false;

    /** Boss 是否已被击败 */
    private _bossDefeated: boolean = false;

    /** 是否由玩家主动退出结束的对局（主动退出时不展示结算界面） */
    private _quitted: boolean = false;

    /** 本局是否已使用过广告复活：每局限一次，开始新对局时重置 */
    private _reviveUsed: boolean = false;

    /** 是否处于暂停状态（升级选卡等场景使用） */
    private _paused: boolean = false;

    /**
     * 结算用的统计：由玩家域事件驱动，避免结算界面反过来去读玩家组件。
     * 玩家等级随 PLAYER_LEVEL_UP 更新，击杀数随 ENEMY_KILLED 累加。
     */
    private _playerLevel: number = 1;
    private _kills: number = 0;

    /** 默认隐藏、但必须靠 onLoad 注册事件的界面节点名 */
    private static readonly HIDDEN_PANELS: readonly string[] = ['PausePanel', 'EndPanel', 'GuidePanel'];

    onLoad() {
        this._gameTime = 0;
        this._state = GameState.Ready;
        this._isWin = false;
        this._paused = false;
        this._bossSpawned = false;
        this._bossDefeated = false;
        this._quitted = false;
        this._reviveUsed = false;
        this._playerLevel = 1;
        this._kills = 0;

        EventBus.on(PLAYER_DEAD, this.onPlayerDead, this);
        EventBus.on<PlayerLevelUpPayload>(PLAYER_LEVEL_UP, this.onPlayerLevelUp, this);
        EventBus.on<EnemyKilledPayload>(ENEMY_KILLED, this.onEnemyKilled, this);

        this.warmUpHiddenPanels();
    }

    /**
     * 兜底初始化默认隐藏的界面。
     * Cocos 不会为未激活节点调用 onLoad：若暂停/结算/引导界面在场景里被存成未激活，
     * 它们的事件监听与按钮绑定都不会注册，界面会永远打不开（例如点了暂停按钮却没有任何反应）。
     * 这里对仍未激活的面板先激活再同步隐藏，onLoad 会在激活瞬间执行，界面不会真正渲染出来。
     */
    private warmUpHiddenPanels() {
        for (const name of GameManager.HIDDEN_PANELS) {
            const panel = this.node.getChildByName(name);
            if (!panel?.isValid || panel.active) continue;

            panel.active = true;
            panel.active = false;
        }
    }

    onDestroy() {
        EventBus.off(PLAYER_DEAD, this.onPlayerDead, this);
        EventBus.off<PlayerLevelUpPayload>(PLAYER_LEVEL_UP, this.onPlayerLevelUp, this);
        EventBus.off<EnemyKilledPayload>(ENEMY_KILLED, this.onEnemyKilled, this);
    }

    /** 玩家升级：记录当前等级，供结算界面显示 */
    private onPlayerLevelUp(payload: PlayerLevelUpPayload) {
        if (!payload) return;

        this._playerLevel = Math.max(1, payload.level);
    }

    /** 敌人被击败：累计击杀数，供结算界面显示 */
    private onEnemyKilled(payload: EnemyKilledPayload) {
        if (!payload) return;

        this._kills += 1;
    }

    // 不自动开始：场景启动后处于 Ready 状态，由开始界面（StartPanel）点击按钮调用 startGame() 开始对局

    update(dt: number) {
        // 游戏时间仅在运行状态且未暂停的每一帧累加
        if (this._state !== GameState.Running || this._paused) return;

        // 时间到达上限后保持在上限值，胜负交由 Boss 战决定
        const limit = Math.max(0, this.timeLimit);
        this._gameTime = Math.min(this._gameTime + Math.max(0, dt), limit);
    }

    /** 玩家生命值归零：游戏未结束则判定为失败 */
    private onPlayerDead() {
        if (this._state !== GameState.Running) return;

        this.endGame(false);
    }

    /** 开始游戏：将状态切换为 Running */
    public startGame() {
        if (this._state === GameState.Running) return;

        this._gameTime = 0;
        this._isWin = false;
        this._playerLevel = 1;
        this._kills = 0;
        // 从暂停状态（例如退出对局）重开时补发恢复事件，避免各逻辑仍处于冻结状态
        if (this._paused) {
            this._paused = false;
            EventBus.emit<boolean>(GAME_PAUSE_CHANGE, false);
        }
        this._bossSpawned = false;
        this._bossDefeated = false;
        this._quitted = false;
        this._reviveUsed = false;
        this.setState(GameState.Running);
    }

    /** Boss 已生成：由 BattleManager 在时间到达上限并生成 Boss 后调用 */
    public notifyBossSpawned() {
        this._bossSpawned = true;
    }

    /** Boss 已被击败：判定为胜利 */
    public notifyBossDefeated() {
        if (this._state !== GameState.Running) return;
        if (!this._bossSpawned || this._bossDefeated) return;

        this._bossDefeated = true;
        this.endGame(true);
    }

    /** Boss 是否已生成 */
    public isBossSpawned(): boolean {
        return this._bossSpawned;
    }

    /** Boss 是否已被击败 */
    public isBossDefeated(): boolean {
        return this._bossDefeated;
    }

    /** 是否为玩家主动退出结束的对局 */
    public isQuitted(): boolean {
        return this._quitted;
    }

    /**
     * 玩家主动退出对局：按失败结束，并标记不展示结算界面。
     * 暂停界面点击「退出游戏」时调用。
     */
    public quitGame() {
        if (this._state !== GameState.Running) return;

        this._quitted = true;
        this.endGame(false);
    }

    /**
     * 本局是否还能通过广告复活：仅失败结算、且本局尚未使用过时可复活。
     * 胜利结算与玩家主动退出都不提供复活。
     */
    public canRevive(): boolean {
        return this._state === GameState.Over && !this._isWin && !this._reviveUsed;
    }

    /**
     * 广告复活：把对局从结算状态恢复为运行状态，并让玩家按 REVIVE_HP_RATIO 恢复生命值。
     * 每局只能成功一次，状态不满足（非失败结算 / 已用过）时返回 false。
     * @returns 是否复活成功
     */
    public reviveGame(): boolean {
        if (!this.canRevive()) return false;

        this._reviveUsed = true;
        this._isWin = false;
        this._quitted = false;

        // 先恢复玩家生命值，再切回 Running：BattleManager 收到状态变化后会重新开始刷怪
        EventBus.emit<PlayerRevivePayload>(PLAYER_REVIVE, { hpRatio: REVIVE_HP_RATIO });
        this.setState(GameState.Running);
        return true;
    }

    /**
     * 重新加载当前场景：所有节点与组件重新初始化，
     * 对局数据（时间、经验、敌人等）一并重置，并回到开始界面。
     */
    public restartGame() {
        const scene = director.getScene();
        if (!scene) return;

        director.loadScene(scene.name);
    }

    /**
     * 暂停游戏：仅在 Running 状态下生效，暂停后游戏时间不再累加，
     * 并通过 director 派发 GAME_PAUSE_CHANGE 事件通知各逻辑冻结。
     */
    public pauseGame() {
        if (this._state !== GameState.Running || this._paused) return;

        this._paused = true;
        EventBus.emit<boolean>(GAME_PAUSE_CHANGE, true);
    }

    /** 恢复游戏：取消暂停并派发 GAME_PAUSE_CHANGE 事件 */
    public resumeGame() {
        if (!this._paused) return;

        this._paused = false;
        EventBus.emit<boolean>(GAME_PAUSE_CHANGE, false);
    }

    /** 当前是否处于暂停状态 */
    public isPaused(): boolean {
        return this._paused;
    }

    /** 结束游戏：将状态切换为 Over，并记录胜负结果 */
    public endGame(isWin: boolean) {
        if (this._state === GameState.Over) return;

        this._isWin = isWin;
        this.setState(GameState.Over);
    }

    /** 获取当前游戏时间（秒） */
    public getGameTime(): number {
        return this._gameTime;
    }

    /** 获取当前游戏状态 */
    public getState(): GameState {
        return this._state;
    }

    /** 获取结束游戏时记录的胜负结果：true 为胜利 */
    public isWin(): boolean {
        return this._isWin;
    }

    /** 切换状态，并以新状态值为参数派发节点事件 */
    private setState(state: GameState) {
        if (this._state === state) return;

        this._state = state;

        // 开局循环播放战斗 BGM，对局结束时停止；未挂载 AudioManager 时静默跳过
        if (state === GameState.Running) {
            AudioManager.playBgm();
        } else if (state === GameState.Over) {
            AudioManager.stopBgm();
            this.emitGameOver();
        }

        this.node.emit(GAME_STATE_CHANGE, state);
    }

    /**
     * 结束对局时把胜负与统计一并广播出去：
     * 结算界面只需监听 GAME_OVER，不必再持有玩家组件去读等级与击杀数。
     */
    private emitGameOver() {
        const payload: GameOverPayload = {
            win: this._isWin,
            time: this._gameTime,
            level: this._playerLevel,
            kills: this._kills,
            quitted: this._quitted,
        };
        EventBus.emit<GameOverPayload>(GAME_OVER, payload);
    }
}
