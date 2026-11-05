/** @jest-environment jsdom */
import { ChatSessionService } from '../../src/services/chatSessionService';
import { CdpService } from '../../src/services/cdpService';
import { MODERN_AGENT_STATE_SCRIPT } from '../../src/ui/antigravityState';

describe('Antigravity 2.6 session controls', () => {
    function mountActiveConversation(): void {
        document.body.innerHTML = `
            <span data-testid="breadcrumb-segment">TestProject</span>
            <span data-testid="breadcrumb-segment">Connection Test</span>
            <button data-testid="extension-new-conversation">New Conversation</button>
            <div data-testid="agent-input-box"><button aria-label="Stop"></button></div>
            <div data-testid="conversation-view">
                <div data-testid="user-input-step">Test prompt</div>
                <div data-testid="planner-response-text">LAZYGRAVITY_OK</div>
            </div>`;
    }

    function createCdp(): CdpService {
        return {
            getContexts: () => [{ id: -1, name: '', url: 'http://127.0.0.1:5049/?extensionView=true' }],
            call: jest.fn(async (_method: string, params: any) => ({
                result: { value: await window.eval(params.expression) },
            })),
        } as unknown as CdpService;
    }

    afterEach(() => { document.body.innerHTML = ''; });

    it('reads the conversation breadcrumb and detects active generation', () => {
        mountActiveConversation();
        expect(window.eval(MODERN_AGENT_STATE_SCRIPT)).toMatchObject({
            title: 'Connection Test', hasActiveChat: true, isGenerating: true, hasRenderableContent: true,
        });
    });

    it('returns the active conversation title through the session service', async () => {
        mountActiveConversation();
        expect(await new ChatSessionService().getCurrentSessionInfo(createCdp())).toEqual({
            title: 'Connection Test', hasActiveChat: true,
        });
    });

    it('starts a new conversation inside its frame and verifies the empty state', async () => {
        mountActiveConversation();
        const button = document.querySelector('[data-testid="extension-new-conversation"]')!;
        const click = jest.fn(() => {
            document.querySelectorAll('[data-testid="breadcrumb-segment"]')[1].remove();
            document.querySelector('[data-testid="conversation-view"]')!.remove();
        });
        button.addEventListener('click', click);
        expect(await new ChatSessionService().startNewChat(createCdp())).toEqual({ ok: true });
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('does not create another conversation when the agent is already empty', async () => {
        document.body.innerHTML = '<button data-testid="extension-new-conversation"></button><div data-testid="agent-input-box"></div>';
        const click = jest.fn();
        document.querySelector('button')!.addEventListener('click', click);
        expect(await new ChatSessionService().startNewChat(createCdp())).toEqual({ ok: true });
        expect(click).not.toHaveBeenCalled();
    });

    it('leaves legacy workbench pages to the legacy session implementation', () => {
        document.body.innerHTML = '<div class="antigravity-agent-side-panel">Agent</div>';
        expect(window.eval(MODERN_AGENT_STATE_SCRIPT)).toBeNull();
    });
});
