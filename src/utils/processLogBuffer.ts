/**
 * Options configuration object for custom CLI/process log formatting and buffering.
 */
export interface ProcessLogBufferOptions {
    /** Maximum character limit allowed in the log snapshot. */
    maxChars?: number;
    /** Maximum number of distinct log lines/entries to keep in memory. */
    maxEntries?: number;
    /** Maximum character length of any single log entry. */
    maxEntryLength?: number;
}

const DEFAULT_MAX_CHARS = 3500;
const DEFAULT_MAX_ENTRIES = 120;
const DEFAULT_MAX_ENTRY_LENGTH = 260;

/**
 * Normalizes multi-line whitespace and strips raw carriage return characters.
 * @param text Raw log text chunk.
 * @returns Clean normalized string.
 */
function collapseWhitespace(text: string): string {
    return (text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits raw process logs into discrete blocks/lines.
 * @param raw Raw process logs.
 * @returns Array of separate log message blocks.
 */
function parseBlocks(raw: string): string[] {
    const normalized = (raw || '').replace(/\r/g, '').trim();
    if (!normalized) return [];

    const blocks = normalized
        .split(/\n{2,}/)
        .map((chunk) => collapseWhitespace(chunk))
        .filter((chunk) => chunk.length > 0);

    if (blocks.length > 1) return blocks;

    return normalized
        .split('\n')
        .map((line) => collapseWhitespace(line))
        .filter((line) => line.length > 0);
}

/**
 * Picks an illustrative emoji icon for the entry text prefix.
 * @param entry The formatted entry text.
 * @returns An emoji character indicator.
 */
function pickEmoji(entry: string): string {
    const lower = entry.toLowerCase();
    if (/^thought for\b/.test(lower) || /^thinking\b/.test(lower)) return '🧠';
    if (/^initiating\b/.test(lower) || /^starting\b/.test(lower)) return '🚀';
    if (/^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i.test(entry)) return '🛠️';
    if (/^(?:analy[sz]ed|read|wrote|created|updated|deleted|built|compiled|installed|resolved|downloaded|connected|fetched)\b/i.test(entry)) return '📄';
    if (/^(?:analy[sz]ing|reading|writing|running|searching|fetching|checking|scanning|creating|updating|deleting|building|compiling|deploying|parsing|resolving|downloading|uploading|connecting|installing|executing|testing|debugging|processing|loading)\b/i.test(entry)) return '🔍';
    if (/^title:\s/.test(lower) && /\surl:\s/.test(lower)) return '🔎';
    if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log)$/i.test(entry)) return '📦';
    return '•';
}

/**
 * Prepares a raw entry for display by collapsing white space, picking an emoji, and truncating if too long.
 * @param rawEntry Raw log line.
 * @param maxEntryLength Maximum character limit for this single entry.
 * @returns Clean display entry string.
 */
function toDisplayEntry(rawEntry: string, maxEntryLength: number): string {
    const trimmed = collapseWhitespace(rawEntry);
    if (!trimmed) return '';
    const clipped =
        trimmed.length > maxEntryLength
            ? `${trimmed.slice(0, Math.max(0, maxEntryLength - 3))}...`
            : trimmed;
    return `${pickEmoji(clipped)} ${clipped}`;
}

/**
 * Deduplicating log buffer designed for displaying formatted CLI activity logs in chat UI updates.
 */
export class ProcessLogBuffer {
    private readonly maxChars: number;
    private readonly maxEntries: number;
    private readonly maxEntryLength: number;
    private readonly entries: string[] = [];
    private readonly seen = new Set<string>();

    /**
     * @param options Buffer tuning options.
     */
    constructor(options: ProcessLogBufferOptions = {}) {
        this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxEntryLength = options.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH;
    }

    /**
     * Appends raw process log chunks to the buffer.
     * @param raw Raw process logs chunk.
     * @returns Consolidated snapshot string.
     */
    append(raw: string): string {
        const blocks = parseBlocks(raw);
        for (const block of blocks) {
            const display = toDisplayEntry(block, this.maxEntryLength);
            if (!display) continue;
            const key = display.toLowerCase();
            if (this.seen.has(key)) continue;
            this.entries.push(display);
            this.seen.add(key);
        }

        this.trim();
        return this.snapshot();
    }

    /**
     * Retrieves the consolidated buffer representation text.
     * @returns Merged entries string.
     */
    snapshot(): string {
        return this.entries.join('\n');
    }

    /**
     * Trims old entries from the circular queue if boundaries are exceeded.
     */
    private trim(): void {
        while (this.entries.length > this.maxEntries) {
            this.dropOldest();
        }

        while (this.entries.length > 1 && this.snapshot().length > this.maxChars) {
            this.dropOldest();
        }

        if (this.entries.length === 1 && this.entries[0].length > this.maxChars) {
            const only = this.entries[0];
            this.entries[0] = `${only.slice(0, Math.max(0, this.maxChars - 3))}...`;
            this.seen.clear();
            this.seen.add(this.entries[0].toLowerCase());
        }
    }

    /**
     * Discards the oldest cached entry in the queue.
     */
    private dropOldest(): void {
        const removed = this.entries.shift();
        if (!removed) return;
        this.seen.delete(removed.toLowerCase());
    }
}
