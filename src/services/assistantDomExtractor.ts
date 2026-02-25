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
    return `(() => {
    var panel = document.querySelector('.antigravity-agent-side-panel');
    var scope = panel || document;

    var messages = scope.querySelectorAll('[data-message-role="assistant"]');
    if (!messages || messages.length === 0) return null;

    var segments = [];

    for (var mi = 0; mi < messages.length; mi++) {
        var msg = messages[mi];
        var basePath = '[data-message-role="assistant"]:nth-of-type(' + (mi + 1) + ')';

        // Extract thinking / tool-call / tool-result from <details>
        var details = msg.querySelectorAll('details');
        for (var di = 0; di < details.length; di++) {
            var detail = details[di];

            // Summary → thinking
            var summary = detail.querySelector('summary');
            if (summary) {
                var summaryText = (summary.textContent || '').trim();
                if (summaryText) {
                    segments.push({
                        kind: 'thinking',
                        text: summaryText,
                        role: 'assistant',
                        messageIndex: mi,
                        domPath: basePath + ' details summary'
                    });
                }
            }

            // Tool calls inside details
            var toolCalls = detail.querySelectorAll('.tool-call, [class*="tool-call"]');
            for (var ti = 0; ti < toolCalls.length; ti++) {
                var tcText = (toolCalls[ti].textContent || '').trim();
                if (tcText) {
                    segments.push({
                        kind: 'tool-call',
                        text: tcText,
                        role: 'assistant',
                        messageIndex: mi,
                        domPath: basePath + ' details div.tool-call'
                    });
                }
            }

            // Tool results inside details
            var toolResults = detail.querySelectorAll('.tool-result, [class*="tool-result"]');
            for (var ri = 0; ri < toolResults.length; ri++) {
                var trText = (toolResults[ri].textContent || '').trim();
                if (trText) {
                    segments.push({
                        kind: 'tool-result',
                        text: trText,
                        role: 'assistant',
                        messageIndex: mi,
                        domPath: basePath + ' details div.tool-result'
                    });
                }
            }
        }

        // Extract feedback from buttons
        var feedbackBtns = msg.querySelectorAll('[class*="feedback"] button, footer button');
        for (var fi = 0; fi < feedbackBtns.length; fi++) {
            var btnText = (feedbackBtns[fi].textContent || '').trim();
            if (btnText === 'Good' || btnText === 'Bad') {
                segments.push({
                    kind: 'feedback',
                    text: btnText,
                    role: 'assistant',
                    messageIndex: mi,
                    domPath: basePath + ' footer.feedback button.' + btnText.toLowerCase()
                });
            }
        }

        // Extract assistant body: clone message, remove details and feedback, get innerHTML
        var clone = msg.cloneNode(true);
        var toRemove = clone.querySelectorAll('details, [class*="feedback"], footer');
        for (var ri2 = 0; ri2 < toRemove.length; ri2++) {
            toRemove[ri2].parentNode.removeChild(toRemove[ri2]);
        }

        var bodyHtml = clone.innerHTML;
        if (bodyHtml && bodyHtml.trim()) {
            segments.push({
                kind: 'assistant-body',
                text: bodyHtml,
                role: 'assistant',
                messageIndex: mi,
                domPath: basePath
            });
        }
    }

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
