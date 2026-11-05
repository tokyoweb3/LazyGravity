import { ResponseMonitor } from '../../src/services/responseMonitor';
import type { CdpService } from '../../src/services/cdpService';

describe('ResponseMonitor stop lifecycle', () => {
    /** Avoid real CDP traffic while exercising the public start and stop lifecycle. */
    function createMonitor(onStop: (reason: string) => Promise<void>) {
        const cdp = { on: jest.fn(), removeListener: jest.fn() } as unknown as CdpService;
        return new ResponseMonitor({ cdpService: cdp, initialBaselineText: null, initialSeenProcessLogKeys: [], onStop });
    }

    it('shares one awaited stop hook between concurrent callers and resets it on restart', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const onStop = jest.fn(() => gate);
        const monitor = createMonitor(onStop);
        await monitor.start();
        let finished = false;
        const stopping = monitor.stop();
        void stopping.then(() => { finished = true; });
        expect(monitor.stop()).toBe(stopping);
        await Promise.resolve();
        expect(onStop).toHaveBeenCalledTimes(1);
        expect(onStop).toHaveBeenCalledWith('stopped');
        expect(finished).toBe(false);
        release();
        await stopping;
        await monitor.startPassive();
        await monitor.stop('timeout');
        expect(onStop).toHaveBeenCalledTimes(2);
        expect(onStop).toHaveBeenLastCalledWith('timeout');
    });

    it('awaits persistence when stopping through the IDE stop button', async () => {
        let release!: () => void;
        const onStop = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const monitor = createMonitor(onStop);
        (monitor as any).evaluateAcrossContexts = jest.fn().mockResolvedValue({ value: { ok: true } });
        await monitor.start();
        let finished = false;
        const stopping = monitor.clickStopButton().then(result => { finished = true; return result; });
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(onStop).toHaveBeenCalledWith('stopped');
        expect(finished).toBe(false);
        release();
        expect(await stopping).toEqual({ ok: true });
    });
});
