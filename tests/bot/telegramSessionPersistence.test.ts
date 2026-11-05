import Database from 'better-sqlite3';
import { TelegramBindingRepository } from '../../src/database/telegramBindingRepository';
import { handleTelegramJoinSelect } from '../../src/bot/telegramJoinCommand';
import { handleTelegramCommand } from '../../src/bot/telegramCommands';
import { createTelegramModelActionDeps } from '../../src/bot/telegramModelActions';
import { createModelSelectAction } from '../../src/handlers/modelSelectAction';
import { MODEL_SELECT_ID } from '../../src/ui/modelsUi';
import { createQuestionSelectAction } from '../../src/handlers/questionSelectAction';
import { createQuestionSkipAction } from '../../src/handlers/questionSkipAction';

jest.mock('../../src/services/cdpBridgeManager', () => ({
    ...jest.requireActual('../../src/services/cdpBridgeManager'),
    ensureQuestionDetector: jest.fn(), getCurrentChatTitle: jest.fn().mockResolvedValue(null),
}));

describe('persisted Telegram topic conversations', () => {
    let db: Database.Database;
    let repo: TelegramBindingRepository;
    beforeEach(() => { db = new Database(':memory:'); repo = new TelegramBindingRepository(db); repo.create({ chatId: '-100', workspacePath: 'project' }); });
    afterEach(() => { db.close(); });

    /** Use one IDE workspace with mutable active conversation state for multiple Telegram topics. */
    function setup() {
        let state = { title: 'Conversation B', hasActiveChat: true };
        const cdp = { getUiModels: jest.fn().mockResolvedValue(['Model A']), getCurrentModel: jest.fn().mockResolvedValue('Model A'),
            setUiModel: jest.fn(async () => ({ ok: true, model: state.title })) };
        const bridge = { selectedAccountByChannel: new Map(), approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
            pool: { getOrConnect: jest.fn().mockResolvedValue(cdp), extractProjectName: () => 'project', getQuestionDetector: jest.fn() } } as any;
        const service = { getCurrentSessionInfo: jest.fn(async () => state),
            activateSessionByTitle: jest.fn(async (_cdp: unknown, title: string) => { state = { title, hasActiveChat: true }; return { ok: true }; }),
            startNewChat: jest.fn(async () => { state = { title: '(Untitled)', hasActiveChat: false }; return { ok: true }; }),
            refreshSessionViewIfStuck: jest.fn().mockResolvedValue({ ok: true }),
        } as any;
        const deps = { bridge, telegramBindingRepo: repo, workspaceService: { getWorkspacePath: () => '/projects/project' } as any,
            chatSessionService: service, fetchQuota: async () => [], antigravityAccounts: [{ name: 'default', cdpPort: 9222 }] };
        return { cdp, service, deps };
    }

    /** Represent a Telegram topic control without involving the external Telegram API. */
    function interaction(chatId: string, title = 'Conversation A') {
        return { customId: MODEL_SELECT_ID, channel: { id: chatId }, user: { id: 'operator' }, values: [title],
            update: jest.fn().mockResolvedValue(undefined), deferUpdate: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined), followUp: jest.fn().mockResolvedValue(undefined) } as any;
    }

    it('restores the joined topic after another topic changes the IDE conversation and the repository is reopened', async () => {
        const { cdp, service, deps } = setup();
        await handleTelegramJoinSelect(deps, interaction('-100_7', 'Conversation A'));
        await handleTelegramJoinSelect(deps, interaction('-100_8', 'Conversation B'));
        expect(repo.findByChatId('-100_7')).toMatchObject({ sessionTitle: 'Conversation A', accountName: 'default' });
        const reopened = new TelegramBindingRepository(db);
        const modelDeps = createTelegramModelActionDeps({ ...deps, telegramBindingRepo: reopened });
        await createModelSelectAction(modelDeps).execute(interaction('-100_7'), ['Model A']);
        expect(service.activateSessionByTitle).toHaveBeenLastCalledWith(cdp, 'Conversation A', expect.any(Object));
        expect(cdp.setUiModel).toHaveLastReturnedWith(expect.any(Promise));
        expect(await cdp.setUiModel.mock.results.at(-1)!.value).toMatchObject({ model: 'Conversation A' });
    });

    it('persists a new empty conversation and rejects another topic\'s active conversation after a restart', async () => {
        const { cdp, deps } = setup();
        const message = { channel: { id: '-100_9' }, author: { id: 'operator' }, reply: jest.fn().mockResolvedValue(undefined) } as any;
        await handleTelegramCommand(deps, message, { command: 'new', args: '' });
        expect(repo.findByChatId('-100_9')).toMatchObject({ sessionTitle: '', accountName: 'default' });
        const modelDeps = createTelegramModelActionDeps({ ...deps, telegramBindingRepo: new TelegramBindingRepository(db) });
        await createModelSelectAction(modelDeps).execute(interaction('-100_9'), ['Model A']);
        expect(cdp.setUiModel).toHaveBeenCalledTimes(1);
        await handleTelegramJoinSelect(deps, interaction('-100_8', 'Conversation B'));
        const stale = interaction('-100_9');
        await createModelSelectAction(modelDeps).execute(stale, ['Model A']);
        expect(cdp.setUiModel).toHaveBeenCalledTimes(1);
        expect(stale.followUp).toHaveBeenCalledWith({ text: expect.stringContaining('no longer active') });
    });

    it.each(['answer', 'skip'])('restores the topic before an old question %s control can act', async kind => {
        const { service, deps } = setup();
        repo.setSession('-100_7', 'project', 'Conversation A', 'default');
        const modelDeps = createTelegramModelActionDeps(deps);
        const submit = jest.fn(async () => {
            expect(await service.getCurrentSessionInfo()).toMatchObject({ title: 'Conversation A' });
            return true;
        });
        deps.bridge.pool.getQuestionDetector.mockReturnValue({ submitOption: submit, skipQuestion: submit, refresh: async () => {} });
        const questionDeps = { bridge: deps.bridge, wsHandler: { getWorkspaceForChannel: () => '/projects/project' },
            prepareSession: modelDeps.prepareQuestionSession, resolveAccountName: modelDeps.resolveAccountName };
        const control = interaction('-100_7');
        control.customId = `question_${kind === 'answer' ? 'select' : 'skip'}_action:project:-100_7:0123456789abcdef`;
        const ok = kind === 'answer'
            ? await createQuestionSelectAction(questionDeps).execute(control, ['0'])
            : await createQuestionSkipAction(questionDeps).execute(control, {});
        expect(ok).toBe(true);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('never submits a question if its saved conversation cannot be restored', async () => {
        const { service, deps } = setup();
        repo.setSession('-100_7', 'project', 'Conversation A', 'default');
        service.activateSessionByTitle.mockResolvedValue({ ok: false, error: 'Conversation missing' });
        const modelDeps = createTelegramModelActionDeps(deps);
        const submit = jest.fn();
        deps.bridge.pool.getQuestionDetector.mockReturnValue({ submitOption: submit });
        const control = interaction('-100_7');
        control.customId = 'question_select_action:project:-100_7:0123456789abcdef';
        expect(await createQuestionSelectAction({ bridge: deps.bridge,
            wsHandler: { getWorkspaceForChannel: () => '/projects/project' }, prepareSession: modelDeps.prepareQuestionSession,
        }).execute(control, ['0'])).toBe(false);
        expect(submit).not.toHaveBeenCalled();
    });

    it.each(['new', 'join'])('keeps the saved account when /%s runs after restart', async command => {
        const { deps } = setup();
        repo.setSession('-100_7', 'project', 'Conversation A', 'personal');
        const shared = { ...deps, antigravityAccounts: [{ name: 'default', cdpPort: 9222 }, { name: 'personal', cdpPort: 9223 }] };
        const modelActionDeps = createTelegramModelActionDeps(shared);
        const configured = { ...shared, modelActionDeps };
        if (command === 'new') {
            await handleTelegramCommand(configured, { channel: { id: '-100_7' }, author: { id: 'operator' },
                reply: jest.fn().mockResolvedValue(undefined) } as any, { command: 'new', args: '' });
        } else {
            await handleTelegramJoinSelect(configured, interaction('-100_7', 'Conversation C'));
        }
        expect(deps.bridge.pool.getOrConnect).toHaveBeenCalledWith('/projects/project', { name: 'personal' });
        expect(repo.findByChatId('-100_7')?.accountName).toBe('personal');
    });
});
