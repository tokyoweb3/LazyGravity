import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_DIR = '.lazy-gravity';
export const UPDATE_CHECK_FILE = 'update-check.json';
export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

const REGISTRY_URL = 'https://registry.npmjs.org/lazy-gravity/latest';
const REQUEST_TIMEOUT_MS = 5000;

/** Cache file format for update checking telemetry. */
interface UpdateCheckCache {
    /** Last check timestamp in milliseconds. */
    lastCheck: number;
}

/**
 * Gets path to the local home settings update file.
 * @returns Absolute cache path.
 */
function getCachePath(): string {
    return path.join(os.homedir(), CONFIG_DIR, UPDATE_CHECK_FILE);
}

/**
 * Determine whether enough time has elapsed since the last update check.
 * Returns true if we should query the registry.
 * @returns True if checking cooldown duration expired.
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
 * @returns Latest package version string.
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

/**
 * Writes current timestamp cache details to disk file.
 */
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
 * @param a First version string.
 * @param b Second version string.
 * @returns Comparison integer code.
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
 * Detect whether the process is running from a global npm install
 * (as opposed to a local dev checkout via `ts-node`, `tsx`, etc.).
 * @returns True if global environment install.
 */
export function isGlobalInstall(): boolean {
    const execPath = process.argv[1] || '';
    // Global installs run from a path containing node_modules
    // Local dev runs from the source tree (no node_modules/.bin in argv[1])
    const globalIndicators = ['/lib/node_modules/', '\\node_modules\\lazy-gravity\\'];
    return globalIndicators.some((indicator) => execPath.includes(indicator));
}

/**
 * Non-blocking update check. Call at startup (fire-and-forget).
 * Respects a 24-hour cooldown via a local cache file.
 * Skipped when running from source (dev/local checkout).
 * @param currentVersion Current package version string.
 */
export async function checkForUpdates(currentVersion: string): Promise<void> {
    if (!isGlobalInstall()) return;
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
