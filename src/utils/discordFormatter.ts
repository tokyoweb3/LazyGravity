const PROCESS_LINE_PATTERN = /^(?:\[[A-Z]+\]|\[(?:ResponseMonitor|CdpService|ApprovalDetector|AntigravityLauncher)[^\]]*\]|(?:analy[sz]ing|analy[sz]ed|reading|writing|running|searching|searched|planning|thinking|processing|loading|executing|executed|testing|debugging|thought for|looked|opened|closed|connected|sent|received|parsed|scanned|validated|compared|computed|evaluated|launched|fetched|downloaded|uploaded|committed|pushed|pulled|merged|created|deleted|updated|modified|refactored)\b|(?:処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中))/i;
const PROCESS_KEYWORD_PATTERN = /\b(?:run|running|read|reading|write|writing|search|searching|analy[sz]e?|plan(?:ning)?|debug|test|compile|execute|retrieval|directory|commencing|initiating|checking)\b/i;
const PROCESS_PARAGRAPH_PATTERN = /(?:thought for\s*<?\d+s|initiating step[- ]by[- ]step action|advancing toward a goal|i[' ]?m now focused|i am now focused|i[' ]?m now zeroing in|i am now zeroing in|carefully considering|analyzing the data|refining my approach|planned execution|next milestone|subsequent stage|plan is forming|progressing steadily|actions to take|aim is to make definitive steps|commencing information retrieval|checking global skills directory|initiating task execution|思考中|これから実行|次の手順|方針を検討)/i;
const FIRST_PERSON_PATTERN = /\b(?:i|i'm|i’ve|i'll|i am|my|we|we're|our)\b|(?:私|僕|わたし|我々)/i;
const ABSTRACT_PROGRESS_PATTERN = /\b(?:focus|focusing|plan|planning|progress|goal|milestone|subsequent|approach|action|execution|execute|next step|aim|zeroing in|steadily)\b|(?:方針|手順|進捗|目標|計画|実行方針|次の段階)/i;
const TOOL_TRACE_LINE_PATTERN = /^(?:mcp tool\b|show details\b|thought for\s*<?\d+s|initiating task execution\b|commencing information retrieval\b|checking global skills directory\b|tool call:|tool result:|calling tool\b|tool response\b|running mcp\b|\[mcp\]|mcp server\b)/i;

/**
 * Discord Embed用にテキストをフォーマットする。
 *
 * Discord Embedはmarkdownテーブル（`| ... |`）やツリー構造（`├──`等）を
 * そのまま表示できないため、これらを自動検出してコードブロックで囲む。
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

export function splitOutputAndLogs(rawText: string): { output: string; logs: string } {
    const normalized = (rawText || '').replace(/\r/g, '');
    if (!normalized.trim()) {
        return { output: '', logs: '' };
    }

    const outputLines: string[] = [];
    const logLines: string[] = [];
    let inCodeBlock = false;

    const lines = normalized.split('\n');
    for (const originalLine of lines) {
        const line = originalLine ?? '';
        const trimmed = line.trim();

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

        const looksProcess =
            PROCESS_LINE_PATTERN.test(trimmed) ||
            PROCESS_PARAGRAPH_PATTERN.test(trimmed) ||
            TOOL_TRACE_LINE_PATTERN.test(trimmed) ||
            (/^\[[^\]]+\]/.test(trimmed) && trimmed.length <= 280) ||
            (/^(?:\d+\.\s*)?(?:tool|step|action|task)\b/i.test(trimmed) && trimmed.length <= 280) ||
            (/^(?:ran|read|wrote|executed|searching|searched|planning|thinking|processing|thought for|looked|opened|closed|connected|sent|received|parsed|fetched|created|deleted|updated|scanned|launched)\b/i.test(trimmed) && trimmed.length <= 280) ||
            (trimmed.length <= 120 && PROCESS_KEYWORD_PATTERN.test(trimmed) && /[:`\-\[]/.test(trimmed));

        if (looksProcess) {
            logLines.push(trimmed);
        } else {
            outputLines.push(line);
        }
    }

    const normalizeText = (text: string): string =>
        text
            .replace(/\n{3,}/g, '\n\n')
            .trim();

    const outputText = normalizeText(outputLines.join('\n'));
    const movedLogBlocks: string[] = [];
    const keptOutputBlocks: string[] = [];
    const outputBlocks = outputText ? outputText.split(/\n{2,}/) : [];
    for (const block of outputBlocks) {
        const trimmed = (block || '').trim();
        if (!trimmed) continue;

        const looksAbstractProcess =
            PROCESS_PARAGRAPH_PATTERN.test(trimmed) ||
            TOOL_TRACE_LINE_PATTERN.test(trimmed) ||
            (
                FIRST_PERSON_PATTERN.test(trimmed) &&
                ABSTRACT_PROGRESS_PATTERN.test(trimmed) &&
                trimmed.length >= 40 &&
                !/```|`[^`]+`/.test(trimmed)
            ) ||
            (/^advancing toward /i.test(trimmed) && trimmed.length <= 120) ||
            (/^initiating /i.test(trimmed) && trimmed.length <= 120);

        if (looksAbstractProcess) {
            movedLogBlocks.push(trimmed);
            continue;
        }
        keptOutputBlocks.push(trimmed);
    }

    const dedupedLogs = Array.from(
        new Set(
            [...logLines, ...movedLogBlocks]
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
        ),
    );

    return {
        output: normalizeText(keptOutputBlocks.join('\n\n')),
        logs: normalizeText(dedupedLogs.join('\n')),
    };
}

export function sanitizeActivityLines(raw: string): string {
    const lines = (raw || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const kept = lines.filter((line) => {
        if (TOOL_TRACE_LINE_PATTERN.test(line)) return false;
        if (/^mcp\b/i.test(line) && line.length > 120) return false;
        if (FIRST_PERSON_PATTERN.test(line) && ABSTRACT_PROGRESS_PATTERN.test(line) && line.length >= 60) {
            return false;
        }
        return true;
    });

    return Array.from(new Set(kept)).join('\n');
}
