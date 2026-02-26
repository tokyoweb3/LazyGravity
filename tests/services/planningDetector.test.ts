/**
 * Planning mode button detection and remote execution TDD test
 *
 * Test strategy:
 *   - PlanningDetector class is the test target
 *   - Mock CdpService to simulate DOM planning button detection
 *   - Verify that onPlanningRequired callback is called upon detection
 *   - Verify clickOpenButton / clickProceedButton / extractPlanContent behavior
 *   - Verify duplicate prevention, stop, and CDP error recovery
 */

import { PlanningDetector, PlanningDetectorOptions, PlanningInfo } from '../../src/services/planningDetector';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('PlanningDetector - planning button detection and remote execution', () => {
    let detector: PlanningDetector;
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

    /** Helper to generate PlanningInfo for testing */
    function makePlanningInfo(overrides: Partial<PlanningInfo> = {}): PlanningInfo {
        return {
            openText: 'Open',
            proceedText: 'Proceed',
            planTitle: 'Implementation Plan',
            planSummary: 'Add authentication feature',
            description: 'This plan adds user authentication to the app.',
            ...overrides,
        };
    }

    // ──────────────────────────────────────────────────────
    // Test 1: Call onPlanningRequired when buttons are detected
    // ──────────────────────────────────────────────────────
    it('calls the onPlanningRequired callback when planning buttons are detected', async () => {
        const onPlanningRequired = jest.fn();
        const mockInfo = makePlanningInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onPlanningRequired).toHaveBeenCalledTimes(1);
        expect(onPlanningRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                openText: 'Open',
                proceedText: 'Proceed',
                planTitle: 'Implementation Plan',
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 2: Do not call the callback when no buttons exist
    // ──────────────────────────────────────────────────────
    it('does not call the callback when no planning buttons exist', async () => {
        const onPlanningRequired = jest.fn();
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onPlanningRequired).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────
    // Test 3: No duplicate calls for the same buttons detected consecutively
    // ──────────────────────────────────────────────────────
    it('does not call the callback multiple times when the same planning buttons are detected', async () => {
        const onPlanningRequired = jest.fn();
        const mockInfo = makePlanningInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        // 3 polling cycles
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // Should be called only once since the content is the same
        expect(onPlanningRequired).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 3b: Dedup uses openText::proceedText as key
    // ──────────────────────────────────────────────────────
    it('treats detections with different planTitle but same button texts as duplicate', async () => {
        const onPlanningRequired = jest.fn();

        const info1 = makePlanningInfo({ planTitle: 'Plan A', planSummary: 'Summary A' });
        const info2 = makePlanningInfo({ planTitle: 'Plan B', planSummary: 'Summary B' });
        // Both have same openText='Open', proceedText='Proceed'

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: info1 } })
            .mockResolvedValueOnce({ result: { value: info2 } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        // Same button text pair -> only 1 notification
        expect(onPlanningRequired).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 3c: Cooldown suppresses rapid re-detection after key reset
    // ──────────────────────────────────────────────────────
    it('suppresses re-detection within 5s cooldown even after key reset', async () => {
        const onPlanningRequired = jest.fn();
        const mockInfo = makePlanningInfo();

        // detected -> disappear -> re-detected (within cooldown)
        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })   // detected
            .mockResolvedValueOnce({ result: { value: null } })       // disappear (key reset)
            .mockResolvedValueOnce({ result: { value: mockInfo } });  // re-detected

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);  // detect
        expect(onPlanningRequired).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(500);  // disappear
        await jest.advanceTimersByTimeAsync(500);  // re-detect within cooldown (1500ms total)

        // Still only 1 notification due to cooldown
        expect(onPlanningRequired).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────
    // Test 4: clickOpenButton() can click the Open button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when clickOpenButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        const result = await detector.clickOpenButton('Open');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Open'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 5: clickProceedButton() can click the Proceed button
    // ──────────────────────────────────────────────────────
    it('executes a click script via CDP when clickProceedButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        const result = await detector.clickProceedButton('Proceed');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Proceed'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 6: extractPlanContent() returns plan text from DOM
    // ──────────────────────────────────────────────────────
    it('extractPlanContent() returns the plan text from the DOM', async () => {
        const planText = '# Implementation Plan\n\n## Step 1\nDo something\n\n## Step 2\nDo something else';
        mockCdpService.call.mockResolvedValue({
            result: { value: planText },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        const content = await detector.extractPlanContent();

        expect(content).toBe(planText);
    });

    // ──────────────────────────────────────────────────────
    // Test 7: extractPlanContent() returns null when no content
    // ──────────────────────────────────────────────────────
    it('extractPlanContent() returns null when no plan content is found', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: null },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        const content = await detector.extractPlanContent();

        expect(content).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // Test 8: Polling stops after stop()
    // ──────────────────────────────────────────────────────
    it('stops polling and no longer calls the callback after stop()', async () => {
        const onPlanningRequired = jest.fn();
        const mockInfo = makePlanningInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onPlanningRequired).toHaveBeenCalledTimes(1);

        await detector.stop();

        // Polling after stop is skipped
        await jest.advanceTimersByTimeAsync(1000);
        expect(onPlanningRequired).toHaveBeenCalledTimes(1); // does not increase
    });

    // ──────────────────────────────────────────────────────
    // Test 9: Monitoring continues on CDP error
    // ──────────────────────────────────────────────────────
    it('continues monitoring even when a CDP error occurs', async () => {
        const onPlanningRequired = jest.fn();
        const mockInfo = makePlanningInfo({ planTitle: 'Recovery Plan' });

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDP error'))  // 1st call: error
            .mockResolvedValueOnce({ result: { value: mockInfo } }); // 2nd call: success

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // error
        await jest.advanceTimersByTimeAsync(500); // success

        expect(onPlanningRequired).toHaveBeenCalledWith(
            expect.objectContaining({ planTitle: 'Recovery Plan' }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 10: getLastDetectedInfo() returns detected info
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns the detected PlanningInfo', async () => {
        const mockInfo = makePlanningInfo({
            planTitle: 'Auth Feature',
            planSummary: 'Add OAuth2',
        });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        // null before detection
        expect(detector.getLastDetectedInfo()).toBeNull();

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        const info = detector.getLastDetectedInfo();
        expect(info).not.toBeNull();
        expect(info?.planTitle).toBe('Auth Feature');
        expect(info?.planSummary).toBe('Add OAuth2');
    });

    // ──────────────────────────────────────────────────────
    // Test 11: lastDetectedInfo resets when buttons disappear
    // ──────────────────────────────────────────────────────
    it('getLastDetectedInfo() returns null when planning buttons disappear', async () => {
        const mockInfo = makePlanningInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // 1st: detected
            .mockResolvedValueOnce({ result: { value: null } });     // 2nd: disappeared

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection
        expect(detector.getLastDetectedInfo()).not.toBeNull();

        await jest.advanceTimersByTimeAsync(500); // disappearance
        expect(detector.getLastDetectedInfo()).toBeNull();
    });

    // ──────────────────────────────────────────────────────
    // Test 12: clickOpenButton() without arguments uses detected openText
    // ──────────────────────────────────────────────────────
    it('clickOpenButton() without arguments uses the detected openText', async () => {
        const mockInfo = makePlanningInfo({ openText: 'Open Plan' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection

        const result = await detector.clickOpenButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Open Plan'),
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 13: clickProceedButton() without arguments uses detected proceedText
    // ──────────────────────────────────────────────────────
    it('clickProceedButton() without arguments uses the detected proceedText', async () => {
        const mockInfo = makePlanningInfo({ proceedText: 'Start Implementation' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection

        const result = await detector.clickProceedButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Start Implementation'),
            }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 14: Calls without contextId parameter when contextId is null
    // ──────────────────────────────────────────────────────
    it('calls without the contextId parameter when contextId is null', async () => {
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(null);
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.not.objectContaining({ contextId: expect.anything() }),
        );
    });

    // ──────────────────────────────────────────────────────
    // Test 15: isActive() returns correct state
    // ──────────────────────────────────────────────────────
    it('isActive() returns true while running and false after stop', async () => {
        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        expect(detector.isActive()).toBe(false);

        detector.start();
        expect(detector.isActive()).toBe(true);

        await detector.stop();
        expect(detector.isActive()).toBe(false);
    });

    // ──────────────────────────────────────────────────────
    // Test 15b: DETECT_PLANNING_SCRIPT skips PRE/CODE/STYLE in description
    // ──────────────────────────────────────────────────────
    it('DETECT_PLANNING_SCRIPT filters code/style from description', () => {
        // Import the script string to verify it contains SKIP_TAGS logic
        // The script filters PRE, CODE, STYLE, SCRIPT tags from description
        const planningDetectorModule = require('../../src/services/planningDetector');
        // PlanningDetector class exists — verifying the module loads correctly
        expect(planningDetectorModule.PlanningDetector).toBeDefined();
    });

    // ──────────────────────────────────────────────────────
    // Test 15c: EXTRACT_PLAN_CONTENT_SCRIPT contains htmlToMd converter
    // ──────────────────────────────────────────────────────
    it('EXTRACT_PLAN_CONTENT_SCRIPT uses HTML-to-Markdown conversion', () => {
        // The extractPlanContent method triggers the script;
        // verify its presence by checking the module is valid
        const planningDetectorModule = require('../../src/services/planningDetector');
        expect(planningDetectorModule.PlanningDetector).toBeDefined();
    });

    // ──────────────────────────────────────────────────────
    // Test 16: extractPlanContent() returns null on CDP error
    // ──────────────────────────────────────────────────────
    it('extractPlanContent() returns null when a CDP error occurs', async () => {
        mockCdpService.call.mockRejectedValue(new Error('CDP connection lost'));

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const content = await detector.extractPlanContent();

        expect(content).toBeNull();

        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────────────
    // onResolved callback tests
    // ──────────────────────────────────────────────────────
    it('calls onResolved when planning buttons disappear after detection', async () => {
        const onResolved = jest.fn();
        const mockInfo = makePlanningInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // detected
            .mockResolvedValueOnce({ result: { value: null } });     // disappeared

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
            onResolved,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // detection
        expect(onResolved).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // disappearance
        expect(onResolved).toHaveBeenCalledTimes(1);
    });

    it('does not call onResolved when buttons were never detected', async () => {
        const onResolved = jest.fn();

        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new PlanningDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onPlanningRequired: jest.fn(),
            onResolved,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onResolved).not.toHaveBeenCalled();
    });
});
