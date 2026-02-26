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
        if (/^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|fetching|connecting|creating|updating|deleting|installing|building|compiling|deploying|checking|scanning|parsing|resolving|downloading|uploading|analyzed|read|wrote|ran|created|updated|deleted|fetched|built|compiled|installed|resolved|downloaded|connected)\\b/i.test(normalized) && normalized.length <= 220) return true;
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
        // embedded <style> tags, and code-line divs — NOT standard <pre><code>.
        // We normalize to <pre><code> for htmlToDiscordMarkdown.
        var clone = node.cloneNode(true);
        var pres = clone.querySelectorAll('pre');
        for (var pi = 0; pi < pres.length; pi++) {
            var pre = pres[pi];
            // Extract language from header div (font-sans text-sm class)
            var langDiv = pre.querySelector('.font-sans.text-sm, [class*="text-sm"][class*="opacity"]');
            var lang = langDiv ? (langDiv.textContent || '').trim() : '';

            // Remove <style> tags before extracting text (AG injects code-block CSS)
            var styles = pre.querySelectorAll('style');
            for (var si = 0; si < styles.length; si++) {
                styles[si].parentNode.removeChild(styles[si]);
            }

            // Remove the header bar (language label + copy button)
            var headerBar = pre.querySelector('[class*="rounded-t"][class*="border-b"]');
            if (headerBar) headerBar.parentNode.removeChild(headerBar);

            // Extract code text: prefer code-line elements for reliable newlines
            var codeLines = pre.querySelectorAll('.code-line, [class*="code-line"]');
            var codeText;
            if (codeLines.length > 0) {
                var lineTexts = [];
                for (var cli = 0; cli < codeLines.length; cli++) {
                    lineTexts.push(codeLines[cli].textContent || '');
                }
                codeText = lineTexts.join('\\n');
            } else {
                // Fallback: use innerText of cleaned pre
                codeText = (pre.innerText || '').trim();
                if (lang && codeText.startsWith(lang)) {
                    codeText = codeText.slice(lang.length).trim();
                }
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
        // Also remove any top-level <style> tags from the clone
        var topStyles = clone.querySelectorAll('style');
        for (var tsi = 0; tsi < topStyles.length; tsi++) {
            topStyles[tsi].parentNode.removeChild(topStyles[tsi]);
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

    // Pass 2: Extract thinking + tool segments from <details>
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
        // Extract child content (tool-call / tool-result) inside <details>
        var children = detail.children;
        for (var ci = 0; ci < children.length; ci++) {
            var child = children[ci];
            if (child.tagName === 'SUMMARY' || child.tagName === 'STYLE') continue;
            var childText = (child.innerText || child.textContent || '').trim();
            if (!childText || childText.length < 2) continue;
            var childKind = looksLikeToolOutput(childText) ? 'tool-result' : 'tool-call';
            segments.push({
                kind: childKind,
                text: childText.slice(0, 300),
                role: 'assistant',
                messageIndex: 0,
                domPath: 'details:nth(' + di + ') child:nth(' + ci + ')'
            });
        }
    }

    // Pass 2.5: Broad activity scan - leaf-ish elements with activity-like text
    // Uses querySelectorAll('*') to find activity nodes that don't match content
    // selectors (e.g. "Analyzed package.json#L1-75" inside <div class="flex flex-row">).
    // Excludes nodes inside response body containers to avoid false positives.
    // Uses ancestor dedup to prevent capturing both parent and child activity nodes.
    var actSeen = new Set();
    var allEls = scope.querySelectorAll('*');
    for (var ai = 0; ai < allEls.length; ai++) {
        var el = allEls[ai];
        if (el.children.length > 3) continue;       // leaf-ish only
        if (seen.has(el)) continue;                  // already captured in Pass 1/2
        if (isInsideExcludedContainer(el)) continue;
        // Skip nodes inside response body containers (prevents capturing inline words)
        if (el.closest('.leading-relaxed, .rendered-markdown, .prose, .animate-markdown, [data-message-role], [data-message-author-role]')) continue;
        var aText = (el.innerText || el.textContent || '').replace(/\\r/g, '').trim();
        if (!aText || aText.length < 4 || aText.length > 300) continue;
        if (looksLikeActivityLog(aText) || looksLikeToolOutput(aText)) {
            // Ancestor dedup: skip if a parent was already captured as activity
            var dup = false;
            var p = el.parentElement;
            while (p && p !== scope) {
                if (actSeen.has(p)) { dup = true; break; }
                p = p.parentElement;
            }
            if (dup) continue;
            actSeen.add(el);
            var aKind = looksLikeToolOutput(aText) ? 'tool-result' : 'tool-call';
            segments.push({
                kind: aKind,
                text: aText.slice(0, 300),
                role: 'assistant',
                messageIndex: 0,
                domPath: 'activity-scan:nth(' + ai + ')'
            });
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
