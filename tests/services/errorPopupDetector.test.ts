/**
 * Error popup detection and remote execution TDD test
 *
 * Test strategy:
 *   - ErrorPopupDetector class is the test target
 *   - Mock CdpService to simulate DOM error popup detection
 *   - Verify that onErrorPopup callback is called upon detection
 *   - Verify clickDismissButton / clickCopyDebugInfoButton / clickRetryButton / readClipboard behavior
 *   - Verify duplicate prevention, cooldown, stop, and CDP error recovery
 */

import { ErrorPopupDetector, ErrorPopupDetectorOptions, ErrorPopupInfo } from '../../src/services/errorPopupDetector';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ErrorPopupDetector - error popup detection and remote execution', () => {
    let detector: ErrorPopupDetector;
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

    /** Helper to generate ErrorPopupInfo for testing */
    function makeErrorPopupInfo(overrides: Partial<ErrorPopupInfo> = {}): ErrorPopupInfo {
        return {
            title: 'Agent terminated due to error',
            body: 'The agent encountered an unexpected error and was terminated.',
            buttons: ['Dismiss', 'Copy debug info', 'Retry'],
            ...overrides,
        };
    }

    // ──────────────────────────────────────────────────────
    // Test 1: Call onErrorPopup when error popup is detected
    // ──────────────────────────────────────────────────────
    it('calls the onErrorPopup callback when an error popup is detected', async () => {
        const onErrorPopup = jest.fn();
        const mockInfo = makeErrorPopupInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onErrorPopup).toHaveBeenCalledTimes(1);
        expect(onErrorPopup).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Agent terminated due to error',
                buttons: expect.arrayContaining(['Dismiss', 'Copy debug info', 'Retry']),
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 2: Do not call the callback when no error popup exists
    // ──────────────────────────────────────────────────────
    it('does not call the callback when no error popup exists', async () => {
        const onErrorPopup = jest.fn();
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onErrorPopup).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // Test 3: No duplicate calls for the same popup detected consecutively
    // ──────────────────────────────────────────────────────
    it('does not call the callback multiple times when the same error popup is detected', async () => {
        const onErrorPopup = jest.fn();
        const mockInfo = makeErrorPopupInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        // 3 polling cycles
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // Should be called only once since the content is the same
        expect(onErrorPopup).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 3b: Dedup uses title + body snippet as key
    // ──────────────────────────────────────────────────────
    it('treats detections with same title and body as duplicate', async () => {
        const onErrorPopup = jest.fn();

        const info1 = makeErrorPopupInfo({ buttons: ['Dismiss', 'Retry'] });
        const info2 = makeErrorPopupInfo({ buttons: ['Dismiss', 'Copy debug info', 'Retry'] });
        // Both have same title + body -> same key

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: info1 } })
            .mockResolvedValueOnce({ result: { value: info2 } });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // Same title+body pair -> only 1 notification
        expect(onErrorPopup).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 3c: Cooldown suppresses rapid re-detection after key reset
    // ──────────────────────────────────────────────────────
    it('suppresses re-detection within 10s cooldown even after key reset', async () => {
        const onErrorPopup = jest.fn();
        const mockInfo = makeErrorPopupInfo();

        // detected -> disappear -> re-detected (within cooldown)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })   // detected
            .mockResolvedValueOnce({ result: { value: null } })       // disappear (key reset)
            .mockResolvedValueOnce({ result: { value: mockInfo } });  // re-detected

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);  // detect
        expect(onErrorPopup).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(500);  // disappear
        await jest.advanceTimersByTimeAsync(500);  // re-detect within cooldown (1500ms total)

        // Still only 1 notification due to cooldown (10s)
        expect(onErrorPopup).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 4: clickDismissButton() can click the Dismiss button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when clickDismissButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const result = await detector.clickDismissButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Dismiss'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 5: clickCopyDebugInfoButton() can click the Copy debug info button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when clickCopyDebugInfoButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const result = await detector.clickCopyDebugInfoButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Copy debug info'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 6: clickRetryButton() can click the Retry button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when clickRetryButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const result = await detector.clickRetryButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Retry'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 7: readClipboard() returns clipboard text
    // ──────────────────────────────────────────────────────
    it('readClipboard() returns the clipboard text', async () => {
        const debugInfo = 'Error: Agent terminated\nStack: at line 42\nVersion: 1.0.0';
        mockCdpService.call.mockResolvedValue({
            result: { value: debugInfo },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const content = await detector.readClipboard();

        expect(content).toBe(debugInfo);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                awaitPromise: true,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 8: readClipboard() returns null when clipboard is empty
    // ──────────────────────────────────────────────────────
    it('readClipboard() returns null when clipboard content is not available', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: null },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const content = await detector.readClipboard();

        expect(content).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // Test 9: readClipboard() returns null on CDP error
    // ──────────────────────────────────────────────────────
    it('readClipboard() returns null when a CDP error occurs', async () => {
        mockCdpService.call.mockRejectedValue(new Error('CDP connection lost'));

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const content = await detector.readClipboard();

        expect(content).toBeNull();

        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────────────
    // Test 10: Polling stops after stop()
    // ──────────────────────────────────────────────────────
    it('stops polling and no longer calls the callback after stop()', async () => {
        const onErrorPopup = jest.fn();
        const mockInfo = makeErrorPopupInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onErrorPopup).toHaveBeenCalledTimes(1);

        await detector.stop();

        // Polling after stop is skipped
        await jest.advanceTimersByTimeAsync(1000);
        expect(onErrorPopup).toHaveBeenCalledTimes(1); // does not increase
    });

    // ──────────────────────────────────────────────────────
    // Test 11: Monitoring continues on CDP error
    // ──────────────────────────────────────────────────────
    it('continues monitoring even when a CDP error occurs', async () => {
        const onErrorPopup = jest.fn();
        const mockInfo = makeErrorPopupInfo({ title: 'Recovery Error' });

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDP error'))  // 1st call: error
            .mockResolvedValueOnce({ result: { value: mockInfo } }); // 2nd call: success

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });
        detector.start();

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await jest.advanceTimersByTimeAsync(500); // error
        await jest.advanceTimersByTimeAsync(500); // success

        expect(onErrorPopup).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Recovery Error' }),
        );

        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────────────
    // Test 12: getLastDetectedInfo() returns detected info
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns the detected ErrorPopupInfo', async () => {
        const mockInfo = makeErrorPopupInfo({
            title: 'Custom Error',
            body: 'Something went wrong with the agent.',
        });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        // null before detection
        expect(detector.getLastDetectedInfo()).toBeNull();

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        const info = detector.getLastDetectedInfo();
        expect(info).not.toBeNull();
        expect(info?.title).toBe('Custom Error');
        expect(info?.body).toBe('Something went wrong with the agent.');
    });

    // ──────────────────────────────────────────────────────
    // Test 13: lastDetectedInfo resets when popup disappears
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns null when error popup disappears', async () => {
        const mockInfo = makeErrorPopupInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // 1st: detected
            .mockResolvedValueOnce({ result: { value: null } });     // 2nd: disappeared

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection
        expect(detector.getLastDetectedInfo()).not.toBeNull();

        await jest.advanceTimersByTimeAsync(500); // disappearance
        expect(detector.getLastDetectedInfo()).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // Test 14: isActive() returns correct state
    // ──────────────────────────────────────────────────────
    it('isActive() returns true while running and false after stop', async () => {
        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        expect(detector.isActive()).toBe(false);

        detector.start();
        expect(detector.isActive()).toBe(true);

        await detector.stop();
        expect(detector.isActive()).toBe(false);
    });

    // ──────────────────────────────────────────────────────
    // Test 15: Calls without contextId parameter when contextId is null
    // ──────────────────────────────────────────────────────
    it('calls without the contextId parameter when contextId is null', async () => {
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(null);
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.not.objectContaining({ contextId: expect.anything() }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 16: clickDismissButton() returns false on CDP error
    // ──────────────────────────────────────────────────────
    it('clickDismissButton() returns false when a CDP error occurs', async () => {
        mockCdpService.call.mockRejectedValue(new Error('CDP error'));

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup: jest.fn(),
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const result = await detector.clickDismissButton();

        expect(result).toBe(false);

        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────────────
    // Test 17: WebSocket disconnect errors are silently ignored
    // ──────────────────────────────────────────────────────
    it('silently ignores WebSocket disconnect errors during polling', async () => {
        const onErrorPopup = jest.fn();
        mockCdpService.call.mockRejectedValue(new Error('WebSocket is not connected'));

        detector = new ErrorPopupDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onErrorPopup,
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        expect(onErrorPopup).not.toHaveBeenCalled();
        // The WebSocket error should be silently ignored (not logged)
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
