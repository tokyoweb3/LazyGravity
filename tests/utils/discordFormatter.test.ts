import { formatForDiscord, sanitizeActivityLines, splitOutputAndLogs } from '../../src/utils/discordFormatter';

describe('discordFormatter', () => {
    describe('formatForDiscord', () => {
        it('テーブル行をコードブロックで囲む', () => {
            const input = ['通常行', '| a | b |', '|---|---|', '終端'].join('\n');
            const output = formatForDiscord(input);

            expect(output).toContain('```');
            expect(output).toContain('| a | b |');
            expect(output).toContain('終端');
        });
    });

    describe('splitOutputAndLogs', () => {
        it('処理ログ行を本文から分離する', () => {
            const input = ['最終回答です', 'Analyzing current workspace', 'もう一行の本文'].join('\n');
            const separated = splitOutputAndLogs(input);

            expect(separated.output).toContain('最終回答です');
            expect(separated.output).toContain('もう一行の本文');
            expect(separated.logs).toContain('Analyzing current workspace');
        });

        it('コードブロック内はログ扱いしない', () => {
            const input = ['```txt', 'Analyzing inside code block', '```'].join('\n');
            const separated = splitOutputAndLogs(input);

            expect(separated.output).toContain('Analyzing inside code block');
            expect(separated.logs).toBe('');
        });
    });

    describe('sanitizeActivityLines', () => {
        it('tool traceを除去する', () => {
            const input = ['tool call: mcp.search', 'Running tests', 'show details'].join('\n');
            const output = sanitizeActivityLines(input);

            expect(output).toContain('Running tests');
            expect(output).not.toContain('tool call');
            expect(output).not.toContain('show details');
        });
    });
});
