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
 * Build a script that activates an existing chat in the side panel by its title.
 * Uses broad selector fallbacks because Antigravity's DOM structure can vary across versions.
 */
function buildActivateChatByTitleScript(title: string): string {
    const safeTitle = JSON.stringify(title);
    return `(() => {
        const wantedRaw = ${safeTitle};
        const wanted = (wantedRaw || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        if (!wanted) return { ok: false, error: 'Empty target title' };

        const panel = document.querySelector('.antigravity-agent-side-panel') || document;
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
        const clickTarget = (el) => {
            const clickable = el.closest('button, [role="button"], a, li, [data-testid*="conversation"]') || el;
            if (!(clickable instanceof HTMLElement)) return false;
            clickable.click();
            return true;
        };

        const nodes = Array.from(panel.querySelectorAll('button, [role="button"], a, li, div, span'))
            .filter(isVisible);

        const exact = [];
        const includes = [];
        for (const node of nodes) {
            const text = normalize(node.textContent || '');
            if (!text) continue;
            if (text === wanted) {
                exact.push({ node, textLength: text.length });
            } else if (text.includes(wanted)) {
                includes.push({ node, textLength: text.length });
            }
        }

        const pick = (list) => {
            if (list.length === 0) return null;
            list.sort((a, b) => a.textLength - b.textLength);
            return list[0].node;
        };

        const target = pick(exact) || pick(includes);
        if (!target) return { ok: false, error: 'Chat title not found in side panel' };
        if (!clickTarget(target)) return { ok: false, error: 'Matched element is not clickable' };
        return { ok: true };
    })()`;
}

/**
 * Build a script that opens Past Conversations and selects a conversation by title.
 * This path is required for older chats that are not visible in the current side panel.
 */
function buildActivateViaPastConversationsScript(title: string): string {
    const safeTitle = JSON.stringify(title);
    return `(() => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const wantedRaw = ${safeTitle};
        const normalize = (text) => (text || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\\u2018\\u2019\\u201C\\u201D'"\`]/g, '')
            .replace(/\\s+/g, ' ')
            .trim();
        const normalizeLoose = (text) => normalize(text).replace(/[^a-z0-9\\u3040-\\u30ff\\u4e00-\\u9faf\\s]/g, '').replace(/\\s+/g, ' ').trim();

        const wanted = normalize(wantedRaw || '');
        const wantedLoose = normalizeLoose(wantedRaw || '');
        if (!wanted) return { ok: false, error: 'Empty target title' };

        const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
        const asArray = (nodeList) => Array.from(nodeList || []);
        const getLabelText = (el) => {
            if (!el || !(el instanceof Element)) return '';
            const parts = [
                el.textContent || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('title') || '',
                el.getAttribute('placeholder') || '',
                el.getAttribute('data-tooltip-content') || '',
                el.getAttribute('data-testid') || '',
            ];
            return parts.filter(Boolean).join(' ');
        };
        const getClickable = (el) => {
            if (!el || !(el instanceof Element)) return null;
            const clickable = el.closest('button, [role="button"], a, li, [role="option"], [data-testid*="conversation"]');
            return clickable instanceof HTMLElement ? clickable : (el instanceof HTMLElement ? el : null);
        };
        const pickBest = (elements, patterns) => {
            const matched = [];
            for (const el of elements) {
                if (!isVisible(el)) continue;
                const text = normalize(getLabelText(el));
                const textLoose = normalizeLoose(getLabelText(el));
                if (!text) continue;
                for (const pattern of patterns) {
                    if (!pattern) continue;
                    const p = normalize(pattern);
                    const pLoose = normalizeLoose(pattern);
                    if (
                        text === p ||
                        text.includes(p) ||
                        (pLoose && (textLoose === pLoose || textLoose.includes(pLoose)))
                    ) {
                        matched.push({ el, score: Math.abs(text.length - pattern.length) });
                        break;
                    }
                }
            }
            if (matched.length === 0) return null;
            matched.sort((a, b) => a.score - b.score);
            return matched[0].el;
        };
        const clickByPatterns = (patterns, selector) => {
            const nodes = asArray(document.querySelectorAll('button, [role="button"], a, li, div, span'));
            const scopedNodes = selector ? asArray(document.querySelectorAll(selector)) : [];
            const source = scopedNodes.length > 0 ? scopedNodes : nodes;
            const target = pickBest(source, patterns);
            const clickable = getClickable(target);
            if (!clickable) return false;
            clickable.click();
            return true;
        };
        const setInputValue = (el, value) => {
            if (!el) return false;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.focus();
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            if (el instanceof HTMLElement) {
                el.focus();
                if (el.isContentEditable) {
                    el.textContent = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
            return false;
        };
        const pressEnter = (el) => {
            if (!(el instanceof HTMLElement)) return;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        };
        const findSearchInput = () => {
            const inputs = asArray(document.querySelectorAll('input, textarea, [role="combobox"], [role="searchbox"], [contenteditable="true"]'));
            const strongPatterns = ['select a conversation', 'search conversation', 'search chats', 'search'];
            const placeholders = [];
            for (const el of inputs) {
                if (!isVisible(el)) continue;
                const placeholder = normalize(el.getAttribute('placeholder') || '');
                const ariaLabel = normalize(el.getAttribute('aria-label') || '');
                const text = normalize(getLabelText(el));
                const combined = [placeholder, ariaLabel, text].filter(Boolean).join(' ');
                placeholders.push({ el, combined });
            }
            for (const p of strongPatterns) {
                const found = placeholders.find((x) => x.combined.includes(p));
                if (found) return found.el;
            }
            return placeholders[0]?.el || null;
        };

        return (async () => {
            const opened = clickByPatterns([
                'past conversations',
                'past conversation',
                'conversation history',
                'past chats',
                '過去の会話',
                'chat history',
            ]);
            if (!opened) {
                return { ok: false, error: 'Past Conversations button not found' };
            }

            await wait(320);

            // In some UI states "Select a conversation" itself is a trigger.
            clickByPatterns(['select a conversation', 'select conversation', 'conversation'], '[role="button"], button, [aria-haspopup], [data-testid*="conversation"]');
            await wait(220);

            const input = findSearchInput();
            if (input) {
                setInputValue(input, wantedRaw);
                await wait(260);
            }

            let selected = clickByPatterns([wanted, wantedLoose], '[role="option"], li, button, [data-testid*="conversation"]');
            if (!selected && input) {
                pressEnter(input);
                await wait(220);
                selected = true;
            }
            if (!selected) {
                return { ok: false, error: 'Conversation not found in Past Conversations' };
            }
            return { ok: true };
        })();
    })()`;
}

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
     * Activate an existing chat by title.
     * Returns ok:false if the target chat cannot be located or verified.
     */
    async activateSessionByTitle(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string }> {
        if (!title || title.trim().length === 0) {
            return { ok: false, error: 'Session title is empty' };
        }

        const current = await this.getCurrentSessionInfo(cdpService);
        if (current.title.trim() === title.trim()) {
            return { ok: true };
        }

        let usedPastConversations = false;
        const directResult = await this.tryActivateByDirectSidePanel(cdpService, title);
        let clicked = directResult.ok;

        if (!clicked) {
            const pastResult = await this.tryActivateByPastConversations(cdpService, title);
            clicked = pastResult.ok;
            usedPastConversations = pastResult.ok;
        }

        if (!clicked) {
            return { ok: false, error: `Failed to activate session "${title}" (${directResult.error || 'direct search failed'})` };
        }

        // Wait briefly for DOM state transition and verify destination chat.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = await this.getCurrentSessionInfo(cdpService);
        if (after.title.trim() === title.trim()) {
            return { ok: true };
        }

        // If direct side-panel activation hit the wrong row, try the explicit Past Conversations flow.
        if (!usedPastConversations) {
            const viaPast = await this.tryActivateByPastConversations(cdpService, title);
            if (viaPast.ok) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                const afterPast = await this.getCurrentSessionInfo(cdpService);
                if (afterPast.title.trim() === title.trim()) {
                    return { ok: true };
                }
                return {
                    ok: false,
                    error: `Past Conversations selected a different chat (expected="${title}", actual="${afterPast.title}")`,
                };
            }
        }

        return {
            ok: false,
            error: `Activated chat did not match target title (expected="${title}", actual="${after.title}")`,
        };
    }

    private async tryActivateByDirectSidePanel(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string }> {
        return this.tryActivateWithScript(cdpService, buildActivateChatByTitleScript(title), false);
    }

    private async tryActivateByPastConversations(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string }> {
        return this.tryActivateWithScript(cdpService, buildActivateViaPastConversationsScript(title), true);
    }

    private async tryActivateWithScript(
        cdpService: CdpService,
        script: string,
        awaitPromise: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
        const contexts = cdpService.getContexts();
        let lastError = 'Activation script returned no match';
        for (const ctx of contexts) {
            try {
                const result = await cdpService.call('Runtime.evaluate', {
                    expression: script,
                    returnByValue: true,
                    awaitPromise,
                    contextId: ctx.id,
                });
                const value = result?.result?.value;
                if (value?.ok) {
                    return { ok: true };
                }
                if (value?.error && typeof value.error === 'string') {
                    lastError = value.error;
                }
            } catch (error: unknown) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }
        return { ok: false, error: lastError };
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
