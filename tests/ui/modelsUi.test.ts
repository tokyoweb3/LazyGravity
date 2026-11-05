import { sendModelsUI, buildModelsUI, buildModelsPayload } from '../../src/ui/modelsUi';

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
    it('does not claim quota data was retrieved when it is unavailable', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };
        const result = await buildModelsUI(cdp as any, async () => []);
        expect(result!.embeds[0].data.footer?.text).toContain('quota information unavailable');
    });

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

describe('buildModelsPayload', () => {
    it('reports unavailable quotas accurately', () => {
        expect(buildModelsPayload(['Model A'], 'Model A', [])!.richContent!.footer).toContain('quota information unavailable');
        expect(buildModelsPayload(['Model A'], 'Model A', [{ label: 'Model A', quotaInfo: { remainingFraction: 0.5 } }])!.richContent!.footer)
            .toBe('Latest quota information retrieved');
    });

    it('returns null when no models are available', () => {
        const result = buildModelsPayload([], null, []);
        expect(result).toBeNull();
    });

    it('returns payload with components when models are available', () => {
        const result = buildModelsPayload(['Model A', 'Model B'], 'Model A', []);
        expect(result).not.toBeNull();
        expect(result!.components!.length).toBeGreaterThan(0);
    });

    it('shows "Not set" when no default model', () => {
        const result = buildModelsPayload(['Model A'], 'Model A', [], null);
        expect(result).not.toBeNull();
        expect(result!.richContent!.description).toContain('Not set');
    });

    it('shows default model name with star when default is set', () => {
        const result = buildModelsPayload(['Model A', 'Model B'], 'Model A', [], 'Model B');
        expect(result).not.toBeNull();
        expect(result!.richContent!.description).toContain('Model B');
    });

    it('includes Set Current as Default button when no default', () => {
        const result = buildModelsPayload(['Model A'], 'Model A', [], null);
        const allButtons = result!.components!.flatMap(r => r.components);
        const setBtn = allButtons.find(b => b.customId === 'model_set_default_btn');
        expect(setBtn).toBeDefined();
        expect((setBtn as any).label).toContain('Set Current as Default');
    });

    it('includes Clear Default button when default is set', () => {
        const result = buildModelsPayload(['Model A'], 'Model A', [], 'Model A');
        const allButtons = result!.components!.flatMap(r => r.components);
        const clearBtn = allButtons.find(b => b.customId === 'model_clear_default_btn');
        expect(clearBtn).toBeDefined();
        expect((clearBtn as any).label).toContain('Clear Default');
    });
});
