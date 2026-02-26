import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LogFileTransport } from './logger';

const DEFAULT_LOG_DIR = path.join(os.homedir(), '.lazy-gravity', 'logs');
const LOG_FILE_PREFIX = 'lazy-gravity-';
const LOG_FILE_EXT = '.log';

/** Maximum number of log files to keep (default 14 days). */
const DEFAULT_MAX_FILES = 14;

/** Maximum size in bytes for a single log file (default 10 MB). */
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function buildFileName(dateStr: string): string {
    return `${LOG_FILE_PREFIX}${dateStr}${LOG_FILE_EXT}`;
}

export class LogFileTransportImpl implements LogFileTransport {
    private readonly logDir: string;
    private currentDate: string;
    private currentFilePath: string;

    constructor(logDir: string = DEFAULT_LOG_DIR) {
        this.logDir = logDir;
        this.currentDate = formatDate(new Date());
        this.currentFilePath = path.join(this.logDir, buildFileName(this.currentDate));
        this.ensureDir();
        this.scheduleCleanup();
    }

    write(level: string, timestamp: string, message: string): void {
        this.rollIfNeeded();
        const line = `${timestamp} [${level}] ${message}\n`;
        try {
            fs.appendFileSync(this.currentFilePath, line, 'utf-8');
        } catch {
            // Silently ignore write errors to avoid crashing the bot
        }
    }

    /**
     * Remove old log files that exceed maxFiles count or maxSizeBytes per file.
     * Runs asynchronously to avoid blocking startup.
     */
    cleanup(
        maxFiles: number = DEFAULT_MAX_FILES,
        maxSizeBytes: number = DEFAULT_MAX_SIZE_BYTES,
    ): void {
        setImmediate(() => {
            try {
                this.cleanupSync(maxFiles, maxSizeBytes);
            } catch {
                // Silently ignore cleanup errors
            }
        });
    }

    /** Synchronous cleanup for testability. */
    cleanupSync(
        maxFiles: number = DEFAULT_MAX_FILES,
        maxSizeBytes: number = DEFAULT_MAX_SIZE_BYTES,
    ): void {
        if (!fs.existsSync(this.logDir)) return;

        const entries = fs
            .readdirSync(this.logDir)
            .filter(
                (f) =>
                    f.startsWith(LOG_FILE_PREFIX) && f.endsWith(LOG_FILE_EXT),
            )
            .sort(); // chronological order (YYYY-MM-DD sorts naturally)

        // Remove files exceeding size limit
        for (const entry of entries) {
            const filePath = path.join(this.logDir, entry);
            try {
                const stat = fs.statSync(filePath);
                if (stat.size > maxSizeBytes) {
                    fs.unlinkSync(filePath);
                }
            } catch {
                // Ignore stat/unlink errors
            }
        }

        // Re-read after size-based cleanup
        const remaining = fs
            .readdirSync(this.logDir)
            .filter(
                (f) =>
                    f.startsWith(LOG_FILE_PREFIX) && f.endsWith(LOG_FILE_EXT),
            )
            .sort();

        // Remove oldest files if count exceeds limit
        const excess = remaining.length - maxFiles;
        if (excess > 0) {
            for (let i = 0; i < excess; i++) {
                const filePath = path.join(this.logDir, remaining[i]);
                try {
                    fs.unlinkSync(filePath);
                } catch {
                    // Ignore unlink errors
                }
            }
        }
    }

    private ensureDir(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    private rollIfNeeded(): void {
        const today = formatDate(new Date());
        if (today !== this.currentDate) {
            this.currentDate = today;
            this.currentFilePath = path.join(
                this.logDir,
                buildFileName(today),
            );
        }
    }

    private scheduleCleanup(): void {
        this.cleanup();
    }
}
