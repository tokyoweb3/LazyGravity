export type AssistantDomSegmentKind =
    | 'assistant-body'
    | 'thinking'
    | 'tool-call'
    | 'tool-result'
    | 'feedback'
    | 'unknown';

export interface AssistantDomSegment {
    kind: AssistantDomSegmentKind;
    text: string;
    role?: string;
    messageIndex?: number;
    domPath?: string;
}

export interface AssistantDomSegmentPayload {
    source: 'dom-structured';
    extractedAt: number;
    segments: AssistantDomSegment[];
}

export interface ClassifiedAssistantSegments {
    finalOutputText: string;
    finalOutputSegments: AssistantDomSegment[];
    activityLines: string[];
    activitySegments: AssistantDomSegment[];
    feedback: string[];
    feedbackSegments: AssistantDomSegment[];
    diagnostics: {
        source: 'dom-structured' | 'legacy-fallback';
        fallbackReason?: string;
        segmentCounts: Record<string, number>;
    };
}

const ACTIVITY_KINDS = new Set<AssistantDomSegmentKind>(['thinking', 'tool-call', 'tool-result']);

function normalizeLine(text: string | null | undefined): string {
    return (text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function dedupePreserveOrder(lines: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of lines) {
        if (!line || seen.has(line)) continue;
        seen.add(line);
        unique.push(line);
    }
    return unique;
}

function buildSegmentCounts(segments: AssistantDomSegment[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const segment of segments) {
        counts[segment.kind] = (counts[segment.kind] || 0) + 1;
    }
    return counts;
}

export function classifyAssistantSegments(
    payload: AssistantDomSegmentPayload | null | undefined,
): ClassifiedAssistantSegments {
    if (!payload || !Array.isArray(payload.segments)) {
        return {
            finalOutputText: '',
            finalOutputSegments: [],
            activityLines: [],
            activitySegments: [],
            feedback: [],
            feedbackSegments: [],
            diagnostics: {
                source: 'legacy-fallback',
                fallbackReason: 'invalid-payload',
                segmentCounts: {},
            },
        };
    }

    const normalizedSegments = payload.segments
        .map((segment) => ({ ...segment, text: normalizeLine(segment.text) }))
        .filter((segment) => segment.text.length > 0);

    const finalOutputSegments = normalizedSegments.filter((segment) => segment.kind === 'assistant-body');
    const activitySegments = normalizedSegments.filter((segment) => ACTIVITY_KINDS.has(segment.kind));
    const feedbackSegments = normalizedSegments.filter((segment) => segment.kind === 'feedback');

    const finalOutputText = finalOutputSegments.map((segment) => segment.text).join('\n\n').trim();
    const activityLines = dedupePreserveOrder(activitySegments.map((segment) => segment.text));
    const feedback = dedupePreserveOrder(feedbackSegments.map((segment) => segment.text));

    return {
        finalOutputText,
        finalOutputSegments,
        activityLines,
        activitySegments,
        feedback,
        feedbackSegments,
        diagnostics: {
            source: 'dom-structured',
            segmentCounts: buildSegmentCounts(normalizedSegments),
        },
    };
}

export function extractAssistantSegmentsPayloadScript(): string {
    return `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const root = panel || document;

        const normalize = (value) => (value || '').replace(/\\r/g, '').replace(/\\s+/g, ' ').trim();

        const inferKind = (node, text, role) => {
            const lower = text.toLowerCase();
            if (!lower) return 'unknown';

            const inFeedback = !!node.closest('[class*="feedback"], [data-feedback], footer');
            if (inFeedback || lower === 'good' || lower === 'bad' || lower === 'good bad') {
                return 'feedback';
            }

            const inDetails = !!node.closest('details');
            const classBlob = [
                node.getAttribute('class') || '',
                node.getAttribute('data-testid') || '',
                node.getAttribute('data-role') || '',
            ].join(' ').toLowerCase();

            if (inDetails && /tool result|tool-output|result/.test(classBlob)) return 'tool-result';
            if (inDetails && /tool call|tool-call|tool_input|tool/.test(classBlob)) return 'tool-call';
            if (inDetails && /thinking|reason|analysis|thought/.test(classBlob)) return 'thinking';
            if (inDetails) return 'thinking';

            if (/tool call|tool-call|jina-mcp-server\s*\/\s*search_web/.test(lower)) return 'tool-call';
            if (/full output written to|output\\.txt#l/.test(lower)) return 'tool-result';
            if (/analyzing|thinking|planning|processing|実行中|思考中|分析中/.test(lower) && lower.length <= 280) return 'thinking';

            if (role === 'assistant') return 'assistant-body';
            return 'unknown';
        };

        const buildPath = (el) => {
            if (!el || !el.tagName) return '';
            const id = el.getAttribute('id');
            if (id) return '#' + id;
            const role = el.getAttribute('data-message-role') || el.getAttribute('data-message-author-role');
            if (role) return '[data-message-role="' + role + '"]';
            return el.tagName.toLowerCase();
        };

        const messageNodes = Array.from(root.querySelectorAll('[data-message-role], [data-message-author-role], article, [class*="message"]'));
        const segments = [];

        for (let i = 0; i < messageNodes.length; i++) {
            const message = messageNodes[i];
            const role = message.getAttribute('data-message-role') || message.getAttribute('data-message-author-role') || '';
            const candidates = message.querySelectorAll('details summary, details [class*="tool"], details [class*="thinking"], [class*="feedback"], footer button, p, li, pre, div');

            const sourceNodes = candidates.length > 0 ? candidates : [message];
            for (const node of sourceNodes) {
                const text = normalize(node.innerText || node.textContent || '');
                if (!text) continue;
                const kind = inferKind(node, text, role);
                if (kind === 'unknown' && role !== 'assistant') continue;
                segments.push({
                    kind,
                    text,
                    role,
                    messageIndex: i,
                    domPath: buildPath(node),
                });
            }
        }

        return {
            source: 'dom-structured',
            extractedAt: Date.now(),
            segments,
        };
    })()`;
}
