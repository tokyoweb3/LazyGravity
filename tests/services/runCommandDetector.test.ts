/**
 * Run command dialog detection and remote execution TDD test
 *
 * Test strategy:
 *   - RunCommandDetector class is the test target
 *   - Mock CdpService to simulate DOM run command dialog detection
 *   - Verify that onRunCommandRequired callback is called upon detection
 *   - Verify duplicate prevention, stop behavior, and button clicks
 */

import { RunCommandDetector, RunCommandDetectorOptions, RunCommandInfo } from '../../src/services/runCommandDetector';
import { CdpService } from '../../src/services/cdpService';

jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('RunCommandDetector - run command dialog detection and remote execution', () => {
    let detector: RunCommandDetector;
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

    function makeRunCommandInfo(overrides: Partial<RunCommandInfo> = {}): RunCommandInfo {
        return {
            commandText: 'python3 -m http.server 8000',
            workingDirectory: '~/Code/login',
            runText: 'Run',
            rejectText: 'Reject',
            ...overrides,
        };
    }

    it('calls the onRunCommandRequired callback when a run command dialog is detected', async () => {
        const onRunCommandRequired = jest.fn();
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onRunCommandRequired).toHaveBeenCalledTimes(1);
        expect(onRunCommandRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                commandText: 'python3 -m http.server 8000',
                workingDirectory: '~/Code/login',
                runText: 'Run',
                rejectText: 'Reject',
            }),
        );
    });

    it('does not call the callback when no run command dialog exists', async () => {
        const onRunCommandRequired = jest.fn();
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onRunCommandRequired).not.toHaveBeenCalled();
    });

    it('does not call the callback multiple times for the same command', async () => {
        const onRunCommandRequired = jest.fn();
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onRunCommandRequired).toHaveBeenCalledTimes(1);
    });

    it('calls callback again when a different command appears', async () => {
        const onRunCommandRequired = jest.fn();
        const info1 = makeRunCommandInfo({ commandText: 'npm install' });
        const info2 = makeRunCommandInfo({ commandText: 'npm test' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: info1 } })
            .mockResolvedValueOnce({ result: { value: info2 } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onRunCommandRequired).toHaveBeenCalledTimes(2);
        expect(onRunCommandRequired).toHaveBeenNthCalledWith(1, expect.objectContaining({ commandText: 'npm install' }));
        expect(onRunCommandRequired).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandText: 'npm test' }));
    });

    it('executes a click script via CDP when runButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });

        const result = await detector.runButton('Run');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Run'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    it('executes a reject click script via CDP when rejectButton() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });

        const result = await detector.rejectButton('Reject');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Reject'),
                returnByValue: true,
                contextId: 42,
            }),
        );
    });

    it('stops polling and no longer calls the callback after stop()', async () => {
        const onRunCommandRequired = jest.fn();
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onRunCommandRequired).toHaveBeenCalledTimes(1);

        await detector.stop();

        await jest.advanceTimersByTimeAsync(1000);
        expect(onRunCommandRequired).toHaveBeenCalledTimes(1);
    });

    it('continues monitoring even when a CDP error occurs', async () => {
        const onRunCommandRequired = jest.fn();
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call
            .mockRejectedValueOnce(new Error('CDP error'))
            .mockResolvedValueOnce({ result: { value: mockInfo } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // error
        await jest.advanceTimersByTimeAsync(500); // success

        expect(onRunCommandRequired).toHaveBeenCalledWith(
            expect.objectContaining({ commandText: 'python3 -m http.server 8000' }),
        );
    });

    it('getLastDetectedInfo() returns the detected RunCommandInfo', async () => {
        const mockInfo = makeRunCommandInfo({
            commandText: 'ls -la',
            workingDirectory: '~/projects',
        });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });

        expect(detector.getLastDetectedInfo()).toBeNull();

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        const info = detector.getLastDetectedInfo();
        expect(info).not.toBeNull();
        expect(info?.commandText).toBe('ls -la');
        expect(info?.workingDirectory).toBe('~/projects');
    });

    it('getLastDetectedInfo() returns null when the dialog disappears', async () => {
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: null } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(detector.getLastDetectedInfo()).not.toBeNull();

        await jest.advanceTimersByTimeAsync(500);
        expect(detector.getLastDetectedInfo()).toBeNull();
    });

    it('runButton() without arguments uses the detected runText', async () => {
        const mockInfo = makeRunCommandInfo({ runText: 'Execute' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        const result = await detector.runButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Execute'),
            }),
        );
    });

    it('rejectButton() without arguments uses the detected rejectText', async () => {
        const mockInfo = makeRunCommandInfo({ rejectText: 'Cancel' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        const result = await detector.rejectButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Cancel'),
            }),
        );
    });

    it('calls without the contextId parameter when contextId is null', async () => {
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(null);
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.not.objectContaining({ contextId: expect.anything() }),
        );
    });

    it('detects dialog with Accept/Reject buttons (alternative pattern)', async () => {
        const onRunCommandRequired = jest.fn();
        const mockInfo = makeRunCommandInfo({
            runText: 'Accept',
            rejectText: 'Reject',
        });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo },
        });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onRunCommandRequired).toHaveBeenCalledTimes(1);
        expect(onRunCommandRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                runText: 'Accept',
                rejectText: 'Reject',
            }),
        );

        // Verify the detection script itself contains the 'accept' pattern
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining("'accept'"),
            }),
        );
    });

    it('runButton() uses detected Accept text when dialog has Accept pattern', async () => {
        const mockInfo = makeRunCommandInfo({ runText: 'Accept' });

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: { ok: true } } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        const result = await detector.runButton();

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenLastCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Accept'),
            }),
        );
    });

    it('calls onResolved when dialog disappears after detection', async () => {
        const onResolved = jest.fn();
        const mockInfo = makeRunCommandInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })
            .mockResolvedValueOnce({ result: { value: null } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
            onResolved,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        expect(onResolved).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500);
        expect(onResolved).toHaveBeenCalledTimes(1);
    });

    it('does not call onResolved when dialog was never detected', async () => {
        const onResolved = jest.fn();

        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new RunCommandDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onRunCommandRequired: jest.fn(),
            onResolved,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onResolved).not.toHaveBeenCalled();
    });
});
