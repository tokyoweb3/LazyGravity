import { logger } from '../utils/logger';
import type { ExtractionMode } from '../utils/config';
import { CdpService } from './cdpService';
import {
    extractAssistantSegmentsPayloadScript,
    classifyAssistantSegments,
} from './assistantDomExtractor';

/** Lean DOM selectors for response extraction */
export const RESPONSE_SELECTORS = {
    /** Scored selector approach for extracting response text.
     *  Tie-breaking: newest wins (first found in reverse iteration).
     *  DOM is normal order: index 0 = oldest, N-1 = newest.
     *  Reverse iteration (N-1→0) visits newest first; strict > keeps it. */
    RESPONSE_TEXT: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.text-ide-message-block-bot-color', score: 10 },
            { sel: '.rendered-markdown', score: 9 },
            { sel: '.leading-relaxed.select-text', score: 8 },
            { sel: '.flex.flex-col.gap-y-3', score: 7 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(normalized) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(normalized) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(normalized) && normalized.length <= 500) return true;
            return false;
        };

        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };

        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };

        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const looksLikeQuotaPopup = (text) => {
            var lower = (text || '').trim().toLowerCase();
            // Inline error: "Error You have exhausted your quota on this model."
            if (lower.includes('exhausted your quota') || lower.includes('exhausted quota')) return true;
            // Popup: quota keyword + dismiss/upgrade button text
            if (!lower.includes('model quota reached') && !lower.includes('quota exceeded') && !lower.includes('rate limit')) return false;
            return lower.includes('dismiss') || lower.includes('upgrade');
        };

        const combinedSelector = selectors.map((s) => s.sel).join(', ');
        const seen = new Set();

        let foundText = null;
        let foundIndex = -1;
        const allFingerprints = [];
        let globalNodeCount = 0;

        let foundFingerprint = null;
        for (const scope of scopes) {
            const nodes = scope.querySelectorAll(combinedSelector);
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node || seen.has(node)) continue;
                seen.add(node);
                if (isInsideExcludedContainer(node)) continue;
                const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                if (!text || text.length < 2) continue;
                if (looksLikeActivityLog(text)) continue;
                if (looksLikeFeedbackFooter(text)) continue;
                if (looksLikeToolOutput(text)) continue;
                if (looksLikeQuotaPopup(text)) continue;

                const fp = text.length + ':' + text.slice(0, 50) + ':' + text.slice(-50);
                allFingerprints.push(fp);

                foundText = text;
                foundIndex = globalNodeCount + i;
                foundFingerprint = fp;
            }
            globalNodeCount += nodes.length;
        }

        return { 
            text: foundText, 
            index: foundIndex, 
            count: globalNodeCount, 
            fingerprints: allFingerprints,
            fingerprint: foundFingerprint
        };
    })()`,
    /** Stop button detection via tooltip-id + text fallback */
    STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        for (const scope of scopes) {
            const el = scope.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (el) {
                const style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                    return { isGenerating: true };
                }
            }
        }

        const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const STOP_PATTERNS = [
            /^stop$/,
            /^stop generating$/,
            /^stop response$/,
            /^停止$/,
            /^生成を停止$/,
            /^応答を停止$/,
        ];
        const isStopLabel = (value) => {
            const normalized = normalize(value);
            if (!normalized) return false;
            return STOP_PATTERNS.some((re) => re.test(normalized));
        };
        for (const scope of scopes) {
            const buttons = scope.querySelectorAll('button, [role="button"]');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                const labels = [
                    btn.textContent || '',
                    btn.getAttribute('aria-label') || '',
                    btn.getAttribute('title') || '',
                ];
                if (labels.some(isStopLabel)) {
                    return { isGenerating: true };
                }
            }
        }

        return { isGenerating: false };
    })()`,
    /** Click stop button via tooltip-id + text fallback */
    CLICK_STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        for (const scope of scopes) {
            const el = scope.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (el && typeof el.click === 'function') {
                el.click();
                return { ok: true, method: 'tooltip-id' };
            }
        }

        const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const STOP_PATTERNS = [
            /^stop$/,
            /^stop generating$/,
            /^stop response$/,
            /^停止$/,
            /^生成を停止$/,
            /^応答を停止$/,
        ];
        const isStopLabel = (value) => {
            const normalized = normalize(value);
            if (!normalized) return false;
            return STOP_PATTERNS.some((re) => re.test(normalized));
        };
        for (const scope of scopes) {
            const buttons = scope.querySelectorAll('button, [role="button"]');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                const labels = [
                    btn.textContent || '',
                    btn.getAttribute('aria-label') || '',
                    btn.getAttribute('title') || '',
                ];
                if (labels.some(isStopLabel) && typeof btn.click === 'function') {
                    btn.click();
                    return { ok: true, method: 'text-fallback' };
                }
            }
        }

        return { ok: false, error: 'Stop button not found' };
    })()`,
    /** Diagnostic: dump ALL candidate text nodes with filter classification */
    DUMP_ALL_TEXTS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(normalized) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(normalized) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(normalized) && normalized.length <= 500) return true;
            return false;
        };
        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };
        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };
        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const results = [];
        const seen = new Set();

        for (const scope of scopes) {
            for (const { sel, score } of selectors) {
                const nodes = scope.querySelectorAll(sel);
                for (let i = nodes.length - 1; i >= 0; i--) {
                    const node = nodes[i];
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                    let skip = null;
                    if (!text || text.length < 2) skip = 'too-short';
                    else if (isInsideExcludedContainer(node)) skip = 'excluded-container';
                    else if (looksLikeActivityLog(text)) skip = 'activity-log';
                    else if (looksLikeFeedbackFooter(text)) skip = 'feedback-footer';
                    else if (looksLikeToolOutput(text)) skip = 'tool-output';
                    else {
                        var qlower = (text || '').trim().toLowerCase();
                        if (qlower.includes('exhausted your quota') || qlower.includes('exhausted quota')) skip = 'quota-popup';
                        else if ((qlower.includes('model quota reached') || qlower.includes('quota exceeded') || qlower.includes('rate limit'))
                            && (qlower.includes('dismiss') || qlower.includes('upgrade'))) skip = 'quota-popup';
                    }
                    const classes = (node.className || '').toString().slice(0, 80);
                    results.push({
                        sel,
                        score,
                        skip,
                        len: text.length,
                        classes,
                        preview: text.slice(0, 120),
                    });
                }
            }
        }
        return results;
    })()`,
    /** Extract process log entries (activity messages + tool output) from DOM */
    PROCESS_LOGS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const selectors = [
            { sel: '.rendered-markdown', score: 10 },
            { sel: '.leading-relaxed.select-text', score: 9 },
            { sel: '.flex.flex-col.gap-y-3', score: 8 },
            { sel: '[data-message-author-role="assistant"]', score: 7 },
            { sel: '[data-message-role="assistant"]', score: 6 },
            { sel: '[class*="assistant-message"]', score: 5 },
            { sel: '[class*="message-content"]', score: 4 },
            { sel: '[class*="markdown-body"]', score: 3 },
            { sel: '.prose', score: 2 },
        ];

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i;
            if (activityPattern.test(normalized) && normalized.length <= 220) return true;
            if (/^initiating\\s/i.test(normalized) && normalized.length <= 500) return true;
            if (/^thought for\\s/i.test(normalized) && normalized.length <= 500) return true;
            return false;
        };

        const looksLikeToolOutput = (text) => {
            const first = (text || '').trim().split('\\n')[0] || '';
            if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
            if (/^full output written to\\b/i.test(first)) return true;
            if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
            var lower = (text || '').trim().toLowerCase();
            if (/^title:\\s/.test(lower) && /\\surl:\\s/.test(lower) && /\\ssnippet:\\s/.test(lower)) return true;
            if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log|ruby|go|rust|java|c|cpp|csharp|php|swift|kotlin)$/i.test(first)) return true;
            return false;
        };

        const isInsideExcludedContainer = (node) => {
            if (node.closest('details')) return true;
            if (node.closest('[class*="feedback"], footer')) return true;
            if (node.closest('.notify-user-container')) return true;
            if (node.closest('[role="dialog"]')) return true;
            return false;
        };

        const results = [];
        const seen = new Set();

        for (const scope of scopes) {
            for (const { sel } of selectors) {
                const nodes = scope.querySelectorAll(sel);
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    if (isInsideExcludedContainer(node)) continue;
                    const text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
                    if (!text || text.length < 4) continue;
                    if (looksLikeActivityLog(text) || looksLikeToolOutput(text)) {
                        results.push(text.slice(0, 300));
                    }
                }
            }
        }

        return results;
    })()`,
    /** Quota error detection — text-based h3 span match first, class-based fallback second */
    QUOTA_ERROR: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;
        const QUOTA_KEYWORDS = ['model quota reached', 'rate limit', 'quota exceeded', 'exhausted your quota', 'exhausted quota'];
        const isInsideResponse = (node) =>
            node.closest('.rendered-markdown, .prose, pre, code, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="message-content"]');

        // Primary: text-based detection via h3 span (Tailwind-only popup)
        const headings = scope.querySelectorAll('h3 span, h3');
        for (const el of headings) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) return true;
        }

        // Inline error: "Error You have exhausted your quota on this model."
        // Appears in process log area as a span inside flex containers
        const inlineSpans = scope.querySelectorAll('span');
        for (const el of inlineSpans) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('exhausted your quota') || text.includes('exhausted quota')) return true;
        }

        // Fallback: semantic class-based detection
        const errorSelectors = [
            '[role="alert"]',
            '[class*="error"]',
            '[class*="warning"]',
            '[class*="toast"]',
            '[class*="banner"]',
            '[class*="notification"]',
            '[class*="alert"]',
            '[class*="quota"]',
            '[class*="rate-limit"]',
        ];
        const errorElements = scope.querySelectorAll(errorSelectors.join(', '));
        for (const el of errorElements) {
            if (isInsideResponse(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            if (QUOTA_KEYWORDS.some(kw => text.includes(kw))) return true;
        }
        return false;
    })()`,
    /** Structured DOM extraction — walks DOM to produce typed segment array */
    RESPONSE_STRUCTURED: extractAssistantSegmentsPayloadScript(),
    /** One-shot DOM diagnostic — dumps DOM structure around activity areas */
    DOM_DIAGNOSTIC: `(() => {
        var panel = document.querySelector('.antigravity-agent-side-panel');
        var scope = panel || document;
        var diag = { detailsCount: 0, detailsDump: [], activityNodes: [], allTextNodes: [] };

        // 1. Dump all <details> elements
        var details = scope.querySelectorAll('details');
        diag.detailsCount = details.length;
        for (var i = 0; i < Math.min(details.length, 5); i++) {
            diag.detailsDump.push({
                outerHTML: details[i].outerHTML.slice(0, 500),
                summaryText: (details[i].querySelector('summary') || {}).textContent || '(no summary)',
                childCount: details[i].children.length
            });
        }

        // 2. Find all text nodes that look like activity
        var selectors = '.rendered-markdown, .leading-relaxed.select-text, .flex.flex-col.gap-y-3, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="assistant-message"], [class*="message-content"], [class*="markdown-body"], .prose';
        var nodes = scope.querySelectorAll(selectors);
        for (var j = 0; j < nodes.length; j++) {
            var text = (nodes[j].innerText || nodes[j].textContent || '').trim();
            if (!text || text.length < 2) continue;
            diag.allTextNodes.push({
                tag: nodes[j].tagName,
                className: (nodes[j].className || '').toString().slice(0, 100),
                text: text.slice(0, 200),
                insideDetails: !!nodes[j].closest('details'),
                length: text.length
            });
        }

        // 3. Broader scan: any element with activity-like text
        var allEls = scope.querySelectorAll('*');
        for (var k = 0; k < allEls.length; k++) {
            var el = allEls[k];
            if (el.children.length > 2) continue; // only leaf-ish nodes
            var t = (el.textContent || '').trim();
            if (!t || t.length < 5 || t.length > 300) continue;
            var lower = t.toLowerCase();
            if (/^(?:analy[sz]|read|writ|run|search|think|process|execut|debug|test)/i.test(lower) || /\\//.test(t)) {
                diag.activityNodes.push({
                    tag: el.tagName,
                    className: (el.className || '').toString().slice(0, 100),
                    text: t.slice(0, 200),
                    parentTag: el.parentElement ? el.parentElement.tagName : null,
                    parentClass: el.parentElement ? (el.parentElement.className || '').toString().slice(0, 100) : null,
                    insideDetails: !!el.closest('details')
                });
            }
        }
        return diag;
    })()`,
};

/** Response generation phases */
export type ResponsePhase = 'waiting' | 'thinking' | 'generating' | 'complete' | 'timeout' | 'quotaReached' | 'disconnected';

export interface ResponseMonitorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in ms (default: 2000) */
    pollIntervalMs?: number;
    /** Max inactivity duration in ms (default: 900000 = 15 min). Set 0 to disable. */
    maxDurationMs?: number;
    /** Consecutive stop-gone confirmations needed (default: 3) */
    stopGoneConfirmCount?: number;
    /** Extraction mode: 'legacy' uses innerText, 'structured' uses DOM segment extraction */
    extractionMode?: ExtractionMode;
    /** Text update callback */
    onProgress?: (text: string) => void;
    /** Generation complete callback */
    onComplete?: (finalText: string) => void;
    /** Timeout callback */
    onTimeout?: (lastText: string) => void;
    /** Phase change callback */
    onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    /** Process log update callback (activity messages + tool output) */
    onProcessLog?: (text: string) => void;
    /** Optional pre-captured baseline response text from before prompt injection */
    initialBaselineText?: string | null;
    /** Optional pre-captured baseline node count from before prompt injection */
    initialBaselineCount?: number;
    /** Optional fingerprints of existing messages to ignore */
    initialBaselineFingerprints?: string[];
    /** Optional pre-captured process log keys from before prompt injection */
    initialSeenProcessLogKeys?: string[];
}

/**
 * Snapshot of pre-injection output and process-log state used to seed monitoring.
 */
export interface ResponseMonitorBaselineSnapshot {
    text: string | null;
    count: number;
    fingerprints: string[];
    processLogKeys: string[];
}

/**
 * Execution context metadata used when probing multiple CDP runtime contexts.
 */
interface ContextProbeTarget {
    id: number;
    name?: string;
    url?: string;
}

/**
 * Evaluation result paired with the context that produced it.
 */
interface ContextProbeResult<T = unknown> {
    value: T;
    contextId: number | null;
    contextName: string | null;
    contextUrl: string | null;
}

/**
 * Prefer the active runtime context first, then fall back to any discovered contexts.
 */
function getOrderedContextTargets(cdpService: CdpService): ContextProbeTarget[] {
    const primaryId = cdpService.getPrimaryContextId?.() ?? null;
    const rawContexts = cdpService.getContexts?.() ?? [];
    const contexts = rawContexts
        .filter((ctx: any) => ctx && typeof ctx.id === 'number')
        .map((ctx: any) => ({
            id: ctx.id,
            name: typeof ctx.name === 'string' ? ctx.name : undefined,
            url: typeof ctx.url === 'string' ? ctx.url : undefined,
        }));

    if (contexts.length === 0) {
        return primaryId !== null ? [{ id: primaryId }] : [];
    }

    if (primaryId === null) {
        return contexts;
    }

    const primary = contexts.find((ctx) => ctx.id === primaryId);
    const ordered = primary ? [primary] : [{ id: primaryId }];
    for (const ctx of contexts) {
        if (ctx.id !== primaryId) ordered.push(ctx);
    }
    return ordered;
}

/**
 * Evaluate an expression across known runtime contexts until one returns an acceptable value.
 */
async function evaluateAcrossContexts<T = unknown>(
    cdpService: CdpService,
    expression: string,
    accept: (value: T) => boolean,
    options?: {
        awaitPromise?: boolean;
    },
): Promise<ContextProbeResult<T>> {
    const awaitPromise = options?.awaitPromise ?? true;
    const targets = getOrderedContextTargets(cdpService);
    let firstValue: ContextProbeResult<T> | null = null;
    let lastError: unknown = null;

    if (targets.length === 0) {
        const result = await cdpService.call('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise,
        });
        return {
            value: (result?.result?.value ?? null) as T,
            contextId: null,
            contextName: null,
            contextUrl: null,
        };
    }

    for (const target of targets) {
        try {
            const result = await cdpService.call('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise,
                contextId: target.id,
            });
            const value = (result?.result?.value ?? null) as T;
            const probed: ContextProbeResult<T> = {
                value,
                contextId: target.id,
                contextName: target.name ?? null,
                contextUrl: target.url ?? null,
            };
            if (!firstValue) firstValue = probed;
            if (accept(value)) {
                return probed;
            }
        } catch (error) {
            lastError = error;
        }
    }

    if (firstValue) {
        return firstValue;
    }

    if (lastError) {
        throw lastError;
    }

    return {
        value: null as T,
        contextId: null,
        contextName: null,
        contextUrl: null,
    };
}

/**
 * Capture the current assistant/output DOM state before sending a new prompt.
 * This avoids races where a fast reply is mistaken for baseline text.
 */
export async function captureResponseMonitorBaseline(
    cdpService: CdpService,
): Promise<ResponseMonitorBaselineSnapshot> {
    let text: string | null = null;
    let count = 0;
    const fingerprints: string[] = [];
    
    // Aggressive retry: wait up to 1 second for the DOM to settle if it looks empty
    for (let i = 0; i < 5; i++) {
        try {
            const result = await evaluateAcrossContexts<{text: string | null, index: number, count: number, fingerprints: string[]} | null>(
                cdpService,
                RESPONSE_SELECTORS.RESPONSE_TEXT,
                (value) => !!value && typeof (value as any).count === 'number',
            );
            const val = result.value;
            text = typeof val?.text === 'string' ? val.text.trim() || null : null;
            count = val?.count ?? 0;
            
            if (Array.isArray(val?.fingerprints)) {
                for (const fp of val.fingerprints) {
                    if (!fingerprints.includes(fp)) fingerprints.push(fp);
                }
            }
            
            // If we see nodes, consider it settled. If 0 nodes, maybe it's clearing? Wait a bit.
            if (count > 0) break;
            await new Promise(r => setTimeout(r, 200)); 
        } catch {
            text = null;
            count = 0;
        }
    }

    const processLogKeys = new Set<string>();
    try {
        const logResult = await evaluateAcrossContexts<string[] | null>(
            cdpService,
            RESPONSE_SELECTORS.PROCESS_LOGS,
            (value) => Array.isArray(value) && value.length > 0,
        );
        const logEntries = logResult.value;
        if (Array.isArray(logEntries)) {
            for (const entry of logEntries) {
                const key = String(entry || '').replace(/\r/g, '').trim().slice(0, 200);
                if (key) processLogKeys.add(key);
            }
        }
    } catch {
        // best-effort baseline capture
    }

    return {
        text,
        count,
        fingerprints,
        processLogKeys: Array.from(processLogKeys),
    };
}

/**
 * Lean AI response monitor.
 *
 * Each poll makes exactly 3 CDP calls: stop button, quota, text extraction.
 * Completion: stop button gone N consecutive times -> complete.
 * Simple baseline suppression via string comparison.
 * NO network event subscription.
 */
/**
 * Monitors the Antigravity UI for AI responses and execution logs.
 *
 * This class handles:
 * - Detecting when the AI starts and stops generating.
 * - Extracting text and structured content (tool calls, diffs) from the DOM.
 * - Monitoring the "Process Log" for diagnostic information.
 * - Handling CDP connection interruptions and reconnections.
 * - Providing real-time progress updates via callbacks.
 */
export class ResponseMonitor {
    private readonly cdpService: CdpService;
    private readonly pollIntervalMs: number;
    private readonly maxDurationMs: number;
    private readonly stopGoneConfirmCount: number;
    private readonly extractionMode: ExtractionMode;
    private readonly onProgress?: (text: string) => void;
    private readonly onComplete?: (finalText: string) => void;
    private readonly onTimeout?: (lastText: string) => void;
    private readonly onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    private readonly onProcessLog?: (text: string) => void;
    private readonly initialBaselineText?: string | null;
    private readonly initialBaselineCount?: number;
    private readonly initialBaselineFingerprints?: string[];
    private readonly initialSeenProcessLogKeys?: string[];

    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private isRunning: boolean = false;
    private lastText: string | null = null;
    private baselineText: string | null = null;
    private baselineCount: number = 0;
    private baselineFingerprints: Set<string> = new Set();
    private generationStarted: boolean = false;
    private currentPhase: ResponsePhase = 'waiting';
    private stopGoneCount: number = 0;
    private quotaDetected: boolean = false;
    private seenProcessLogKeys: Set<string> = new Set();
    private structuredDiagLogged: boolean = false;
    private lastContentContextId: number | null = null;

    // CDP disconnect handling (#48)
    private isPaused: boolean = false;
    private onCdpDisconnected: (() => void) | null = null;
    private onCdpReconnected: (() => void) | null = null;
    private onCdpReconnectFailed: ((err: Error) => void | Promise<void>) | null = null;

    // Activity-based timeout (#49)
    private lastActivityTime: number = 0;

    /**
     * Initializes a new ResponseMonitor instance.
     * @param options Configuration options for monitoring.
     */
    constructor(options: ResponseMonitorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.maxDurationMs = options.maxDurationMs ?? 900000;
        this.stopGoneConfirmCount = options.stopGoneConfirmCount ?? 3;
        this.extractionMode = options.extractionMode ?? 'structured';
        this.onProgress = options.onProgress;
        this.onComplete = options.onComplete;
        this.onTimeout = options.onTimeout;
        this.onPhaseChange = options.onPhaseChange;
        this.onProcessLog = options.onProcessLog;
        this.initialBaselineText = options.initialBaselineText;
        this.initialBaselineCount = options.initialBaselineCount;
        this.initialBaselineFingerprints = options.initialBaselineFingerprints;
        this.initialSeenProcessLogKeys = options.initialSeenProcessLogKeys;
    }

    /** Start monitoring */
    async start(): Promise<void> {
        return this.initMonitoring(false);
    }

    /**
     * Start monitoring in passive mode.
     * Same as start() but with generationStarted=true, so text changes
     * are detected immediately without waiting for the stop button to appear.
     * Used when joining an existing session that may already be generating.
     */
    async startPassive(): Promise<void> {
        return this.initMonitoring(true);
    }

    /** Internal initialization shared between start() and startPassive() */
    private async initMonitoring(passive: boolean): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isPaused = false;
        this.lastText = null;
        this.baselineText = this.initialBaselineText ?? null;
        this.baselineCount = this.initialBaselineCount ?? 0;
        this.baselineFingerprints = new Set(this.initialBaselineFingerprints || []);
        this.generationStarted = passive;
        this.currentPhase = passive ? 'generating' : 'waiting';
        this.stopGoneCount = 0;
        this.quotaDetected = false;
        this.seenProcessLogKeys = new Set();

        this.onPhaseChange?.(this.currentPhase, null);

        if (this.initialBaselineText !== undefined) {
            this.baselineText = this.initialBaselineText;
        } else {
            try {
                const baseResult = await this.evaluateAcrossContexts<string | null>(
                    RESPONSE_SELECTORS.RESPONSE_TEXT,
                    (value) => typeof value === 'string' && value.trim().length > 0,
                );
                this.baselineText = typeof baseResult.value === 'string' ? baseResult.value.trim() || null : null;
            } catch {
                this.baselineText = null;
            }
        }

        if (this.initialSeenProcessLogKeys !== undefined) {
            this.seenProcessLogKeys = new Set(
                this.initialSeenProcessLogKeys
                    .map((s) => (s || '').replace(/\r/g, '').trim())
                    .filter((s) => s.length > 0)
                    .map((s) => s.slice(0, 200)),
            );
        } else {
            try {
                const logResult = await this.evaluateAcrossContexts<string[] | null>(
                    RESPONSE_SELECTORS.PROCESS_LOGS,
                    (value) => Array.isArray(value) && value.length > 0,
                );
                const logEntries = logResult.value;
                if (Array.isArray(logEntries)) {
                    this.seenProcessLogKeys = new Set(
                        logEntries
                            .map((s: string) => (s || '').replace(/\r/g, '').trim())
                            .filter((s: string) => s.length > 0)
                            .map((s: string) => s.slice(0, 200)),
                    );
                }
            } catch {
                // baseline capture only
            }
        }

        // In structured mode, also capture activity lines from the structured
        // extraction to align the baseline with polling logic. The PROCESS_LOGS
        // script skips <details> content, but structured extraction (Pass 2)
        // explicitly walks <details> elements — without this, tool-call/thinking
        // entries from previous turns leak into the process log as "new" entries.
        if (this.extractionMode === 'structured') {
            try {
                const structuredBaseline = await this.evaluateAcrossContexts<unknown>(
                    RESPONSE_SELECTORS.RESPONSE_STRUCTURED,
                    (value) => classifyAssistantSegments(value).diagnostics.source === 'dom-structured',
                );
                const baselineClassified = classifyAssistantSegments(structuredBaseline.value);
                if (baselineClassified.diagnostics.source === 'dom-structured') {
                    for (const line of baselineClassified.activityLines) {
                        const key = (line || '').replace(/\r/g, '').trim().slice(0, 200);
                        if (key) this.seenProcessLogKeys.add(key);
                    }
                }
            } catch {
                // structured baseline is best-effort
            }
        }

        // Activity-based timeout: track last activity time instead of fixed timer (#49)
        this.lastActivityTime = Date.now();

        // Register CDP connection event listeners (#48)
        this.registerCdpConnectionListeners();

        const mode = passive ? 'Passive monitoring' : 'Monitoring';
        logger.debug(
            `── ${mode} started | poll=${this.pollIntervalMs}ms inactivityTimeout=${this.maxDurationMs / 1000}s baseline=${this.baselineText?.length ?? 0}ch`,
        );

        this.schedulePoll();
    }

    /**
     * Stop monitoring and clean up resources.
     * Unregisters CDP listeners and clears polling timers.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        this.isPaused = false;
        this.unregisterCdpConnectionListeners();
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Get current phase */
    getPhase(): ResponsePhase {
        return this.currentPhase;
    }

    /** Whether quota error was detected */
    getQuotaDetected(): boolean {
        return this.quotaDetected;
    }

    /** Whether monitoring is active */
    isActive(): boolean {
        return this.isRunning;
    }

    /** Get last extracted text */
    getLastText(): string | null {
        return this.lastText;
    }

    /** Click the stop button to interrupt LLM generation */
    async clickStopButton(): Promise<{ ok: boolean; method?: string; error?: string }> {
        try {
            const result = await this.evaluateAcrossContexts<{ ok?: boolean; method?: string; error?: string } | null>(
                RESPONSE_SELECTORS.CLICK_STOP_BUTTON,
                (value) => !!(value && typeof value === 'object' && (value as any).ok),
            );
            const value = result.value;

            if (this.isRunning) {
                await this.stop();
            }

            if (value && typeof value.ok === 'boolean') {
                return value as { ok: boolean; method?: string; error?: string };
            }

            return { ok: false, error: 'CDP evaluation returned empty' };
        } catch (error: any) {
            return { ok: false, error: error.message || 'Failed to click stop button' };
        }
    }

    private setPhase(phase: ResponsePhase, text: string | null): void {
        if (this.currentPhase !== phase) {
            this.currentPhase = phase;
            const len = text?.length ?? 0;
            switch (phase) {
                case 'thinking':
                    logger.phase('Thinking');
                    break;
                case 'generating':
                    logger.phase(`Generating (${len} chars)`);
                    break;
                case 'complete':
                    logger.done(`Complete (${len} chars)`);
                    break;
                case 'timeout':
                    logger.warn(`Timeout (${len} chars captured)`);
                    break;
                case 'quotaReached':
                    logger.warn('Quota Reached');
                    break;
                case 'disconnected':
                    logger.warn(`CDP Disconnected — paused (${len} chars captured)`);
                    break;
                default:
                    logger.phase(`${phase}`);
            }
            this.onPhaseChange?.(phase, text);
        }
    }

    private registerCdpConnectionListeners(): void {
        this.onCdpDisconnected = () => {
            if (!this.isRunning) return;
            logger.warn('[ResponseMonitor] CDP disconnected — pausing poll');
            this.isPaused = true;
            if (this.pollTimer) {
                clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            this.setPhase('disconnected', this.lastText);
        };

        this.onCdpReconnected = () => {
            if (!this.isRunning) return;
            logger.warn('[ResponseMonitor] CDP reconnected — resuming poll');
            this.isPaused = false;
            this.lastActivityTime = Date.now();
            const resumePhase = this.generationStarted ? 'generating' : 'waiting';
            this.setPhase(resumePhase, this.lastText);
            this.schedulePoll();
        };

        this.onCdpReconnectFailed = async (err: Error) => {
            if (!this.isRunning) return;
            logger.error('[ResponseMonitor] CDP reconnection failed — stopping monitor:', err.message);
            const lastText = this.lastText ?? '';
            this.setPhase('disconnected', lastText);
            await this.stop();
            try {
                await Promise.resolve(this.onTimeout?.(lastText));
            } catch (error) {
                logger.error('[ResponseMonitor] timeout callback failed:', error);
            }
        };

        this.cdpService.on('disconnected', this.onCdpDisconnected);
        this.cdpService.on('reconnected', this.onCdpReconnected);
        this.cdpService.on('reconnectFailed', this.onCdpReconnectFailed);
    }

    private unregisterCdpConnectionListeners(): void {
        if (this.onCdpDisconnected) {
            this.cdpService.removeListener('disconnected', this.onCdpDisconnected);
            this.onCdpDisconnected = null;
        }
        if (this.onCdpReconnected) {
            this.cdpService.removeListener('reconnected', this.onCdpReconnected);
            this.onCdpReconnected = null;
        }
        if (this.onCdpReconnectFailed) {
            this.cdpService.removeListener('reconnectFailed', this.onCdpReconnectFailed);
            this.onCdpReconnectFailed = null;
        }
    }

    private schedulePoll(): void {
        if (!this.isRunning || this.isPaused) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    private async evaluateAcrossContexts<T = unknown>(
        expression: string,
        accept: (value: T) => boolean,
    ): Promise<ContextProbeResult<T>> {
        const result = await evaluateAcrossContexts<T>(this.cdpService, expression, accept, {
            awaitPromise: true,
        });
        if (
            result.contextId !== null
            && accept(result.value)
            && this.lastContentContextId !== result.contextId
        ) {
            this.lastContentContextId = result.contextId;
            logger.debug(
                `[ResponseMonitor] Using context ${result.contextId} (${result.contextName ?? 'unknown'} | ${result.contextUrl ?? 'no-url'})`,
            );
        }
        return result;
    }

    private async logStructuredExtractionDiagnostics(payload: unknown): Promise<void> {
        try {
            const dumpResult = await this.evaluateAcrossContexts<any[] | null>(
                RESPONSE_SELECTORS.DUMP_ALL_TEXTS,
                (value) => Array.isArray(value) && value.length > 0,
            );
            const dumpValue = Array.isArray(dumpResult.value) ? dumpResult.value : [];
            const accepted = dumpValue.filter((entry: any) => !entry?.skip).slice(0, 5);
            const skipped = dumpValue.filter((entry: any) => entry?.skip).slice(0, 5);

            logger.warn(
                `[ResponseMonitor:diag] Structured payload invalid — ${dumpValue.length} candidate(s), ` +
                `${accepted.length} accepted, ${skipped.length} skipped ` +
                `(context=${dumpResult.contextId ?? 'none'})`,
            );
            logger.debug(
                '[ResponseMonitor:diag] Candidate details:',
                JSON.stringify({
                    payloadType: payload === null ? 'null' : typeof payload,
                    contextId: dumpResult.contextId,
                    contextUrl: dumpResult.contextUrl,
                    totalCandidates: dumpValue.length,
                    accepted: accepted.map((entry: any) => ({
                        sel: entry.sel,
                        len: entry.len,
                        preview: entry.preview,
                    })),
                    skipped: skipped.map((entry: any) => ({
                        sel: entry.sel,
                        skip: entry.skip,
                        len: entry.len,
                        preview: entry.preview,
                    })),
                }),
            );
        } catch (error) {
            logger.warn('[ResponseMonitor:diag] DUMP_ALL_TEXTS failed:', error);
        }

        try {
            const domResult = await this.evaluateAcrossContexts<any>(
                RESPONSE_SELECTORS.DOM_DIAGNOSTIC,
                (value) => !!value && typeof value === 'object' && (
                    Array.isArray((value as any).allTextNodes)
                    || Array.isArray((value as any).activityNodes)
                    || Array.isArray((value as any).detailsDump)
                ),
            );
            const domValue = domResult.value;
            logger.warn(
                `[ResponseMonitor:diag] DOM_DIAGNOSTIC — ` +
                `details=${domValue?.detailsCount ?? 0}, ` +
                `activity=${Array.isArray(domValue?.activityNodes) ? domValue.activityNodes.length : 0}, ` +
                `textNodes=${Array.isArray(domValue?.allTextNodes) ? domValue.allTextNodes.length : 0} ` +
                `(context=${domResult.contextId ?? 'none'})`,
            );
            logger.debug(
                '[ResponseMonitor:diag] DOM_DIAGNOSTIC details:',
                JSON.stringify({
                    contextId: domResult.contextId,
                    contextUrl: domResult.contextUrl,
                    detailsCount: domValue?.detailsCount ?? null,
                    detailsDump: Array.isArray(domValue?.detailsDump) ? domValue.detailsDump.slice(0, 3) : [],
                    activityNodes: Array.isArray(domValue?.activityNodes) ? domValue.activityNodes.slice(0, 5) : [],
                    allTextNodes: Array.isArray(domValue?.allTextNodes) ? domValue.allTextNodes.slice(0, 5) : [],
                }),
            );
        } catch (error) {
            logger.warn('[ResponseMonitor:diag] DOM_DIAGNOSTIC failed:', error);
        }
    }

    /**
     * Emit new process log entries, deduplicating against previously seen keys.
     */
    private emitNewProcessLogs(entries: string[]): void {
        const newEntries: string[] = [];
        for (const line of entries) {
            const normalized = (line || '').replace(/\r/g, '').trim();
            if (!normalized) continue;
            const key = normalized.slice(0, 200);
            if (this.seenProcessLogKeys.has(key)) continue;
            this.seenProcessLogKeys.add(key);
            newEntries.push(normalized.slice(0, 300));
        }
        if (newEntries.length > 0) {
            this.lastActivityTime = Date.now();
            try {
                this.onProcessLog?.(newEntries.join('\n\n'));
            } catch {
                // callback error
            }
        }
    }

    /**
     * Single poll cycle.
     * - Legacy mode: 4 CDP calls (stop, quota, text, process logs).
     * - Structured mode: 3-4 CDP calls (stop, quota, structured; legacy text on fallback).
     */
    private async poll(): Promise<void> {
        try {
            // 1. Stop button check
            const stopResult = await this.evaluateAcrossContexts<{ isGenerating?: boolean } | null>(
                RESPONSE_SELECTORS.STOP_BUTTON,
                (value) => !!(value && typeof value === 'object' && (value as any).isGenerating),
            );
            const stopValue = stopResult.value;
            const isGenerating = !!(stopValue && typeof stopValue === 'object' && (stopValue as any).isGenerating);

            // 2. Quota error check
            const quotaResult = await this.evaluateAcrossContexts<boolean | null>(
                RESPONSE_SELECTORS.QUOTA_ERROR,
                (value) => value === true,
            );
            const quotaDetected = quotaResult.value === true;

            // 3. Text extraction (structured or legacy)
            let currentText: string | null = null;
            let currentCount = 0;
            let currentIndex = -1;
            let structuredHandledLogs = false;

            if (this.extractionMode === 'structured') {
                // Structured: use DOM segment extraction with HTML-to-Markdown
                try {
                    const structuredResult = await this.evaluateAcrossContexts<unknown>(
                        RESPONSE_SELECTORS.RESPONSE_STRUCTURED,
                        (value) => classifyAssistantSegments(value).diagnostics.source === 'dom-structured',
                    );
                    const payload = structuredResult.value;
                    const classified = classifyAssistantSegments(payload);

                    if (classified.diagnostics.source === 'dom-structured') {
                        currentText = classified.finalOutputText.trim() || null;
                        structuredHandledLogs = true;

                        if (!this.structuredDiagLogged) {
                            this.structuredDiagLogged = true;
                            logger.debug('[ResponseMonitor] Structured extraction OK — segments:', classified.diagnostics.segmentCounts);
                        }

                        // Emit structured activity lines as process logs
                        if (classified.activityLines.length > 0) {
                            this.emitNewProcessLogs(classified.activityLines);
                        }
                    } else if (!this.structuredDiagLogged) {
                        this.structuredDiagLogged = true;
                        logger.warn(
                            '[ResponseMonitor:poll] Structured extraction failed — reason:',
                            classified.diagnostics.fallbackReason ?? 'unknown',
                            '| payload type:', typeof payload,
                            '| payload:', payload === null ? 'null' : payload === undefined ? 'undefined' : 'object',
                        );
                        await this.logStructuredExtractionDiagnostics(payload);
                    }
                } catch (error) {
                    logger.warn('[ResponseMonitor:poll] RESPONSE_STRUCTURED failed, falling back to legacy:', error);
                }
            }

            // Legacy path for index, count, and fingerprint (always run this to ensure baseline suppression works)
            let currentFingerprint: string | null = null;
            let legacyText: string | null = null;
            
            try {
                const result = await this.evaluateAcrossContexts<{text: string | null, index: number, count: number, fingerprint: string | null} | null>(
                    RESPONSE_SELECTORS.RESPONSE_TEXT,
                    (value) => !!value && typeof (value as any).index === 'number',
                );
                legacyText = typeof result.value?.text === 'string' ? result.value.text.trim() || null : null;
                currentIndex = result.value?.index ?? -1;
                currentCount = result.value?.count ?? 0;
                currentFingerprint = result.value?.fingerprint ?? null;
            } catch (err) {
                // Ignore errors here
            }

            // Fallback text if structured extraction failed
            if (currentText === null) {
                currentText = legacyText;
            }

            // Normalization helper for baseline comparison
            const normalize = (t: string | null) => (t || '').replace(/[\s\r\n]+/g, ' ').trim();

            // 4. Process log extraction — always when structured didn't handle it
            if (!structuredHandledLogs) {
                try {
                    const logResult = await this.evaluateAcrossContexts<string[] | null>(
                        RESPONSE_SELECTORS.PROCESS_LOGS,
                        (value) => Array.isArray(value) && value.length > 0,
                    );
                    const logEntries = logResult.value;
                    if (Array.isArray(logEntries)) {
                        this.emitNewProcessLogs(logEntries);
                    }
                } catch {
                    // process log extraction is best-effort
                }
            }

            // Handle stop button appearing
            if (isGenerating) {
                this.lastActivityTime = Date.now();
                if (!this.generationStarted) {
                    this.generationStarted = true;
                    this.setPhase('thinking', null);
                }
                this.stopGoneCount = 0;
            }

            // Handle quota detection
            if (quotaDetected) {
                const hasText = !!(this.lastText && this.lastText.trim().length > 0);
                logger.warn(`[ResponseMonitor] quota detected hasText=${hasText}`);
                if (hasText) {
                    this.quotaDetected = true;
                } else {
                    this.setPhase('quotaReached', '');
                    await this.stop();
                    try {
                        await Promise.resolve(this.onComplete?.(''));
                    } catch (error) {
                        logger.error('[ResponseMonitor] complete callback failed:', error);
                    }
                    return;
                }
            }

            // Check if structured text and legacy text are looking at the same node
            let applyLegacySuppression = false;
            if (currentText === null || legacyText === null) {
                applyLegacySuppression = true;
            } else {
                applyLegacySuppression = normalize(currentText) === normalize(legacyText);
            }

            // Baseline suppression: do not emit progress for pre-existing text.
            const isBaseline = currentText !== null && this.baselineText !== null && normalize(currentText) === normalize(this.baselineText);
            
            let isOldNode = false;
            let isBlacklisted = false;
            
            if (applyLegacySuppression) {
                isOldNode = currentIndex >= 0 && currentIndex < this.baselineCount;
                isBlacklisted = currentFingerprint !== null && this.baselineFingerprints.has(currentFingerprint);
            }

            const countHasIncreased = currentCount > this.baselineCount;
            
            const effectiveText = (isOldNode || isBlacklisted || (isBaseline && this.lastText === null && !countHasIncreased)) ? null : currentText;

            // Text change handling
            const textChanged = effectiveText !== null && effectiveText !== this.lastText;
            if (textChanged) {
                // If we haven't detected generation start yet (no stop button), 
                // be very conservative about emitting text changes unless they are clearly different from baseline.
                if (!this.generationStarted && !isGenerating && isBaseline) {
                    // Still looking at old text, skip
                } else {
                    this.lastActivityTime = Date.now();
                    this.lastText = effectiveText;

                    if (this.currentPhase === 'waiting' || this.currentPhase === 'thinking') {
                        this.setPhase('generating', effectiveText);
                        if (!this.generationStarted) {
                            this.generationStarted = true;
                        }
                    }

                    this.onProgress?.(effectiveText);
                }
            }

            // Completion: stop button gone N consecutive times
            if (!isGenerating && this.generationStarted) {
                this.stopGoneCount++;
                if (this.stopGoneCount >= this.stopGoneConfirmCount) {
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    try {
                        await Promise.resolve(this.onComplete?.(finalText));
                    } catch (error) {
                        logger.error('[ResponseMonitor] complete callback failed:', error);
                    }
                    return;
                }
            }

            // Activity-based inactivity timeout (#49)
            // Guard: never timeout while the stop button is visible — it means
            // Antigravity is still actively generating (extended thinking, long
            // shell commands, large file operations, etc.).
            if (this.maxDurationMs > 0 && !isGenerating && Date.now() - this.lastActivityTime >= this.maxDurationMs) {
                const lastText = this.lastText ?? '';
                this.setPhase('timeout', lastText);
                await this.stop();
                try {
                    await Promise.resolve(this.onTimeout?.(lastText));
                } catch (error) {
                    logger.error('[ResponseMonitor] timeout callback failed:', error);
                }
                return;
            }
        } catch (error) {
            logger.error('[ResponseMonitor] poll error:', error);
        }
    }
}
