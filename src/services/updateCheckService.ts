import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_DIR = '.lazy-gravity';
export const UPDATE_CHECK_FILE = 'update-check.json';
export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

const REGISTRY_URL = 'https://registry.npmjs.org/lazy-gravity/latest';
const REQUEST_TIMEOUT_MS = 5000;

interface UpdateCheckCache {
    lastCheck: number;
}

function getCachePath(): string {
    return path.join(os.homedir(), CONFIG_DIR, UPDATE_CHECK_FILE);
}

/**
 * Determine whether enough time has elapsed since the last update check.
 * Returns true if we should query the registry.
 */
export function shouldCheckForUpdates(): boolean {
    const cachePath = getCachePath();
    try {
        if (!fs.existsSync(cachePath)) return true;
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const cache: UpdateCheckCache = JSON.parse(raw);
        return Date.now() - cache.lastCheck >= COOLDOWN_MS;
    } catch {
        return true;
    }
}

/**
 * Query the npm registry for the latest published version.
 */
export function fetchLatestVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(REGISTRY_URL, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            let body = '';
            res.on('data', (chunk: string) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data.version);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
    });
}

function writeCache(): void {
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const cache: UpdateCheckCache = { lastCheck: Date.now() };
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
    } catch {
        // Silently ignore cache write failures
    }
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (diff < 0) return -1;
        if (diff > 0) return 1;
    }
    return 0;
}

/**
 * Non-blocking update check. Call at startup (fire-and-forget).
 * Respects a 24-hour cooldown via a local cache file.
 */
export async function checkForUpdates(currentVersion: string): Promise<void> {
    if (!shouldCheckForUpdates()) return;

    try {
        const latest = await fetchLatestVersion();
        writeCache();

        if (compareSemver(currentVersion, latest) < 0) {
            console.info(
                `\n  Update available: ${currentVersion} \u2192 ${latest} \u2014 run \x1b[36mnpm i -g lazy-gravity\x1b[0m\n`,
            );
        }
    } catch {
        // Silently ignore — update check should never block startup
    }
}
