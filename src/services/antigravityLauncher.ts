import { logger } from '../utils/logger';
import { CDP_PORTS } from '../utils/cdpPorts';
import { getAntigravityCdpHint } from '../utils/pathUtils';
import * as http from 'http';

/**
 * Check if CDP responds on the specified port.
 */
function checkPort(port: number): Promise<boolean> {
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
    logger.warn('  Please run AntigravityDebug.command before starting the Bot');
    logger.warn('');
    logger.warn('  Or manually:');
    logger.warn(`    ${getAntigravityCdpHint(9222)}`);
    logger.warn('='.repeat(70));
    logger.warn('');
}
