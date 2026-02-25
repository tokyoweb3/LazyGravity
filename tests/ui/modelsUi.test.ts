import { sendModelsUI, buildModelsUI } from '../../src/ui/modelsUi';

describe('modelsUi', () => {
    it('returns a connection error message when not connected', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        await sendModelsUI(target, {
            getCurrentCdp: () => null,
            fetchQuota: async () => [],
        });

        expect(target.editReply).toHaveBeenCalledWith({ content: 'Not connected to CDP.' });
    });

    it('returns an Embed when models are available', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A', 'Model B']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        await sendModelsUI(target, {
            getCurrentCdp: () => cdp as any,
            fetchQuota: async () => [],
        });

        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });
});

describe('buildModelsUI', () => {
    it('returns null when no models are available', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue([]),
            getCurrentModel: jest.fn().mockResolvedValue(null),
        };

        const result = await buildModelsUI(cdp as any, async () => []);
        expect(result).toBeNull();
    });

    it('returns embeds and components when models are available', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A', 'Model B']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        const result = await buildModelsUI(cdp as any, async () => []);
        expect(result).not.toBeNull();
        expect(result!.embeds.length).toBeGreaterThan(0);
        expect(result!.components.length).toBeGreaterThan(0);
    });

    it('sendModelsUI delegates to buildModelsUI', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        await sendModelsUI(target, {
            getCurrentCdp: () => cdp as any,
            fetchQuota: async () => [],
        });

        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });
});
