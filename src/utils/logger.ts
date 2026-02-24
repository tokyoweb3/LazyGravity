const COLORS = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
} as const;

export const logger = {
    info: (...args: any[]) => console.info(`${COLORS.cyan}[INFO]${COLORS.reset}`, ...args),
    warn: (...args: any[]) => console.warn(`${COLORS.yellow}[WARN]${COLORS.reset}`, ...args),
    error: (...args: any[]) => console.error(`${COLORS.red}[ERROR]${COLORS.reset}`, ...args),
    debug: (...args: any[]) => console.debug(`${COLORS.dim}[DEBUG]${COLORS.reset}`, ...args),
    /** Important state transitions — stands out in logs */
    phase: (...args: any[]) => console.info(`${COLORS.magenta}[PHASE]${COLORS.reset}`, ...args),
    /** Completion-related events — green for success */
    done: (...args: any[]) => console.info(`${COLORS.green}[DONE]${COLORS.reset}`, ...args),
};
