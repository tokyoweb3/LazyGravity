import { logger } from './logger';
import fs from 'fs';
import os from 'os';
import path from 'path';

const LOCK_DIR = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `lazygravity-${process.getuid ? process.getuid() : 'user'}`);
const LOCK_FILE = path.join(LOCK_DIR, '.bot.lock');

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Acquire a lockfile to prevent duplicate bot instances.
 *
 * @returns A function to release the lock
 */
export function acquireLock(): () => void {
    fs.mkdirSync(LOCK_DIR, { recursive: true, mode: 0o700 });

    // Check existing lock file
    if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const existingPid = parseInt(content, 10);

        if (!isNaN(existingPid) && existingPid !== process.pid && isProcessRunning(existingPid)) {
            throw new Error(`Another Bot process is already running (PID: ${existingPid})`);
        } else if (!isNaN(existingPid) && !isProcessRunning(existingPid)) {
            logger.warn(`⚠️  Stale lock file detected (PID: ${existingPid} has exited). Cleaning up.`);
            try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
        }
    }

    // Create new lock file
    fs.writeFileSync(LOCK_FILE, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
    logger.info(`🔒 Lock acquired (PID: ${process.pid})`);

    // Cleanup function
    const releaseLock = () => {
        try {
            if (fs.existsSync(LOCK_FILE)) {
                const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
                if (parseInt(content, 10) === process.pid) {
                    fs.unlinkSync(LOCK_FILE);
                    logger.info(`🔓 Lock released (PID: ${process.pid})`);
                }
            }
        } catch {
            // Ignore errors during cleanup
        }
    };

    // Auto cleanup on process exit
    process.on('exit', releaseLock);
    process.on('SIGINT', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught exception:', err);
        releaseLock();
        process.exit(1);
    });

    return releaseLock;
}
