import { logger } from '../utils/logger';
import { CDP_PORTS } from '../utils/cdpPorts';
import { getAntigravityCdpHint } from '../utils/pathUtils';
import * as http from 'http';
import { execFile, spawn } from 'child_process';

let lifecycleOperation: Promise<unknown> | null = null;

/**
 * Check if CDP responds on the specified port.
 */
export function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(Array.isArray(parsed));
                } catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function waitForPort(port: number, timeoutMs: number = 30000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
        if (await checkPort(port)) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    return false;
}

function serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    if (lifecycleOperation) {
        return lifecycleOperation.then(operation, operation);
    }
    const pending = operation();
    lifecycleOperation = pending;
    pending.finally(() => {
        if (lifecycleOperation === pending) lifecycleOperation = null;
    }).catch(() => {});
    return pending;
}

export function startAntigravity(port: number = CDP_PORTS[0]): Promise<'started' | 'already-running'> {
    return serializeLifecycle(async () => {
        if (await checkPort(port)) return 'already-running';

        const executable = process.env.ANTIGRAVITY_PATH || 'Antigravity IDE.exe';
        const child = spawn(executable, [`--remote-debugging-port=${port}`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();

        if (!await waitForPort(port)) {
            throw new Error(`Antigravity did not become ready on CDP port ${port}.`);
        }
        return 'started';
    });
}

export function stopAntigravity(port: number = CDP_PORTS[0]): Promise<'stopped' | 'already-stopped'> {
    return serializeLifecycle(async () => {
        if (!await checkPort(port)) return 'already-stopped';

        await new Promise<void>((resolve, reject) => {
            const command = [
                `$ownerPid=(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue`,
                '| Select-Object -First 1 -ExpandProperty OwningProcess);',
                'if ($ownerPid) { Stop-Process -Id $ownerPid -Force }',
            ].join(' ');
            execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        return 'stopped';
    });
}

/**
 * Check if Antigravity is running with CDP ports.
 * If not running, output a warning log (no auto-start or restart).
 *
 * Called during Bot initialization.
 */
export async function ensureAntigravityRunning(): Promise<void> {
    logger.debug('[AntigravityLauncher] Checking CDP ports...');

    for (const port of CDP_PORTS) {
        if (await checkPort(port)) {
            logger.debug(`[AntigravityLauncher] OK — Port ${port} responding`);
            return;
        }
    }

    logger.warn('');
    logger.warn('='.repeat(70));
    logger.warn('  Antigravity CDP ports are not responding');
    logger.warn('');
    logger.warn('  Run the following command to open Antigravity with CDP enabled:');
    logger.warn('');
    logger.warn('    lazy-gravity open');
    logger.warn('');
    logger.warn('  Or manually:');
    logger.warn(`    ${getAntigravityCdpHint(9222)}`);
    logger.warn('');
    logger.warn('  Then run:  lazy-gravity start');
    logger.warn('='.repeat(70));
    logger.warn('');
}
