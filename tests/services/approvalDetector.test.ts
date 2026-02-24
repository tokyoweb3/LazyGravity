/**
 * Approval button auto-detection and remote execution TDD test
 *
 * Test strategy:
 *   - ApprovalDetector class is the test target
 *   - Mock CdpService to simulate DOM approval button detection
 *   - Verify that onApprovalRequired callback is called upon detection,
 *     triggering a button-attached Embed to be sent to Discord
 *   - Verify that getLastDetectedInfo() retains detected button info
 *   - Verify that scripts are executed with a specified contextId
 */

import { ApprovalDetector, ApprovalDetectorOptions, ApprovalInfo } from '../../src/services/approvalDetector';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ApprovalDetector - approval button detection and remote execution', () => {
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

    /** Helper to generate ApprovalInfo for testing */
    function makeApprovalInfo(overrides: Partial<ApprovalInfo> = {}): ApprovalInfo {
        return {
            approveText: '許可',
            denyText: '拒否',
            description: 'ファイルへの書き込みを許可しますか？',
            ...overrides,
        };
    }

    // ──────────────────────────────────────────────────────
    // Test 1: Call onApprovalRequired when a button is detected
    // ──────────────────────────────────────────────────────
    it('calls the onApprovalRequired callback when an approval button is detected', async () => {
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
    // Test 2: Do not call the callback when no button exists
    // ──────────────────────────────────────────────────────
    it('does not call the callback when no approval button exists', async () => {
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
    // Test 3: No duplicate calls for the same button detected consecutively
    // ──────────────────────────────────────────────────────
    it('does not call the callback multiple times when the same approval button is detected consecutively', async () => {
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

        // 3 polling cycles
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // Should be called only once since the content is the same
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 4: approveButton() can click the button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when approveButton() is called', async () => {
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
    // Test 5: denyButton() can click (deny) the button
    // ──────────────────────────────────────────────────────
    it('executes a deny click script via CDP when denyButton() is called', async () => {
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

    it('alwaysAllowButton() can directly click Allow This Conversation', async () => {
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

    it('alwaysAllowButton() can click the conversation allow button after expanding the Allow Once dropdown', async () => {
        let expanded = false;
        mockCdpService.call.mockImplementation(async (_method: string, params: any) => {
            const expression: string = params.expression || '';

            // Dropdown expansion script
            if (expression.includes('ALLOW_ONCE_PATTERNS')) {
                expanded = true;
                return { result: { value: { ok: true, reason: 'toggle-button' } } } as any;
            }

            // Only succeed the conversation allow button click after expansion
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
    // Test 6: Polling stops after stop()
    // ──────────────────────────────────────────────────────
    it('stops polling and no longer calls the callback after stop()', async () => {
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

        // Polling after stop is skipped
        await jest.advanceTimersByTimeAsync(1000);
        expect(onApprovalRequired).toHaveBeenCalledTimes(1); // does not increase
    });

    // ──────────────────────────────────────────────────────
    // Test 7: Monitoring continues on CDP error
    // ──────────────────────────────────────────────────────
    it('continues monitoring even when a CDP error occurs', async () => {
        const onApprovalRequired = jest.fn();
        const mockInfo = makeApprovalInfo({ description: 'エラー後リカバリ' });

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDP error'))  // 1st call: error
            .mockResolvedValueOnce({ result: { value: mockInfo } }); // 2nd call: success

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
    // Test 8: getLastDetectedInfo() can retrieve detected info
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns the detected ApprovalInfo', async () => {
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

        // null before detection
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
    // Test 9: lastDetectedInfo resets when the button disappears
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns null when the button disappears', async () => {
        const mockInfo = makeApprovalInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // 1st: detected
            .mockResolvedValueOnce({ result: { value: null } });     // 2nd: disappeared

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection
        expect(detector.getLastDetectedInfo()).not.toBeNull();

        await jest.advanceTimersByTimeAsync(500); // disappearance
        expect(detector.getLastDetectedInfo()).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // Test 10: Button text propagates correctly through the detection-to-click flow
    // ──────────────────────────────────────────────────────
    it('approveButton() without arguments uses the detected approveText', async () => {
        const mockInfo = makeApprovalInfo({ approveText: '承認する' });

        // 1st call: for polling (detection)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            // 2nd call: for approveButton (click)
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new ApprovalDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onApprovalRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection

        // Call approveButton() without arguments
        const result = await detector.approveButton();

        expect(result).toBe(true);
        // The detected approveText is used in the 2nd call
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('承認する'),
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 11: denyButton() without arguments uses the detected denyText
    // ──────────────────────────────────────────────────────
    it('denyButton() without arguments uses the detected denyText', async () => {
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
    // Test 12: Calls without contextId parameter when contextId is null
    // ──────────────────────────────────────────────────────
    it('calls without the contextId parameter when contextId is null', async () => {
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
