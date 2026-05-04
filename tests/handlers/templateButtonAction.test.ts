import { createTemplateButtonAction } from '../../src/handlers/templateButtonAction';

jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    getCurrentCdp: jest.fn(),
}));

jest.mock('../../src/ui/templateUi', () => ({
    TEMPLATE_BTN_PREFIX: 'template_btn_',
    parseTemplateButtonId: jest.fn((customId: string) => {
        if (!customId.startsWith('template_btn_')) return NaN;
        return parseInt(customId.slice('template_btn_'.length), 10);
    }),
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

describe('createTemplateButtonAction', () => {
    const bridge = { 
        lastActiveWorkspace: null, 
        pool: { getConnected: jest.fn().mockReturnValue(null) },
        cdpHost: '127.0.0.1' 
    } as any;
    const templateRepo = {
        findById: jest.fn(),
        findAll: jest.fn().mockReturnValue([]),
    } as any;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('matches template_btn_<id> customId', () => {
        const action = createTemplateButtonAction({ bridge, templateRepo });
        expect(action.match('template_btn_42')).toEqual({ templateId: '42' });
    });

    it('does not match non-template customIds', () => {
        const action = createTemplateButtonAction({ bridge, templateRepo });
        expect(action.match('model_btn_test')).toBeNull();
    });

    it('does not match invalid template ID', () => {
        const action = createTemplateButtonAction({ bridge, templateRepo });
        expect(action.match('template_btn_')).toBeNull();
    });

    it('replies with error when template is not found', async () => {
        templateRepo.findById.mockReturnValue(null);
        const action = createTemplateButtonAction({ bridge, templateRepo });
        const interaction = createMockInteraction('template_btn_99');

        await action.execute(interaction as any, { templateId: '99' });

        expect(interaction.reply).toHaveBeenCalledWith({
            text: 'Template not found. It may have been deleted.',
        });
    });

    it('replies with error when CDP is not available', async () => {
        templateRepo.findById.mockReturnValue({ id: 1, name: 'Test', prompt: 'test prompt' });
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const action = createTemplateButtonAction({ bridge, templateRepo });
        const interaction = createMockInteraction('template_btn_1');

        await action.execute(interaction as any, { templateId: '1' });

        expect(interaction.deferUpdate).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({
            text: 'Not connected to Antigravity. Send the prompt as a message instead.',
        });
    });

    it('injects prompt and confirms on success', async () => {
        templateRepo.findById.mockReturnValue({ id: 1, name: 'Test Template', prompt: 'do something' });
        const mockCdp = { injectMessage: jest.fn().mockResolvedValue({ ok: true }) };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createTemplateButtonAction({ bridge, templateRepo });
        const interaction = createMockInteraction('template_btn_1');

        await action.execute(interaction as any, { templateId: '1' });

        expect(mockCdp.injectMessage).toHaveBeenCalledWith('do something');
        expect(interaction.followUp).toHaveBeenCalledWith({
            text: 'Executing template: Test Template',
        });
    });

    it('reports injection failure', async () => {
        templateRepo.findById.mockReturnValue({ id: 1, name: 'Test', prompt: 'test' });
        const mockCdp = { injectMessage: jest.fn().mockResolvedValue({ ok: false, error: 'CDP error' }) };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createTemplateButtonAction({ bridge, templateRepo });
        const interaction = createMockInteraction('template_btn_1');

        await action.execute(interaction as any, { templateId: '1' });

        expect(interaction.followUp).toHaveBeenCalledWith({
            text: 'Failed to execute template: CDP error',
        });
    });
});
