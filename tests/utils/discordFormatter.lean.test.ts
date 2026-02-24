/**
 * TDD RED phase: Lean discordFormatter tests.
 *
 * These tests define the expected behavior of the NEW simplified discordFormatter.
 * They should FAIL against the current implementation because they test the new
 * Set-based + simple-regex approach instead of the complex pattern soup.
 *
 * Key differences from current implementation:
 *   - splitOutputAndLogs uses a literal string Set for known UI chrome lines
 *   - Simple regex for: line number prefixes, char counts, file type labels, editor positions
 *   - NO PROCESS_LINE_PATTERN, PROCESS_KEYWORD_PATTERN, PROCESS_PARAGRAPH_PATTERN,
 *     FIRST_PERSON_PATTERN, ABSTRACT_PROGRESS_PATTERN, TOOL_TRACE_LINE_PATTERN,
 *     THINKING_* patterns
 *   - sanitizeActivityLines removes UI chrome using the same Set-based approach
 */

import {
    formatForDiscord,
    splitOutputAndLogs,
    sanitizeActivityLines,
} from '../../src/utils/discordFormatter';

describe('Lean discordFormatter (new API)', () => {
    // ---------------------------------------------------------------
    // Test 1: formatForDiscord wraps table lines in code blocks
    // ---------------------------------------------------------------
    it('formatForDiscord wraps table lines in code blocks', () => {
        const input = ['Normal text', '| col1 | col2 |', '|------|------|', '| a    | b    |', 'End'].join('\n');
        const output = formatForDiscord(input);

        expect(output).toContain('```');
        expect(output).toContain('| col1 | col2 |');
        expect(output).toContain('End');
        // Verify table lines are between code fences
        const lines = output.split('\n');
        const firstFence = lines.indexOf('```');
        const tableLine = lines.findIndex((l) => l.includes('| col1 | col2 |'));
        expect(firstFence).toBeLessThan(tableLine);
    });

    // ---------------------------------------------------------------
    // Test 2: formatForDiscord wraps tree lines in code blocks
    // ---------------------------------------------------------------
    it('formatForDiscord wraps tree lines in code blocks', () => {
        const input = ['Directory:', '├── src/', '│   ├── index.ts', '└── package.json'].join('\n');
        const output = formatForDiscord(input);

        expect(output).toContain('```');
        expect(output).toContain('├── src/');
    });

    // ---------------------------------------------------------------
    // Test 3: 'analyzed' is classified as log (UI chrome literal)
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'analyzed' is classified as log (UI chrome literal)", () => {
        const result = splitOutputAndLogs('analyzed');

        expect(result.logs).toContain('analyzed');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 4: 'thinking...' is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'thinking...' is classified as log", () => {
        const result = splitOutputAndLogs('thinking...');

        expect(result.logs).toContain('thinking...');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 5: 'good bad' is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'good bad' is classified as log", () => {
        const result = splitOutputAndLogs('good bad');

        expect(result.logs).toContain('good bad');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 6: 'tool call: xyz' is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'tool call: xyz' is classified as log", () => {
        const result = splitOutputAndLogs('tool call: xyz');

        expect(result.logs).toContain('tool call: xyz');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 7: '+5' (line number prefix) is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: '+5' (line number prefix) is classified as log", () => {
        const result = splitOutputAndLogs('+5');

        expect(result.logs).toContain('+5');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 8: 'css' (file type label) is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'css' (file type label) is classified as log", () => {
        const result = splitOutputAndLogs('css');

        expect(result.logs).toContain('css');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 9: normal assistant text is kept as output
    // ---------------------------------------------------------------
    it('splitOutputAndLogs: normal assistant text is kept as output', () => {
        const normalText = 'Here is the implementation of the authentication module with JWT tokens.';
        const result = splitOutputAndLogs(normalText);

        expect(result.output).toContain(normalText);
        expect(result.logs).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 10: code blocks are preserved as output (never classified as log)
    // ---------------------------------------------------------------
    it('splitOutputAndLogs: code blocks are preserved as output (never classified as log)', () => {
        const input = [
            '```typescript',
            'const analyzed = true;',
            'const thinking = "hello";',
            'const css = require("./style.css");',
            '```',
        ].join('\n');
        const result = splitOutputAndLogs(input);

        expect(result.output).toContain('const analyzed = true;');
        expect(result.output).toContain('const thinking = "hello";');
        expect(result.output).toContain('const css = require("./style.css");');
        expect(result.logs).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 11: sanitizeActivityLines removes UI chrome lines
    // ---------------------------------------------------------------
    it('sanitizeActivityLines removes UI chrome lines', () => {
        const input = [
            'analyzed',
            'thinking...',
            'good bad',
            'Actual status: running tests',
        ].join('\n');
        const result = sanitizeActivityLines(input);

        // UI chrome should be removed
        expect(result).not.toContain('analyzed');
        expect(result).not.toContain('thinking...');
        expect(result).not.toContain('good bad');
        // Actual activity should be kept
        expect(result).toContain('Actual status: running tests');
    });

    // ---------------------------------------------------------------
    // Test 12: splitOutputAndLogs separates mixed content correctly
    // ---------------------------------------------------------------
    it('splitOutputAndLogs separates mixed content (output + UI chrome)', () => {
        const input = 'This is the answer.\nanalyzed';
        const result = splitOutputAndLogs(input);

        expect(result.output).toContain('This is the answer.');
        expect(result.logs).toContain('analyzed');
    });

    // ---------------------------------------------------------------
    // Test 13: MCP server/tool format is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'jina-mcp-server / search_web' is classified as log", () => {
        const result = splitOutputAndLogs('jina-mcp-server / search_web');

        expect(result.logs).toContain('jina-mcp-server / search_web');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 14: Tool result redirect is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'Full output written to ...' is classified as log", () => {
        const result = splitOutputAndLogs('Full output written to /tmp/output.txt');

        expect(result.logs).toContain('Full output written to /tmp/output.txt');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 15: output.txt#L format is classified as log
    // ---------------------------------------------------------------
    it("splitOutputAndLogs: 'output.txt#L1-131' is classified as log", () => {
        const result = splitOutputAndLogs('output.txt#L1-131');

        expect(result.logs).toContain('output.txt#L1-131');
        expect(result.output).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 16: "Initiating..." should remain output (avoid narrative misclassification)
    // ---------------------------------------------------------------
    it('splitOutputAndLogs keeps initiating narrative in output', () => {
        const input = [
            'Initiating Task Execution',
            '',
            "I'm now preparing the next execution step.",
            '',
            'Final answer: done.',
        ].join('\n');

        const result = splitOutputAndLogs(input);

        expect(result.output).toContain('Initiating Task Execution');
        expect(result.output).toContain("I'm now preparing the next execution step.");
        expect(result.output).toContain('Final answer: done.');
        expect(result.logs).toBe('');
    });

    // ---------------------------------------------------------------
    // Test 17: "prioritizing/querying/retrieving" style narrative is output by default
    // ---------------------------------------------------------------
    it('splitOutputAndLogs keeps process-like narrative words in output', () => {
        const input = 'Prioritizing the next implementation steps.';
        const result = splitOutputAndLogs(input);

        expect(result.output).toContain(input);
        expect(result.logs).toBe('');
    });
});
