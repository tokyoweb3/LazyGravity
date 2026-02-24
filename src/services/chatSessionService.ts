import { CdpService } from './cdpService';

/** Chat session information */
export interface ChatSessionInfo {
    /** Current chat title (if available) */
    title: string;
    /** Whether an active chat exists */
    hasActiveChat: boolean;
}

/** Script to get the state of the new chat button */
const GET_NEW_CHAT_BUTTON_SCRIPT = `(() => {
    const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
    if (!btn) return { found: false };
    const cursor = window.getComputedStyle(btn).cursor;
    const rect = btn.getBoundingClientRect();
    return {
        found: true,
        enabled: cursor === 'pointer',
        cursor,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
    };
})()`;

/**
 * Script to get the chat title from the Cascade panel header.
 * The title element is a div with the text-ellipsis class inside the header.
 */
const GET_CHAT_TITLE_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel');
    if (!panel) return { title: '', hasActiveChat: false };
    const header = panel.querySelector('div[class*="border-b"]');
    if (!header) return { title: '', hasActiveChat: false };
    const titleEl = header.querySelector('div[class*="text-ellipsis"]');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    // "Agent" is the default empty chat title
    const hasActiveChat = title.length > 0 && title !== 'Agent';
    return { title: title || '(Untitled)', hasActiveChat };
})()`;

/**
 * Service for managing chat sessions on Antigravity via CDP.
 *
 * CDP dependencies are received as method arguments (connection pool compatible).
 */
export class ChatSessionService {
    /**
     * Start a new chat session in the Antigravity UI.
     *
     * Strategy:
     *   1. Check the state of the new chat button
     *   2. cursor: not-allowed -> already an empty chat (do nothing)
     *   3. cursor: pointer -> click via Input.dispatchMouseEvent coordinates
     *   4. Button not found -> error
     *
     * @param cdpService CdpService instance to use
     * @returns { ok: true } on success, { ok: false, error: string } on failure
     */
    async startNewChat(cdpService: CdpService): Promise<{ ok: boolean; error?: string }> {
        try {
            // Contexts may be empty right after Antigravity starts.
            // Wait up to 10 seconds for the cascade-panel to become ready.
            let contexts = cdpService.getContexts();
            if (contexts.length === 0) {
                const ready = await cdpService.waitForCascadePanelReady(10000, 500);
                if (!ready) {
                    return { ok: false, error: 'No contexts available (timed out)' };
                }
                contexts = cdpService.getContexts();
            }

            // Get button state (retry waiting for DOM load: up to 5 times, 1 second interval)
            let btnState = await this.getNewChatButtonState(cdpService, contexts);

            if (!btnState.found) {
                const maxRetries = 5;
                for (let i = 0; i < maxRetries && !btnState.found; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    contexts = cdpService.getContexts();
                    btnState = await this.getNewChatButtonState(cdpService, contexts);
                }
            }

            if (!btnState.found) {
                return { ok: false, error: 'New chat button not found' };
            }

            // cursor: not-allowed -> already an empty chat (no need to create new)
            if (!btnState.enabled) {
                return { ok: true };
            }

            // cursor: pointer -> click via CDP Input API coordinates
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: btnState.x, y: btnState.y,
            });
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: btnState.x, y: btnState.y,
                button: 'left', clickCount: 1,
            });
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: btnState.x, y: btnState.y,
                button: 'left', clickCount: 1,
            });

            // Wait for UI to update after click
            await new Promise(r => setTimeout(r, 1500));

            // Check if button changed to not-allowed (evidence that a new chat was opened)
            const afterState = await this.getNewChatButtonState(cdpService, contexts);
            if (afterState.found && !afterState.enabled) {
                return { ok: true };
            }

            // Button still enabled -> click may not have worked
            return { ok: false, error: 'Clicked new chat button but state did not change' };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: message };
        }
    }

    /**
     * Get the current chat session information.
     * @param cdpService CdpService instance to use
     * @returns Chat session information
     */
    async getCurrentSessionInfo(cdpService: CdpService): Promise<ChatSessionInfo> {
        try {
            const contexts = cdpService.getContexts();
            for (const ctx of contexts) {
                try {
                    const result = await cdpService.call('Runtime.evaluate', {
                        expression: GET_CHAT_TITLE_SCRIPT,
                        returnByValue: true,
                        contextId: ctx.id,
                    });
                    const value = result?.result?.value;
                    if (value && value.title) {
                        return {
                            title: value.title,
                            hasActiveChat: value.hasActiveChat ?? false,
                        };
                    }
                } catch (_) { /* try next context */ }
            }
            return { title: '(Failed to retrieve)', hasActiveChat: false };
        } catch (error) {
            return { title: '(Failed to retrieve)', hasActiveChat: false };
        }
    }

    /**
     * Get the state (enabled/disabled, coordinates) of the new chat button.
     */
    private async getNewChatButtonState(
        cdpService: CdpService,
        contexts: { id: number; name: string; url: string }[],
    ): Promise<{ found: boolean; enabled: boolean; x: number; y: number }> {
        for (const ctx of contexts) {
            try {
                const res = await cdpService.call('Runtime.evaluate', {
                    expression: GET_NEW_CHAT_BUTTON_SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id,
                });
                const value = res?.result?.value;
                if (value?.found) {
                    return { found: true, enabled: value.enabled, x: value.x, y: value.y };
                }
            } catch (_) { /* try next context */ }
        }
        return { found: false, enabled: false, x: 0, y: 0 };
    }
}
