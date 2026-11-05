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
    it.each([null, 'Model B'])('shows the correct saved-default action on the initial menu (%s)', async defaultModel => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const cdp = { getUiModels: async () => ['Model A', 'Model B'], getCurrentModel: async () => 'Model A' };
        await sendModelsUI(target, { getCurrentCdp: () => cdp as any, fetchQuota: async () => [],
            getDefaultModel: () => defaultModel });
        const payload = target.editReply.mock.calls[0][0];
        const modelOptions = payload.components[0].toJSON().components[0].options;
        const actions = payload.components[1].toJSON().components[0].options;
        expect(actions[1].value).toBe(defaultModel ? 'clear_default' : 'set_default');
        expect(modelOptions.find((option: any) => option.value === 'Model B').description)
            .toBe(defaultModel ? 'Default model' : undefined);
        expect(payload.embeds[0].data.description).toContain(defaultModel ?? 'Not set');
    });

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
        expect(result!.components.every(row => row.toJSON().components[0].type === 3)).toBe(true);
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

    it('includes Set Current as Default in the actions dropdown when no default', () => {
        const result = buildModelsPayload(['Model A'], 'Model A', [], null);
        const allButtons = result!.components!.flatMap(r => r.components);
        const actions = allButtons.find(b => b.customId === 'model_actions_select') as any;
        expect(actions.options).toContainEqual({ label: 'Set current model as default', value: 'set_default' });
    });

    it('includes Clear Default in the actions dropdown when default is set', () => {
        const result = buildModelsPayload(['Model A'], 'Model A', [], 'Model A');
        const allButtons = result!.components!.flatMap(r => r.components);
        const actions = allButtons.find(b => b.customId === 'model_actions_select') as any;
        expect(actions.options).toContainEqual({ label: 'Clear default model', value: 'clear_default' });
    });

    it('lists full model names and marks the current model in a dropdown', () => {
        const payload = buildModelsPayload(['Gemini 4 Argon High', 'Gemini 3.8 Flash Low'], 'Gemini 3.8 Flash Low', []);
        expect(payload!.components!.flatMap(row => row.components).every(component => component.type === 'selectMenu')).toBe(true);
        expect(payload!.components![0].components[0]).toMatchObject({ customId: 'model_select', options: [
            { label: 'Gemini 4 Argon High', value: 'Gemini 4 Argon High', isDefault: false },
            { label: 'Gemini 3.8 Flash Low', value: 'Gemini 3.8 Flash Low', isDefault: true },
        ] });
    });
});
