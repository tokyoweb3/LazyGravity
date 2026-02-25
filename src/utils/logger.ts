export const COLORS = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
} as const;

const getTimestamp = () => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', { hour12: false });
    return `${COLORS.dim}[${timeString}]${COLORS.reset}`;
};

export const logger = {
    info: (...args: any[]) => console.info(`${getTimestamp()} ${COLORS.cyan}[INFO]${COLORS.reset}`, ...args),
    warn: (...args: any[]) => console.warn(`${getTimestamp()} ${COLORS.yellow}[WARN]${COLORS.reset}`, ...args),
    error: (...args: any[]) => console.error(`${getTimestamp()} ${COLORS.red}[ERROR]${COLORS.reset}`, ...args),
    debug: (...args: any[]) => console.debug(`${getTimestamp()} ${COLORS.dim}[DEBUG]${COLORS.reset}`, ...args),
    /** Important state transitions — stands out in logs */
    phase: (...args: any[]) => console.info(`${getTimestamp()} ${COLORS.magenta}[PHASE]${COLORS.reset}`, ...args),
    /** Completion-related events — green for success */
    done: (...args: any[]) => console.info(`${getTimestamp()} ${COLORS.green}[DONE]${COLORS.reset}`, ...args),
    /** Section divider with optional label for structured output */
    divider: (label?: string) => {
        if (label) {
            const pad = Math.max(4, 50 - label.length - 4);
            console.info(`${COLORS.green}[DONE]${COLORS.reset} ${COLORS.dim}── ${label} ${'─'.repeat(pad)}${COLORS.reset}`);
        } else {
            console.info(`${COLORS.green}[DONE]${COLORS.reset} ${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`);
        }
    },
};
