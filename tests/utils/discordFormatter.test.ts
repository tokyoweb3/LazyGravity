import {
    formatForDiscord,
    sanitizeActivityLines,
    splitOutputAndLogs,
    separateOutputForDelivery,
} from '../../src/utils/discordFormatter';

describe('discordFormatter', () => {
    describe('formatForDiscord', () => {
        it('wraps table rows in code blocks', () => {
            const input = ['通常行', '| a | b |', '|---|---|', '終端'].join('\n');
            const output = formatForDiscord(input);

            expect(output).toContain('```');
            expect(output).toContain('| a | b |');
            expect(output).toContain('終端');
        });

        it('Task 3: wraps file references (e.g. src/bot/index.ts:54) in backticks', () => {
            const input = '対象ファイルは src/bot/index.ts:54 です。';
            const output = formatForDiscord(input);
            expect(output).toContain('`src/bot/index.ts:54`');
            expect(output).not.toContain(' `src/bot/index.ts:54` です。'); // checking exact format maybe?
            // Test that it wraps the file name with line number
        });
    });

    describe('splitOutputAndLogs', () => {
        it('separates processing log lines from the main body', () => {
            const input = ['最終回答です', 'Analyzing current workspace', 'もう一行の本文'].join('\n');
            const separated = splitOutputAndLogs(input);

            expect(separated.output).toContain('最終回答です');
            expect(separated.output).toContain('もう一行の本文');
            expect(separated.logs).toContain('Analyzing current workspace');
        });

        it('does not treat lines inside code blocks as logs', () => {
            const input = ['```txt', 'Analyzing inside code block', '```'].join('\n');
            const separated = splitOutputAndLogs(input);

            expect(separated.output).toContain('Analyzing inside code block');
            expect(separated.logs).toBe('');
        });

        it('removes MCP tool logs and thinking text from the final output', () => {
            const input = [
                '今日の日本円ドル円レートは？',
                'jina-mcp-server / search_web',
                'json',
                '{',
                '"query": "今日 2026年2月23日 ドル円 レート"',
                '}',
                'Full output written to',
                'output.txt',
                'output.txt#L1-131',
                '',
                'Pinpointing a Future Rate',
                '',
                "Okay, I've got some search results, but they don't give me the specific rate I need.",
                'jina-mcp-server / search_web',
                'json',
                '{',
                '"query": "USD/JPY current rate 2026-02-23 21:00 JST"',
                '}',
                'Full output written to',
                'output.txt',
                'output.txt#L1-127',
                '',
                "I've just been looking at some recent data points concerning USD/JPY.",
                '',
                '2026年2月23日（月）現在のドル円レートは、1ドル＝154円台後半で推移しています。',
                '',
                'Good',
                'Bad',
            ].join('\n');

            const separated = splitOutputAndLogs(input);

            expect(separated.output).toContain('2026年2月23日（月）現在のドル円レートは、1ドル＝154円台後半で推移しています。');
            expect(separated.output).not.toContain('jina-mcp-server / search_web');
            expect(separated.output).not.toContain('Full output written to');
            expect(separated.output).not.toContain('Pinpointing a Future Rate');
            expect(separated.output).not.toContain("I've just been looking at some recent data points");
            expect(separated.output).not.toMatch(/\bGood\b/i);
            expect(separated.output).not.toMatch(/\bBad\b/i);
        });
    });

    describe('sanitizeActivityLines', () => {
        it('removes tool traces', () => {
            const input = ['tool call: mcp.search', 'Running tests', 'show details'].join('\n');
            const output = sanitizeActivityLines(input);

            expect(output).toContain('Running tests');
            expect(output).not.toContain('tool call');
            expect(output).not.toContain('show details');
        });
    });

    describe('separateOutputForDelivery', () => {
        it('prioritizes DOM results over raw string when DOM extraction succeeds', () => {
            const raw = [
                'jina-mcp-server / search_web',
                'Full output written to output.txt',
                '最終回答本文',
                'Good',
            ].join('\n');

            const separated = separateOutputForDelivery({
                rawText: raw,
                domSource: 'dom-structured',
                domOutputText: '最終回答本文',
                domActivityLines: ['jina-mcp-server / search_web'],
            });

            expect(separated.source).toBe('dom-structured');
            expect(separated.output).toBe('最終回答本文');
            expect(separated.logs).toBe('jina-mcp-server / search_web');
        });

        it('falls back to legacy string separation only when DOM extraction fails', () => {
            const raw = [
                'jina-mcp-server / search_web',
                'Full output written to',
                'output.txt#L1-10',
                '',
                '最終回答本文',
                '',
                'Good',
            ].join('\n');

            const separated = separateOutputForDelivery({
                rawText: raw,
                domSource: 'legacy-fallback',
            });

            expect(separated.source).toBe('legacy-fallback');
            expect(separated.output).toContain('最終回答本文');
            expect(separated.output).not.toContain('jina-mcp-server / search_web');
            expect(separated.logs).toContain('jina-mcp-server / search_web');
        });
    });
});
