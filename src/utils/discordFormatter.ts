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
    /^\s*\{\s*$/,                        // lone JSON opening brace
    /^\s*\}\s*$/,                        // lone JSON closing brace
    /^\s*"[^"]*"\s*:\s*/,               // JSON key-value line: "query": "..."
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

/** Regex matching file references like src/bot/index.ts:54 or tests/utils/config.ts.
 *  Consumes one trailing space so the replacement `\`ref\`` doesn't leave a double space. */
const FILE_REF_REGEX = /(?<![`/\\])(\b[a-zA-Z][\w.-]*(?:\/[\w.-]+)+(?::\d+(?:-\d+)?)?)\s?(?!`)/g;

/**
 * Format text for Discord Embed display.
 * Wraps table lines and tree lines in code blocks.
 * Wraps file references (e.g. src/bot/index.ts:54) in inline code backticks.
 */
export function formatForDiscord(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inSpecialBlock = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            result.push(line);
            continue;
        }

        if (inCodeBlock) {
            result.push(line);
            continue;
        }

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
            result.push(wrapFileReferences(line));
        } else {
            result.push(wrapFileReferences(line));
        }
    }

    if (inSpecialBlock) {
        result.push('```');
    }

    return result.join('\n');
}

/**
 * Wrap file references (e.g. src/bot/index.ts:54) in inline code backticks.
 */
function wrapFileReferences(line: string): string {
    return line.replace(FILE_REF_REGEX, '`$1`');
}

/** Check if a line is an MCP tool call format (server / tool_name) */
function isMcpFormatLine(line: string): boolean {
    return /^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i.test(line);
}

/**
 * Check if a line is a multi-word activity log (e.g. "Analyzing current workspace").
 * Used only by splitOutputAndLogs — NOT by sanitizeActivityLines, which needs
 * to keep these lines in the activity log output.
 */
function isActivityLogLine(line: string): boolean {
    const trimmed = (line || '').trim();
    if (!trimmed) return false;
    return /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran)\s+.+/i.test(trimmed)
        && trimmed.length <= 220;
}

/**
 * Split raw text into output (real content) and logs (UI chrome).
 * Code blocks are always preserved as output.
 *
 * When tool call blocks are detected (MCP format lines), applies a
 * "last paragraph wins" heuristic: only the final block of non-chrome
 * text is treated as the assistant's answer; everything between tool
 * call regions is treated as thinking text and moved to logs.
 */
export function splitOutputAndLogs(rawText: string): { output: string; logs: string } {
    const normalized = (rawText || '').replace(/\r/g, '');
    if (!normalized.trim()) {
        return { output: '', logs: '' };
    }

    const lines = normalized.split('\n');

    // Pass 1: classify each line as output/chrome/blank/code
    type LineClass = 'output' | 'chrome' | 'blank' | 'code';
    const classes: LineClass[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = (line || '').trim();

        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            classes.push('code');
            continue;
        }
        if (inCodeBlock) {
            classes.push('code');
            continue;
        }
        if (!trimmed) {
            classes.push('blank');
            continue;
        }
        if (isUiChromeLine(trimmed) || isActivityLogLine(trimmed)) {
            classes.push('chrome');
        } else {
            classes.push('output');
        }
    }

    // Check if tool calls are present — triggers "last paragraph wins" heuristic
    const hasMcpCalls = lines.some(
        (l, i) => classes[i] === 'chrome' && isMcpFormatLine(l.trim()),
    );

    if (!hasMcpCalls) {
        // Simple path: no tool calls, line-by-line separation
        const outputLines: string[] = [];
        const logLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (classes[i] === 'chrome') {
                logLines.push(lines[i].trim());
            } else {
                outputLines.push(lines[i]);
            }
        }
        return {
            output: collapseBlankLines(outputLines.join('\n')),
            logs: collapseBlankLines(logLines.join('\n')),
        };
    }

    // Complex path: tool calls present — only the LAST paragraph is output.
    // Scan bottom-up to find the last non-chrome text line.
    let lastOutputEnd = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (classes[i] === 'output' || classes[i] === 'code') {
            lastOutputEnd = i;
            break;
        }
    }

    if (lastOutputEnd === -1) {
        // No output lines at all
        const logLines = lines.filter((_, i) => classes[i] === 'chrome').map((l) => l.trim());
        return { output: '', logs: collapseBlankLines(logLines.join('\n')) };
    }

    // Walk upward from lastOutputEnd to find the start of the final paragraph.
    // Stop at any blank line or chrome line — in the legacy tool-call path, only
    // the immediate last paragraph is preserved as output. Multi-paragraph final
    // answers are handled correctly by the structured extraction mode (Phase 1).
    let lastOutputStart = lastOutputEnd;
    for (let i = lastOutputEnd - 1; i >= 0; i--) {
        if (classes[i] === 'blank' || classes[i] === 'chrome') {
            break;
        }
        if (classes[i] === 'output' || classes[i] === 'code') {
            lastOutputStart = i;
        }
    }

    const outputLines: string[] = [];
    const logLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (i >= lastOutputStart && i <= lastOutputEnd) {
            // Inside the final answer block — keep non-chrome lines as output
            if (classes[i] !== 'chrome') {
                outputLines.push(lines[i]);
            } else {
                logLines.push(lines[i].trim());
            }
        } else if (classes[i] === 'chrome' || classes[i] === 'output') {
            // Outside the final block — chrome or thinking text → logs
            logLines.push(lines[i].trim());
        }
        // blank lines outside the final block are dropped
    }

    return {
        output: collapseBlankLines(outputLines.join('\n')),
        logs: collapseBlankLines(logLines.join('\n')),
    };
}

/** Collapse 3+ consecutive newlines to 2, and trim */
function collapseBlankLines(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Separate raw text into output and logs, choosing between DOM-structured
 * extraction and legacy string-based separation.
 *
 * When domSource is 'dom-structured', DOM results are used directly.
 * When domSource is 'legacy-fallback', falls back to splitOutputAndLogs().
 */
export function separateOutputForDelivery(options: {
    rawText: string;
    domSource: 'dom-structured' | 'legacy-fallback';
    domOutputText?: string;
    domActivityLines?: string[];
}): { source: string; output: string; logs: string } {
    const { rawText, domSource, domOutputText, domActivityLines } = options;

    if (domSource === 'dom-structured' && domOutputText !== undefined) {
        return {
            source: 'dom-structured',
            output: domOutputText,
            logs: (domActivityLines ?? []).join('\n'),
        };
    }

    // Fallback to legacy string-based separation
    const separated = splitOutputAndLogs(rawText);
    return {
        source: 'legacy-fallback',
        output: separated.output,
        logs: separated.logs,
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
