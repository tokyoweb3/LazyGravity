/**
 * Step 6: AIレスポンスの抽出とプログレス監視 TDDテスト
 *
 * テスト方針:
 *   - ResponseMonitor クラスを対象とする
 *   - CdpService をモック化して、DOM からのテキスト抽出と生成完了検知をテスト
 *   - Discordメッセージ更新（Edit）のコールバック機能を検証する
 *
 * poll()内の呼び出し順:
 *   1. ストップボタンチェック (STOP_BUTTON)
 *   2. クォータエラーチェック (QUOTA_ERROR)
 *   3. アクティビティ取得 (ACTIVITY_STATUS)
 *   4. テキスト取得 (RESPONSE_TEXT)
 *
 * start()時の呼び出し:
 *   1. ベースラインテキスト取得 (RESPONSE_TEXT)
 *
 * 完了検知の優先順位（3段構え）:
 *   1. Network.loadingFinished → テキスト安定待ち → 完了
 *   2. テキスト安定（textStabilityCompleteMs）→ 完了
 *   3. 更新停止（noUpdateTimeoutMs）→ 完了
 *   既存のストップボタン検出も併用
 */

import { ResponseMonitor, ResponseMonitorOptions, ResponsePhase } from '../../src/services/responseMonitor';
import { CdpService } from '../../src/services/cdpService';

// CdpService をモック化
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ResponseMonitor - AIレスポンス抽出とプログレス監視 (Step 6)', () => {
    let monitor: ResponseMonitor;
    let mockCdpService: jest.Mocked<CdpService>;
    /** on() で登録されたリスナーをキャプチャ */
    let eventListeners: Map<string, Function[]>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        eventListeners = new Map();

        // EventEmitter の on / removeListener をモック
        (mockCdpService as any).on = jest.fn((event: string, listener: Function) => {
            const listeners = eventListeners.get(event) || [];
            listeners.push(listener);
            eventListeners.set(event, listeners);
            return mockCdpService;
        });
        (mockCdpService as any).removeListener = jest.fn((event: string, listener: Function) => {
            const listeners = eventListeners.get(event) || [];
            eventListeners.set(event, listeners.filter(l => l !== listener));
            return mockCdpService;
        });

        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (monitor) {
            await monitor.stop();
        }
        jest.useRealTimers();
    });

    /** CDP イベントをシミュレーション発火する */
    function emitCdpEvent(event: string, params: any): void {
        const listeners = eventListeners.get(event) || [];
        for (const listener of listeners) {
            listener(params);
        }
    }

    /**
     * テスト用ヘルパー: poll で4回のCDP呼び出し（ストップボタン, クォータ, アクティビティ, テキスト）を一括設定
     */
    function mockPollResult(
        mock: jest.Mocked<CdpService>,
        isGenerating: boolean,
        text: string | null,
        activities: string[] = [],
        quotaReached: boolean = false,
    ) {
        mock.call
            .mockResolvedValueOnce({ result: { value: isGenerating } })    // ストップボタン
            .mockResolvedValueOnce({ result: { value: quotaReached } })    // クォータチェック
            .mockResolvedValueOnce({ result: { value: activities } })       // アクティビティ
            .mockResolvedValueOnce({ result: { value: text } });           // テキスト
    }

    // ──────────────────────────────────────────────────────
    // テスト 1: 生成中テキストの逐次抽出
    // ──────────────────────────────────────────────────────
    it('生成中のテキストを逐次抽出し、onProgressコールバックを呼び出すこと', async () => {
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'Hello');
        mockPollResult(mockCdpService, true, 'Hello World');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onProgress).toHaveBeenCalledWith('Hello');
        expect(onProgress).toHaveBeenCalledWith('Hello World');
    });

    // ──────────────────────────────────────────────────────
    // テスト 2: テキストが変化しない場合はコールバックを呼ばない
    // ──────────────────────────────────────────────────────
    it('テキストが変化しない場合はonProgressを重複呼び出ししないこと', async () => {
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'Same text');
        mockPollResult(mockCdpService, true, 'Same text');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith('Same text');
    });

    // ──────────────────────────────────────────────────────
    // テスト 3: 生成完了の検知（ストップボタンの消失を連続確認）
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失を連続3回確認して完了と判定すること', async () => {
        const onComplete = jest.fn();
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス');
        mockPollResult(mockCdpService, false, '最終レスポンス');
        mockPollResult(mockCdpService, false, '最終レスポンス');
        mockPollResult(mockCdpService, false, '最終レスポンス');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 0,
            textStabilityCompleteMs: 0,
            onProgress,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 3b: ストップボタンが再出現したらカウンターリセット
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失後に再出現したらカウンターがリセットされること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト');
        mockPollResult(mockCdpService, false, 'テキスト');
        mockPollResult(mockCdpService, true, 'テキスト更新');
        mockPollResult(mockCdpService, false, 'テキスト更新');
        mockPollResult(mockCdpService, false, 'テキスト更新');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        for (let i = 0; i < 5; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 4: stop()を呼ぶと監視が停止すること
    // ──────────────────────────────────────────────────────
    it('stop()を呼ぶとポーリングが停止してそれ以上コールバックが呼ばれないこと', async () => {
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト');
        mockPollResult(mockCdpService, true, '新テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onProgress).toHaveBeenCalledTimes(1);

        await monitor.stop();

        await jest.advanceTimersByTimeAsync(1000);
        expect(onProgress).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // テスト 5: タイムアウトで停止すること
    // ──────────────────────────────────────────────────────
    it('maxDurationMsを超えたら自動停止してonTimeoutコールバックを呼ぶこと', async () => {
        const onTimeout = jest.fn();
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            const idx = (callCount - 1) % 4;
            if (idx === 0) return { result: { value: true } };
            if (idx === 1) return { result: { value: false } };
            if (idx === 2) return { result: { value: [] } };
            return { result: { value: '生成中...' } };
        });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            maxDurationMs: 2000,
            textStabilityCompleteMs: 0,
            onProgress,
            onTimeout,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(2500);

        expect(onTimeout).toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 6: CDPエラー時にも監視が継続すること
    // ──────────────────────────────────────────────────────
    it('CDPのcallがエラーを投げても監視が継続すること', async () => {
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockCdpService.call.mockRejectedValueOnce(new Error('CDPエラー'));
        mockPollResult(mockCdpService, true, 'リカバリ後テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onProgress).toHaveBeenCalledWith('リカバリ後テキスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 7: フェーズ変更コールバック
    // ──────────────────────────────────────────────────────
    it('フェーズ変更時にonPhaseChangeコールバックが呼ばれること', async () => {
        const onPhaseChange = jest.fn();
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '応答テキスト');
        mockPollResult(mockCdpService, false, '応答テキスト');
        mockPollResult(mockCdpService, false, '応答テキスト');
        mockPollResult(mockCdpService, false, '応答テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 0,
            textStabilityCompleteMs: 0,
            onPhaseChange,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onPhaseChange).toHaveBeenCalledWith('thinking', null);
        expect(onPhaseChange).toHaveBeenCalledWith('generating', '応答テキスト');

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        expect(onPhaseChange).toHaveBeenCalledWith('complete', '応答テキスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 8: アクティビティコールバック
    // ──────────────────────────────────────────────────────
    it('アクティビティ検出時にonActivityコールバックが呼ばれること', async () => {
        const onActivity = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: true } })
            .mockResolvedValueOnce({ result: { value: false } })
            .mockResolvedValueOnce({ result: { value: ['Analyzed 3 files'] } })
            .mockResolvedValueOnce({ result: { value: 'テキスト' } });
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: true } })
            .mockResolvedValueOnce({ result: { value: false } })
            .mockResolvedValueOnce({ result: { value: ['Analyzed 3 files', 'Reading docs'] } })
            .mockResolvedValueOnce({ result: { value: 'テキスト更新' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onActivity,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onActivity).toHaveBeenCalledWith(['Analyzed 3 files']);

        await jest.advanceTimersByTimeAsync(500);
        expect(onActivity).toHaveBeenCalledWith(['Analyzed 3 files', 'Reading docs']);
    });

    // ──────────────────────────────────────────────────────
    // テスト 9: テキスト変化でもストップボタン消失カウンターがリセットされること
    // ──────────────────────────────────────────────────────
    it('テキスト変化時にストップボタン消失カウンターがリセットされること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト1');
        mockPollResult(mockCdpService, false, 'テキスト2');
        mockPollResult(mockCdpService, false, 'テキスト2');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        for (let i = 0; i < 3; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 10: 停止後に活動ログが残っていても完了判定を妨げないこと
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失後は同一の進行中アクティビティが残っていてもcompleteに遷移できること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス');
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 1000,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 11: 「中」を含むだけの非進行テキストは完了遅延の原因にしないこと
    // ──────────────────────────────────────────────────────
    it('非進行の日本語テキストに「中」が含まれていても完了判定を妨げないこと', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 1000,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 12: Good/Badマーカーは完了シグナルとして扱わないこと
    // ──────────────────────────────────────────────────────
    it('Good/BadマーカーがあってもStop消失+安定時間条件を満たすまでcompleteしないこと', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['__AG_FEEDBACK_READY__']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['__AG_FEEDBACK_READY__']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 10000,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 13: ストップボタン誤検知が継続しても長時間更新がなければ完了扱いにする
    // ──────────────────────────────────────────────────────
    it('生成中判定が継続していてもテキスト更新停止が一定時間続けばcompleteに遷移すること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, true, '最終レスポンス', []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            noUpdateTimeoutMs: 1000,
            textStabilityCompleteMs: 0,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 14: テキスト安定性ベースの独立完了パス
    // ストップボタン検出に依存せず、テキストが一定時間変化しなければ完了
    // ──────────────────────────────────────────────────────
    it('テキストが安定時間（textStabilityCompleteMs）変化しなければストップボタン非依存で完了すること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト → 生成開始
        mockPollResult(mockCdpService, true, '安定テキスト');
        // poll2-5: ストップボタンありのまま（壊れている想定）、テキスト変化なし
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 1500,
            noUpdateTimeoutMs: 60000, // フォールバックは遠く設定
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1: テキスト取得、lastTextChangeAt更新
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll2: 1000ms経過、まだ1500ms未満
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll3: 1500ms経過、まだ完了しない可能性
        await jest.advanceTimersByTimeAsync(500);  // poll4: 2000ms経過 → テキスト安定で確実に完了
        expect(onComplete).toHaveBeenCalledWith('安定テキスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 15: テキスト安定パスはテキスト更新でリセットされること
    // ──────────────────────────────────────────────────────
    it('テキストが更新されたらテキスト安定タイマーがリセットされること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト1');
        mockPollResult(mockCdpService, true, 'テキスト1');
        // テキスト更新 → タイマーリセット
        mockPollResult(mockCdpService, true, 'テキスト2');
        mockPollResult(mockCdpService, true, 'テキスト2');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 1200,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1: テキスト1取得
        await jest.advanceTimersByTimeAsync(500);  // poll2: 1000ms、まだ安定時間未到達
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll3: テキスト2 → タイマーリセット
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll4: テキスト2から500ms、まだ安定時間未到達
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 16: ネットワーク完了検知ベースの完了パス
    // ──────────────────────────────────────────────────────
    it('Network.loadingFinished後にテキストが安定すれば最速で完了すること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');
        // poll2: ストップボタンあり（壊れている想定）、テキスト変化なし
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            networkCompleteDelayMs: 800,
            textStabilityCompleteMs: 0, // テキスト安定パス無効
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        // on() がNetwork.requestWillBeSent, Network.loadingFinished で呼ばれていること
        expect((mockCdpService as any).on).toHaveBeenCalledWith(
            'Network.requestWillBeSent',
            expect.any(Function),
        );
        expect((mockCdpService as any).on).toHaveBeenCalledWith(
            'Network.loadingFinished',
            expect.any(Function),
        );

        await jest.advanceTimersByTimeAsync(500); // poll1: テキスト取得

        // ネットワークリクエスト開始をシミュレーション
        emitCdpEvent('Network.requestWillBeSent', {
            requestId: 'req-1',
            request: { url: 'https://api.example.com/api/chat/stream' },
        });

        // ネットワーク完了をシミュレーション
        emitCdpEvent('Network.loadingFinished', { requestId: 'req-1' });

        // まだnetworkCompleteDelayMs経過していない
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll2: 500ms経過、まだ800ms未満
        expect(onComplete).not.toHaveBeenCalled();

        // さらに待つ → 800ms超過 → 完了
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');
        await jest.advanceTimersByTimeAsync(500); // poll3: 1000ms経過 → 完了
        expect(onComplete).toHaveBeenCalledWith('ネットワーク完了テスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 17: 非ストリーミングURLはネットワーク追跡対象外
    // ──────────────────────────────────────────────────────
    it('ストリーミングURLパターンにマッチしないリクエストは追跡しないこと', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト');
        mockPollResult(mockCdpService, true, 'テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            networkCompleteDelayMs: 100,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);

        // 非ストリーミングURL → 追跡対象外
        emitCdpEvent('Network.requestWillBeSent', {
            requestId: 'req-static',
            request: { url: 'https://cdn.example.com/styles.css' },
        });
        emitCdpEvent('Network.loadingFinished', { requestId: 'req-static' });

        await jest.advanceTimersByTimeAsync(500);
        // ネットワーク完了シグナルは発火していないので、完了しない
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 18b: テキスト抽出不能でもアクティビティ検知で生成開始扱いになり完了できること
    // ──────────────────────────────────────────────────────
    it('テキストが取得できなくてもアクティビティがあれば生成開始を推定し、一定時間後にcompleteへ遷移すること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline

        // poll1: stopなし / activityあり / textなし
        mockPollResult(mockCdpService, false, null, ['Analyzed 2 files']);
        // poll2: stopなし / activityなし / textなし
        mockPollResult(mockCdpService, false, null, []);
        // poll3: stopなし / activityなし / textなし（完了判定）
        mockPollResult(mockCdpService, false, null, []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 1,
            noTextCompletionDelayMs: 1000,
            completionStabilityMs: 0,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).not.toHaveBeenCalled();
        expect(monitor.getPhase()).toBe('thinking');

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('');
        expect(monitor.getPhase()).toBe('complete');
    });

    // ──────────────────────────────────────────────────────
    // テスト 18c: 本文未取得時、アクティビティ更新が続いても stop 消失完了が過剰遅延しないこと
    // ──────────────────────────────────────────────────────
    it('本文未取得 + stop消失時はアクティビティ更新で完了安定判定が延長されないこと', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline

        // poll1-3: stopなし / activity更新あり / textなし
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 2 files']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 3 files']);
        // poll4: activity更新が止まる
        mockPollResult(mockCdpService, false, null, []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 1,
            noTextCompletionDelayMs: 1000,
            completionStabilityMs: 1500,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll2
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll3
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll4
        expect(onComplete).toHaveBeenCalledWith('');
    });

    // ──────────────────────────────────────────────────────
    // テスト 18: stop()でネットワークリスナーが解除されること
    // ──────────────────────────────────────────────────────
    it('stop()呼び出し時にネットワークイベントリスナーが解除されること', async () => {
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
        });
        await monitor.start();

        expect((mockCdpService as any).on).toHaveBeenCalledTimes(2);

        await monitor.stop();

        expect((mockCdpService as any).removeListener).toHaveBeenCalledWith(
            'Network.requestWillBeSent',
            expect.any(Function),
        );
        expect((mockCdpService as any).removeListener).toHaveBeenCalledWith(
            'Network.loadingFinished',
            expect.any(Function),
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 19: primary context がある場合、Runtime.evaluate に contextId を付与する
    // ──────────────────────────────────────────────────────
    it('primary context が存在する場合は Runtime.evaluate に contextId を付与すること', async () => {
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        (mockCdpService as any).getPrimaryContextId = jest.fn(() => 42);

        mockPollResult(mockCdpService, true, 'ctx text');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
        });
        await monitor.start();
        await jest.advanceTimersByTimeAsync(500);

        const evaluateCalls = mockCdpService.call.mock.calls
            .filter((call) => call[0] === 'Runtime.evaluate')
            .map((call) => call[1]);

        expect(evaluateCalls.length).toBeGreaterThan(0);
        for (const params of evaluateCalls) {
            expect(params.contextId).toBe(42);
        }
    });

    // ──────────────────────────────────────────────────────
    // テスト 20: stopボタン未検出の環境では完了安定時間を短縮すること
    // ──────────────────────────────────────────────────────
    it('stopボタンが一度も検出されない場合はstop消失完了の安定時間を短縮すること', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll1
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll2
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll3
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll4
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll5
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll6
        mockPollResult(mockCdpService, false, '本文', ['Analyzed 1 file']); // poll7

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 1,
            completionStabilityMs: 10000, // 通常は10秒
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(2000); // poll2-5 (計2500ms)
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1000); // poll6-7 (計3500ms)
        expect(onComplete).toHaveBeenCalledWith('本文');
    });

    // ──────────────────────────────────────────────────────
    // テスト 21: baselineと同一テキストを初期進捗として誤採用しないこと
    // ──────────────────────────────────────────────────────
    it('baselineと同一テキストは一定時間抑制し、異なる本文が来た時点で進捗に採用すること', async () => {
        const onProgress = jest.fn();

        // baseline
        mockCdpService.call.mockResolvedValueOnce({ result: { value: '前回の応答' } });
        // poll1
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: false } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: ['Analyzed 1 file'] } }) // activity
            .mockResolvedValueOnce({ result: { value: '前回の応答' } }); // text
        // poll2 (+ start-side extractor)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: false } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: ['Analyzed 2 files'] } }) // activity
            .mockResolvedValueOnce({ result: { value: '前回の応答' } }) // text
            .mockResolvedValueOnce({ result: { value: null } }); // RESPONSE_TEXT_FROM_START
        // poll3
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: false } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: ['Analyzed 3 files'] } }) // activity
            .mockResolvedValueOnce({ result: { value: '前回の応答' } }); // text
        // poll4 (+ start-side extractor)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: false } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: ['Analyzed 4 files'] } }) // activity
            .mockResolvedValueOnce({ result: { value: '前回の応答' } }) // text
            .mockResolvedValueOnce({ result: { value: null } }); // RESPONSE_TEXT_FROM_START
        // poll5
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: false } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: ['Analyzed 5 files'] } }) // activity
            .mockResolvedValueOnce({ result: { value: '新しい応答' } }); // text

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 99, // 完了判定が先に走らないようにする
            completionStabilityMs: 0,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(2000); // poll1-4
        expect(onProgress).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll5
        expect(onProgress).toHaveBeenCalledWith('新しい応答');
    });

    // ──────────────────────────────────────────────────────
    // テスト 22: stop未検出環境でactivity変化が続く間は早期completeしないこと
    // ──────────────────────────────────────────────────────
    it('stop未検出 + activity更新継続中は短縮stability条件を満たしてもcompleteしないこと', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline
        mockPollResult(mockCdpService, false, '本文', ['A1']); // poll1
        mockPollResult(mockCdpService, false, '本文', ['A2']); // poll2
        mockPollResult(mockCdpService, false, '本文', ['A3']); // poll3
        mockPollResult(mockCdpService, false, '本文', ['A4']); // poll4
        mockPollResult(mockCdpService, false, '本文', ['A5']); // poll5
        mockPollResult(mockCdpService, false, '本文', ['A6']); // poll6
        mockPollResult(mockCdpService, false, '本文', ['A7']); // poll7

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 1,
            completionStabilityMs: 10000,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(3500); // poll1-7
        expect(onComplete).not.toHaveBeenCalled();
    });
});
