/**
 * Structured DOM extraction for Antigravity assistant responses.
 *
 * Provides two functions:
 * - extractAssistantSegmentsPayloadScript() — Returns a CDP-evaluatable IIFE string
 *   that walks the DOM and returns a typed segment array.
 * - classifyAssistantSegments(payload) — Node.js-side classifier that converts
 *   the raw payload into finalOutputText, activityLines, feedback, and diagnostics.
 */

import { htmlToDiscordMarkdown } from '../utils/htmlToDiscordMarkdown';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssistantDomSegment {
    kind: 'assistant-body' | 'thinking' | 'tool-call' | 'tool-result' | 'feedback';
    text: string;
    role: 'assistant';
    messageIndex: number;
    domPath: string;
}

export interface AssistantDomSegmentPayload {
    source: 'dom-structured';
    extractedAt: number;
    segments: AssistantDomSegment[];
}

export interface ClassifyResult {
    finalOutputText: string;
    activityLines: string[];
    feedback: string[];
    diagnostics: {
        source: 'dom-structured' | 'legacy-fallback';
        segmentCounts: Record<string, number>;
        fallbackReason?: string;
    };
}

// ---------------------------------------------------------------------------
// classifyAssistantSegments — Node.js side
// ---------------------------------------------------------------------------

/**
 * Classify an AssistantDomSegmentPayload into output text, activity lines,
 * feedback, and diagnostics.
 *
 * If the payload is invalid, returns a legacy-fallback result with empty fields.
 */
let _htmlDiagLogged = false;

export function classifyAssistantSegments(payload: unknown): ClassifyResult {
    if (!isValidPayload(payload)) {
        return {
            finalOutputText: '',
            activityLines: [],
            feedback: [],
            diagnostics: {
                source: 'legacy-fallback',
                segmentCounts: {},
                fallbackReason: 'invalid-payload',
            },
        };
    }

    const typed = payload as AssistantDomSegmentPayload;
    const segments = typed.segments;

    const bodyTexts: string[] = [];
    const activityLines: string[] = [];
    const feedbackTexts: string[] = [];
    const segmentCounts: Record<string, number> = {};

    for (const seg of segments) {
        segmentCounts[seg.kind] = (segmentCounts[seg.kind] ?? 0) + 1;

        switch (seg.kind) {
            case 'assistant-body':
                if (seg.text && seg.text.trim()) {
                    bodyTexts.push(seg.text);
                }
                break;
            case 'thinking':
            case 'tool-call':
            case 'tool-result':
                if (seg.text && seg.text.trim()) {
                    activityLines.push(seg.text.trim());
                }
                break;
            case 'feedback':
                if (seg.text && seg.text.trim()) {
                    feedbackTexts.push(seg.text.trim());
                }
                break;
        }
    }

    // Join body segments and apply HTML-to-Markdown conversion
    const rawBody = bodyTexts.join('\n\n');

    // Diagnostic: log a snippet of the raw HTML once for debugging
    if (rawBody.length > 0 && !_htmlDiagLogged) {
        _htmlDiagLogged = true;
        const preIdx = rawBody.toLowerCase().indexOf('<pre');
        if (preIdx >= 0) {
            logger.debug('[AssistantDomExtractor] Raw HTML around <pre>:', rawBody.slice(preIdx, preIdx + 500));
        } else {
            logger.debug('[AssistantDomExtractor] No <pre> found. Raw HTML sample:', rawBody.slice(0, 500));
        }
    }

    const finalOutputText = htmlToDiscordMarkdown(rawBody);

    return {
        finalOutputText,
        activityLines,
        feedback: feedbackTexts,
        diagnostics: {
            source: 'dom-structured',
            segmentCounts,
        },
    };
}

// ---------------------------------------------------------------------------
// extractAssistantSegmentsPayloadScript — CDP IIFE
// ---------------------------------------------------------------------------

/**
 * Return a CDP-evaluatable IIFE string that walks the Antigravity DOM
 * and returns an AssistantDomSegmentPayload object.
 *
 * The IIFE extracts:
 * - assistant-body segments (innerHTML for Markdown conversion)
 * - thinking segments (from <details> summary text)
 * - tool-call / tool-result segments (from <details> content)
 * - feedback segments (Good/Bad buttons)
 */
export function extractAssistantSegmentsPayloadScript(): string {
    // The IIFE is a plain string evaluated in the browser context via CDP.
    // It MUST NOT reference any Node.js module or import.
    //
    // Uses the same multi-selector strategy as RESPONSE_TEXT to find
    // assistant content nodes in Antigravity's DOM.
    return `(() => {
    var panel = document.querySelector('.antigravity-agent-side-panel');
    var scope = panel || document;

    // Same selectors as RESPONSE_TEXT — ordered by specificity
    var selectors = [
        '.rendered-markdown',
        '.leading-relaxed.select-text',
        '.flex.flex-col.gap-y-3',
        '[data-message-author-role="assistant"]',
        '[data-message-role="assistant"]',
        '[class*="assistant-message"]',
        '[class*="message-content"]',
        '[class*="markdown-body"]',
        '.prose',
    ];

    var looksLikeActivityLog = function(text) {
        var normalized = (text || '').trim().toLowerCase();
        if (!normalized) return false;
        if (/^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran)/i.test(normalized) && normalized.length <= 220) return true;
        if (/^initiating\\s/i.test(normalized) && normalized.length <= 500) return true;
        if (/^thought for\\s/i.test(normalized) && normalized.length <= 500) return true;
        return false;
    };

    var looksLikeFeedbackFooter = function(text) {
        var normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
        return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
    };

    var looksLikeToolOutput = function(text) {
        var first = (text || '').trim().split('\\n')[0] || '';
        if (/^[a-z0-9._-]+\\s*\\/\\s*[a-z0-9._-]+$/i.test(first)) return true;
        if (/^full output written to\\b/i.test(first)) return true;
        if (/^output\\.[a-z0-9._-]+(?:#l\\d+(?:-\\d+)?)?$/i.test(first)) return true;
        return false;
    };

    var isInsideExcludedContainer = function(node) {
        if (node.closest('details')) return true;
        if (node.closest('[class*="feedback"], footer')) return true;
        if (node.closest('.notify-user-container')) return true;
        return false;
    };

    var segments = [];
    var seen = new Set();
    var bodyFound = false;

    // Pass 1: Find assistant body — last non-excluded content node (recency first)
    var combinedSelector = selectors.join(', ');
    var nodes = scope.querySelectorAll(combinedSelector);

    for (var i = nodes.length - 1; i >= 0; i--) {
        var node = nodes[i];
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (isInsideExcludedContainer(node)) continue;

        var text = (node.innerText || node.textContent || '').replace(/\\r/g, '').trim();
        if (!text || text.length < 2) continue;
        if (looksLikeActivityLog(text)) continue;
        if (looksLikeFeedbackFooter(text)) continue;
        if (looksLikeToolOutput(text)) continue;

        // This is the assistant body — normalize code blocks then extract innerHTML
        // AG wraps code in <pre><div class="..."> with a header div for language label,
        // instead of standard <pre><code>. Normalize to <pre><code> for htmlToDiscordMarkdown.
        var clone = node.cloneNode(true);
        var pres = clone.querySelectorAll('pre');
        for (var pi = 0; pi < pres.length; pi++) {
            var pre = pres[pi];
            // Extract language from header div (font-sans text-sm class)
            var langDiv = pre.querySelector('.font-sans.text-sm, [class*="text-sm"][class*="opacity"]');
            var lang = langDiv ? (langDiv.textContent || '').trim() : '';
            // Get code text via innerText, then strip language label and copy-button text
            var codeText = (pre.innerText || '').trim();
            if (lang && codeText.startsWith(lang)) {
                codeText = codeText.slice(lang.length).trim();
            }
            // Remove trailing "Copy" or clipboard button text
            codeText = codeText.replace(/\\nCopy$/i, '').replace(/\\ncopy code$/i, '').trim();
            // Replace with simple <pre><code>
            var newPre = document.createElement('pre');
            var newCode = document.createElement('code');
            if (lang) newCode.setAttribute('class', 'language-' + lang);
            newCode.textContent = codeText;
            newPre.appendChild(newCode);
            pre.parentNode.replaceChild(newPre, pre);
        }
        var bodyHtml = clone.innerHTML;
        if (bodyHtml && bodyHtml.trim()) {
            segments.push({
                kind: 'assistant-body',
                text: bodyHtml,
                role: 'assistant',
                messageIndex: 0,
                domPath: 'multi-selector'
            });
            bodyFound = true;
            break; // Only take the last (most recent) output node
        }
    }

    // Pass 2: Extract thinking segments from <details> summaries
    var details = scope.querySelectorAll('details');
    for (var di = 0; di < details.length; di++) {
        var detail = details[di];
        var summary = detail.querySelector('summary');
        if (summary) {
            var summaryText = (summary.textContent || '').trim();
            if (summaryText) {
                segments.push({
                    kind: 'thinking',
                    text: summaryText,
                    role: 'assistant',
                    messageIndex: 0,
                    domPath: 'details:nth(' + di + ') summary'
                });
            }
        }
    }

    // Pass 3: Extract feedback buttons
    var feedbackBtns = scope.querySelectorAll('[class*="feedback"] button, footer button');
    for (var fi = 0; fi < feedbackBtns.length; fi++) {
        var btnText = (feedbackBtns[fi].textContent || '').trim();
        if (btnText === 'Good' || btnText === 'Bad') {
            segments.push({
                kind: 'feedback',
                text: btnText,
                role: 'assistant',
                messageIndex: 0,
                domPath: 'feedback button.' + btnText.toLowerCase()
            });
        }
    }

    if (!bodyFound && segments.length === 0) return null;

    return {
        source: 'dom-structured',
        extractedAt: Date.now(),
        segments: segments
    };
})()`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidPayload(value: unknown): value is AssistantDomSegmentPayload {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    if (obj.source !== 'dom-structured') return false;
    if (!Array.isArray(obj.segments)) return false;
    return true;
}
