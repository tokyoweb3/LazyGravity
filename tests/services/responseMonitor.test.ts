/**
 * Step 6: AIレスポンスの抽出とプログレス監視 TDDテスト
 *
 * テスト方針:
 *   - ResponseMonitor クラスを対象とする
 *   - CdpService をモック化して、DOM からのテキスト抽出と生成完了検知をテスト
 *   - Discordメッセージ更新（Edit）のコールバック機能を検証する
 */

import { ResponseMonitor, ResponseMonitorOptions } from '../../src/services/responseMonitor';
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

    // ──────────────────────────────────────────────────────
    // テスト 1: 生成中テキストの逐次抽出
    // ──────────────────────────────────────────────────────
    it('生成中のテキストを逐次抽出し、onProgressコールバックを呼び出すこと', async () => {
        const onProgress = jest.fn();

        // ポーリング1回あたり: テキスト取得 + ストップボタンチェックの2回callが発生
        // 1回目ポーリング: Hello取得 → ストップボタンあり(生成中)
        // 2回目ポーリング: Hello World取得 → ストップボタンあり(生成中)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: 'Hello' } })        // 1回目: テキスト取得
            .mockResolvedValueOnce({ result: { value: true } })           // 1回目: ストップボタンあり
            .mockResolvedValueOnce({ result: { value: 'Hello World' } })  // 2回目: テキスト取得
            .mockResolvedValueOnce({ result: { value: true } });          // 2回目: ストップボタンあり

        const options: ResponseMonitorOptions = {
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        };

        monitor = new ResponseMonitor(options);
        monitor.start();

        // タイマーを2ティック進める
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

        // 両回とも同じテキスト
        mockCdpService.call.mockResolvedValue({ result: { value: 'Same text' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        });
        monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // 最初の取得時のみコールバックが呼ばれること（2回目は変化なしのため呼ばれない）
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith('Same text');
    });

    // ──────────────────────────────────────────────────────
    // テスト 3: 生成完了の検知（ストップボタンの消失）
    // ──────────────────────────────────────────────────────
    it('生成完了を検知した際にonCompleteコールバックを呼び出すこと', async () => {
        const onComplete = jest.fn();
        const onProgress = jest.fn();

        // ポーリング1回あたり: テキスト取得 + ストップボタンチェックの2回callが発生
        // テキスト取得を先に呼び、次にストップボタンをチェック
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: '最終レスポンス' } }) // テキスト取得
            .mockResolvedValueOnce({ result: { value: false } });           // ストップボタンなし = 生成完了

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
            onComplete,
        });
        monitor.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // テスト 4: stop()を呼ぶと監視が停止すること
    // ──────────────────────────────────────────────────────
    it('stop()を呼ぶとポーリングが停止してそれ以上コールバックが呼ばれないこと', async () => {
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValue({ result: { value: 'テキスト' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        });
        monitor.start();

        // 1回ティック
        await jest.advanceTimersByTimeAsync(500);
        expect(onProgress).toHaveBeenCalledTimes(1);

        // 停止
        await monitor.stop();

        // さらにティックしても呼ばれない
        await jest.advanceTimersByTimeAsync(1000);
        expect(onProgress).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // テスト 5: タイムアウトで停止すること
    // ──────────────────────────────────────────────────────
    it('maxDurationMsを超えたら自動停止してonTimeoutコールバックを呼ぶこと', async () => {
        const onTimeout = jest.fn();
        const onProgress = jest.fn();

        mockCdpService.call.mockResolvedValue({ result: { value: '生成中...' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            maxDurationMs: 2000, // 2秒でタイムアウト
            onProgress,
            onTimeout,
        });
        monitor.start();

        // 2秒超過させる
        await jest.advanceTimersByTimeAsync(2500);

        expect(onTimeout).toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 6: CDPエラー時にも監視が継続すること
    // ──────────────────────────────────────────────────────
    it('CDPのcallがエラーを投げても監視が継続すること', async () => {
        const onProgress = jest.fn();

        // 1回目エラー、2回目成功
        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDPエラー'))
            .mockResolvedValueOnce({ result: { value: 'リカバリ後テキスト' } });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onProgress,
        });
        monitor.start();

        await jest.advanceTimersByTimeAsync(500); // エラー回
        await jest.advanceTimersByTimeAsync(500); // 成功回

        // エラー後もリカバリして動作すること
        expect(onProgress).toHaveBeenCalledWith('リカバリ後テキスト');
    });
});
