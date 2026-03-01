import { logBuffer } from './logBuffer';

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
}

const getTimestamp = () => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', { hour12: false });
    return `${COLORS.dim}[${timeString}]${COLORS.reset}`;
};

export function createLogger(initialLevel: LogLevel = 'info'): Logger {
    let currentLevel: LogLevel = initialLevel;

    function shouldLog(methodLevel: LogLevel): boolean {
        return LEVEL_PRIORITY[methodLevel] >= LEVEL_PRIORITY[currentLevel];
    }

    return {
        info(...args: any[]) {
            if (shouldLog('info')) {
                const formatted = `${getTimestamp()} ${COLORS.cyan}[INFO]${COLORS.reset}`;
                console.info(formatted, ...args);
                logBuffer.append('info', `[INFO] ${args.join(' ')}`);
            }
        },
        warn(...args: any[]) {
            if (shouldLog('warn')) {
                const formatted = `${getTimestamp()} ${COLORS.yellow}[WARN]${COLORS.reset}`;
                console.warn(formatted, ...args);
                logBuffer.append('warn', `[WARN] ${args.join(' ')}`);
            }
        },
        error(...args: any[]) {
            if (shouldLog('error')) {
                const formatted = `${getTimestamp()} ${COLORS.red}[ERROR]${COLORS.reset}`;
                console.error(formatted, ...args);
                logBuffer.append('error', `[ERROR] ${args.join(' ')}`);
            }
        },
        debug(...args: any[]) {
            if (shouldLog('debug')) {
                const formatted = `${getTimestamp()} ${COLORS.dim}[DEBUG]${COLORS.reset}`;
                console.debug(formatted, ...args);
                logBuffer.append('debug', `[DEBUG] ${args.join(' ')}`);
            }
        },
        /** Important state transitions - stands out in logs */
        phase(...args: any[]) {
            if (shouldLog('info')) {
                const formatted = `${getTimestamp()} ${COLORS.magenta}[PHASE]${COLORS.reset}`;
                console.info(formatted, ...args);
                logBuffer.append('info', `[PHASE] ${args.join(' ')}`);
            }
        },
        /** Completion-related events - green for success */
        done(...args: any[]) {
            if (shouldLog('info')) {
                const formatted = `${getTimestamp()} ${COLORS.green}[DONE]${COLORS.reset}`;
                console.info(formatted, ...args);
                logBuffer.append('info', `[DONE] ${args.join(' ')}`);
            }
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
        },
        setLogLevel(level: LogLevel) {
            currentLevel = level;
        },
        getLogLevel(): LogLevel {
            return currentLevel;
        },
    };
}

export const logger = createLogger('info');
