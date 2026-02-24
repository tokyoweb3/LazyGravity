import { logger } from '../utils/logger';
import { CDP_PORTS } from '../utils/cdpPorts';
import * as http from 'http';

/**
 * 指定ポートのCDPが応答するか確認する。
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
 * Antigravityが CDPポート付きで起動済みか確認する。
 * 未起動の場合は警告ログを出力する（自動起動・再起動はしない）。
 *
 * Bot初期化時に呼び出す。
 */
export async function ensureAntigravityRunning(): Promise<void> {
    logger.info('[AntigravityLauncher] Checking CDP ports...');

    for (const port of CDP_PORTS) {
        if (await checkPort(port)) {
            logger.info(`[AntigravityLauncher] OK — Port ${port} responding`);
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
    logger.warn('    open -a Antigravity --args --remote-debugging-port=9222');
    logger.warn('='.repeat(70));
    logger.warn('');
}
