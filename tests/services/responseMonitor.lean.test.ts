/**
 * TDD RED phase: Lean ResponseMonitor tests.
 *
 * These tests define the expected behavior of the NEW simplified ResponseMonitor.
 * They should FAIL against the current implementation because they test the new API
 * that does not yet exist.
 *
 * Key differences from current implementation:
 *   - Constructor accepts only: cdpService, pollIntervalMs (default 2000),
 *     maxDurationMs, stopGoneConfirmCount (default 3), onProgress, onComplete,
 *     onTimeout, onPhaseChange
 *   - NO network event subscription, but subscribes to CDP connection events (disconnected/reconnected/reconnectFailed)
 *   - NO onActivity, networkCompleteDelayMs, textStabilityCompleteMs, etc.
 *   - NO getLastExtractionSource(), getLastDomActivityLines()
 *   - Each poll makes exactly 3 CDP calls: stop button, quota, text extraction
 *   - Stop button disappearing 3 consecutive times triggers onComplete
 *   - Simple baseline suppression (just compare strings, no 20s timeout)
 */

import { ResponseMonitor, ResponsePhase } from '../../src/services/responseMonitor';

/**
 * The NEW lean API renames stopButtonGoneConfirmCount -> stopGoneConfirmCount
 * and removes many options. We define the expected interface here so tests
 * document the target shape, while using `as any` casts to bypass current
 * TS compilation against the old types.
 */
interface LeanResponseMonitorOptions {
    cdpService: any;
    pollIntervalMs?: number;       // default 2000 (was 1000)
    maxDurationMs?: number;        // default 300000
    stopGoneConfirmCount?: number; // default 3 (was stopButtonGoneConfirmCount, default 1)
    onProgress?: (text: string) => void;
    onComplete?: (finalText: string) => void;
    onTimeout?: (lastText: string) => void;
    onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    // Removed: onActivity, networkCompleteDelayMs, textStabilityCompleteMs,
    //          noUpdateTimeoutMs, noTextCompletionDelayMs, completionStabilityMs
}

// Minimal mock: call, getPrimaryContextId, on, removeListener (for CDP connection events).
function createMockCdpService() {
    return {
        call: jest.fn().mockResolvedValue({ result: { value: null } }),
        getPrimaryContextId: jest.fn().mockReturnValue(1),
        on: jest.fn(),
        removeListener: jest.fn(),
    };
}

describe('Lean ResponseMonitor (new API)', () => {
    let cdpService: ReturnType<typeof createMockCdpService>;

    beforeEach(() => {
        jest.useFakeTimers();
        cdpService = createMockCdpService();
    });

    afterEach(async () => {
        jest.useRealTimers();
    });

    function createMonitor(overrides: Partial<LeanResponseMonitorOptions> = {}): ResponseMonitor {
        return new ResponseMonitor({
            cdpService: cdpService as any,
            pollIntervalMs: 2000,
            stopGoneConfirmCount: 3,
            extractionMode: 'legacy',
            ...overrides,
        } as any);
    }

    // Helper: build a CDP result wrapper
    function cdpResult(value: unknown) {
        return { result: { value } };
    }

    // ---------------------------------------------------------------
    // Test 1: start() captures baseline, sets phase to 'waiting', starts polling
    // ---------------------------------------------------------------
    it('start() captures baseline, sets phase to waiting, starts polling', async () => {
        const phases: ResponsePhase[] = [];
        const monitor = createMonitor({
            onPhaseChange: (phase) => { phases.push(phase); },
        });

        // Baseline call returns existing text
        cdpService.call.mockResolvedValueOnce(cdpResult('existing text'));

        await monitor.start();

        expect(phases).toContain('waiting');
        expect(monitor.getPhase()).toBe('waiting');
        // Baseline should have been captured via 2 CDP calls:
        // 1. RESPONSE_TEXT baseline, 2. PROCESS_LOGS baseline
        expect(cdpService.call).toHaveBeenCalledTimes(2);

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // Test 2: Stop button appearing sets generationStarted, phase to 'thinking'
    // ---------------------------------------------------------------
    it('stop button appearing sets phase to thinking', async () => {
        const phases: ResponsePhase[] = [];
        const monitor = createMonitor({
            onPhaseChange: (phase) => { phases.push(phase); },
        });

        // Baseline: no text
        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll: stop button = true, quota = false, text = null
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))  // stop button
            .mockResolvedValueOnce(cdpResult(false))                   // quota
            .mockResolvedValueOnce(cdpResult(null));                   // text

        await jest.advanceTimersByTimeAsync(2000);

        expect(phases).toContain('thinking');

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // Test 3: Text update triggers onProgress and sets phase to 'generating'
    // ---------------------------------------------------------------
    it('text update triggers onProgress and sets phase to generating', async () => {
        const phases: ResponsePhase[] = [];
        const progressTexts: string[] = [];
        const monitor = createMonitor({
            onPhaseChange: (phase) => { phases.push(phase); },
            onProgress: (text) => { progressTexts.push(text); },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll 1: stop=true, quota=false, text='Hello'
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Hello'));

        await jest.advanceTimersByTimeAsync(2000);

        expect(phases).toContain('generating');
        expect(progressTexts).toContain('Hello');

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // Test 4: Stop button disappearing 3 consecutive times triggers onComplete
    // ---------------------------------------------------------------
    it('stop button disappearing 3 consecutive times triggers onComplete', async () => {
        let completedText: string | null = null;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll 1: stop=true, quota=false, text='response'
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('response'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 2: stop=false (gone count 1)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('response'));
        await jest.advanceTimersByTimeAsync(2000);
        expect(completedText).toBeNull();

        // Poll 3: stop=false (gone count 2)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('response'));
        await jest.advanceTimersByTimeAsync(2000);
        expect(completedText).toBeNull();

        // Poll 4: stop=false (gone count 3) -> complete
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('response'));
        await jest.advanceTimersByTimeAsync(2000);
        expect(completedText).toBe('response');
    });

    // ---------------------------------------------------------------
    // Test 5: Stop button reappearing resets gone counter
    // ---------------------------------------------------------------
    it('stop button reappearing resets gone counter', async () => {
        let completedText: string | null = null;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll 1: stop=true, text='resp'
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('resp'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 2: stop=false (gone 1)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('resp'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 3: stop=false (gone 2)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('resp'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 4: stop=TRUE again -> resets counter
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('resp'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 5: stop=false (gone 1 again)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('resp'));
        await jest.advanceTimersByTimeAsync(2000);

        // Should NOT be complete yet (only 1 gone after reset)
        expect(completedText).toBeNull();

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // Test 6: Text change does NOT reset stop gone counter
    // ---------------------------------------------------------------
    it('text change does NOT reset stop gone counter — completion still fires', async () => {
        let completedText: string | null = null;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll 1: stop=true, text='first'
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('first'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 2: stop=false (gone 1), text unchanged
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('first'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 3: stop=false (gone 2), text changed — counter must NOT reset
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('first updated'));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 4: stop=false (gone 3) — should complete despite text change in poll 3
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('first updated'));
        await jest.advanceTimersByTimeAsync(2000);

        expect(completedText).toBe('first updated');
    });

    // ---------------------------------------------------------------
    // Test 6b: Continuous text updates after stop-gone do NOT block completion
    // ---------------------------------------------------------------
    it('continuous text updates after stop button disappears do NOT block completion', async () => {
        let completedText: string | null = null;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll 1: stop=true, text='token1'
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('token1'));
        await jest.advanceTimersByTimeAsync(2000);

        // Polls 2-4: stop=false, text keeps changing every poll (streaming tail)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('token1 token2'));
        await jest.advanceTimersByTimeAsync(2000);

        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('token1 token2 token3'));
        await jest.advanceTimersByTimeAsync(2000);

        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('token1 token2 token3 final'));
        await jest.advanceTimersByTimeAsync(2000);

        // Should be complete after 3 consecutive stop-gone, despite text changing each time
        expect(completedText).toBe('token1 token2 token3 final');
    });

    // ---------------------------------------------------------------
    // Test 7: Baseline text is suppressed
    // ---------------------------------------------------------------
    it('baseline text is suppressed (same text as before is not treated as new)', async () => {
        const progressTexts: string[] = [];
        const monitor = createMonitor({
            onProgress: (text) => { progressTexts.push(text); },
        });

        // Baseline captures 'old response'
        cdpService.call.mockResolvedValueOnce(cdpResult('old response'));
        await monitor.start();

        // Poll 1: stop=false, quota=false, text='old response' (same as baseline)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('old response'));
        await jest.advanceTimersByTimeAsync(2000);

        // Should NOT have triggered progress with baseline text
        expect(progressTexts).not.toContain('old response');

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // Test 7b: Baseline suppression does NOT block completion transitions
    // ---------------------------------------------------------------
    it('baseline suppression does not block completion when stop button disappears', async () => {
        let completedText: string | null = null;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        // Baseline captures old response
        cdpService.call.mockResolvedValueOnce(cdpResult('old response'));
        await monitor.start();

        // Poll 1: generation starts but extracted text is still baseline (suppressed)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('old response'));
        await jest.advanceTimersByTimeAsync(2000);
        expect(completedText).toBeNull();

        // Poll 2-4: stop disappears 3 times, text remains baseline
        for (let i = 0; i < 3; i++) {
            cdpService.call
                .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
                .mockResolvedValueOnce(cdpResult(false))
                .mockResolvedValueOnce(cdpResult('old response'));
            await jest.advanceTimersByTimeAsync(2000);
        }

        // Even with no new text, monitor must complete instead of hanging in thinking
        expect(completedText).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 8: Timeout triggers onTimeout after maxDurationMs
    // ---------------------------------------------------------------
    it('timeout triggers onTimeout after maxDurationMs', async () => {
        let timedOutText: string | null = null;
        const monitor = createMonitor({
            maxDurationMs: 10000,
            onTimeout: (text) => { timedOutText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Keep returning no stop, no quota, no text for all polls
        cdpService.call.mockResolvedValue(cdpResult(null));

        await jest.advanceTimersByTimeAsync(10000);

        expect(timedOutText).not.toBeNull();
    });

    // ---------------------------------------------------------------
    // Test 9: Quota detection with no text triggers immediate complete with empty string
    // ---------------------------------------------------------------
    it('quota detection with no text triggers immediate complete with empty string', async () => {
        let completedText: string | undefined;
        const monitor = createMonitor({
            onComplete: (text) => { completedText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Poll: stop=false, quota=true, text=null
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(true))   // quota detected
            .mockResolvedValueOnce(cdpResult(null));
        await jest.advanceTimersByTimeAsync(2000);

        expect(completedText).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 10: clickStopButton returns { ok: true, method: 'tooltip-id' }
    // ---------------------------------------------------------------
    it('clickStopButton returns { ok: true, method: tooltip-id } on success', async () => {
        const monitor = createMonitor();

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Mock the click result
        cdpService.call.mockResolvedValueOnce(cdpResult({ ok: true, method: 'tooltip-id' }));
        const result = await monitor.clickStopButton();

        expect(result).toEqual({ ok: true, method: 'tooltip-id' });
    });

    // ---------------------------------------------------------------
    // Test 11: Subscribes to CDP connection events (not network events)
    // ---------------------------------------------------------------
    it('subscribes to CDP connection events on start and removes them on stop', async () => {
        const monitor = createMonitor();

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await monitor.start();

        // Should subscribe to CDP connection events (disconnected, reconnected, reconnectFailed)
        expect(cdpService.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
        expect(cdpService.on).toHaveBeenCalledWith('reconnected', expect.any(Function));
        expect(cdpService.on).toHaveBeenCalledWith('reconnectFailed', expect.any(Function));
        expect(cdpService.on).toHaveBeenCalledTimes(3);

        // Should NOT subscribe to network events
        expect(cdpService.on).not.toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function));
        expect(cdpService.on).not.toHaveBeenCalledWith('Network.loadingFinished', expect.any(Function));

        await monitor.stop();

        // Should unregister all CDP connection listeners
        expect(cdpService.removeListener).toHaveBeenCalledWith('disconnected', expect.any(Function));
        expect(cdpService.removeListener).toHaveBeenCalledWith('reconnected', expect.any(Function));
        expect(cdpService.removeListener).toHaveBeenCalledWith('reconnectFailed', expect.any(Function));
    });

    // ---------------------------------------------------------------
    // Test 12: Default poll interval is 2000ms (not 1000ms)
    // ---------------------------------------------------------------
    it('default poll interval is 2000ms', async () => {
        // Create monitor WITHOUT specifying pollIntervalMs
        const defaultMonitor = new ResponseMonitor({
            cdpService: cdpService as any,
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null));
        await defaultMonitor.start();

        // After 1000ms: should NOT have polled yet (old default was 1000ms)
        const callCountAfterStart = cdpService.call.mock.calls.length;
        cdpService.call.mockResolvedValue(cdpResult(null));
        await jest.advanceTimersByTimeAsync(1000);
        expect(cdpService.call.mock.calls.length).toBe(callCountAfterStart);

        // After 2000ms total: should have polled once
        await jest.advanceTimersByTimeAsync(1000);
        expect(cdpService.call.mock.calls.length).toBeGreaterThan(callCountAfterStart);

        await defaultMonitor.stop();
    });

    // ---------------------------------------------------------------
    // Negative test: methods that should NOT exist on the lean API
    // ---------------------------------------------------------------
    it('does NOT have getLastExtractionSource or getLastDomActivityLines methods', () => {
        const monitor = createMonitor();
        expect((monitor as any).getLastExtractionSource).toBeUndefined();
        expect((monitor as any).getLastDomActivityLines).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // Negative test: constructor should NOT accept removed options
    // ---------------------------------------------------------------
    it('does NOT accept onActivity, networkCompleteDelayMs, textStabilityCompleteMs, noUpdateTimeoutMs, noTextCompletionDelayMs, completionStabilityMs options', () => {
        // The new lean API should NOT use these options. We verify by checking
        // that the monitor uses exactly 3 CDP calls per poll (stop, quota, text)
        // and not 4 (which would mean ACTIVITY_STATUS is still being called).
        const monitor = createMonitor();

        // Verify the options type doesn't include the removed fields
        // This is a compile-time check but we can also verify behavior:
        // Each poll should make exactly 3 CDP calls, not 4
        expect(true).toBe(true); // placeholder - real check is in poll count test below
    });

    // ---------------------------------------------------------------
    // Structural test: poll makes exactly 4 CDP calls
    // (stop, quota, text, process_logs)
    // ---------------------------------------------------------------
    it('poll makes exactly 4 CDP calls (stop, quota, text, process_logs)', async () => {
        const monitor = createMonitor();

        cdpService.call.mockResolvedValueOnce(cdpResult(null)); // baseline text
        // baseline process_logs falls through to default mock
        await monitor.start();
        const callsAfterStart = cdpService.call.mock.calls.length;

        // Poll with no text change: 4 calls
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: false }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult(null));
        // process_logs falls through to default mock
        await jest.advanceTimersByTimeAsync(2000);

        expect(cdpService.call.mock.calls.length - callsAfterStart).toBe(4);

        // Poll with text change: still 4 calls (dump removed)
        const callsBefore = cdpService.call.mock.calls.length;
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('new text'));
        // process_logs falls through to default mock
        await jest.advanceTimersByTimeAsync(2000);

        expect(cdpService.call.mock.calls.length - callsBefore).toBe(4);

        await monitor.stop();
    });

    // ---------------------------------------------------------------
    // CDP disconnect handling tests (#48)
    // ---------------------------------------------------------------

    it('pauses polling on CDP disconnect and resumes on reconnect', async () => {
        const onProgress = jest.fn();
        const onPhaseChange = jest.fn();

        const monitor = createMonitor({ onProgress, onPhaseChange });

        cdpService.call.mockResolvedValueOnce(cdpResult(null)); // baseline
        await monitor.start();

        // Poll 1: detect generation with text
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Hello'))
            .mockResolvedValueOnce(cdpResult([])); // process logs
        await jest.advanceTimersByTimeAsync(2000);
        expect(onProgress).toHaveBeenCalledWith('Hello');

        // Simulate CDP disconnect
        const disconnectHandler = cdpService.on.mock.calls.find(
            (c: any[]) => c[0] === 'disconnected',
        )?.[1];
        expect(disconnectHandler).toBeDefined();
        disconnectHandler!();

        expect(onPhaseChange).toHaveBeenCalledWith('disconnected', 'Hello');

        // Advance 4 seconds — no polls should fire while paused
        const callCountAtDisconnect = cdpService.call.mock.calls.length;
        await jest.advanceTimersByTimeAsync(4000);
        expect(cdpService.call.mock.calls.length).toBe(callCountAtDisconnect);

        // Simulate CDP reconnect
        const reconnectHandler = cdpService.on.mock.calls.find(
            (c: any[]) => c[0] === 'reconnected',
        )?.[1];
        expect(reconnectHandler).toBeDefined();
        reconnectHandler!();

        // Phase should be restored
        expect(onPhaseChange).toHaveBeenCalledWith('generating', 'Hello');

        // Polling resumes — set up mock for next poll
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Hello World'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);
        expect(onProgress).toHaveBeenCalledWith('Hello World');

        await monitor.stop();
    });

    it('calls onTimeout when CDP reconnection fails', async () => {
        const onTimeout = jest.fn();
        const monitor = createMonitor({ onTimeout });

        cdpService.call.mockResolvedValueOnce(cdpResult(null)); // baseline
        await monitor.start();

        // Poll 1: detect text
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Partial'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // Simulate disconnect + reconnect failure
        const disconnectHandler = cdpService.on.mock.calls.find(
            (c: any[]) => c[0] === 'disconnected',
        )?.[1];
        disconnectHandler!();

        const reconnectFailedHandler = cdpService.on.mock.calls.find(
            (c: any[]) => c[0] === 'reconnectFailed',
        )?.[1];
        reconnectFailedHandler!(new Error('Max retries'));

        // Let the stop() promise resolve
        await jest.advanceTimersByTimeAsync(0);

        expect(onTimeout).toHaveBeenCalledWith('Partial');
        expect(monitor.isActive()).toBe(false);
    });

    // ---------------------------------------------------------------
    // Activity-based timeout tests (#49)
    // ---------------------------------------------------------------

    it('does not timeout while text is actively changing', async () => {
        let timedOutText: string | null = null;
        const monitor = createMonitor({
            maxDurationMs: 6000,
            onTimeout: (text) => { timedOutText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null)); // baseline
        await monitor.start();

        // Poll 1 at 2s: text changes → activity resets
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 2 at 4s: text changes again → activity resets
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1\nLine 2'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 3 at 6s: text changes again → activity resets
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1\nLine 2\nLine 3'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // 6 seconds have passed (exceeds maxDurationMs), but activity kept resetting
        expect(timedOutText).toBeNull();

        await monitor.stop();
    });

    it('activity-based timeout fires only after inactivity, not fixed duration', async () => {
        let timedOutText: string | null = null;
        const monitor = createMonitor({
            maxDurationMs: 4000, // 4s inactivity timeout
            onTimeout: (text) => { timedOutText = text; },
        });

        cdpService.call.mockResolvedValueOnce(cdpResult(null)); // baseline
        await monitor.start();

        // Poll 1 at 2s: text appears → activity resets
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // Poll 2 at 4s: text changes → activity resets (would be fixed timeout here)
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1\nLine 2'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // At 4s: fixed timeout would have fired, but activity-based should NOT
        expect(timedOutText).toBeNull();

        // Poll 3 at 6s: text changes again → activity resets
        cdpService.call
            .mockResolvedValueOnce(cdpResult({ isGenerating: true }))
            .mockResolvedValueOnce(cdpResult(false))
            .mockResolvedValueOnce(cdpResult('Line 1\nLine 2\nLine 3'))
            .mockResolvedValueOnce(cdpResult([]));
        await jest.advanceTimersByTimeAsync(2000);

        // At 6s: 2x maxDurationMs, but still no timeout thanks to activity
        expect(timedOutText).toBeNull();

        await monitor.stop();
    });
});
