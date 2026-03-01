import type { LogLevel } from './logger';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
}

const MAX_ENTRIES = 200;

// Strip ANSI escape codes for clean buffer storage
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
    return text.replace(ANSI_REGEX, '');
}

export class LogBuffer {
    private readonly buffer: LogEntry[] = [];
    private head = 0;
    private count = 0;

    append(level: LogLevel, message: string): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message: stripAnsi(message),
        };

        if (this.count < MAX_ENTRIES) {
            this.buffer.push(entry);
            this.count++;
        } else {
            this.buffer[this.head] = entry;
        }
        this.head = (this.head + 1) % MAX_ENTRIES;
    }

    getRecent(count: number, levelFilter?: LogLevel): readonly LogEntry[] {
        const all: LogEntry[] = [];
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head - this.count + i + MAX_ENTRIES * 2) % MAX_ENTRIES;
            all.push(this.buffer[idx]);
        }

        const filtered = levelFilter
            ? all.filter((e) => e.level === levelFilter)
            : all;

        return filtered.slice(-count);
    }

    clear(): void {
        this.buffer.length = 0;
        this.head = 0;
        this.count = 0;
    }
}

export const logBuffer = new LogBuffer();
