import { PromptDispatcher } from '../../src/services/promptDispatcher';

describe('PromptDispatcher', () => {
    it('invokes the existing send implementation via send()', async () => {
        const sendPromptImpl = jest.fn().mockResolvedValue(undefined);
        const dispatcher = new PromptDispatcher({
            bridge: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            sendPromptImpl,
        });

        const req = {
            message: { channelId: 'c1', id: 'm1' } as any,
            prompt: 'hello',
            cdp: {} as any,
            inboundImages: [],
            options: {} as any,
        };

        await dispatcher.send(req);

        // We wrap the options inside _dispatch, so we match parts of options rather than exact object
        expect(sendPromptImpl).toHaveBeenCalledWith(
            {} as any,
            req.message,
            'hello',
            req.cdp,
            {} as any,
            {} as any,
            [],
            expect.objectContaining({
                onMonitorCreated: expect.any(Function),
                onFullCompletion: expect.any(Function),
            }),
        );
    });

    it('cancels the previous monitor on the same channel when a new prompt is dispatched', async () => {
        const mockMonitor1 = {
            stop: jest.fn().mockResolvedValue(undefined),
        };
        const mockMonitor2 = {
            stop: jest.fn().mockResolvedValue(undefined),
        };
        let callCount = 0;
        const sendPromptImpl = jest.fn().mockImplementation((_b, _m, _p, _c, _ms, _md, _img, opts) => {
            callCount++;
            // Simulate monitor creation
            opts.onMonitorCreated?.(callCount === 1 ? mockMonitor1 : mockMonitor2);
            return Promise.resolve();
        });

        const dispatcher = new PromptDispatcher({
            bridge: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            sendPromptImpl,
        });

        const req1 = {
            message: { channelId: 'c1', id: 'm1' } as any,
            prompt: 'hello',
            cdp: {} as any,
            inboundImages: [],
            options: {} as any,
        };

        const req2 = {
            message: { channelId: 'c1', id: 'm2' } as any,
            prompt: 'world',
            cdp: {} as any,
            inboundImages: [],
            options: {} as any,
        };

        // Dispatch first prompt
        await dispatcher.send(req1);
        expect(mockMonitor1.stop).not.toHaveBeenCalled();
        expect(mockMonitor2.stop).not.toHaveBeenCalled();

        // Dispatch second prompt on same channel
        await dispatcher.send(req2);
        expect(mockMonitor1.stop).toHaveBeenCalledTimes(1);
        expect(mockMonitor2.stop).not.toHaveBeenCalled();
    });
});
