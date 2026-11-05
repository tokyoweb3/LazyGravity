/** @jest-environment jsdom */
import { QuestionDetector, QuestionInfo } from '../../src/services/questionDetector';
import { CdpService } from '../../src/services/cdpService';
import { MODERN_QUESTION_SNAPSHOT_SCRIPT } from '../../src/ui/antigravityQuestion';
import { restoreQuestionDetector } from '../../src/services/cdpBridgeManager';
import Database from 'better-sqlite3';
import { TelegramBindingRepository } from '../../src/database/telegramBindingRepository';
import { createTelegramModelActionDeps } from '../../src/bot/telegramModelActions';
import { createQuestionSelectAction } from '../../src/handlers/questionSelectAction';
import { toTelegramPayload } from '../../src/platform/telegram/wrappers';
import { decodeSelectCallback } from '../../src/platform/telegram/selectCallbackData';

describe('Antigravity 2.6 question prompts', () => {
    let detector: QuestionDetector;
    let detected: jest.Mock;
    let submit: jest.Mock;
    let skip: jest.Mock;
    let cdp: CdpService;

    beforeEach(() => {
        document.body.innerHTML = `
            <button aria-label="Stop">Stop</button>
            <section id="question">
                <div><div data-testid="ask-question-header-text">Allow read access to this path?</div>
                    <p id="path">/projects/other/AGENTS.md</p></div>
                <label data-testid="ask-question-option"><input type="radio" name="choice" value="once">
                    <span data-testid="ask-question-shortcut-badge">1</span>
                    <span data-testid="ask-question-option-text">Yes, allow this time</span></label>
                <label data-testid="ask-question-option"><input type="radio" name="choice" value="conversation">
                    <span data-testid="ask-question-option-text">Yes, and always allow in this conversation</span></label>
                <label data-testid="ask-question-option"><input type="radio" name="choice" value="always">
                    <span data-testid="ask-question-option-text">Yes, and always allow</span></label>
                <label id="decline"><span data-testid="ask-question-writein-shortcut-badge">4</span>No
                    <textarea data-testid="ask-question-writein" placeholder="Tell the agent what to do instead"></textarea></label>
                <button data-testid="interaction-skip-button">Skip</button>
                <button data-testid="interaction-continue-button">Submit</button>
            </section>`;
        jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40, toJSON: () => ({}),
        });
        jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        detected = jest.fn();
        submit = jest.fn();
        skip = jest.fn();
        document.querySelector('[data-testid="interaction-continue-button"]')!.addEventListener('click', submit);
        document.querySelector('[data-testid="interaction-skip-button"]')!.addEventListener('click', skip);
        cdp = {
            isConnected: () => true,
            getContexts: () => [{ id: -3, name: '', url: 'http://127.0.0.1:5000/?extensionView=true' }],
            getPrimaryContextId: () => -3,
            call: jest.fn(async (_method: string, params: any) => ({ result: { value: await window.eval(params.expression) } })),
        } as unknown as CdpService;
        detector = new QuestionDetector({ cdpService: cdp, onQuestionRequired: detected });
        (detector as any)._isStarted = true;
    });

    afterEach(() => { detector.stop(); jest.restoreAllMocks(); document.body.innerHTML = ''; });

    async function poll(): Promise<QuestionInfo> {
        await (detector as any).poll();
        return detected.mock.calls.at(-1)?.[0];
    }

    it('restores and refreshes Telegram question tokens after model-session activation and answers on the saved account', async () => {
        document.body.insertAdjacentHTML('afterbegin', '<span data-testid="breadcrumb-segment">TestProject</span><span data-testid="breadcrumb-segment">Conversation A</span><button data-testid="extension-new-conversation"></button>');
        const db = new Database(':memory:');
        const repo = new TelegramBindingRepository(db);
        const chatId = '-1001234567890_7';
        repo.setSession(chatId, 'TestProject', 'Conversation A', 'personal');
        let recovered: QuestionDetector | undefined;
        const channel = { id: chatId, send: jest.fn().mockResolvedValue({ edit: jest.fn().mockResolvedValue(undefined) }) } as any;
        const bridge = { selectedAccountByChannel: new Map(), approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
            pool: { extractProjectName: () => 'TestProject', getOrConnect: jest.fn().mockResolvedValue(cdp),
                getQuestionDetector: (_project: string, account: string) => account === 'personal' ? recovered : undefined,
                registerQuestionDetector: (_project: string, value: QuestionDetector) => { recovered = value; },
            } } as any;
        (cdp as any).getUiModels = async () => ['Model A'];
        (cdp as any).getCurrentModel = async () => 'Model A';
        const modelDeps = createTelegramModelActionDeps({ bridge, telegramBindingRepo: repo,
            workspaceService: { getWorkspacePath: () => '/projects/TestProject' }, fetchQuota: async () => [],
            chatSessionService: { getCurrentSessionInfo: async () => ({ title: 'Conversation A', hasActiveChat: true }) } as any,
            antigravityAccounts: [{ name: 'default', cdpPort: 9222 }, { name: 'personal', cdpPort: 9223 }],
        });
        /** Run the model command's shared session-ready hook against the real question detector. */
        async function refreshControls(): Promise<void> {
            const connected = await modelDeps.resolveCdp!(chatId, 'operator');
            expect(connected).toBe(cdp);
            expect(await modelDeps.ensureSessionActivated!(chatId, 'operator', cdp)).toEqual({ ok: true });
            await modelDeps.onSessionReady!(channel, 'operator', cdp);
        }
        try {
            await refreshControls();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(channel.send).toHaveBeenCalledTimes(1);
            const old = toTelegramPayload(channel.send.mock.calls[0][0]).reply_markup!.inline_keyboard[0][0].callback_data;
            const now = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60 * 1000 + 1);
            expect(decodeSelectCallback(old)).toBe('expired');
            await refreshControls();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(channel.send).toHaveBeenCalledTimes(2);
            const fresh = toTelegramPayload(channel.send.mock.calls[1][0]).reply_markup!.inline_keyboard[0][0].callback_data;
            const selection = decodeSelectCallback(fresh);
            expect(selection).not.toBe('expired');
            if (!selection || selection === 'expired') throw new Error('Question token was not refreshed');
            const action = createQuestionSelectAction({ bridge, resolveAccountName: modelDeps.resolveAccountName,
                wsHandler: { getWorkspaceForChannel: () => '/projects/TestProject' } });
            expect(await action.execute({ channel, user: { id: 'operator' }, customId: selection.customId,
                deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
                followUp: jest.fn().mockResolvedValue(undefined) } as any, [selection.value])).toBe(true);
            expect(submit).toHaveBeenCalledTimes(1);
            expect(bridge.pool.getOrConnect).toHaveBeenCalledWith('/projects/TestProject', { name: 'personal' });
        } finally { recovered?.stop(); db.close(); }
    });

    it('restores a question after restart and answers the matching control without a duplicate notification', async () => {
        const info = await poll();
        let recovered: QuestionDetector | undefined;
        const channel = { id: 'channel', send: jest.fn().mockResolvedValue({ edit: jest.fn() }) } as any;
        const bridge = {
            pool: {
                getQuestionDetector: () => recovered,
                getConnected: jest.fn().mockReturnValue(null),
                extractProjectName: () => 'TestProject',
                getOrConnect: jest.fn().mockResolvedValue(cdp),
                registerQuestionDetector: (_project: string, value: QuestionDetector) => { recovered = value; },
            },
            approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
        } as any;
        try {
            const restored = await restoreQuestionDetector(bridge, 'TestProject', '/projects/TestProject', channel, info.questionId);
            expect(restored).toBe(recovered);
            expect(bridge.pool.getOrConnect).toHaveBeenCalledTimes(1);
            expect(channel.send).not.toHaveBeenCalled();
            expect(submit).not.toHaveBeenCalled();
            expect(await restored!.submitOption(0, info.questionId)).toBe(true);
            expect(submit).toHaveBeenCalledTimes(1);
        } finally { recovered?.stop(); }
    });

    it('rejects an old question identity after restoring a different pending question', async () => {
        const old = await poll();
        document.querySelector('#path')!.textContent = '/projects/other/README.md';
        let recovered: QuestionDetector | undefined;
        const channel = { id: 'channel', send: jest.fn().mockResolvedValue({ edit: jest.fn() }) } as any;
        const bridge = {
            pool: {
                getQuestionDetector: () => recovered, getConnected: () => cdp,
                registerQuestionDetector: (_project: string, value: QuestionDetector) => { recovered = value; },
            },
            approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
        } as any;
        try {
            const restored = await restoreQuestionDetector(bridge, 'TestProject', null, channel, old.questionId);
            expect(await restored!.submitOption(0, old.questionId)).toBe(false);
            expect(submit).not.toHaveBeenCalled();
        } finally { recovered?.stop(); }
    });

    it('notifies an identical future question after restoring an already-resolved control', async () => {
        const old = await poll();
        const question = document.querySelector('#question')!;
        question.setAttribute('hidden', '');
        let recovered: QuestionDetector | undefined;
        const channel = { id: 'channel', send: jest.fn().mockResolvedValue({ edit: jest.fn() }) } as any;
        const bridge = {
            pool: {
                getQuestionDetector: () => recovered, getConnected: () => cdp,
                registerQuestionDetector: (_project: string, value: QuestionDetector) => { recovered = value; },
            },
            approvalChannelByWorkspace: new Map(), approvalChannelBySession: new Map(),
        } as any;
        try {
            await restoreQuestionDetector(bridge, 'TestProject', null, channel, old.questionId);
            expect(channel.send).not.toHaveBeenCalled();
            question.removeAttribute('hidden');
            await recovered!.refresh();
            // Notification delivery follows the async chat-title lookup in the callback.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(channel.send).toHaveBeenCalledTimes(1);
            expect(submit).not.toHaveBeenCalled();
        } finally { recovered?.stop(); }
    });

    it('reads the path and all choices despite the write-in field and visible Stop control', async () => {
        const info = await poll();
        expect(info.title).toBe('Allow read access to this path?');
        expect(info.description).toBe('/projects/other/AGENTS.md');
        expect(info.options.map(option => option.text)).toEqual([
            'Yes, allow this time', 'Yes, and always allow in this conversation', 'Yes, and always allow', 'No',
        ]);
        expect(info.questionId).toMatch(/^[a-f0-9]{16}$/);
        expect(submit).not.toHaveBeenCalled();
        expect(skip).not.toHaveBeenCalled();
    });

    it('submits exactly the option explicitly chosen in Discord', async () => {
        const info = await poll();
        expect(await detector.submitOption(1, info.questionId)).toBe(true);
        expect((document.querySelector('input[value="conversation"]') as HTMLInputElement).checked).toBe(true);
        expect((document.querySelector('input[value="always"]') as HTMLInputElement).checked).toBe(false);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(await detector.submitOption(1, info.questionId)).toBe(false);
    });

    it('supports the No choice with its optional explanation input', async () => {
        const decline = jest.fn();
        document.querySelector('#decline')!.addEventListener('click', decline);
        const info = await poll();
        expect(await detector.submitOption(3, info.questionId)).toBe(true);
        expect(decline).toHaveBeenCalled();
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('skips only the matching question when requested', async () => {
        const info = await poll();
        expect(await detector.skipQuestion(info.questionId)).toBe(true);
        expect(skip).toHaveBeenCalledTimes(1);
        expect(submit).not.toHaveBeenCalled();
    });

    it('publishes a replacement question and rejects controls from the previous path', async () => {
        const first = await poll();
        document.querySelector('#path')!.textContent = '/projects/different/AGENTS.md';
        const second = await poll();
        expect(detected).toHaveBeenCalledTimes(2);
        expect(second.questionId).not.toBe(first.questionId);
        expect(await detector.submitOption(0, first.questionId)).toBe(false);
        expect(await detector.skipQuestion(first.questionId)).toBe(false);
        expect(submit).not.toHaveBeenCalled();
        expect(skip).not.toHaveBeenCalled();
    });

    it('rechecks the live prompt before clicking even when it changes between polls', async () => {
        const info = await poll();
        document.querySelector('#path')!.textContent = '/projects/different/AGENTS.md';
        expect(await detector.submitOption(0, info.questionId)).toBe(false);
        expect(submit).not.toHaveBeenCalled();
    });

    it('does not detect a hidden or resolved question from the conversation history', () => {
        document.querySelector('#question')!.setAttribute('hidden', '');
        expect(window.eval(MODERN_QUESTION_SNAPSHOT_SCRIPT)).toBeNull();
        document.querySelector('#question')!.removeAttribute('hidden');
        (document.querySelector('[data-testid="interaction-continue-button"]') as HTMLButtonElement).disabled = true;
        expect(window.eval(MODERN_QUESTION_SNAPSHOT_SCRIPT)).toBeNull();
    });
});
