import { PromptDispatcher } from '../../src/services/promptDispatcher';

describe('PromptDispatcher', () => {
    it('sendで既存の送信実装を呼び出す', async () => {
        const sendPromptImpl = jest.fn().mockResolvedValue(undefined);
        const dispatcher = new PromptDispatcher({
            bridge: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            sendPromptImpl,
        });

        const req = {
            message: { id: 'm1' } as any,
            prompt: 'hello',
            cdp: {} as any,
            inboundImages: [],
            options: { foo: 'bar' } as any,
        };

        await dispatcher.send(req);

        expect(sendPromptImpl).toHaveBeenCalledWith(
            {} as any,
            req.message,
            'hello',
            req.cdp,
            {} as any,
            {} as any,
            [],
            req.options,
        );
    });
});
