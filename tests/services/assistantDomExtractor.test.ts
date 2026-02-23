import {
    classifyAssistantSegments,
    extractAssistantSegmentsPayloadScript,
    type AssistantDomSegmentPayload,
    type AssistantDomSegment,
} from '../../src/services/assistantDomExtractor';

describe('assistantDomExtractor', () => {
    const buildPayload = (segments: AssistantDomSegment[]): AssistantDomSegmentPayload => ({
        source: 'dom-structured',
        extractedAt: 1700000000000,
        segments,
    });

    it('DOM構造に基づいて本文/アクティビティ/フィードバックを分離する', () => {
        const payload = buildPayload([
            {
                kind: 'assistant-body',
                text: '最終回答: 1ドル=154.8円です。',
                role: 'assistant',
                messageIndex: 9,
                domPath: '[data-message-role="assistant"]:nth-of-type(9)',
            },
            {
                kind: 'thinking',
                text: 'Analyzing current exchange data...',
                role: 'assistant',
                messageIndex: 9,
                domPath: 'details[open] summary',
            },
            {
                kind: 'tool-call',
                text: 'jina-mcp-server / search_web',
                role: 'assistant',
                messageIndex: 9,
                domPath: 'details[open] div.tool-call',
            },
            {
                kind: 'tool-result',
                text: 'Full output written to output.txt#L1-10',
                role: 'assistant',
                messageIndex: 9,
                domPath: 'details[open] div.tool-result',
            },
            {
                kind: 'feedback',
                text: 'Good',
                role: 'assistant',
                messageIndex: 9,
                domPath: 'footer.feedback button.good',
            },
            {
                kind: 'feedback',
                text: 'Bad',
                role: 'assistant',
                messageIndex: 9,
                domPath: 'footer.feedback button.bad',
            },
        ]);

        const result = classifyAssistantSegments(payload);

        expect(result.finalOutputText).toBe('最終回答: 1ドル=154.8円です。');
        expect(result.activityLines).toEqual([
            'Analyzing current exchange data...',
            'jina-mcp-server / search_web',
            'Full output written to output.txt#L1-10',
        ]);
        expect(result.feedback).toEqual(['Good', 'Bad']);
        expect(result.diagnostics.source).toBe('dom-structured');
        expect(result.diagnostics.segmentCounts['assistant-body']).toBe(1);
        expect(result.diagnostics.segmentCounts.feedback).toBe(2);
    });

    it('本文が複数セグメントに分かれていても結合できる', () => {
        const payload = buildPayload([
            {
                kind: 'assistant-body',
                text: '前半です。',
                role: 'assistant',
                messageIndex: 3,
                domPath: 'article:nth-child(3)',
            },
            {
                kind: 'assistant-body',
                text: '後半です。',
                role: 'assistant',
                messageIndex: 3,
                domPath: 'article:nth-child(3) p:last-child',
            },
            {
                kind: 'tool-call',
                text: 'mcp.search',
                role: 'assistant',
                messageIndex: 3,
                domPath: 'details summary',
            },
        ]);

        const result = classifyAssistantSegments(payload);

        expect(result.finalOutputText).toBe('前半です。\n\n後半です。');
        expect(result.activityLines).toEqual(['mcp.search']);
        expect(result.feedback).toEqual([]);
    });

    it('不正payloadはlegacy-fallback判定になる', () => {
        const result = classifyAssistantSegments(null);

        expect(result.finalOutputText).toBe('');
        expect(result.activityLines).toEqual([]);
        expect(result.feedback).toEqual([]);
        expect(result.diagnostics.source).toBe('legacy-fallback');
        expect(result.diagnostics.fallbackReason).toBe('invalid-payload');
    });

    it('抽出スクリプトがDOM構造抽出関数として返る', () => {
        const script = extractAssistantSegmentsPayloadScript();

        expect(typeof script).toBe('string');
        expect(script).toContain('data-message-role');
        expect(script).toContain('assistant-body');
        expect(script).toContain('details');
        expect(script).toContain('feedback');
    });
});
