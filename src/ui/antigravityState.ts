import { MODERN_QUESTION_PENDING_SCRIPT } from './antigravityQuestion';

/** DOM state shared by session routing and CDP diagnostics for Antigravity 2.6. */
export const MODERN_AGENT_STATE_SCRIPT = `(() => {
    const input = document.querySelector('[data-testid="agent-input-box"]');
    const newConversation = document.querySelector('[data-testid="extension-new-conversation"]');
    if (!input || !newConversation) return null;
    const breadcrumbs = Array.from(document.querySelectorAll('[data-testid="breadcrumb-segment"]'));
    const title = breadcrumbs.length > 1 ? (breadcrumbs[breadcrumbs.length - 1].textContent || '').trim() : '';
    const view = document.querySelector('[data-testid="conversation-view"]');
    const output = view?.querySelector('[data-testid="planner-response-text"]');
    const hasActiveChat = !!title || !!view?.querySelector('[data-testid="user-input-step"]');
    const waitingForUser = ${MODERN_QUESTION_PENDING_SCRIPT};
    const isGenerating = !waitingForUser && Array.from(input.querySelectorAll('button')).some(button =>
        /^(stop|stop generating|stop generation|cancel)$/i.test(button.getAttribute('aria-label') || '')
    );
    return {
        title: title || '(Untitled)', hasActiveChat, isGenerating, waitingForUser,
        panelFound: true,
        hasLoadingIndicator: !!view?.querySelector('[role="progressbar"], [class*="animate-spin"]'),
        hasRenderableContent: !!(output?.textContent || '').trim(),
        renderablePreview: [],
    };
})()`;

/** Click inside the agent frame so iframe-local coordinates never hit the editor. */
export const MODERN_NEW_CHAT_SCRIPT = `(async () => {
    const before = ${MODERN_AGENT_STATE_SCRIPT};
    if (!before) return { ok: false, error: 'Agent input not ready' };
    if (!before.hasActiveChat) return { ok: true };
    document.querySelector('[data-testid="extension-new-conversation"]').click();
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const state = ${MODERN_AGENT_STATE_SCRIPT};
        if (state && !state.hasActiveChat) return { ok: true };
    }
    return { ok: false, error: 'New conversation did not become ready' };
})()`;
