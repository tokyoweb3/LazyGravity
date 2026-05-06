import { createModelButtonAction } from '../../src/handlers/modelButtonAction';

jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    getCurrentCdp: jest.fn(),
}));

jest.mock('../../src/ui/modelsUi', () => ({
    buildModelsPayload: jest.fn().mockReturnValue({ richContent: { title: 'Models' }, components: [] }),
}));

import { getCurrentCdp } from '../../src/services/cdpBridgeManager';

function createMockInteraction(customId: string) {
    return {
        id: 'int-1',
        platform: 'telegram' as const,
        customId,
        user: { id: 'user-1', platform: 'telegram' as const, username: 'test', isBot: false },
        channel: { id: 'ch-1', platform: 'telegram' as const, send: jest.fn() },
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({ id: '2', platform: 'telegram', channelId: 'ch-1', edit: jest.fn(), delete: jest.fn() }),
    };
}

describe('createModelButtonAction', () => {
    const bridge = { 
        lastActiveWorkspace: null, 
        pool: { getConnected: jest.fn().mockReturnValue(null) },
        cdpHost: '127.0.0.1' 
    } as any;
    const fetchQuota = jest.fn().mockResolvedValue([]);

    it('matches model_btn_<name> customId', () => {
        const action = createModelButtonAction({ bridge, fetchQuota });
        expect(action.match('model_btn_gpt-4')).toEqual({ action: 'select', modelName: 'gpt-4' });
    });

    it('matches model_refresh_btn customId', () => {
        const action = createModelButtonAction({ bridge, fetchQuota });
        expect(action.match('model_refresh_btn')).toEqual({ action: 'refresh' });
    });

    it('matches model_set_default_btn customId', () => {
        const action = createModelButtonAction({ bridge, fetchQuota });
        expect(action.match('model_set_default_btn')).toEqual({ action: 'set_default' });
    });

    it('matches model_clear_default_btn customId', () => {
        const action = createModelButtonAction({ bridge, fetchQuota });
        expect(action.match('model_clear_default_btn')).toEqual({ action: 'clear_default' });
    });

    it('does not match unrelated customIds', () => {
        const action = createModelButtonAction({ bridge, fetchQuota });
        expect(action.match('autoaccept_btn_on')).toBeNull();
    });

    it('reports error when CDP is not available', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const action = createModelButtonAction({ bridge, fetchQuota });
        const interaction = createMockInteraction('model_btn_test');

        await action.execute(interaction as any, { action: 'select', modelName: 'test' });

        expect(interaction.deferUpdate).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Not connected to CDP.' });
    });

    it('changes model and refreshes UI on select', async () => {
        const mockCdp = {
            setUiModel: jest.fn().mockResolvedValue({ ok: true, model: 'new-model' }),
            getUiModels: jest.fn().mockResolvedValue(['model-a', 'model-b']),
            getCurrentModel: jest.fn().mockResolvedValue('model-b'),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createModelButtonAction({ bridge, fetchQuota });
        const interaction = createMockInteraction('model_btn_new-model');

        await action.execute(interaction as any, { action: 'select', modelName: 'new-model' });

        expect(mockCdp.setUiModel).toHaveBeenCalledWith('new-model');
        expect(interaction.update).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Model changed to new-model.' });
    });

    it('refreshes UI without changing model on refresh action', async () => {
        const mockCdp = {
            getUiModels: jest.fn().mockResolvedValue(['model-a']),
            getCurrentModel: jest.fn().mockResolvedValue('model-a'),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createModelButtonAction({ bridge, fetchQuota });
        const interaction = createMockInteraction('model_refresh_btn');

        await action.execute(interaction as any, { action: 'refresh' });

        expect(interaction.update).toHaveBeenCalled();
    });

    it('sets current model as default on set_default action', async () => {
        const mockCdp = {
            getCurrentModel: jest.fn().mockResolvedValue('active-model'),
            getUiModels: jest.fn().mockResolvedValue(['active-model']),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);

        const mockModelService = {
            setDefaultModel: jest.fn(),
            getDefaultModel: jest.fn().mockReturnValue('active-model'),
        };
        const mockUserPrefRepo = { setDefaultModel: jest.fn() };

        const action = createModelButtonAction({
            bridge,
            fetchQuota,
            modelService: mockModelService as any,
            userPrefRepo: mockUserPrefRepo as any,
        });
        const interaction = createMockInteraction('model_set_default_btn');

        await action.execute(interaction as any, { action: 'set_default' });

        expect(mockModelService.setDefaultModel).toHaveBeenCalledWith('active-model');
        expect(mockUserPrefRepo.setDefaultModel).toHaveBeenCalledWith('user-1', 'active-model');
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Default model set to active-model.' });
    });

    it('clears default model on clear_default action', async () => {
        const mockCdp = {
            getCurrentModel: jest.fn().mockResolvedValue('some-model'),
            getUiModels: jest.fn().mockResolvedValue(['some-model']),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);

        const mockModelService = {
            setDefaultModel: jest.fn(),
            getDefaultModel: jest.fn().mockReturnValue(null),
        };
        const mockUserPrefRepo = { setDefaultModel: jest.fn() };

        const action = createModelButtonAction({
            bridge,
            fetchQuota,
            modelService: mockModelService as any,
            userPrefRepo: mockUserPrefRepo as any,
        });
        const interaction = createMockInteraction('model_clear_default_btn');

        await action.execute(interaction as any, { action: 'clear_default' });

        expect(mockModelService.setDefaultModel).toHaveBeenCalledWith(null);
        expect(mockUserPrefRepo.setDefaultModel).toHaveBeenCalledWith('user-1', null);
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Default model cleared.' });
    });
});
