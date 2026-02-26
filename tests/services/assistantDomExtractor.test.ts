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

    it('separates body, activity, and feedback based on DOM structure', () => {
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

    it('concatenates body text when split across multiple segments', () => {
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

    it('treats invalid payload as legacy-fallback', () => {
        const result = classifyAssistantSegments(null);

        expect(result.finalOutputText).toBe('');
        expect(result.activityLines).toEqual([]);
        expect(result.feedback).toEqual([]);
        expect(result.diagnostics.source).toBe('legacy-fallback');
        expect(result.diagnostics.fallbackReason).toBe('invalid-payload');
    });

    it('returns the extraction script as a DOM structure extraction function', () => {
        const script = extractAssistantSegmentsPayloadScript();

        expect(typeof script).toBe('string');
        expect(script).toContain('data-message-role');
        expect(script).toContain('assistant-body');
        expect(script).toContain('details');
        expect(script).toContain('feedback');
    });

    describe('Pass 2.5: broad activity scan captures non-selector-matched nodes', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
        });

        it('captures activity text from leaf-ish elements outside content selectors', () => {
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            // Activity node that does NOT match any content selector
            // (e.g. <div class="flex flex-row">Analyzed package.json#L1-75</div>)
            const activityContainer = document.createElement('div');
            activityContainer.className = 'flex flex-col space-y-2';
            const activityNode = document.createElement('div');
            activityNode.className = 'flex flex-row';
            activityNode.textContent = 'Analyzed package.json#L1-75';
            activityContainer.appendChild(activityNode);
            panel.appendChild(activityContainer);

            document.body.appendChild(panel);

            const script = extractAssistantSegmentsPayloadScript();
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `window.__pass25Payload = ${script};`;
            document.body.appendChild(scriptEl);
            const payload = (window as any).__pass25Payload;
            const result = classifyAssistantSegments(payload);

            expect(result.activityLines).toContain('Analyzed package.json#L1-75');
        });

        it('captures MCP tool output from non-selector-matched nodes', () => {
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            const toolNode = document.createElement('div');
            toolNode.className = 'flex flex-row';
            toolNode.textContent = 'jina-mcp-server / search_web';
            panel.appendChild(toolNode);

            document.body.appendChild(panel);

            const script = extractAssistantSegmentsPayloadScript();
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `window.__pass25McpPayload = ${script};`;
            document.body.appendChild(scriptEl);
            const payload = (window as any).__pass25McpPayload;
            const result = classifyAssistantSegments(payload);

            expect(result.activityLines).toContain('jina-mcp-server / search_web');
        });

        it('captures new activity verbs (fetching, creating, building, etc.)', () => {
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            const verbs = ['Fetching data from API', 'Creating new file', 'Building project', 'Connected to server'];
            for (const verb of verbs) {
                const node = document.createElement('div');
                node.className = 'flex flex-row';
                node.textContent = verb;
                panel.appendChild(node);
            }

            document.body.appendChild(panel);

            const script = extractAssistantSegmentsPayloadScript();
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `window.__pass25VerbsPayload = ${script};`;
            document.body.appendChild(scriptEl);
            const payload = (window as any).__pass25VerbsPayload;
            const result = classifyAssistantSegments(payload);

            for (const verb of verbs) {
                expect(result.activityLines).toContain(verb);
            }
        });

        it('skips mode description inside role="dialog" container', () => {
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            // AG mode selector popup: role="dialog" container
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            const modeOption = document.createElement('div');
            modeOption.className = 'flex flex-col';
            const modeName = document.createElement('div');
            modeName.className = 'font-medium';
            modeName.textContent = 'Planning';
            const modeDesc = document.createElement('div');
            modeDesc.className = 'text-xs opacity-50';
            modeDesc.textContent =
                'Agent can plan before executing tasks. Use for deep research, complex tasks, or collaborative work';
            modeOption.appendChild(modeName);
            modeOption.appendChild(modeDesc);
            dialog.appendChild(modeOption);
            panel.appendChild(dialog);

            document.body.appendChild(panel);

            const script = extractAssistantSegmentsPayloadScript();
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `window.__pass25DialogPayload = ${script};`;
            document.body.appendChild(scriptEl);
            const payload = (window as any).__pass25DialogPayload;
            const result = classifyAssistantSegments(payload);

            // Neither "Planning" nor the description should appear in activity
            expect(result.activityLines).toEqual([]);
        });

        it('skips container elements with more than 3 children', () => {
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            // Container with 4+ children should be skipped
            const container = document.createElement('div');
            container.className = 'flex flex-col';
            for (let i = 0; i < 5; i++) {
                const child = document.createElement('span');
                child.textContent = `Analyzed file${i}.ts`;
                container.appendChild(child);
            }
            panel.appendChild(container);

            document.body.appendChild(panel);

            const script = extractAssistantSegmentsPayloadScript();
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `window.__pass25ContainerPayload = ${script};`;
            document.body.appendChild(scriptEl);
            const payload = (window as any).__pass25ContainerPayload;
            const result = classifyAssistantSegments(payload);

            // The container div itself should NOT appear, but individual leaf children should
            const containerText = Array.from({ length: 5 }, (_, i) => `Analyzed file${i}.ts`).join('');
            expect(result.activityLines).not.toContain(containerText);
        });
    });

    describe('Task 1 & Task 2 & Task 3: DOM extraction and Markdown structure/file reference restoration', () => {
        beforeEach(() => {
            // Minimal mock for environments without JSDOM; use JSDOM DOM if available
            document.body.innerHTML = '';
        });

        it('preserves list structure and file references in extraction script output', () => {
            // Build test DOM
            const panel = document.createElement('div');
            panel.className = 'antigravity-agent-side-panel';

            const message = document.createElement('div');
            message.setAttribute('data-message-role', 'assistant');

            // Ordered and unordered lists
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

            // Paragraph with line break
            const p = document.createElement('p');
            p.textContent = '改行付き\nの段落';

            // File reference (assuming path is stored via title or aria-label)
            const fileRef = document.createElement('div');
            fileRef.setAttribute('title', 'src/bot/index.ts');
            fileRef.textContent = ':54';

            message.appendChild(p);
            message.appendChild(ol);
            message.appendChild(ul);
            message.appendChild(fileRef);
            panel.appendChild(message);
            document.body.appendChild(panel);

            // Evaluate the extraction script
            const script = extractAssistantSegmentsPayloadScript();

            // Execute the extraction function immediately
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

            // Expected: Markdown structure is preserved
            expect(output).toContain('1. 最初の項目');
            expect(output).toContain('2. 次の項目');
            expect(output).toContain('- 箇条書き1');
            expect(output).toContain('改行付き\nの段落');

            // Expected: file path is restored from title attribute to "src/bot/index.ts:54"
            expect(output).toContain('src/bot/index.ts:54');
        });
    });
});
