/**
 * @jest-environment jsdom
 */

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

    describe('Task 1 & Task 2 & Task 3: DOM抽出とMarkdown構造/ファイル参照復元', () => {
        beforeEach(() => {
            // JSDOMがない場合でも動くように最低限のモックか、JSDOMならそのままDOMを使う
            document.body.innerHTML = '';
        });

        it('抽出スクリプトが箇条書きやファイル参照の構造を保持して抽出できること', () => {
            // テスト用DOMの構築
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            const message = document.createElement('div');
            message.setAttribute('data-message-role', 'assistant');

            // 番号付きリスト・箇条書き
            const ol = document.createElement('ol');
            const li1 = document.createElement('li');
            li1.textContent = '最初の項目';
            const li2 = document.createElement('li');
            li2.textContent = '次の項目';
            ol.appendChild(li1);
            ol.appendChild(li2);

            const ul = document.createElement('ul');
            const li3 = document.createElement('li');
            li3.textContent = '箇条書き1';
            ul.appendChild(li3);

            // 段落と改行
            const p = document.createElement('p');
            p.textContent = '改行付き\nの段落';

            // ファイル参照 (title や aria-label でパス保持されていると想定)
            const fileRef = document.createElement('div');
            fileRef.setAttribute('title', 'src/bot/index.ts');
            fileRef.textContent = ':54';

            message.appendChild(p);
            message.appendChild(ol);
            message.appendChild(ul);
            message.appendChild(fileRef);
            panel.appendChild(message);
            document.body.appendChild(panel);

            // 抽出スクリプトの評価実行
            const script = extractAssistantSegmentsPayloadScript();

            // 抽出関数の即時実行
            let payload: any;
            try {
                // To avoid SyntaxError from evaluating an IIFE directly, we assign it.
                // We use global eval trick: (1, eval)(...); or just create a new function.
                // Wait, if it's evaluated in JSDOM, maybe we can append a script tag!
                const scriptEl = document.createElement('script');
                scriptEl.textContent = `window.__extractedPayload = ${script};`;
                document.body.appendChild(scriptEl);
                payload = (window as any).__extractedPayload;
            } catch (e) {
                console.error("Script eval error:", e);
                throw e;
            }
            const result = classifyAssistantSegments(payload);
            const output = result.finalOutputText;

            // 期待値: Markdown構造が保持されていること
            expect(output).toContain('1. 最初の項目');
            expect(output).toContain('2. 次の項目');
            expect(output).toContain('- 箇条書き1');
            expect(output).toContain('改行付き\nの段落');

            // 期待値: title 等からファイルパスが復元され "src/bot/index.ts:54" になること
            expect(output).toContain('src/bot/index.ts:54');
        });
    });
});
