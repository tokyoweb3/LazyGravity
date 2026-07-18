import type { LogLevel } from './logger';

/**
 * Log entry payload structure stored in the memory buffer.
 */
export interface LogEntry {
    /** Log timestamp in ISO format. */
    timestamp: string;
    /** Message severity level. */
    level: LogLevel;
    /** Text content message. */
    message: string;
}

const MAX_ENTRIES = 200;

// Strip ANSI escape codes for clean buffer storage
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Helper removing terminal ANSI color/styling codes from messages.
 * @param text Original terminal message.
 * @returns Clean text string.
 */
function stripAnsi(text: string): string {
    return text.replace(ANSI_REGEX, '');
}

/**
 * Circular log buffer class keeping track of recent console output logs.
 */
export class LogBuffer {
    private readonly buffer: LogEntry[] = [];
    private head = 0;
    private count = 0;

    /**
     * Appends a new log entry to the buffer.
     * @param level Severity level of the log message.
     * @param message Text message content.
     */
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

    /**
     * Retrieves recent log entries up to specified count, optionally filtering by level.
     * @param count Maximum log entry count to return.
     * @param levelFilter Optional log level severity filter.
     * @returns Array of log entry objects.
     */
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

    /**
     * Resets/clears the entire circular log buffer.
     */
    clear(): void {
        this.buffer.length = 0;
        this.head = 0;
        this.count = 0;
    }
}

/** Default global LogBuffer instance */
export const logBuffer = new LogBuffer();
