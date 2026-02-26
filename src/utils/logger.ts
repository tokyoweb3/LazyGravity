export const COLORS = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
} as const;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
};

export interface LogFileTransport {
    write(level: string, timestamp: string, message: string): void;
}

export interface Logger {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
    phase(...args: any[]): void;
    done(...args: any[]): void;
    divider(label?: string): void;
    setLogLevel(level: LogLevel): void;
    getLogLevel(): LogLevel;
    enableFileLogging(transport: LogFileTransport): void;
}

const getTimestamp = () => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', { hour12: false });
    return `${COLORS.dim}[${timeString}]${COLORS.reset}`;
};

function getPlainTimestamp(): string {
    return new Date().toISOString();
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function formatArgs(args: any[]): string {
    return args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
}

export function createLogger(initialLevel: LogLevel = 'info'): Logger {
    let currentLevel: LogLevel = initialLevel;
    let fileTransport: LogFileTransport | null = null;

    function shouldLog(methodLevel: LogLevel): boolean {
        return LEVEL_PRIORITY[methodLevel] >= LEVEL_PRIORITY[currentLevel];
    }

    function writeToFile(level: string, args: any[]): void {
        if (!fileTransport) return;
        const timestamp = getPlainTimestamp();
        const message = stripAnsi(formatArgs(args));
        fileTransport.write(level, timestamp, message);
    }

    return {
        info(...args: any[]) {
            if (shouldLog('info')) {
                console.info(`${getTimestamp()} ${COLORS.cyan}[INFO]${COLORS.reset}`, ...args);
            }
            writeToFile('INFO', args);
        },
        warn(...args: any[]) {
            if (shouldLog('warn')) {
                console.warn(`${getTimestamp()} ${COLORS.yellow}[WARN]${COLORS.reset}`, ...args);
            }
            writeToFile('WARN', args);
        },
        error(...args: any[]) {
            if (shouldLog('error')) {
                console.error(`${getTimestamp()} ${COLORS.red}[ERROR]${COLORS.reset}`, ...args);
            }
            writeToFile('ERROR', args);
        },
        debug(...args: any[]) {
            if (shouldLog('debug')) {
                console.debug(`${getTimestamp()} ${COLORS.dim}[DEBUG]${COLORS.reset}`, ...args);
            }
            writeToFile('DEBUG', args);
        },
        /** Important state transitions - stands out in logs */
        phase(...args: any[]) {
            if (shouldLog('info')) {
                console.info(`${getTimestamp()} ${COLORS.magenta}[PHASE]${COLORS.reset}`, ...args);
            }
            writeToFile('PHASE', args);
        },
        /** Completion-related events - green for success */
        done(...args: any[]) {
            if (shouldLog('info')) {
                console.info(`${getTimestamp()} ${COLORS.green}[DONE]${COLORS.reset}`, ...args);
            }
            writeToFile('DONE', args);
        },
        /** Section divider with optional label for structured output */
        divider(label?: string) {
            if (shouldLog('info')) {
                if (label) {
                    const pad = Math.max(4, 50 - label.length - 4);
                    console.info(`${COLORS.green}[DONE]${COLORS.reset} ${COLORS.dim}── ${label} ${'─'.repeat(pad)}${COLORS.reset}`);
                } else {
                    console.info(`${COLORS.green}[DONE]${COLORS.reset} ${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`);
                }
            }
            writeToFile('DONE', label ? [`── ${label}`] : ['──────────']);
        },
        setLogLevel(level: LogLevel) {
            currentLevel = level;
        },
        getLogLevel(): LogLevel {
            return currentLevel;
        },
        enableFileLogging(transport: LogFileTransport) {
            fileTransport = transport;
        },
    };
}

export const logger = createLogger('info');
