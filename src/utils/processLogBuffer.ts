export interface ProcessLogBufferOptions {
    maxChars?: number;
    maxEntries?: number;
    maxEntryLength?: number;
}

const DEFAULT_MAX_CHARS = 3500;
const DEFAULT_MAX_ENTRIES = 120;
const DEFAULT_MAX_ENTRY_LENGTH = 260;

function collapseWhitespace(text: string): string {
    return (text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function parseBlocks(raw: string): string[] {
    const normalized = (raw || '').replace(/\r/g, '').trim();
    if (!normalized) return [];

    const blocks = normalized
        .split(/\n{2,}/)
        .map((chunk) => collapseWhitespace(chunk))
        .filter((chunk) => chunk.length > 0);

    if (blocks.length > 0) return blocks;

    return normalized
        .split('\n')
        .map((line) => collapseWhitespace(line))
        .filter((line) => line.length > 0);
}

function pickEmoji(entry: string): string {
    const lower = entry.toLowerCase();
    if (/^thought for\b/.test(lower) || /^thinking\b/.test(lower)) return '🧠';
    if (/^initiating\b/.test(lower) || /^starting\b/.test(lower)) return '🚀';
    if (/^[a-z0-9._-]+\s*\/\s*[a-z0-9._-]+$/i.test(entry)) return '🛠️';
    if (/^title:\s/.test(lower) && /\surl:\s/.test(lower)) return '🔎';
    if (/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|yml|toml|sql|graphql|markdown|text|plaintext|log)$/i.test(entry)) return '📦';
    return '•';
}

function toDisplayEntry(rawEntry: string, maxEntryLength: number): string {
    const trimmed = collapseWhitespace(rawEntry);
    if (!trimmed) return '';
    const clipped =
        trimmed.length > maxEntryLength
            ? `${trimmed.slice(0, Math.max(0, maxEntryLength - 3))}...`
            : trimmed;
    return `${pickEmoji(clipped)} ${clipped}`;
}

export class ProcessLogBuffer {
    private readonly maxChars: number;
    private readonly maxEntries: number;
    private readonly maxEntryLength: number;
    private readonly entries: string[] = [];
    private readonly seen = new Set<string>();

    constructor(options: ProcessLogBufferOptions = {}) {
        this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxEntryLength = options.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH;
    }

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

    snapshot(): string {
        return this.entries.join('\n');
    }

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

    private dropOldest(): void {
        const removed = this.entries.shift();
        if (!removed) return;
        this.seen.delete(removed.toLowerCase());
    }
}
