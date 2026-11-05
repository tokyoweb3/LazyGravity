import { createTelegramModelActionDeps } from '../../src/bot/telegramModelActions';
import { createModelSelectAction } from '../../src/handlers/modelSelectAction';
import { createModelButtonAction } from '../../src/handlers/modelButtonAction';
import { handleTelegramCommand } from '../../src/bot/telegramCommands';
import { MODEL_SELECT_ID, MODEL_ACTIONS_SELECT_ID } from '../../src/ui/modelsUi';

jest.mock('../../src/services/cdpBridgeManager', () => ({
    ...jest.requireActual('../../src/services/cdpBridgeManager'),
    ensureQuestionDetector: jest.fn(),
    getCurrentChatTitle: jest.fn().mockResolvedValue('Conversation A'),
}));

describe('Telegram model workspace routing', () => {
    /** Keep workspace B globally active while the tested Telegram chat remains bound to A. */
    function setup() {
        const a = { setUiModel: jest.fn().mockResolvedValue({ ok: true, model: 'Model A' }),
            getUiModels: jest.fn().mockResolvedValue(['Model A']), getCurrentModel: jest.fn().mockResolvedValue('Model A') };
        const b = { setUiModel: jest.fn(), getUiModels: jest.fn(), getCurrentModel: jest.fn() };
        const bridge = { lastActiveWorkspace: 'B', selectedAccountByChannel: new Map(),
            approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
            pool: { getConnected: jest.fn().mockReturnValue(b), getOrConnect: jest.fn().mockResolvedValue(a),
                extractProjectName: jest.fn().mockReturnValue('A'), getQuestionDetector: jest.fn() } } as any;
        const deps = { bridge, fetchQuota: async () => [],
            telegramBindingRepo: {
                findByChatIdWithParentFallback: jest.fn().mockReturnValue({ workspacePath: 'A' }),
                findByChatId: jest.fn().mockReturnValue({ workspacePath: 'A', sessionTitle: 'Conversation A', accountName: 'personal' }),
            },
            workspaceService: { getWorkspacePath: jest.fn().mockReturnValue('/projects/A') },
            chatSessionService: {
                getCurrentSessionInfo: jest.fn().mockResolvedValue({ title: 'Conversation A', hasActiveChat: true }),
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: true }),
                refreshSessionViewIfStuck: jest.fn().mockResolvedValue({ ok: true }),
            },
            antigravityAccounts: [{ name: 'default', cdpPort: 9222 }, { name: 'personal', cdpPort: 9223 }],
        };
        const interaction = { customId: MODEL_SELECT_ID, channel: { id: '-100123_7' }, user: { id: 'operator' },
            deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined) } as any;
        return { a, b, bridge, deps, interaction, actionDeps: createTelegramModelActionDeps(deps) };
    }

    it.each([[MODEL_SELECT_ID, 'Model A'], [MODEL_ACTIONS_SELECT_ID, 'refresh']])(
        'routes %s through the chat binding and selected account', async (customId, value) => {
            const { a, b, bridge, deps, interaction, actionDeps } = setup();
            interaction.customId = customId;
            await createModelSelectAction(actionDeps).execute(interaction, [value]);
            expect(deps.telegramBindingRepo.findByChatIdWithParentFallback).toHaveBeenCalledWith('-100123_7');
            expect(bridge.pool.getOrConnect).toHaveBeenCalledWith('/projects/A', { name: 'personal' });
            expect(a.getUiModels).toHaveBeenCalled();
            expect(b.setUiModel).not.toHaveBeenCalled();
            expect(b.getUiModels).not.toHaveBeenCalled();
            expect(bridge.pool.getConnected).not.toHaveBeenCalled();
        },
    );

    it('activates the saved conversation before applying a model from a stale menu', async () => {
        const { a, deps, interaction, actionDeps } = setup();
        deps.chatSessionService.getCurrentSessionInfo.mockResolvedValue({ title: 'Another conversation', hasActiveChat: true });
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(deps.chatSessionService.activateSessionByTitle).toHaveBeenCalledWith(a, 'Conversation A', expect.any(Object));
        expect(deps.chatSessionService.activateSessionByTitle.mock.invocationCallOrder[0])
            .toBeLessThan(a.setUiModel.mock.invocationCallOrder[0]);
        expect(deps.chatSessionService.refreshSessionViewIfStuck).toHaveBeenCalledWith(a, 'Conversation A');
    });

    it('leaves the model unchanged when saved-session activation fails', async () => {
        const { a, deps, interaction, actionDeps } = setup();
        deps.chatSessionService.getCurrentSessionInfo.mockResolvedValue({ title: 'Another conversation', hasActiveChat: true });
        deps.chatSessionService.activateSessionByTitle.mockResolvedValue({ ok: false } as any);
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(a.setUiModel).not.toHaveBeenCalled();
        expect(a.getUiModels).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: expect.stringContaining('Failed to activate saved session') });
    });

    it('never falls back to the active workspace when the chat is unbound', async () => {
        const { a, b, bridge, deps, interaction, actionDeps } = setup();
        deps.telegramBindingRepo.findByChatIdWithParentFallback.mockReturnValue(undefined as any);
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(bridge.pool.getOrConnect).not.toHaveBeenCalled();
        expect(bridge.pool.getConnected).not.toHaveBeenCalled();
        expect(a.setUiModel).not.toHaveBeenCalled();
        expect(b.setUiModel).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Not connected to CDP.' });
    });

    it('reports unavailable connections to both model commands and menu actions', async () => {
        const { bridge, interaction, actionDeps } = setup();
        bridge.pool.getOrConnect.mockRejectedValue(new Error('IDE is closed'));
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(interaction.followUp).toHaveBeenCalledWith({ text: 'Not connected to CDP.' });
        const message = { channel: interaction.channel, author: interaction.user,
            reply: jest.fn().mockResolvedValue(undefined) } as any;
        await handleTelegramCommand({ bridge, modelActionDeps: actionDeps }, message, { command: 'model', args: '' });
        expect(message.reply).toHaveBeenCalledWith({ text: 'Not connected to Antigravity.' });
    });

    it('rejects a topic without persisted conversation identity', async () => {
        const { a, deps, interaction, actionDeps } = setup();
        deps.telegramBindingRepo.findByChatId.mockReturnValue({ workspacePath: 'A', sessionTitle: null, accountName: null } as any);
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(a.setUiModel).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: expect.stringContaining('Use /join or /new') });
    });

    it('requires a new binding when the operator explicitly switches the conversation account', async () => {
        const { a, bridge, interaction, actionDeps } = setup();
        bridge.selectedAccountByChannel.set(interaction.channel.id, 'default');
        await createModelSelectAction(actionDeps).execute(interaction, ['Model A']);
        expect(a.setUiModel).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith({ text: expect.stringContaining('another account') });
    });

    it('uses the same bound resolver for preexisting model buttons', async () => {
        const { a, b, interaction, actionDeps } = setup();
        await createModelButtonAction(actionDeps).execute(interaction, { action: 'select', modelName: 'Model A' });
        expect(a.setUiModel).toHaveBeenCalledWith('Model A');
        expect(b.setUiModel).not.toHaveBeenCalled();
    });

    it('reads the initial model menu from the same workspace as its later actions', async () => {
        const { a, b, bridge, actionDeps } = setup();
        const message = { channel: { id: '-100123_7' }, author: { id: 'operator' },
            reply: jest.fn().mockResolvedValue(undefined) } as any;
        await handleTelegramCommand({ bridge, modelActionDeps: actionDeps }, message, { command: 'model', args: '' });
        expect(a.getUiModels).toHaveBeenCalledTimes(1);
        expect(require('../../src/services/cdpBridgeManager').ensureQuestionDetector)
            .toHaveBeenCalledWith(bridge, a, 'A', 'personal');
        expect(b.getUiModels).not.toHaveBeenCalled();
        expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ richContent: expect.objectContaining({ title: 'Model Management' }) }));
    });
});
