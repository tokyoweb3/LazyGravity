/**
 * Step 7: 承認ボタンの自動検出とリモート実行 TDDテスト
 *
 * テスト方針:
 *   - ApprovalDetector クラスをテスト対象とする
 *   - CdpService をモック化してDOM上の承認ボタン検出をシミュレート
 *   - 検出時に onApprovalRequired コールバックが呼ばれ、
 *     Discordへのボタン付きEmbedの送信トリガーとなることを検証
 */

import { ApprovalDetector, ApprovalDetectorOptions, ApprovalInfo } from '../../src/services/approvalDetector';
import { CdpService } from '../../src/services/cdpService';

// CdpService をモック化
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ApprovalDetector - 承認ボタン検出とリモート実行 (Step 7)', () => {
    let detector: ApprovalDetector;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (detector) {
            await detector.stop();
        }
        jest.useRealTimers();
    });

    // ──────────────────────────────────────────────────────
    // テスト 1: ボタンが検出されたらonApprovalRequiredを呼ぶ
    // ──────────────────────────────────────────────────────
    it('承認ボタンを検出した際にonApprovalRequiredコールバックを呼び出すこと', async () => {
        const onApprovalRequired = jest.fn();

        // 承認ボタンが存在するケース
        const mockApprovalInfo: ApprovalInfo = {
            buttonText: 'Allow',
            description: 'Allow the following action: write to file.ts',
        };
        mockCdpService.call.mockResolvedValue({
            result: { value: mockApprovalInfo }
        });

        const options: ApprovalDetectorOptions = {
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        };

        detector = new ApprovalDetector(options);
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(onApprovalRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                buttonText: 'Allow',
                description: expect.stringContaining('write to file.ts'),
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 2: ボタンがない場合はコールバックを呼ばない
    // ──────────────────────────────────────────────────────
    it('承認ボタンが存在しない場合はコールバックを呼ばないこと', async () => {
        const onApprovalRequired = jest.fn();

        // ボタンが存在しないケース
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onApprovalRequired).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // テスト 3: 同じボタンが連続検出されても重複呼び出ししない
    // ──────────────────────────────────────────────────────
    it('同じ承認ボタンが連続検出されても重複してコールバックを呼ばないこと', async () => {
        const onApprovalRequired = jest.fn();

        const mockApprovalInfo: ApprovalInfo = {
            buttonText: 'Allow',
            description: '重複テスト: run command',
        };

        // 複数回同じボタン情報を返す
        mockCdpService.call.mockResolvedValue({
            result: { value: mockApprovalInfo }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        // 3回ポーリング
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // 同じ内容なので1回だけ呼ばれること
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // テスト 4: approveButton()でボタンをクリックできること
    // ──────────────────────────────────────────────────────
    it('approveButton()を呼ぶとCDPでクリックスクリプトが実行されること', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });

        const result = await detector.approveButton('Allow');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Allow'),
                returnByValue: true,
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 5: denyButton()でボタンをクリック（拒否）できること
    // ──────────────────────────────────────────────────────
    it('denyButton()を呼ぶとCDPでDenyクリックスクリプトが実行されること', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });

        const result = await detector.denyButton('Deny');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Deny'),
                returnByValue: true,
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 6: stop()後はポーリングが停止すること
    // ──────────────────────────────────────────────────────
    it('stop()後はポーリングが停止してコールバックが呼ばれないこと', async () => {
        const onApprovalRequired = jest.fn();

        const mockApprovalInfo: ApprovalInfo = {
            buttonText: 'Allow',
            description: 'some action',
        };
        mockCdpService.call.mockResolvedValue({
            result: { value: mockApprovalInfo }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);

        await detector.stop();

        // 停止後のポーリングはスキップ
        await jest.advanceTimersByTimeAsync(1000);
        expect(onApprovalRequired).toHaveBeenCalledTimes(1); // 増えない
    });

    // ──────────────────────────────────────────────────────
    // テスト 7: CDPエラー時に監視が継続すること
    // ──────────────────────────────────────────────────────
    it('CDPエラーが発生しても監視を継続すること', async () => {
        const onApprovalRequired = jest.fn();

        const mockApprovalInfo: ApprovalInfo = {
            buttonText: 'Allow',
            description: 'エラー後リカバリ',
        };

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDPエラー'))  // 1回目エラー
            .mockResolvedValueOnce({ result: { value: mockApprovalInfo } }); // 2回目成功

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // エラー回
        await jest.advanceTimersByTimeAsync(500); // 成功回

        expect(onApprovalRequired).toHaveBeenCalledWith(
            expect.objectContaining({ buttonText: 'Allow' })
        );
    });
});
