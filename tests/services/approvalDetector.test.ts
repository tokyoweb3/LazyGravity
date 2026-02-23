/**
 * 承認ボタンの自動検出とリモート実行 TDDテスト
 *
 * テスト方針:
 *   - ApprovalDetector クラスをテスト対象とする
 *   - CdpService をモック化してDOM上の承認ボタン検出をシミュレート
 *   - 検出時に onApprovalRequired コールバックが呼ばれ、
 *     Discordへのボタン付きEmbedの送信トリガーとなることを検証
 *   - getLastDetectedInfo() で検出済みボタン情報が保持されることを検証
 *   - contextId を指定してスクリプト実行されることを検証
 */

import { ApprovalDetector, ApprovalDetectorOptions, ApprovalInfo } from '../../src/services/approvalDetector';
import { CdpService } from '../../src/services/cdpService';

// CdpService をモック化
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ApprovalDetector - 承認ボタン検出とリモート実行', () => {
    let detector: ApprovalDetector;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(42);
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (detector) {
            await detector.stop();
        }
        jest.useRealTimers();
    });

    /** テスト用のApprovalInfoを生成するヘルパー */
    function makeApprovalInfo(overrides: Partial<ApprovalInfo> = {}): ApprovalInfo {
        return {
            approveText: '許可',
            denyText: '拒否',
            description: 'ファイルへの書き込みを許可しますか？',
            ...overrides,
        };
    }

    // ──────────────────────────────────────────────────────
    // テスト 1: ボタンが検出されたらonApprovalRequiredを呼ぶ
    // ──────────────────────────────────────────────────────
    it('承認ボタンを検出した際にonApprovalRequiredコールバックを呼び出すこと', async () => {
        const onApprovalRequired = jest.fn();
        const mockInfo = makeApprovalInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(onApprovalRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                approveText: '許可',
                denyText: '拒否',
                description: expect.stringContaining('ファイルへの書き込み'),
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 2: ボタンがない場合はコールバックを呼ばない
    // ──────────────────────────────────────────────────────
    it('承認ボタンが存在しない場合はコールバックを呼ばないこと', async () => {
        const onApprovalRequired = jest.fn();
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
        const mockInfo = makeApprovalInfo({ description: '重複テスト: run command' });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
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
                contextId: 42,
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
                contextId: 42,
            })
        );
    });

    it('alwaysAllowButton()が直接Allow This Conversationをクリックできること', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });

        const result = await detector.alwaysAllowButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Allow This Conversation'),
                returnByValue: true,
                contextId: 42,
            })
        );
    });

    it('alwaysAllowButton()がAllow Onceのドロップダウン展開後に会話許可をクリックできること', async () => {
        let expanded = false;
        mockCdpService.call.mockImplementation(async (_method: string, params: any) => {
            const expression: string = params.expression || '';

            // ドロップダウン展開スクリプト
            if (expression.includes('ALLOW_ONCE_PATTERNS')) {
                expanded = true;
                return { result: { value: { ok: true, reason: 'toggle-button' } } } as any;
            }

            // 展開後のみ会話許可ボタンのクリックを成功させる
            if (expanded && expression.includes('Allow This Conversation')) {
                return { result: { value: { ok: true } } } as any;
            }

            return { result: { value: { ok: false } } } as any;
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });

        const result = await detector.alwaysAllowButton();

        expect(result).toBe(true);
        const expressions = mockCdpService.call.mock.calls
            .map((call) => call?.[1]?.expression as string);
        expect(expressions.some((exp) => exp.includes('ALLOW_ONCE_PATTERNS'))).toBe(true);
        expect(expressions.some((exp) => exp.includes('Allow This Conversation'))).toBe(true);
    });

    // ──────────────────────────────────────────────────────
    // テスト 6: stop()後はポーリングが停止すること
    // ──────────────────────────────────────────────────────
    it('stop()後はポーリングが停止してコールバックが呼ばれないこと', async () => {
        const onApprovalRequired = jest.fn();
        const mockInfo = makeApprovalInfo({ description: 'some action' });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
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
        const mockInfo = makeApprovalInfo({ description: 'エラー後リカバリ' });

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDPエラー'))  // 1回目エラー
            .mockResolvedValueOnce({ result: { value: mockInfo } }); // 2回目成功

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // エラー回
        await jest.advanceTimersByTimeAsync(500); // 成功回

        expect(onApprovalRequired).toHaveBeenCalledWith(
            expect.objectContaining({ approveText: '許可' })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 8: getLastDetectedInfo()で検出済み情報を取得できること
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo()が検出済みのApprovalInfoを返すこと', async () => {
        const mockInfo = makeApprovalInfo({
            approveText: 'Accept',
            denyText: 'Decline',
            description: 'テストアクション',
        });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
        });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });

        // 検出前はnull
        expect(detector.getLastDetectedInfo()).toBeNull();

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        const info = detector.getLastDetectedInfo();
        expect(info).not.toBeNull();
        expect(info?.approveText).toBe('Accept');
        expect(info?.denyText).toBe('Decline');
        expect(info?.description).toBe('テストアクション');
    });

    // ──────────────────────────────────────────────────────
    // テスト 9: ボタンが消えたらlastDetectedInfoがリセットされること
    // ──────────────────────────────────────────────────────
    it('ボタンが消えたらgetLastDetectedInfo()がnullを返すこと', async () => {
        const mockInfo = makeApprovalInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // 1回目: 検出
            .mockResolvedValueOnce({ result: { value: null } });     // 2回目: 消えた

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // 検出
        expect(detector.getLastDetectedInfo()).not.toBeNull();

        await jest.advanceTimersByTimeAsync(500); // 消失
        expect(detector.getLastDetectedInfo()).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // テスト 10: 検出 → クリックの流れでボタンテキストが正しく伝搬すること
    // ──────────────────────────────────────────────────────
    it('引数なしのapproveButton()が検出済みのapproveTextを使用すること', async () => {
        const mockInfo = makeApprovalInfo({ approveText: '承認する' });

        // 最初のcall: poll用（検出）
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            // 2回目のcall: approveButton用（クリック）
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // 検出

        // 引数なしでapproveButton()
        const result = await detector.approveButton();

        expect(result).toBe(true);
        // 2回目のcallで検出済みのapproveTextが使われている
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('承認する'),
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 11: 引数なしのdenyButton()が検出済みのdenyTextを使用すること
    // ──────────────────────────────────────────────────────
    it('引数なしのdenyButton()が検出済みのdenyTextを使用すること', async () => {
        const mockInfo = makeApprovalInfo({ denyText: 'キャンセル' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        const result = await detector.denyButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('キャンセル'),
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 12: contextIdがnullの場合はcontextIdなしでcallされること
    // ──────────────────────────────────────────────────────
    it('contextIdがnullの場合はcontextIdパラメータなしでcallされること', async () => {
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(null);
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.not.objectContaining({ contextId: expect.anything() })
        );
    });
});
