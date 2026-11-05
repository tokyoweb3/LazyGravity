import { ResponseMonitor, RESPONSE_SELECTORS } from '../../src/services/responseMonitor';
import { CdpService } from '../../src/services/cdpService';

describe('ResponseMonitor user-input waits', () => {
    let waiting: boolean;
    let generating: boolean;
    let text: string | null;
    let cdp: CdpService;
    let monitor: ResponseMonitor;

    beforeEach(() => {
        jest.useFakeTimers();
        waiting = true;
        generating = false;
        text = null;
        cdp = {
            isConnected: () => true, getPrimaryContextId: () => -3, getContexts: () => [],
            on: jest.fn(), removeListener: jest.fn(),
            call: jest.fn(async (_method: string, params: any) => ({ result: { value:
                params.expression === RESPONSE_SELECTORS.STOP_BUTTON ? { isGenerating: generating, waitingForUser: waiting }
                    : params.expression === RESPONSE_SELECTORS.RESPONSE_TEXT ? text
                    : params.expression === RESPONSE_SELECTORS.PROCESS_LOGS ? ['.', '..', '...'] : false,
            } })),
        } as unknown as CdpService;
    });

    afterEach(async () => { await monitor?.stop(); jest.useRealTimers(); });

    it('shows waiting state without spinner logs or premature completion/timeout', async () => {
        const completed = jest.fn();
        const timedOut = jest.fn();
        const logs = jest.fn();
        monitor = new ResponseMonitor({ cdpService: cdp, extractionMode: 'legacy',
            initialBaselineText: null, initialSeenProcessLogKeys: [],
            onComplete: completed, onTimeout: timedOut, onProcessLog: logs });
        await monitor.start();
        await (monitor as any).poll();
        expect(monitor.getPhase()).toBe('waitingForUser');
        jest.setSystemTime(Date.now() + 21 * 60 * 1000);
        await (monitor as any).poll();
        expect(completed).not.toHaveBeenCalled();
        expect(timedOut).not.toHaveBeenCalled();
        expect(logs).toHaveBeenCalledTimes(1);
        expect(logs).toHaveBeenCalledWith(expect.stringContaining('Choose an option'));
        expect((cdp.call as jest.Mock).mock.calls.some(([, params]) => params.expression === RESPONSE_SELECTORS.PROCESS_LOGS)).toBe(false);
    });

    it('resumes generation and completes after an answer, excluding the user wait from the hard timeout', async () => {
        const completed = jest.fn();
        const timedOut = jest.fn();
        monitor = new ResponseMonitor({ cdpService: cdp, extractionMode: 'legacy', stopGoneConfirmCount: 2,
            initialBaselineText: null, initialSeenProcessLogKeys: [], onComplete: completed, onTimeout: timedOut });
        await monitor.start();
        await (monitor as any).poll();
        jest.setSystemTime(Date.now() + 21 * 60 * 1000);
        waiting = false;
        generating = true;
        text = 'Resumed response';
        await (monitor as any).poll();
        expect(monitor.getPhase()).toBe('generating');
        expect(timedOut).not.toHaveBeenCalled();
        generating = false;
        await (monitor as any).poll();
        await (monitor as any).poll();
        expect(completed).toHaveBeenCalledWith('Resumed response', [], []);
        expect(timedOut).not.toHaveBeenCalled();
    });

    it('does not forward animated dot placeholders as process log details', async () => {
        const logs = jest.fn();
        waiting = false;
        generating = true;
        monitor = new ResponseMonitor({ cdpService: cdp, extractionMode: 'legacy',
            initialBaselineText: null, initialSeenProcessLogKeys: [], onProcessLog: logs });
        await monitor.start();
        await (monitor as any).poll();
        expect(logs).not.toHaveBeenCalled();
    });
});
