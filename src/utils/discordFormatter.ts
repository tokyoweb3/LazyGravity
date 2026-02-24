/**
 * Lean discordFormatter using Set-based UI chrome literal matching + small regex patterns.
 */

/** Known UI chrome literal strings (exact match after trim + lowercase) */
const UI_CHROME_LITERALS = new Set([
    'analyzed',
    'analyzing',
    'reading',
    'writing',
    'running',
    'searching',
    'planning',
    'thinking',
    'thinking...',
    'processing',
    'loading',
    'executing',
    'testing',
    'debugging',
    'read',
    'wrote',
    'ran',
    'good',
    'bad',
    'good bad',
    'show details',
    'json',
    'css',
    'html',
    'xml',
    'yaml',
    'toml',
    'sql',
    'graphql',
]);

/** Small regex patterns for UI chrome lines */
const UI_CHROME_REGEXES: RegExp[] = [
    /^[+-]\d+$/,                         // line number prefixes: +5, -3
    /^\d+\s*chars?$/i,                   // char counts: "120 chars"
    /^line\s+\d+/i,                      // editor positions: "line 5"
    /^col\s+\d+/i,                       // editor positions: "col 10"
    /^tool call:/i,                      // tool call traces
    /^tool result:/i,                    // tool result traces
    /^calling tool\b/i,                  // tool invocations
    /^tool response\b/i,                 // tool responses
    /^mcp\b/i,                           // MCP traces
    /^thought for\s*<?\d+/i,            // thought traces
    /^show details$/i,                   // UI button text
    /^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i,  // MCP server/tool format: "jina-mcp-server / search_web"
    /^full output written to\b/i,             // tool result redirect: "Full output written to ..."
    /^output\.[a-z0-9._-]+(?:#l\d+(?:-\d+)?)?$/i, // output file ref: "output.txt#L1-131"
];

/**
 * Check if a line is UI chrome (not real assistant output).
 */
function isUiChromeLine(line: string): boolean {
    const trimmed = (line || '').trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();

    if (UI_CHROME_LITERALS.has(lower)) return true;

    for (const re of UI_CHROME_REGEXES) {
        if (re.test(trimmed)) return true;
    }

    return false;
}

/**
 * Format text for Discord Embed display.
 * Wraps table lines and tree lines in code blocks.
 */
export function formatForDiscord(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inSpecialBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        const isTableLine =
            (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) ||
            /^\|[\s\-:]+\|/.test(trimmed);

        const isTreeLine = /[├└│┌┐┘┤┬┴┼]/.test(line) ||
            /^\s*[│├└]\s*──/.test(line) ||
            /^\s*\|.*──/.test(line);

        const isSpecialLine = isTableLine || isTreeLine;

        if (isSpecialLine && !inSpecialBlock) {
            result.push('```');
            inSpecialBlock = true;
            result.push(line);
        } else if (isSpecialLine && inSpecialBlock) {
            result.push(line);
        } else if (!isSpecialLine && inSpecialBlock) {
            result.push('```');
            inSpecialBlock = false;
            result.push(line);
        } else {
            result.push(line);
        }
    }

    if (inSpecialBlock) {
        result.push('```');
    }

    return result.join('\n');
}

/**
 * Split raw text into output (real content) and logs (UI chrome).
 * Code blocks are always preserved as output.
 */
export function splitOutputAndLogs(rawText: string): { output: string; logs: string } {
    const normalized = (rawText || '').replace(/\r/g, '');
    if (!normalized.trim()) {
        return { output: '', logs: '' };
    }

    const outputLines: string[] = [];
    const logLines: string[] = [];
    let inCodeBlock = false;

    const lines = normalized.split('\n');
    for (const line of lines) {
        const trimmed = (line || '').trim();

        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            outputLines.push(line);
            continue;
        }

        if (inCodeBlock) {
            outputLines.push(line);
            continue;
        }

        if (!trimmed) {
            outputLines.push(line);
            continue;
        }

        if (isUiChromeLine(trimmed)) {
            logLines.push(trimmed);
        } else {
            outputLines.push(line);
        }
    }

    const normalizeText = (text: string): string =>
        text
            .replace(/\n{3,}/g, '\n\n')
            .trim();

    return {
        output: normalizeText(outputLines.join('\n')),
        logs: normalizeText(logLines.join('\n')),
    };
}

/**
 * Remove UI chrome lines from activity text.
 */
export function sanitizeActivityLines(raw: string): string {
    const lines = (raw || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const kept = lines.filter((line) => !isUiChromeLine(line));

    return Array.from(new Set(kept)).join('\n');
}

