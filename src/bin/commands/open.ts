import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { CDP_PORTS } from '../../utils/cdpPorts';
import { getAntigravityCliPath, getAntigravityLaunchEnv } from '../../utils/pathUtils';

const APP_NAME = 'Antigravity';

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
} as const;

/**
 * Check whether a TCP port is available (not in use) by attempting to listen on it.
 * @param port Target port number.
 * @returns Whether the port is available.
 */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Iterates over standard candidate ports to find the first unused TCP port.
 * @returns Available port number, or null if none are available.
 */
async function findAvailablePort(): Promise<number | null> {
    for (const port of CDP_PORTS) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    return null;
}

/** Read a local CDP target list without treating other HTTP servers as CDP. */
function readTargets(port: number): Promise<Array<{ url?: string; title?: string }>> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    resolve(Array.isArray(targets) ? targets : []);
                } catch {
                    resolve([]);
                }
            });
            res.on('error', () => resolve([]));
        });
        req.on('error', () => resolve([]));
        req.setTimeout(2000, () => { req.destroy(); resolve([]); });
    });
}

function hasAntigravityTarget(targets: Array<{ url?: string; title?: string }>): boolean {
    return targets.some(target => /antigravity/i.test(target.url || target.title || ''));
}

/**
 * Spawns Antigravity with debugging port enabled on macOS.
 * @param port Debugging target port.
 * @returns Promise resolving on spawn completion.
 */
function openMacOS(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('open', ['-a', APP_NAME, '--args', `--remote-debugging-port=${port}`], { env: getAntigravityLaunchEnv() }, (err) => {
            if (err) {
                reject(new Error(`Failed to open ${APP_NAME}: ${err.message}`));
                return;
            }
            resolve();
        });
    });
}

/**
 * Spawns Antigravity with debugging port enabled on Windows.
 * @param port Debugging target port.
 * @returns Promise resolving on spawn completion.
 */
function openWindows(port: number): Promise<void> {
    return spawnAntigravity(port);
}

/**
 * Spawns Antigravity with debugging port enabled on Linux.
 * @param port Debugging target port.
 * @returns Promise resolving on spawn completion.
 */
function openLinux(port: number): Promise<void> {
    return spawnAntigravity(port);
}

/** Launch the resolved executable directly, including paths containing spaces. */
function spawnAntigravity(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(getAntigravityCliPath(), [`--remote-debugging-port=${port}`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: getAntigravityLaunchEnv(),
        });
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
        child.once('error', (err) => {
            reject(new Error(`Failed to open ${APP_NAME}: ${err.message}`));
        });
    });
}

/**
 * Poll CDP endpoint until it responds or timeout is reached.
 * @param port Debugging port to poll.
 * @param timeoutMs Maximum duration to poll.
 * @param intervalMs Time between checks.
 * @returns Whether the port responded before timeout.
 */
function waitForCdp(port: number, timeoutMs: number = 15000, intervalMs: number = 1000): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
        const check = (): void => {
            const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (Array.isArray(parsed)) {
                            resolve(true);
                            return;
                        }
                    } catch { /* not ready */ }
                    retry();
                });
            });
            req.on('error', () => retry());
            req.setTimeout(2000, () => {
                req.destroy();
                retry();
            });
        };

        const retry = (): void => {
            if (Date.now() - start >= timeoutMs) {
                resolve(false);
                return;
            }
            setTimeout(check, intervalMs);
        };

        check();
    });
}

/**
 * Command action to open/launch the Antigravity application with CDP enabled on a free port.
 */
export async function openAction(): Promise<void> {
    const platform = os.platform();

    for (const port of CDP_PORTS) {
        if (hasAntigravityTarget(await readTargets(port))) {
            console.log(`\n  ${C.green}${APP_NAME} is already ready on CDP port ${port}${C.reset}\n`);
            return;
        }
    }

    console.log(`\n  ${C.cyan}Searching for an available CDP port...${C.reset}`);

    const port = await findAvailablePort();
    if (port === null) {
        console.log(`  ${C.red}No available CDP ports found.${C.reset}`);
        console.log(`  ${C.dim}All candidate ports are in use: ${CDP_PORTS.join(', ')}${C.reset}`);
        console.log(`  ${C.dim}Close an application using one of these ports and try again.${C.reset}\n`);
        process.exitCode = 1;
        return;
    }

    console.log(`  ${C.green}Found available port: ${port}${C.reset}`);
    console.log(`  ${C.dim}Opening ${APP_NAME} with --remote-debugging-port=${port}...${C.reset}\n`);

    try {
        if (platform === 'darwin') {
            await openMacOS(port);
        } else if (platform === 'win32') {
            await openWindows(port);
        } else {
            await openLinux(port);
        }

        console.log(`  ${C.dim}Waiting for CDP to respond on port ${port}...${C.reset}`);

        const ready = await waitForCdp(port);
        if (ready) {
            console.log(`  ${C.green}${APP_NAME} is ready on CDP port ${port}${C.reset}`);
        } else {
            console.log(`  ${C.yellow}${APP_NAME} launched but CDP not yet responding on port ${port}${C.reset}`);
            console.log(`  ${C.dim}If Antigravity was already open, close all its windows and run open again.${C.reset}`);
            console.log(`  ${C.dim}An existing process cannot enable CDP from a second launch.${C.reset}`);
            process.exitCode = 1;
            return;
        }
        console.log(`  ${C.dim}Run ${C.reset}${C.cyan}lazy-gravity start${C.reset}${C.dim} to connect the bot.${C.reset}\n`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  ${C.red}${msg}${C.reset}`);
        console.log(`  ${C.dim}Make sure ${APP_NAME} is installed on your system.${C.reset}\n`);
        process.exitCode = 1;
    }
}
