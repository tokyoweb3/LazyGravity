import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { getConfiguredCdpPorts } from '../../utils/cdpPorts';

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

async function findAvailablePort(): Promise<number | null> {
    const ports = getConfiguredCdpPorts(process.env.ANTIGRAVITY_ACCOUNTS);
    for (const port of ports) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    return null;
}

function openMacOS(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('open', ['-a', APP_NAME, '--args', `--remote-debugging-port=${port}`], (err) => {
            if (err) {
                reject(new Error(`Failed to open ${APP_NAME}: ${err.message}`));
                return;
            }
            resolve();
        });
    });
}

function openWindows(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(APP_NAME, [`--remote-debugging-port=${port}`], { shell: true }, (err) => {
            if (err) {
                reject(new Error(`Failed to open ${APP_NAME}: ${err.message}`));
                return;
            }
            resolve();
        });
    });
}

function openLinux(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const child = spawn(APP_NAME.toLowerCase(), [`--remote-debugging-port=${port}`], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            child.on('error', (err) => {
                reject(new Error(`Failed to open ${APP_NAME}: ${err.message}`));
            });
            // Give it a moment to detect spawn errors
            setTimeout(() => resolve(), 500);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reject(new Error(`Failed to open ${APP_NAME}: ${msg}`));
        }
    });
}

/**
 * Poll CDP endpoint until it responds or timeout is reached.
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

export async function openAction(): Promise<void> {
    const platform = os.platform();
    const ports = getConfiguredCdpPorts(process.env.ANTIGRAVITY_ACCOUNTS);

    console.log(`\n  ${C.cyan}Searching for an available CDP port...${C.reset}`);

    const port = await findAvailablePort();
    if (port === null) {
        console.log(`  ${C.red}No available CDP ports found.${C.reset}`);
        console.log(`  ${C.dim}All candidate ports are in use: ${ports.join(', ')}${C.reset}`);
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
            console.log(`  ${C.dim}It may still be starting up. Try running start in a few seconds.${C.reset}`);
        }
        console.log(`  ${C.dim}Run ${C.reset}${C.cyan}lazy-gravity start${C.reset}${C.dim} to connect the bot.${C.reset}\n`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  ${C.red}${msg}${C.reset}`);
        console.log(`  ${C.dim}Make sure ${APP_NAME} is installed on your system.${C.reset}\n`);
        process.exitCode = 1;
    }
}
