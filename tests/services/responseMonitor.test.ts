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
 *   2. アクティビティ取得 (ACTIVITY_STATUS)
 *   3. テキスト取得 (RESPONSE_TEXT)
 *
 * start()時の呼び出し:
 *   1. ベースラインテキスト取得 (RESPONSE_TEXT)
 */

import { ResponseMonitor, ResponseMonitorOptions, ResponsePhase } from '../../src/services/responseMonitor';
import { CdpService } from '../../src/services/cdpService';

// CdpService をモック化
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ResponseMonitor - AIレスポンス抽出とプログレス監視 (Step 6)', () => {
    let monitor: ResponseMonitor;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        jest.useFakeTimers();
        // CdpService のモックインスタンスを作成
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (monitor) {
            await monitor.stop();
        }
        jest.useRealTimers();
    });

    /**
     * テスト用ヘルパー: poll で3回のCDP呼び出し（ストップボタン, アクティビティ, テキスト）を一括設定
     * @param isGenerating ストップボタンの表示状態
     * @param text テキスト
     * @param activities アクティビティ配列
     */
    function mockPollResult(
        mock: jest.Mocked<CdpService>,
        isGenerating: boolean,
        text: string | null,
        activities: string[] = [],
    ) {
        mock.call
            .mockResolvedValueOnce({ result: { value: isGenerating } })    // ストップボタン
            .mockResolvedValueOnce({ result: { value: activities } })       // アクティビティ
            .mockResolvedValueOnce({ result: { value: text } });           // テキスト
    }

    // ──────────────────────────────────────────────────────
    // テスト 1: 生成中テキストの逐次抽出
    // ──────────────────────────────────────────────────────
    it('生成中のテキストを逐次抽出し、onProgressコールバックを呼び出すこと', async () => {
        const onProgress = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト 'Hello'
        mockPollResult(mockCdpService, true, 'Hello');
        // poll2: ストップボタンあり + テキスト 'Hello World'
        mockPollResult(mockCdpService, true, 'Hello World');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
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

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト 'Same text'
        mockPollResult(mockCdpService, true, 'Same text');
        // poll2: ストップボタンあり + テキスト 'Same text'（同じ）
        mockPollResult(mockCdpService, true, 'Same text');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // 最初の取得時のみコールバックが呼ばれること
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith('Same text');
    });

    // ──────────────────────────────────────────────────────
    // テスト 3: 生成完了の検知（ストップボタンの消失を連続確認）
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失を連続3回確認して完了と判定すること', async () => {
        const onComplete = jest.fn();
        const onProgress = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト → 生成開始
        mockPollResult(mockCdpService, true, '最終レスポンス');
        // poll2: ストップボタンなし → 消失1回目（まだ完了しない）
        mockPollResult(mockCdpService, false, '最終レスポンス');
        // poll3: ストップボタンなし → 消失2回目（まだ完了しない）
        mockPollResult(mockCdpService, false, '最終レスポンス');
        // poll4: ストップボタンなし → 消失3回目 → 完了！
        mockPollResult(mockCdpService, false, '最終レスポンス');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 0,
            onProgress,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // poll1: 生成開始
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll2: 消失1回目
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll3: 消失2回目
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll4: 消失3回目 → 完了
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 3b: ストップボタンが再出現したらカウンターリセット
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失後に再出現したらカウンターがリセットされること', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → 生成開始
        mockPollResult(mockCdpService, true, 'テキスト');
        // poll2: ストップボタンなし → 消失1回目
        mockPollResult(mockCdpService, false, 'テキスト');
        // poll3: ストップボタンあり → 再出現（カウンターリセット）
        mockPollResult(mockCdpService, true, 'テキスト更新');
        // poll4: ストップボタンなし → 消失1回目（リセット後）
        mockPollResult(mockCdpService, false, 'テキスト更新');
        // poll5: ストップボタンなし → 消失2回目
        mockPollResult(mockCdpService, false, 'テキスト更新');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            onComplete,
        });
        await monitor.start();

        for (let i = 0; i < 5; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        // 再出現によりカウンターリセット → 連続3回に達していないので完了しない
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 4: stop()を呼ぶと監視が停止すること
    // ──────────────────────────────────────────────────────
    it('stop()を呼ぶとポーリングが停止してそれ以上コールバックが呼ばれないこと', async () => {
        const onProgress = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト
        mockPollResult(mockCdpService, true, 'テキスト');
        // poll2: (stop後は到達しない)
        mockPollResult(mockCdpService, true, '新テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
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

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // 全poll: ストップボタンあり + テキスト
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            const idx = (callCount - 1) % 3;
            if (idx === 0) return { result: { value: true } };     // ストップボタンあり
            if (idx === 1) return { result: { value: [] } };        // アクティビティ
            return { result: { value: '生成中...' } };              // テキスト
        });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            maxDurationMs: 2000,
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

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: CDPエラー
        mockCdpService.call.mockRejectedValueOnce(new Error('CDPエラー'));
        // poll2: 正常
        mockPollResult(mockCdpService, true, 'リカバリ後テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // エラー回
        await jest.advanceTimersByTimeAsync(500); // 成功回

        expect(onProgress).toHaveBeenCalledWith('リカバリ後テキスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 7: フェーズ変更コールバック
    // ──────────────────────────────────────────────────────
    it('フェーズ変更時にonPhaseChangeコールバックが呼ばれること', async () => {
        const onPhaseChange = jest.fn();
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → thinking
        mockPollResult(mockCdpService, true, '応答テキスト');
        // poll2-4: ストップボタンなし → 連続3回で complete
        mockPollResult(mockCdpService, false, '応答テキスト');
        mockPollResult(mockCdpService, false, '応答テキスト');
        mockPollResult(mockCdpService, false, '応答テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 0,
            onPhaseChange,
            onComplete,
        });
        await monitor.start();

        // start()後の初期フェーズはwaitingだがconstructor時と同じなのでコールバックは呼ばれない

        await jest.advanceTimersByTimeAsync(500); // poll1
        expect(onPhaseChange).toHaveBeenCalledWith('thinking', null);
        expect(onPhaseChange).toHaveBeenCalledWith('generating', '応答テキスト');

        await jest.advanceTimersByTimeAsync(500); // poll2
        await jest.advanceTimersByTimeAsync(500); // poll3
        await jest.advanceTimersByTimeAsync(500); // poll4 → complete
        expect(onPhaseChange).toHaveBeenCalledWith('complete', '応答テキスト');
    });

    // ──────────────────────────────────────────────────────
    // テスト 8: アクティビティコールバック
    // ──────────────────────────────────────────────────────
    it('アクティビティ検出時にonActivityコールバックが呼ばれること', async () => {
        const onActivity = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + アクティビティあり
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: true } })                       // ストップボタン
            .mockResolvedValueOnce({ result: { value: ['Analyzed 3 files'] } })       // アクティビティ
            .mockResolvedValueOnce({ result: { value: 'テキスト' } });                // テキスト
        // poll2: アクティビティ更新
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: true } })
            .mockResolvedValueOnce({ result: { value: ['Analyzed 3 files', 'Reading docs'] } })
            .mockResolvedValueOnce({ result: { value: 'テキスト更新' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onActivity,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // poll1
        expect(onActivity).toHaveBeenCalledWith(['Analyzed 3 files']);

        await jest.advanceTimersByTimeAsync(500); // poll2
        expect(onActivity).toHaveBeenCalledWith(['Analyzed 3 files', 'Reading docs']);
    });

    // ──────────────────────────────────────────────────────
    // テスト 9: テキスト変化でもストップボタン消失カウンターがリセットされること
    // ──────────────────────────────────────────────────────
    it('テキスト変化時にストップボタン消失カウンターがリセットされること', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → 生成開始
        mockPollResult(mockCdpService, true, 'テキスト1');
        // poll2: ストップボタンなし + テキスト変化 → リセット(0) → increment(1)
        mockPollResult(mockCdpService, false, 'テキスト2');
        // poll3: ストップボタンなし → increment(2) まだ完了しない
        mockPollResult(mockCdpService, false, 'テキスト2');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            onComplete,
        });
        await monitor.start();

        for (let i = 0; i < 3; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        // テキスト変化でリセットされた後、再カウント開始
        // poll2: リセット+increment=1, poll3: increment=2 → 3に達していない
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 10: 停止後に活動ログが残っていても完了判定を妨げないこと
    // ──────────────────────────────────────────────────────
    it('ストップボタン消失後は同一の進行中アクティビティが残っていてもcompleteに遷移できること', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → 生成開始
        mockPollResult(mockCdpService, true, '最終レスポンス');
        // poll2-4: ストップボタンなし + 同一の進行中アクティビティ（残存）
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 1000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1
        await jest.advanceTimersByTimeAsync(500);  // poll2
        await jest.advanceTimersByTimeAsync(500);  // poll3
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll4 (stability 1000ms)
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 11: 「中」を含むだけの非進行テキストは完了遅延の原因にしないこと
    // ──────────────────────────────────────────────────────
    it('非進行の日本語テキストに「中」が含まれていても完了判定を妨げないこと', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → 生成開始
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        // poll2-4: ストップボタンなし、活動テキストは固定（"中"を含むが進行ではない）
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 1000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1
        await jest.advanceTimersByTimeAsync(500);  // poll2
        await jest.advanceTimersByTimeAsync(500);  // poll3
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll4
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 12: Good/Badマーカーは完了シグナルとして扱わないこと
    // ──────────────────────────────────────────────────────
    it('Good/BadマーカーがあってもStop消失+安定時間条件を満たすまでcompleteしないこと', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり → 生成開始
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        // poll2: ストップボタンなし + フィードバックマーカー（無視される）
        mockPollResult(mockCdpService, false, '最終レスポンス', ['__AG_FEEDBACK_READY__']);
        // poll3: ストップボタンなし + フィードバックマーカー（無視される）
        mockPollResult(mockCdpService, false, '最終レスポンス', ['__AG_FEEDBACK_READY__']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 3,
            completionStabilityMs: 10000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // poll1
        await jest.advanceTimersByTimeAsync(500); // poll2
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll3
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 13: ストップボタン誤検知が継続しても長時間更新がなければ完了扱いにする
    // ──────────────────────────────────────────────────────
    it('生成中判定が継続していてもテキスト更新停止が一定時間続けばcompleteに遷移すること', async () => {
        const onComplete = jest.fn();

        // ベースライン: null
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: ストップボタンあり + テキスト（生成開始）
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        // poll2-3: ストップボタンありのまま、テキスト更新なし
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, true, '最終レスポンス', []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            noUpdateTimeoutMs: 1000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // poll1
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll2
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll3 -> stall判定でcomplete
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });
});
