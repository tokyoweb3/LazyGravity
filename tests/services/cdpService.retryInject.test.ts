import { CdpService } from '../../src/services/cdpService';

describe('CdpService injection recovery', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('opens the chat panel and retries injection after a transient failure', async () => {
        const service = new CdpService() as any;
        jest.spyOn(service, 'isTransientInjectError').mockReturnValue(true);
        const findTarget = jest.spyOn(service, 'findWorkbenchTarget').mockResolvedValue({
            webSocketDebuggerUrl: 'ws://workbench',
        });
        const openPanel = jest.spyOn(service, 'openChatPanelViaKeyboard').mockResolvedValue(undefined);
        jest.spyOn(service, 'reconnectOnDemand').mockResolvedValue(undefined);
        jest.spyOn(service, 'waitForChatInputReady').mockResolvedValue({ ok: true, contextId: 7 });
        const inject = jest.spyOn(service, 'injectMessageCore').mockResolvedValue({ ok: true, method: 'enter' });

        const pending = service.retryInjectOnce('hello', 'WebSocket disconnected');
        await jest.runAllTimersAsync();

        await expect(pending).resolves.toEqual({ ok: true, method: 'enter' });
        expect(findTarget).toHaveBeenCalledTimes(1);
        expect(openPanel).toHaveBeenCalledWith('ws://workbench');
        expect(inject).toHaveBeenCalledWith('hello', undefined);
    });

    it('returns the readiness error without retrying injection when input stays unavailable', async () => {
        const service = new CdpService() as any;
        jest.spyOn(service, 'isTransientInjectError').mockReturnValue(false);
        const findTarget = jest.spyOn(service, 'findWorkbenchTarget');
        jest.spyOn(service, 'reconnectOnDemand').mockRejectedValue(new Error('offline'));
        jest.spyOn(service, 'waitForChatInputReady').mockResolvedValue({ ok: false, error: 'input unavailable' });
        const inject = jest.spyOn(service, 'injectMessageCore');

        const pending = service.retryInjectOnce('hello', 'input missing');
        await jest.runAllTimersAsync();

        await expect(pending).resolves.toEqual({ ok: false, error: 'input unavailable' });
        expect(findTarget).not.toHaveBeenCalled();
        expect(inject).not.toHaveBeenCalled();
    });
});
