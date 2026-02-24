/**
 * Step 6: AI response extraction and progress monitoring TDD test
 *
 * Test strategy:
 *   - ResponseMonitor class is the test target
 *   - Mock CdpService to test DOM text extraction and generation completion detection
 *   - Verify Discord message update (Edit) callback functionality
 *
 * Call order within poll():
 *   1. Stop button check (STOP_BUTTON)
 *   2. Quota error check (QUOTA_ERROR)
 *   3. Activity status retrieval (ACTIVITY_STATUS)
 *   4. Text retrieval (RESPONSE_TEXT)
 *
 * Calls during start():
 *   1. Baseline text retrieval (RESPONSE_TEXT)
 *
 * Completion detection priority (3-tier approach):
 *   1. Network.loadingFinished -> text stability wait -> complete
 *   2. Text stability (textStabilityCompleteMs) -> complete
 *   3. Update stop (noUpdateTimeoutMs) -> complete
 *   Existing stop button detection is also used in parallel
 */

import { ResponseMonitor, ResponseMonitorOptions, ResponsePhase } from '../../src/services/responseMonitor';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ResponseMonitor - AI response extraction and progress monitoring (Step 6)', () => {
    let monitor: ResponseMonitor;
    let mockCdpService: jest.Mocked<CdpService>;
    /** Capture listeners registered via on() */
    let eventListeners: Map<string, Function[]>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        eventListeners = new Map();

        // Mock EventEmitter on / removeListener
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

    /** Simulate firing a CDP event */
    function emitCdpEvent(event: string, params: any): void {
        const listeners = eventListeners.get(event) || [];
        for (const listener of listeners) {
            listener(params);
        }
    }

    /**
     * Test helper: batch-set 4 CDP calls per poll (stop button, quota, activity, text)
     */
    function mockPollResult(
        mock: jest.Mocked<CdpService>,
        isGenerating: boolean,
        text: string | null,
        activities: string[] = [],
        quotaReached: boolean = false,
    ) {
        mock.call
            .mockResolvedValueOnce({ result: { value: isGenerating } })    // stop button
            .mockResolvedValueOnce({ result: { value: quotaReached } })    // quota check
            .mockResolvedValueOnce({ result: { value: activities } })       // activity
            .mockResolvedValueOnce({ result: { value: text } });           // text
    }

    /**
     * Test helper: return poll result as DOM structure payload
     */
    function mockPollResultWithPayload(
        mock: jest.Mocked<CdpService>,
        isGenerating: boolean,
        payload: any,
        activities: string[] = [],
        quotaReached: boolean = false,
    ) {
        mock.call
            .mockResolvedValueOnce({ result: { value: isGenerating } })    // stop button
            .mockResolvedValueOnce({ result: { value: quotaReached } })    // quota check
            .mockResolvedValueOnce({ result: { value: activities } })       // activity
            .mockResolvedValueOnce({ result: { value: payload } });        // DOM payload
    }

    // ──────────────────────────────────────────────────────
    // Test 1: Incremental extraction of in-progress text
    // ──────────────────────────────────────────────────────
    it('incrementally extracts in-progress text and calls the onProgress callback', async () => {
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
    // Test 2: Do not call callback when text does not change
    // ──────────────────────────────────────────────────────
    it('does not redundantly call onProgress when text does not change', async () => {
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
    // Test 3: Generation completion detection (consecutive stop button disappearance)
    // ──────────────────────────────────────────────────────
    it('determines completion after confirming stop button disappearance 3 consecutive times', async () => {
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
    // Test 3b: Counter resets when stop button reappears
    // ──────────────────────────────────────────────────────
    it('resets the counter when stop button reappears after disappearing', async () => {
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
    // Test 4: Monitoring stops when stop() is called
    // ──────────────────────────────────────────────────────
    it('stops polling and no further callbacks are called after stop()', async () => {
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
    // Test 5: Stops on timeout
    // ──────────────────────────────────────────────────────
    it('auto-stops and calls onTimeout callback when maxDurationMs is exceeded', async () => {
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
    // Test 6: Monitoring continues even on CDP error
    // ──────────────────────────────────────────────────────
    it('continues monitoring even when CDP call throws an error', async () => {
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
    // Test 7: Phase change callback
    // ──────────────────────────────────────────────────────
    it('calls the onPhaseChange callback when the phase changes', async () => {
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
    // Test 8: Activity callback
    // ──────────────────────────────────────────────────────
    it('calls the onActivity callback when activity is detected', async () => {
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
    // Test 8b: Separate body/activity logs from DOM payload for notification
    // ──────────────────────────────────────────────────────
    it('notifies onProgress with body only and onActivity with thinking/tool only from DOM payload', async () => {
        const onProgress = jest.fn();
        const onActivity = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResultWithPayload(mockCdpService, true, {
            source: 'dom-structured',
            extractedAt: Date.now(),
            segments: [
                { kind: 'assistant-body', text: '最終回答本文です。', role: 'assistant', messageIndex: 1 },
                { kind: 'thinking', text: 'Analyzing requirement...', role: 'assistant', messageIndex: 1 },
                { kind: 'tool-call', text: 'jina-mcp-server / search_web', role: 'assistant', messageIndex: 1 },
                { kind: 'feedback', text: 'Good', role: 'assistant', messageIndex: 1 },
            ],
        });

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
            onActivity,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onProgress).toHaveBeenCalledWith('最終回答本文です。');
        expect(onActivity).toHaveBeenCalledWith([
            'Analyzing requirement...',
            'jina-mcp-server / search_web',
        ]);
    });

    // ──────────────────────────────────────────────────────
    // Test 8c: Identical DOM payload does not trigger duplicate notifications
    // ──────────────────────────────────────────────────────
    it('does not send duplicate notifications for body/activity logs when DOM payload is identical', async () => {
        const onProgress = jest.fn();
        const onActivity = jest.fn();

        const payload = {
            source: 'dom-structured',
            extractedAt: Date.now(),
            segments: [
                { kind: 'assistant-body', text: '重複しない本文', role: 'assistant', messageIndex: 1 },
                { kind: 'tool-result', text: 'Full output written to output.txt#L1-10', role: 'assistant', messageIndex: 1 },
            ],
        };

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResultWithPayload(mockCdpService, true, payload);
        mockPollResultWithPayload(mockCdpService, true, payload);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            onProgress,
            onActivity,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith('重複しない本文');
        expect(onActivity).toHaveBeenCalledTimes(1);
        expect(onActivity).toHaveBeenCalledWith(['Full output written to output.txt#L1-10']);
    });

    // ──────────────────────────────────────────────────────
    // Test 9: Stop button disappearance counter resets on text change
    // ──────────────────────────────────────────────────────
    it('resets the stop button disappearance counter when text changes', async () => {
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
    // Test 10: Remaining activity logs after stop do not prevent completion
    // ──────────────────────────────────────────────────────
    it('can transition to complete even when identical in-progress activities remain after stop button disappearance', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス');
        mockPollResult(mockCdpService, false, '最終レスポンス', ['Analyzing files...']);
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
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // Test 11: Non-progress text should not delay completion
    // ──────────────────────────────────────────────────────
    it('does not prevent completion when non-progress Japanese text contains activity-like characters', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, '最終レスポンス', []);
        mockPollResult(mockCdpService, false, '最終レスポンス', ['集中モードで完了しました']);
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
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onComplete).toHaveBeenCalledWith('最終レスポンス');
    });

    // ──────────────────────────────────────────────────────
    // Test 12: Good/Bad markers are not treated as completion signals
    // ──────────────────────────────────────────────────────
    it('does not complete until stop disappearance + stability time conditions are met even with Good/Bad markers', async () => {
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
    // Test 13: Complete when no updates for extended period despite false stop button detection
    // ──────────────────────────────────────────────────────
    it('transitions to complete when text updates stop for a certain period even while generating is still detected', async () => {
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
    // Test 14: Independent completion path based on text stability
    // Completes when text does not change for a certain period, independent of stop button detection
    // ──────────────────────────────────────────────────────
    it('completes independent of stop button when text does not change for textStabilityCompleteMs', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: stop button present + text -> generation started
        mockPollResult(mockCdpService, true, '安定テキスト');
        // poll2-5: stop button still present (assumed broken), no text change
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');
        mockPollResult(mockCdpService, true, '安定テキスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 1500,
            noUpdateTimeoutMs: 60000, // Set fallback far away
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500);  // poll1: text retrieved, lastTextChangeAt updated
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll2: 1000ms elapsed, still under 1500ms
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll3: 1500ms elapsed, may not be complete yet
        await jest.advanceTimersByTimeAsync(500);  // poll4: 2000ms elapsed -> definitely complete due to text stability
        expect(onComplete).toHaveBeenCalledWith('安定テキスト');
    });

    // ──────────────────────────────────────────────────────
    // Test 15: Text stability path resets on text update
    // ──────────────────────────────────────────────────────
    it('resets the text stability timer when text is updated', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        mockPollResult(mockCdpService, true, 'テキスト1');
        mockPollResult(mockCdpService, true, 'テキスト1');
        // Text update -> timer reset
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

        await jest.advanceTimersByTimeAsync(500);  // poll1: text1 retrieved
        await jest.advanceTimersByTimeAsync(500);  // poll2: 1000ms, stability time not yet reached
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll3: text2 -> timer reset
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);  // poll4: 500ms since text2, stability time not yet reached
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // Test 16: Completion path based on network completion detection
    // ──────────────────────────────────────────────────────
    it('completes as fast as possible when text stabilizes after Network.loadingFinished', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });
        // poll1: stop button present + text
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');
        // poll2: stop button present (assumed broken), no text change
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            networkCompleteDelayMs: 800,
            textStabilityCompleteMs: 0, // text stability path disabled
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        // Verify on() was called with Network.requestWillBeSent and Network.loadingFinished
        expect((mockCdpService as any).on).toHaveBeenCalledWith(
            'Network.requestWillBeSent',
            expect.any(Function),
        );
        expect((mockCdpService as any).on).toHaveBeenCalledWith(
            'Network.loadingFinished',
            expect.any(Function),
        );

        await jest.advanceTimersByTimeAsync(500); // poll1: text retrieved

        // Simulate network request start
        emitCdpEvent('Network.requestWillBeSent', {
            requestId: 'req-1',
            request: { url: 'https://api.example.com/api/chat/stream' },
        });

        // Simulate network completion
        emitCdpEvent('Network.loadingFinished', { requestId: 'req-1' });

        // networkCompleteDelayMs has not elapsed yet
        expect(onComplete).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // poll2: 500ms elapsed, still under 800ms
        expect(onComplete).not.toHaveBeenCalled();

        // Wait more -> 800ms exceeded -> complete
        mockPollResult(mockCdpService, true, 'ネットワーク完了テスト');
        await jest.advanceTimersByTimeAsync(500); // poll3: 1000ms elapsed -> complete
        expect(onComplete).toHaveBeenCalledWith('ネットワーク完了テスト');
    });

    // ──────────────────────────────────────────────────────
    // Test 17: Non-streaming URLs are not tracked
    // ──────────────────────────────────────────────────────
    it('does not track requests that do not match the streaming URL pattern', async () => {
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

        // Non-streaming URL -> not tracked
        emitCdpEvent('Network.requestWillBeSent', {
            requestId: 'req-static',
            request: { url: 'https://cdn.example.com/styles.css' },
        });
        emitCdpEvent('Network.loadingFinished', { requestId: 'req-static' });

        await jest.advanceTimersByTimeAsync(500);
        // Network completion signal was not fired, so it should not complete
        expect(onComplete).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // Test 18b: Activity detection infers generation start even without text extraction
    // ──────────────────────────────────────────────────────
    it('infers generation start from activity even without text and does not early-complete when stop is undetected', async () => {
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
        expect(onComplete).not.toHaveBeenCalled();
        expect(monitor.getPhase()).toBe('thinking');
    });

    // ──────────────────────────────────────────────────────
    // Task 5 failure test: Early complete when final body is extracted and activity is quiet, even without stop detection
    // ──────────────────────────────────────────────────────
    it('Task 5: completes without waiting 30s when DOM has final body and activity is quiet, even without stop button detection', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } });

        // poll1: stopなし / activityあり / textなし -> thinking
        mockPollResult(mockCdpService, false, null, ['Analyzed files']);

        // poll2: stopなし / activityなし / DOM抽出成功 (hasText=false相当のfallback)
        const payload = {
            source: 'dom-structured',
            extractedAt: Date.now(),
            segments: [{ kind: 'assistant-body', text: '最終本文です。', role: 'assistant', messageIndex: 1 }]
        };
        mockPollResultWithPayload(mockCdpService, false, payload, []);
        mockPollResultWithPayload(mockCdpService, false, payload, []);
        mockPollResultWithPayload(mockCdpService, false, payload, []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            noTextCompletionDelayMs: 15000,
            completionStabilityMs: 1500,
            textStabilityCompleteMs: 15000,
            noUpdateTimeoutMs: 30000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(500); // poll1
        await jest.advanceTimersByTimeAsync(500); // poll2: 本文抽出、activityなし
        await jest.advanceTimersByTimeAsync(500); // poll3
        await jest.advanceTimersByTimeAsync(500); // poll4

        // Wait a few more seconds (should complete in 2-3s, not 30s or 15s)
        await jest.advanceTimersByTimeAsync(2000);

        // Expected: complete via early finalize path even when stopButtonSeenOnce=false
        expect(onComplete).toHaveBeenCalledWith('最終本文です。');
    });

    // ──────────────────────────────────────────────────────
    // Test 18c: Stop-gone completion should not be overly delayed when body is not extracted
    // ──────────────────────────────────────────────────────
    it('does not complete via stop-gone path and delegates to no-update-timeout path when body is not extracted and stop is undetected', async () => {
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
        expect(onComplete).not.toHaveBeenCalled();
        expect(monitor.getPhase()).toBe('thinking');
    });

    // ──────────────────────────────────────────────────────
    // Test 18d: Complete via noTextCompletionDelay when body is not extracted and activity becomes quiet
    // ──────────────────────────────────────────────────────
    it('completes via noTextCompletionDelayMs when body is not extracted and activity disappears', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline

        // poll1-2: activityあり（生成中シグナル）
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 2 files']);
        // poll3-4: activity消失・本文未取得
        mockPollResult(mockCdpService, false, null, []);
        mockPollResult(mockCdpService, false, null, []);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            noTextCompletionDelayMs: 900,
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
        expect(monitor.getPhase()).toBe('complete');
    });

    // ──────────────────────────────────────────────────────
    // Test 18e: Complete via noTextCompletionDelay when body is not extracted and stale activity remains
    // ──────────────────────────────────────────────────────
    it('completes via noTextCompletionDelayMs when body is not extracted and stale activity remains (no updates)', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline

        // poll1: activityあり（生成開始）
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        // poll2-4: 同じactivityが残存（更新は無い）
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            noTextCompletionDelayMs: 1200,
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
        expect(monitor.getPhase()).toBe('complete');
    });

    // ──────────────────────────────────────────────────────
    // Test 18: Network listeners are removed on stop()
    // ──────────────────────────────────────────────────────
    it('removes network event listeners when stop() is called', async () => {
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
    // Test 19: Attach contextId to Runtime.evaluate when primary context exists
    // ──────────────────────────────────────────────────────
    it('attaches contextId to Runtime.evaluate when primary context exists', async () => {
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
    // Test 19b: Empty stop diagnostic object should still interpret isGenerating=false
    // ──────────────────────────────────────────────────────
    it('does not incorrectly treat as generating when stop diagnostic object is empty', async () => {
        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: { isGenerating: false, diagnostics: {} } } }) // stop
            .mockResolvedValueOnce({ result: { value: false } }) // quota
            .mockResolvedValueOnce({ result: { value: [] } }) // activity
            .mockResolvedValueOnce({ result: { value: null } }); // text

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
        });
        await monitor.start();
        await jest.advanceTimersByTimeAsync(500);

        expect(monitor.getPhase()).toBe('waiting');
    });

    // ──────────────────────────────────────────────────────
    // Test 20: Environments where stop button is never detected
    // ──────────────────────────────────────────────────────
    it('does not complete via stop-gone path when stop button is never detected', async () => {
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
            completionStabilityMs: 10000, // normally 10 seconds
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
        expect(onComplete).not.toHaveBeenCalled();
        expect(monitor.getPhase()).toBe('generating');
    });

    // ──────────────────────────────────────────────────────
    // Test 21: Do not incorrectly adopt baseline-identical text as initial progress
    // ──────────────────────────────────────────────────────
    it('suppresses baseline-identical text for a period and adopts progress only when different text arrives', async () => {
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
            stopButtonGoneConfirmCount: 99, // Prevent completion from triggering first
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
    // Test 22: No early completion while activity keeps changing in stop-undetected environment
    // ──────────────────────────────────────────────────────
    it('does not complete even when shortened stability conditions are met while activity updates continue with stop undetected', async () => {
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

    // ──────────────────────────────────────────────────────
    // Test 23: Do not complete via stop-button-gone when body is not extracted and stop is false-negative
    // ──────────────────────────────────────────────────────
    it('does not early-complete when stop=false is a false negative, activity exists, and body is not extracted', async () => {
        const onComplete = jest.fn();

        mockCdpService.call.mockResolvedValueOnce({ result: { value: null } }); // baseline
        mockPollResult(mockCdpService, false, null, ['Analyzed 1 file']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 2 files']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 3 files']);
        mockPollResult(mockCdpService, false, null, ['Analyzed 3 files']);

        monitor = new ResponseMonitor({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            stopButtonGoneConfirmCount: 1,
            noTextCompletionDelayMs: 500,
            completionStabilityMs: 500,
            textStabilityCompleteMs: 0,
            noUpdateTimeoutMs: 60000,
            onComplete,
        });
        await monitor.start();

        await jest.advanceTimersByTimeAsync(2000); // poll1-4

        expect(onComplete).not.toHaveBeenCalled();
        expect(monitor.getPhase()).toBe('thinking');
    });
});
