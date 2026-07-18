import { CdpService } from './cdpService';
import { logger } from '../utils/logger';

/** Session list item from the side panel */
export interface SessionListItem {
    /** Conversation title */
    title: string;
    /** Whether this is the currently active session */
    isActive: boolean;
}

/** Chat session information */
export interface ChatSessionInfo {
    /** Current chat title (if available) */
    title: string;
    /** Whether an active chat exists */
    hasActiveChat: boolean;
}

/**
 * Representation of the chat panel session view state diagnostics.
 */
interface SessionViewState extends ChatSessionInfo {
    /** If the agent side panel container element was located in DOM. */
    panelFound?: boolean;
    /** If a loading/progress spinner is active. */
    hasLoadingIndicator: boolean;
    /** If actual assistant text messages exist. */
    hasRenderableContent: boolean;
    /** Scraped content text summary pieces. */
    renderablePreview?: Array<{
        /** Text element tag name. */
        tag: string;
        /** Text element class names. */
        className: string;
        /** Preview snippet text. */
        text: string;
    }>;
}

/** Shared fuzzy-matching logic for in-page scripts */
const FUZZY_MATCH_HELPERS_SCRIPT = `
    const getWords = (str) => {
        return (str || '').toLowerCase()
            .replace(/[^a-z0-9\\u3040-\\u30ff\\u4e00-\\u9faf\\s]/g, '')
            .split(/\\s+/)
            .filter(w => w.length > 1 && !/^(ago|wks?|days?|mins?|hours?|hrs?|secs?|weeks?|months?|years?)$/i.test(w));
    };
    const wordsMatch = (t, p) => {
        const tWords = getWords(t);
        const pWords = getWords(p);
        if (pWords.length === 0) return false;
        return pWords.every(pw => tWords.some(tw => tw === pw));
    };
`;

/** Script to get the state of the new chat button */
const GET_NEW_CHAT_BUTTON_SCRIPT = `(() => {
    const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
    if (!btn) return { found: false };
    const cursor = window.getComputedStyle(btn).cursor;
    if (typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
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
    const panel = document.querySelector('.antigravity-agent-side-panel') || document.body;
    if (!panel) return { title: '', hasActiveChat: false };
    const header = panel.querySelector('div[class*="border-b"]');
    if (!header) return { title: '', hasActiveChat: false };
    const titleEl = header.querySelector('div[class*="text-ellipsis"]');
    let title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title || title === 'Agent') {
        const activeRow = Array.from(panel.querySelectorAll('div[class*="focusBackground"]'))
            .find((el) => el instanceof HTMLElement && el.offsetParent !== null);
        const activeTitle = activeRow?.querySelector('span.text-sm span, span.text-sm');
        const activeText = activeTitle ? (activeTitle.textContent || '').trim() : '';
        if (activeText) title = activeText;
    }
    // "Agent" is the default empty chat title
    const hasActiveChat = title.length > 0 && title !== 'Agent';
    return { title: title || '(Untitled)', hasActiveChat };
})()`;

const GET_SESSION_VIEW_STATE_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel') || document.body;
    if (!panel) {
        return {
            panelFound: false,
            title: '',
            hasActiveChat: false,
            hasLoadingIndicator: false,
            hasRenderableContent: false,
            renderablePreview: [],
        };
    }
    const header = panel.querySelector('div[class*="border-b"]');
    const titleEl = header?.querySelector('div[class*="text-ellipsis"]');
    let title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title || title === 'Agent') {
        const activeRow = Array.from(panel.querySelectorAll('div[class*="focusBackground"]'))
            .find((el) => el instanceof HTMLElement && el.offsetParent !== null);
        const activeTitle = activeRow?.querySelector('span.text-sm span, span.text-sm');
        const activeText = activeTitle ? (activeTitle.textContent || '').trim() : '';
        if (activeText) title = activeText;
    }
    const hasActiveChat = title.length > 0 && title !== 'Agent';

    const bodyCandidates = Array.from(panel.querySelectorAll(
        '[data-message-author-role], [data-message-role], .rendered-markdown, .prose'
    ));
    const renderablePreview = bodyCandidates.filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const text = (el.textContent || '').trim();
        if (el.offsetParent === null || text.length === 0) return false;
        if (/^\\/\\*\\s*Copied from /i.test(text)) return false;
        return true;
    }).slice(0, 5).map((el) => ({
        tag: el.tagName,
        className: el.className || '',
        text: ((el.textContent || '').trim()).slice(0, 160),
    }));
    const hasRenderableContent = renderablePreview.length > 0;

    const hasLoadingIndicator = Boolean(
        panel.querySelector(
            '[role="progressbar"], ' +
            'svg[class*="animate-spin"], div[class*="animate-spin"], ' +
            'svg[class*="spinner"], div[class*="spinner"], div[class*="loading"]'
        )
    );

    return {
        panelFound: true,
        title: title || '(Untitled)',
        hasActiveChat,
        hasLoadingIndicator,
        hasRenderableContent,
        renderablePreview,
    };
})()`;

/**
 * Script to find the Past Conversations button and return its coordinates.
 * We use coordinates so that the actual click is done via CDP Input.dispatchMouseEvent,
 * which works reliably in Electron (DOM .click() can be ignored).
 *
 * Returns: { found: boolean, x: number, y: number }
 */
const FIND_PAST_CONVERSATIONS_BUTTON_SCRIPT = `(() => {
    const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
    const getRect = (el) => {
        if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        const rect = el.getBoundingClientRect();
        return { found: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    };

    // Strategy 1 (primary): data-past-conversations-toggle attribute
    const toggle = document.querySelector('[data-past-conversations-toggle]');
    if (toggle && isVisible(toggle)) return getRect(toggle);

    // Strategy 2: data-tooltip-id containing "history"
    const tooltipEls = Array.from(document.querySelectorAll('[data-tooltip-id]'));
    for (const el of tooltipEls) {
        if (!isVisible(el)) continue;
        const tid = (el.getAttribute('data-tooltip-id') || '').toLowerCase();
        if (tid.includes('history') || tid.includes('past-conversations')) {
            return getRect(el);
        }
    }

    // Strategy 3: SVG with lucide-history class
    const icons = Array.from(document.querySelectorAll('svg.lucide-history, svg[class*="lucide-history"]'));
    for (const icon of icons) {
        const parent = icon.closest('a, button, [role="button"], div[class*="cursor-pointer"]');
        const target = parent instanceof HTMLElement && isVisible(parent) ? parent : icon;
        if (isVisible(target)) return getRect(target);
    }

    return { found: false, x: 0, y: 0 };
})()`;

/**
 * Script to scrape session items from the open Past Conversations panel.
 * Expects the panel to already be visible.
 *
 * Returns: { sessions: SessionListItem[] }
 */
const SCRAPE_PAST_CONVERSATIONS_SCRIPT = `(() => {
    const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
    const normalize = (text) => (text || '').trim();

    // Past Conversations opens as a floating QuickInput dialog, not inside the side panel.
    // Try the visible QuickInput dialog first, then fall back to the side panel.
    const quickInputPanels = Array.from(document.querySelectorAll('div[class*="bg-quickinput-background"]'));
    const panel = quickInputPanels.find((el) => isVisible(el))
        || document.querySelector('.antigravity-agent-side-panel')
        || document.body;
    if (!panel) return null;

    const items = [];
    const seen = new Set();

    // Find the scrollable conversation list container within the side panel
    const containers = Array.from(panel.querySelectorAll('div[class*="overflow-auto"], div[class*="overflow-y-scroll"]'));
    const container = containers.find((c) => isVisible(c) && c.querySelectorAll('div[class*="cursor-pointer"]').length > 0);
    if (!container) return null;

    // Detect the "Other Conversations" section boundary.
    // Sessions below this header belong to other projects and must be excluded.
    let boundaryTop = Infinity;
    const headerCandidates = container.querySelectorAll('div[class*="text-xs"][class*="opacity"]');
    for (const el of headerCandidates) {
        if (!isVisible(el)) continue;
        const t = normalize(el.textContent || '');
        if (/^Other\\s+Conversations?$/i.test(t)) {
            boundaryTop = el.getBoundingClientRect().top;
            break;
        }
    }

    // Each session row is a div with cursor-pointer
    const rows = Array.from(container.querySelectorAll('div[class*="cursor-pointer"]'));
    for (const row of rows) {
        if (!isVisible(row)) continue;
        // Skip rows that are below the "Other Conversations" boundary
        if (row.getBoundingClientRect().top >= boundaryTop) continue;
        // Find the session title — nested span within the row
        const spans = Array.from(row.querySelectorAll('span.text-sm span, span.text-sm'));
        let title = '';
        for (const span of spans) {
            const t = normalize(span.textContent || '');
            // Skip timestamp labels like "1 hr ago", "7 mins ago"
            if (/^\\d+\\s+(min|hr|hour|day|sec|week|month|year)s?\\s+ago$/i.test(t)) continue;
            // Skip very short or action-like labels
            if (t.length < 2 || t.length > 200) continue;
            if (/^(show\\s+\\d+\\s+more|new|past|history|settings|close|menu)\\b/i.test(t)) continue;
            title = t;
            break;
        }
        if (!title || seen.has(title)) continue;
        seen.add(title);
        // Detect if this is the active/current session (has focusBackground class)
        const isActive = /focusBackground/i.test(row.className || '');
        items.push({ title, isActive });
    }
    return { sessions: items };
})()`;

/**
 * Script to find the "Show N more..." link and return its coordinates.
 * Returns: { found: boolean, x: number, y: number }
 */
const FIND_SHOW_MORE_BUTTON_SCRIPT = `(() => {
    const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
    const quickInputPanels = Array.from(document.querySelectorAll('div[class*="bg-quickinput-background"]'));
    const root = quickInputPanels.find((el) => isVisible(el))
        || document.querySelector('.antigravity-agent-side-panel')
        || document;
    const els = Array.from(root.querySelectorAll('div, span'));
    for (const el of els) {
        if (!isVisible(el)) continue;
        const text = (el.textContent || '').trim();
        if (/^Show\\s+\\d+\\s+more/i.test(text)) {
            if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
            const rect = el.getBoundingClientRect();
            return { found: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
    }
    return { found: false, x: 0, y: 0 };
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

        ${FUZZY_MATCH_HELPERS_SCRIPT}

        const nodes = Array.from(panel.querySelectorAll('button, [role="button"], a, li, div, span'))
            .filter(isVisible);

        const exact = [];
        const includes = [];
        const fuzzy = [];
        for (const node of nodes) {
            const text = normalize(node.textContent || '');
            if (!text) continue;
            
            const isShort = wanted.length < 5;
            if (text === wanted) {
                exact.push({ node, textLength: text.length });
            } else if (!isShort && text.includes(wanted)) {
                includes.push({ node, textLength: text.length });
            } else if (wordsMatch(text, wantedRaw)) {
                fuzzy.push({ node, textLength: text.length });
            }
        }

        const pick = (list) => {
            if (list.length === 0) return null;
            list.sort((a, b) => a.textLength - b.textLength);
            return list[0].node;
        };

        const target = pick(exact) || pick(includes) || pick(fuzzy);
        if (!target) return { ok: false, error: 'Chat title not found in side panel' };
        const clickable = target.closest('button, [role="button"], a, li, [data-testid*="conversation"]') || target;
        if (typeof clickable.scrollIntoView === 'function') {
            clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        const rect = clickable.getBoundingClientRect();
        return {
            ok: true,
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
        };
    })()`;
}

/**
 * Build a script that opens Past Conversations and selects a conversation by title.
 * This path is required for older chats that are not visible in the current side panel.
 * @param title Target conversation title.
 * @returns Serialized evaluation script.
 */
export function buildActivateViaPastConversationsScript(title: string): string {
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
        const getLabelParts = (el) => {
            if (!el || !(el instanceof Element)) return [];
            return [
                el.textContent || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('title') || '',
                el.getAttribute('placeholder') || '',
                el.getAttribute('data-tooltip-content') || '',
                el.getAttribute('data-testid') || '',
            ];
        };
        const getLabelText = (el) => getLabelParts(el).filter(Boolean).join(' ');
        const resolveMatchedTitle = (el) => {
            const parts = getLabelParts(el);
            for (const part of parts) {
                if (!part) continue;
                if (normalize(part) === wanted || (wantedLoose && normalizeLoose(part) === wantedLoose)) {
                    return wantedRaw;
                }
            }
            const visible = (parts[0] || '').trim();
            return visible || null;
        };
        const getClickable = (el) => {
            if (!el || !(el instanceof Element)) return null;
            const clickable = el.closest('button, [role="button"], a, li, [role="option"], [data-testid*="conversation"]');
            return clickable instanceof HTMLElement ? clickable : (el instanceof HTMLElement ? el : null);
        };
        ${FUZZY_MATCH_HELPERS_SCRIPT}

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
                    const isShort = p.length < 5;
                    
                    if (
                        text === p ||
                        (pLoose && textLoose === pLoose) ||
                        (!isShort && (text.includes(p) || (pLoose && textLoose.includes(pLoose))))
                    ) {
                        matched.push({ el, score: Math.abs(text.length - pattern.length) });
                        break;
                    } else if (wordsMatch(text, pattern)) {
                        matched.push({ el, score: Math.abs(text.length - pattern.length) + 1000 });
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
                const proto = el instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(el, value);
                } else {
                    el.value = value;
                }
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
        const clickIconHistoryButton = () => {
            const iconTargets = asArray(document.querySelectorAll('svg, i, span, div'));
            const patterns = ['history', 'clock', 'conversation', 'past'];
            for (const icon of iconTargets) {
                const descriptor = normalize([
                    icon.getAttribute?.('class') || '',
                    icon.getAttribute?.('data-testid') || '',
                    icon.getAttribute?.('data-icon') || '',
                    icon.getAttribute?.('aria-label') || '',
                    icon.getAttribute?.('title') || '',
                    icon.getAttribute?.('data-tooltip-id') || '',
                ].join(' '));
                if (!descriptor) continue;
                if (!patterns.some((p) => descriptor.includes(p))) continue;
                const clickable = getClickable(icon);
                if (clickable && isVisible(clickable)) {
                    clickable.click();
                    return true;
                }
            }
            return false;
        };
        const openMenuThenClickPast = async () => {
            const openedMenu = clickByPatterns(
                ['more', 'options', 'menu', 'actions', '...', 'ellipsis', '設定', '操作'],
                'button[aria-haspopup], [role="button"][aria-haspopup], button, [role="button"]',
            );
            if (!openedMenu) return false;
            await wait(180);
            return clickByPatterns([
                'past conversations',
                'past conversation',
                'conversation history',
                'past chats',
                '過去の会話',
                'chat history',
            ], '[role="menuitem"], [role="option"], button, [role="button"], li, div, span');
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
            // Primary: click via data-past-conversations-toggle attribute
            let opened = false;
            const toggleBtn = document.querySelector('[data-past-conversations-toggle]');
            if (toggleBtn && isVisible(toggleBtn)) {
                const clickable = getClickable(toggleBtn);
                if (clickable) { clickable.click(); opened = true; }
            }
            if (!opened) {
                // Fallback: data-tooltip-id containing "history"
                const tooltipEls = asArray(document.querySelectorAll('[data-tooltip-id]'));
                for (const el of tooltipEls) {
                    if (!isVisible(el)) continue;
                    const tid = normalize(el.getAttribute('data-tooltip-id') || '');
                    if (tid.includes('history') || tid.includes('past-conversations')) {
                        const cl = getClickable(el);
                        if (cl) { cl.click(); opened = true; break; }
                    }
                }
            }
            if (!opened) {
                opened = clickByPatterns([
                    'past conversations',
                    'past conversation',
                    'conversation history',
                    'past chats',
                    '過去の会話',
                    'chat history',
                ]);
            }
            if (!opened) {
                opened = clickIconHistoryButton();
            }
            if (!opened) {
                opened = await openMenuThenClickPast();
            }
            if (!opened) {
                return { ok: false, error: 'Past Conversations button not found' };
            }

            await wait(320);

            // In some UI states "Select a conversation" itself is a trigger.
            clickByPatterns(['select a conversation', 'select conversation', 'conversation'], '[role="button"], button, [aria-haspopup], [data-testid*="conversation"]');
            await wait(220);

            // First, try to find it in the default visible list (works for recent chats)
            let selectedOption = pickBest(
                asArray(document.querySelectorAll('[role="option"], li, button, [data-testid*="conversation"]')),
                [wanted, wantedLoose],
            );
            
            // If not found, fall back to the search input but use a shorter prefix to avoid strict-match bugs
            if (!selectedOption) {
                const input = findSearchInput();
                if (input) {
                    // Use first 2 words to bypass IDE renaming/truncation issues
                    const searchPrefix = (wantedRaw || '').split(/\\s+/).slice(0, 2).join(' ');
                    setInputValue(input, searchPrefix.length > 3 ? searchPrefix : wantedRaw);
                    await wait(350);
                    selectedOption = pickBest(
                        asArray(document.querySelectorAll('[role="option"], li, button, [data-testid*="conversation"]')),
                        [wanted, wantedLoose],
                    );
                }
            }
            
            if (!selectedOption) {
                return { ok: false, error: 'Conversation not found in Past Conversations' };
            }
            const clickable = getClickable(selectedOption) || selectedOption;
            if (typeof clickable.scrollIntoView === 'function') {
                clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
            const rect = clickable.getBoundingClientRect();
            return {
                ok: true,
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2),
                matchedTitle: resolveMatchedTitle(selectedOption)
            };
        })();
    })()`;
}

/**
 * Service for managing chat sessions on Antigravity via CDP.
 *
 * CDP dependencies are received as method arguments (connection pool compatible).
 */
export class ChatSessionService {
    private static readonly ACTIVATE_SESSION_MAX_WAIT_MS = 30000;
    private static readonly ACTIVATE_SESSION_RETRY_INTERVAL_MS = 800;
    private static readonly LIST_SESSIONS_TARGET = 20;
    private static readonly HYDRATE_RETRY_DELAY_MS = 700;
    private static readonly REOPEN_RETRY_ATTEMPTS = 4;
    private static readonly REOPEN_NEW_CHAT_DELAY_MS = 400;
    private static readonly REOPEN_HISTORY_DELAY_MS = 1000;

    /**
     * List recent sessions by opening the Past Conversations panel.
     *
     * Flow (all clicks via CDP Input.dispatchMouseEvent for Electron compatibility):
     *   1. Find Past Conversations button coordinates
     *   2. Click it via CDP mouse events
     *   3. Wait for panel to render
     *   4. Scrape visible sessions
     *   5. If < TARGET sessions, find & click "Show N more..."
     *   6. Re-scrape
     *   7. Close panel with Escape key
     *
     * @param cdpService CdpService instance to use
     * @returns Array of session list items (empty array on failure)
     */
    async listAllSessions(cdpService: CdpService): Promise<SessionListItem[]> {
        let panelOpened = false;
        try {
            // Step 1: Find Past Conversations button
            const btnState = await this.evaluateOnAnyContext(
                cdpService, FIND_PAST_CONVERSATIONS_BUTTON_SCRIPT, false,
            );
            if (!btnState?.found) {
                return [];
            }

            // Step 2: Click via CDP mouse events (reliable in Electron)
            await this.cdpMouseClick(cdpService, btnState.x, btnState.y);
            panelOpened = true;

            // Step 3: Wait for panel to render (poll for content, up to 3s)
            const PANEL_READY_CHECK = `(() => {
                const isVisible = (el) => !!el && el instanceof HTMLElement && el.offsetParent !== null;
                const quickInputPanels = Array.from(document.querySelectorAll('div[class*="bg-quickinput-background"]'));
                const panel = quickInputPanels.find((el) => isVisible(el))
                    || document.querySelector('.antigravity-agent-side-panel')
                    || document.body;
                if (!panel) return false;
                const containers = Array.from(
                    panel.querySelectorAll('div[class*="overflow-auto"], div[class*="overflow-y-scroll"]')
                );
                return containers.some((c) =>
                    isVisible(c) && c.querySelector('div[class*="cursor-pointer"]')
                );
            })()`;
            let panelReady = false;
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                panelReady = Boolean(
                    await this.evaluateOnAnyContext(cdpService, PANEL_READY_CHECK, false),
                );
                if (panelReady) break;
                await new Promise((r) => setTimeout(r, 200));
            }
            if (!panelReady) {
                return [];
            }

            // Step 4: Scrape sessions
            let scrapeResult = await this.evaluateOnAnyContext(
                cdpService, SCRAPE_PAST_CONVERSATIONS_SCRIPT, false,
            );
            let sessions: SessionListItem[] = scrapeResult?.sessions ?? [];

            // Step 5: If fewer than TARGET, click "Show N more..."
            if (sessions.length < ChatSessionService.LIST_SESSIONS_TARGET) {
                const showMoreState = await this.evaluateOnAnyContext(
                    cdpService, FIND_SHOW_MORE_BUTTON_SCRIPT, false,
                );
                if (showMoreState?.found) {
                    await this.cdpMouseClick(cdpService, showMoreState.x, showMoreState.y);
                    await new Promise((r) => setTimeout(r, 500));

                    // Step 6: Re-scrape
                    scrapeResult = await this.evaluateOnAnyContext(
                        cdpService, SCRAPE_PAST_CONVERSATIONS_SCRIPT, false,
                    );
                    sessions = scrapeResult?.sessions ?? [];
                }
            }

            return sessions.slice(0, ChatSessionService.LIST_SESSIONS_TARGET);
        } catch (_) {
            return [];
        } finally {
            if (panelOpened) {
                await this.closePanelWithEscape(cdpService);
            }
        }
    }

    /**
     * Close the Past Conversations panel by sending Escape key events.
     * @param cdpService Target cdp client.
     */
    private async closePanelWithEscape(cdpService: CdpService): Promise<void> {
        try {
            await cdpService.call('Input.dispatchKeyEvent', {
                type: 'keyDown', key: 'Escape', code: 'Escape',
                windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
            });
            await cdpService.call('Input.dispatchKeyEvent', {
                type: 'keyUp', key: 'Escape', code: 'Escape',
                windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
            });
        } catch (_) { /* best-effort cleanup */ }
    }

    /**
     * Evaluate a script on the first context that returns a truthy value.
     * @param cdpService Active CdpService client.
     * @param expression Script string.
     * @param awaitPromise Await promise setting.
     * @returns Script evaluation result value.
     */
    private async evaluateOnAnyContext(
        cdpService: CdpService,
        expression: string,
        awaitPromise: boolean,
    ): Promise<any> {
        const contexts = cdpService.getContexts();
        for (const ctx of contexts) {
            try {
                const result = await cdpService.call('Runtime.evaluate', {
                    expression, returnByValue: true, awaitPromise, contextId: ctx.id,
                });
                const value = result?.result?.value;
                if (value) return value;
            } catch (_) { /* try next context */ }
        }
        return null;
    }

    /**
     * Click at coordinates via CDP Input.dispatchMouseEvent.
     * @param cdpService Target cdp client.
     * @param x X coordinate.
     * @param y Y coordinate.
     */
    private async cdpMouseClick(cdpService: CdpService, x: number, y: number): Promise<void> {
        await cdpService.call('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x, y,
        });
        await cdpService.call('Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1,
        });
        await cdpService.call('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
        });
    }

    /**
     * Sends shortcut key events triggering new conversation in the UI.
     * @param cdpService Target cdp client.
     */
    private async dispatchNewConversationShortcut(cdpService: CdpService): Promise<void> {
        const modifiers = process.platform === 'darwin' ? 8 : 10;
        await cdpService.call('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'L',
            code: 'KeyL',
            modifiers,
            windowsVirtualKeyCode: 76,
            nativeVirtualKeyCode: 76,
        });
        await cdpService.call('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'L',
            code: 'KeyL',
            modifiers,
            windowsVirtualKeyCode: 76,
            nativeVirtualKeyCode: 76,
        });
    }

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

            // Prefer the keyboard shortcut because some Antigravity builds bind hover tips to the button target.
            await this.dispatchNewConversationShortcut(cdpService);

            // Wait for UI to update after shortcut
            await new Promise(r => setTimeout(r, 1500));

            // Check if button changed to not-allowed (evidence that a new chat was opened)
            const afterState = await this.getNewChatButtonState(cdpService, contexts);
            if (afterState.found && !afterState.enabled) {
                return { ok: true };
            }

            // Fallback for older builds where the shortcut is not wired.
            await this.cdpMouseClick(cdpService, btnState.x, btnState.y);
            await new Promise(r => setTimeout(r, 1500));

            const afterFallback = await this.getNewChatButtonState(cdpService, contexts);
            if (afterFallback.found && !afterFallback.enabled) {
                return { ok: true };
            }

            return { ok: false, error: 'New conversation shortcut and button click did not change state' };
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
     * Retrieves current session view details including message content presence.
     * @param cdpService Target cdp client.
     * @returns Session view state diagnostics details.
     */
    async getCurrentSessionViewState(cdpService: CdpService): Promise<SessionViewState> {
        try {
            const contexts = cdpService.getContexts();
            for (const ctx of contexts) {
                try {
                    const result = await cdpService.call('Runtime.evaluate', {
                        expression: GET_SESSION_VIEW_STATE_SCRIPT,
                        returnByValue: true,
                        contextId: ctx.id,
                    });
                    const value = result?.result?.value;
                    const hasPanel = value?.panelFound === true;
                    const looksUseful = Boolean(
                        hasPanel ||
                        value?.hasLoadingIndicator ||
                        value?.hasRenderableContent ||
                        (typeof value?.title === 'string' && value.title.trim().length > 0),
                    );
                    if (value && looksUseful) {
                        return {
                            title: value.title,
                            hasActiveChat: value.hasActiveChat ?? false,
                            panelFound: value.panelFound ?? false,
                            hasLoadingIndicator: value.hasLoadingIndicator ?? false,
                            hasRenderableContent: value.hasRenderableContent ?? false,
                            renderablePreview: Array.isArray(value.renderablePreview) ? value.renderablePreview : [],
                        };
                    }
                } catch (_) { /* try next context */ }
            }
        } catch (_) { /* fall through */ }

        return {
            title: '(Failed to retrieve)',
            hasActiveChat: false,
            panelFound: false,
            hasLoadingIndicator: false,
            hasRenderableContent: false,
            renderablePreview: [],
        };
    }

    /**
     * Checks if a session view appears stuck and tries to recover if needed.
     * @param cdpService Target cdp client.
     * @param title Active session title.
     * @returns Recovery result state.
     */
    async refreshSessionViewIfStuck(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string }> {
        const state = await this.getCurrentSessionViewState(cdpService);
        if (state.title.trim() !== title.trim()) {
            return { ok: false, error: `Current title mismatch before refresh (expected="${title}", actual="${state.title}")` };
        }
        if (!state.hasLoadingIndicator && state.hasRenderableContent) {
            return { ok: true };
        }
        const bounce = await this.recoverSessionViewWithNewConversationBounce(cdpService, title);
        if (bounce.ok) {
            return bounce;
        }

        return {
            ok: false,
            error:
                `Session "${title}" still appears stuck after new-conversation recovery ` +
                `(${bounce.error || 'unknown'})`,
        };
    }

    /**
     * Recovers a stuck session view by performing a bounce through an empty chat.
     * @param cdpService Target cdp client.
     * @param title Target conversation title.
     * @param options Bouncing delay overrides options.
     * @returns Recovery result state.
     */
    async recoverSessionViewWithNewConversationBounce(
        cdpService: CdpService,
        title: string,
        options?: {
            maxAttempts?: number;
            newChatDelayMs?: number;
            reopenDelayMs?: number;
        },
    ): Promise<{ ok: boolean; error?: string }> {
        const state = await this.getCurrentSessionViewState(cdpService);
        if (state.title.trim() === title.trim() && !state.hasLoadingIndicator && state.hasRenderableContent) {
            return { ok: true };
        }

        const maxAttempts = options?.maxAttempts ?? ChatSessionService.REOPEN_RETRY_ATTEMPTS;
        const newChatDelayMs = options?.newChatDelayMs ?? ChatSessionService.REOPEN_NEW_CHAT_DELAY_MS;
        const reopenDelayMs = options?.reopenDelayMs ?? ChatSessionService.REOPEN_HISTORY_DELAY_MS;
        let lastError = `Session "${title}" still appears stuck before recovery`;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const newChat = await this.startNewChat(cdpService);
            if (!newChat.ok) {
                lastError =
                    `Attempt ${attempt}/${maxAttempts}: failed to open a fresh new conversation before reopening "${title}": ` +
                    `${newChat.error || 'unknown'}`;
                continue;
            }

            await new Promise((resolve) => setTimeout(resolve, newChatDelayMs));

            const reopened = await this.activateSessionByTitle(cdpService, title, {
                maxWaitMs: 8000,
                retryIntervalMs: 300,
                allowVisibilityWarmupMs: 1000,
            });
            if (!reopened.ok) {
                lastError =
                    `Attempt ${attempt}/${maxAttempts}: failed to reopen "${title}" after new conversation: ` +
                    `${reopened.error || 'unknown'}`;
                continue;
            }

            await new Promise((resolve) => setTimeout(resolve, reopenDelayMs));

            const after = await this.getCurrentSessionViewState(cdpService);
            if (after.title.trim() === title.trim() && (!after.hasLoadingIndicator || after.hasRenderableContent)) {
                return { ok: true };
            }

            lastError =
                `Attempt ${attempt}/${maxAttempts}: session "${title}" still appears stuck after reopening ` +
                `(loading=${after.hasLoadingIndicator}, content=${after.hasRenderableContent}, actual="${after.title}")`;
        }

        return { ok: false, error: lastError };
    }

    /**
     * Activate an existing chat by title.
     * Returns ok:false if the target chat cannot be located or verified.
     * @param cdpService Target cdp client.
     * @param title Target conversation title.
     * @param options Warmup/retry delay overrides options.
     * @returns Operation result.
     */
    async activateSessionByTitle(
        cdpService: CdpService,
        title: string,
        options?: {
            maxWaitMs?: number;
            retryIntervalMs?: number;
            allowVisibilityWarmupMs?: number;
        },
    ): Promise<{ ok: boolean; error?: string }> {
        if (!title || title.trim().length === 0) {
            return { ok: false, error: 'Session title is empty' };
        }

        const current = await this.getCurrentSessionInfo(cdpService);
        if (current.title.trim() === title.trim()) {
            return { ok: true };
        }

        const maxWaitMs = options?.maxWaitMs ?? ChatSessionService.ACTIVATE_SESSION_MAX_WAIT_MS;
        const retryIntervalMs = options?.retryIntervalMs ?? ChatSessionService.ACTIVATE_SESSION_RETRY_INTERVAL_MS;
        const allowVisibilityWarmupMs = options?.allowVisibilityWarmupMs ?? 0;

        let usedPastConversations = false;
        let directResult: { ok: boolean; error?: string } = { ok: false, error: 'not attempted' };
        let pastResult: { ok: boolean; error?: string; matchedTitle?: string } | null = null;
        let clicked = false;
        let startedAt = Date.now();
        let attempts = 0;
        let warmupConsumed = false;

        while (Date.now() - startedAt <= maxWaitMs) {
            attempts += 1;
            directResult = await this.tryActivateByDirectSidePanel(cdpService, title);
            clicked = directResult.ok;

            if (!clicked) {
                pastResult = await this.tryActivateByPastConversations(cdpService, title);
                clicked = pastResult.ok;
                // If we attempted past conversations, the panel is open (unless it clicked something)
                usedPastConversations = true;
                
                // If it failed to click anything, the panel is still open and blocking the UI.
                if (!clicked) {
                    await this.closePanelWithEscape(cdpService);
                }
            }

            if (clicked) {
                break;
            }

            if (Date.now() - startedAt <= maxWaitMs) {
                await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
            }
        }

        if (!clicked) {
            return {
                ok: false,
                error:
                    `Failed to activate session "${title}" ` +
                    `after ${attempts} attempt(s) ` +
                    `(direct: ${directResult.error || 'direct search failed'}; ` +
                    `past: ${pastResult?.error || 'past conversations search failed'})`,
            };
        }

        // Wait briefly for DOM state transition and verify destination chat.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = await this.getCurrentSessionInfo(cdpService);
        if (after.title.trim() === title.trim()) {
            if (usedPastConversations) {
                await this.closePanelWithEscape(cdpService);
            }
            return { ok: true };
        }

        // Current Antigravity builds keep the header at the generic "Agent"
        // label even after an exact Past Conversations option is selected.
        // The selection script only reports success after matching the wanted
        // title inside this workspace's conversation picker.
        if (
            usedPastConversations &&
            after.title.trim() === 'Agent' &&
            pastResult?.matchedTitle?.trim() === title.trim()
        ) {
            logger.debug(
                `[ChatSession] Accepting Agent-header bypass: ` +
                `usedPastConversations=true observedTitle="${after.title}" targetTitle="${title}"`,
            );
            await this.closePanelWithEscape(cdpService);
            return { ok: true };
        }

        if (!warmupConsumed && allowVisibilityWarmupMs > 0 && after.title.trim() === 'Agent') {
            warmupConsumed = true;
            startedAt = Date.now();
            await new Promise((resolve) => setTimeout(resolve, allowVisibilityWarmupMs));
            return this.activateSessionByTitle(cdpService, title, {
                maxWaitMs,
                retryIntervalMs,
                allowVisibilityWarmupMs: 0,
            });
        }

        // If direct side-panel activation hit the wrong row, try the explicit Past Conversations flow.
        if (!usedPastConversations) {
            const viaPast = await this.tryActivateByPastConversations(cdpService, title);
            if (viaPast.ok) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                const afterPast = await this.getCurrentSessionInfo(cdpService);
                if (afterPast.title.trim() === title.trim()) {
                    await this.closePanelWithEscape(cdpService);
                    return { ok: true };
                }
                if (
                    afterPast.title.trim() === 'Agent' &&
                    viaPast.matchedTitle?.trim() === title.trim()
                ) {
                    logger.debug(
                        `[ChatSession] Accepting Agent-header bypass: ` +
                        `usedPastConversations=true observedTitle="${afterPast.title}" targetTitle="${title}"`,
                    );
                    await this.closePanelWithEscape(cdpService);
                    return { ok: true };
                }
                return {
                    ok: false,
                    error: `Past Conversations selected a different chat (expected="${title}", actual="${afterPast.title}")`,
                };
            }
            await this.closePanelWithEscape(cdpService);
            return {
                ok: false,
                error:
                    `Activated chat did not match target title (expected="${title}", actual="${after.title}") ` +
                    `and Past Conversations fallback failed (${viaPast.error || 'unknown'})`,
            };
        }

        return {
            ok: false,
            error: `Activated chat did not match target title (expected="${title}", actual="${after.title}")`,
        };
    }

    /**
     * Tries to find and select target conversation row from the direct visible side panel list.
     * @param cdpService Target cdp client.
     * @param title Target conversation title.
     * @returns Selection script result.
     */
    private async tryActivateByDirectSidePanel(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string }> {
        return this.tryActivateWithScript(cdpService, buildActivateChatByTitleScript(title), false);
    }

    /**
     * Tries to find and select target conversation row by opening Past Conversations wizard.
     * @param cdpService Target cdp client.
     * @param title Target conversation title.
     * @returns Selection script result.
     */
    private async tryActivateByPastConversations(
        cdpService: CdpService,
        title: string,
    ): Promise<{ ok: boolean; error?: string; matchedTitle?: string }> {
        return this.tryActivateWithScript(cdpService, buildActivateViaPastConversationsScript(title), true);
    }

    /**
     * Runs custom activation script on the active cdp contexts.
     * @param cdpService Target cdp client.
     * @param script Script content string.
     * @param awaitPromise Await promise setting.
     * @returns Operation result.
     */
    private async tryActivateWithScript(
        cdpService: CdpService,
        script: string,
        awaitPromise: boolean,
    ): Promise<{ ok: boolean; error?: string; matchedTitle?: string }> {
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
                    if (typeof value.x === 'number' && typeof value.y === 'number') {
                        await this.cdpMouseClick(cdpService, value.x, value.y);
                    }
                    return {
                        ok: true,
                        ...(typeof value.matchedTitle === 'string'
                            ? { matchedTitle: value.matchedTitle }
                            : {}),
                    };
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
     * @param cdpService Target cdp client.
     * @param contexts Active cdp contexts.
     * @returns Coordinates and state details of the new chat button.
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

    /**
     * Rename the current chat in the Antigravity UI directly by updating the DOM.
     * Note: This is a cosmetic change until Antigravity persists a rename.
     * IDE syncing for chat renaming is strictly "best-effort".
     * @param cdpService Target cdp client.
     * @param newTitle New chat title string.
     * @returns Success/failure indicator.
     */
    async renameCurrentChatInUI(cdpService: CdpService, newTitle: string): Promise<{ ok: boolean; error?: string }> {
        try {
            const contextId = cdpService.getPrimaryContextId();
            
            const RENAME_SCRIPT = `(() => {
                const panel = document.querySelector('.antigravity-agent-side-panel') || document.body;
                if (!panel) return { ok: false, error: 'Panel not found' };
                const header = panel.querySelector('div[class*="border-b"]');
                const titleEl = header?.querySelector('div[class*="text-ellipsis"]');
                if (titleEl) {
                    titleEl.textContent = ${JSON.stringify(newTitle)};
                    return { ok: true };
                }
                
                const activeRow = Array.from(panel.querySelectorAll('div[class*="focusBackground"]'))
                    .find((el) => el instanceof HTMLElement && el.offsetParent !== null);
                const activeTitle = activeRow?.querySelector('span.text-sm span, span.text-sm');
                if (activeTitle) {
                    activeTitle.textContent = ${JSON.stringify(newTitle)};
                    return { ok: true };
                }
                
                return { ok: false, error: 'Title element not found' };
            })()`;
            
            const result = await cdpService.call('Runtime.evaluate', {
                expression: RENAME_SCRIPT,
                returnByValue: true,
                ...(contextId !== null ? { contextId } : {}),
                awaitPromise: true,
            });
            
            return result?.result?.value || { ok: false, error: 'Eval failed' };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }
}
