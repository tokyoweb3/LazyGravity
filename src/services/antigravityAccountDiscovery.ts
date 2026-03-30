import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import { DEFAULT_CDP_PORTS } from '../utils/cdpPorts';

export interface DiscoveredAccount extends AntigravityAccountConfig {
    source: string;
}

export interface DiscoveryResult {
    accounts: DiscoveredAccount[];
    warnings: string[];
}

interface CockpitInstanceRecord {
    name?: unknown;
    userDataDir?: unknown;
    extraArgs?: unknown;
}

function normalizeName(rawName: string, fallbackPort: number): string {
    const trimmed = rawName.trim().toLowerCase();
    const sanitized = trimmed
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return sanitized || `account-${fallbackPort}`;
}

function extractPort(raw: string | undefined): number | null {
    if (!raw) return null;
    const match = raw.match(/--remote-debugging-port(?:=|\s+)(\d+)/);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function extractUserDataDir(raw: string | undefined): string | null {
    if (!raw) return null;

    const quotedMatch = raw.match(/--user-data-dir(?:=|\s+)("([^"]+)"|'([^']+)')/);
    if (quotedMatch) {
        return quotedMatch[2] || quotedMatch[3] || null;
    }

    const unquotedMatch = raw.match(/--user-data-dir(?:=|\s+)(.+?)(?=\s+--[\w-]+|$)/);
    if (!unquotedMatch) return null;

    const value = unquotedMatch[1].trim();
    return value.length > 0 ? value : null;
}

function getDefaultAntigravityUserDataDir(): string {
    const home = os.homedir();
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Antigravity');
    }
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
        return path.join(appData, 'Antigravity');
    }
    return path.join(home, '.config', 'Antigravity');
}

function parseCommandLineAccount(line: string): AntigravityAccountConfig | null {
    if (!/antigravity/i.test(line)) return null;

    const cdpPort = extractPort(line);
    const userDataDir = extractUserDataDir(line);

    if (cdpPort === null || !userDataDir) return null;

    return {
        name: normalizeName(path.basename(userDataDir), cdpPort),
        cdpPort,
        userDataDir,
    };
}

function listCockpitCandidateDirs(): string[] {
    const home = os.homedir();

    if (process.platform === 'darwin') {
        return [
            path.join(home, '.antigravity_cockpit'),
            path.join(home, 'Library', 'Application Support', 'com.antigravity.cockpit-tools'),
            path.join(home, 'Library', 'Application Support', 'cockpit-tools'),
            path.join(home, 'Library', 'Application Support', 'antigravity-cockpit-tools'),
            path.join(home, 'Library', 'Application Support', 'com.lbjlaq.antigravity-tools'),
        ];
    }

    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
        return [
            path.join(home, '.antigravity_cockpit'),
            path.join(appData, 'com.antigravity.cockpit-tools'),
            path.join(appData, 'cockpit-tools'),
            path.join(appData, 'antigravity-cockpit-tools'),
            path.join(appData, 'com.lbjlaq.antigravity-tools'),
        ];
    }

    return [
        path.join(home, '.antigravity_cockpit'),
        path.join(home, '.config', 'com.antigravity.cockpit-tools'),
        path.join(home, '.config', 'cockpit-tools'),
        path.join(home, '.config', 'antigravity-cockpit-tools'),
        path.join(home, '.config', 'com.lbjlaq.antigravity-tools'),
    ];
}

export function hasCockpitSettings(): boolean {
    const instancesPath = path.join(os.homedir(), '.antigravity_cockpit', 'instances.json');
    if (fs.existsSync(instancesPath)) {
        return true;
    }

    return listCockpitCandidateDirs().some((dir) => fs.existsSync(dir));
}

function collectJsonFiles(rootDir: string, depth: number = 3): string[] {
    if (!fs.existsSync(rootDir)) return [];

    const results: string[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                if (current.depth < depth) {
                    queue.push({ dir: fullPath, depth: current.depth + 1 });
                }
                continue;
            }

            if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

function parseJsonTextForAccounts(raw: string): AntigravityAccountConfig[] {
    const matches: AntigravityAccountConfig[] = [];
    const pairPattern = /"name"\s*:\s*"([^"]+)"[\s\S]{0,400}?"(?:cdpPort|port|remoteDebuggingPort|remote_debugging_port)"\s*:\s*(\d+)[\s\S]{0,400}?"(?:userDataDir|user_data_dir|user-data-dir)"\s*:\s*"([^"]+)"/g;

    let pairMatch: RegExpExecArray | null;
    while ((pairMatch = pairPattern.exec(raw)) !== null) {
        matches.push({
            name: normalizeName(pairMatch[1], Number(pairMatch[2])),
            cdpPort: Number(pairMatch[2]),
            userDataDir: pairMatch[3],
        });
    }

    const flagPattern = /--remote-debugging-port(?:=|\s+)(\d+)[\s\S]{0,200}--user-data-dir(?:=|\s+)("([^"]+)"|'([^']+)'|([^\s",]+))/g;
    let flagMatch: RegExpExecArray | null;
    while ((flagMatch = flagPattern.exec(raw)) !== null) {
        const cdpPort = Number(flagMatch[1]);
        const userDataDir = flagMatch[3] || flagMatch[4] || flagMatch[5];
        if (!Number.isInteger(cdpPort) || !userDataDir) continue;
        matches.push({
            name: normalizeName(path.basename(userDataDir), cdpPort),
            cdpPort,
            userDataDir,
        });
    }

    return matches;
}

function readCockpitInstancesFile(filePath: string): CockpitInstanceRecord[] {
    if (!fs.existsSync(filePath)) return [];

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { instances?: CockpitInstanceRecord[] };
        return Array.isArray(parsed.instances) ? parsed.instances : [];
    } catch {
        return [];
    }
}

function nextAvailablePort(usedPorts: Set<number>): number {
    for (const port of DEFAULT_CDP_PORTS) {
        if (!usedPorts.has(port)) return port;
    }

    let candidate = Math.max(...DEFAULT_CDP_PORTS, 9222) + 1;
    while (usedPorts.has(candidate)) {
        candidate += 1;
    }
    return candidate;
}

function parseCockpitInstances(
    records: CockpitInstanceRecord[],
    usedPorts: Set<number>,
): DiscoveryResult {
    const accounts: DiscoveredAccount[] = [];
    const warnings: string[] = [];

    for (const record of records) {
        const userDataDir = typeof record.userDataDir === 'string' ? record.userDataDir.trim() : '';
        if (!userDataDir) continue;

        const recordName = typeof record.name === 'string' ? record.name : path.basename(userDataDir);
        let cdpPort = extractPort(typeof record.extraArgs === 'string' ? record.extraArgs : undefined);
        if (cdpPort === null) {
            cdpPort = nextAvailablePort(usedPorts);
            warnings.push(`Auto-assigned CDP port ${cdpPort} for "${recordName}" because cockpit extraArgs did not set --remote-debugging-port.`);
        }

        usedPorts.add(cdpPort);
        accounts.push({
            name: normalizeName(recordName, cdpPort),
            cdpPort,
            userDataDir,
            source: 'file:' + path.join(os.homedir(), '.antigravity_cockpit', 'instances.json'),
        });
    }

    const defaultUserDataDir = getDefaultAntigravityUserDataDir();
    const hasDefaultMapping = accounts.some((account) => account.userDataDir === defaultUserDataDir);
    if (!hasDefaultMapping) {
        warnings.push(
            `No cockpit instance explicitly uses the default Antigravity profile directory (${defaultUserDataDir}). ` +
            'Create one in cockpit for the default instance, otherwise cockpit may not reopen that default instance correctly when another work instance is already open.',
        );
    }

    return { accounts, warnings };
}

async function getProcessCommandLines(): Promise<string[]> {
    const run = (command: string, args: string[]): Promise<string> =>
        new Promise((resolve, reject) => {
            execFile(command, args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });

    try {
        if (process.platform === 'win32') {
            const stdout = await run('powershell', [
                '-NoProfile',
                '-Command',
                "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'antigravity' } | Select-Object -ExpandProperty CommandLine",
            ]);
            return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        }

        const stdout = await run('/bin/sh', ['-lc', "ps -Ao args= | grep -i antigravity | grep -v grep"]);
        return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

export async function discoverAntigravityAccounts(
    existingAccounts: readonly AntigravityAccountConfig[] = [],
): Promise<DiscoveryResult> {
    const discovered = new Map<string, DiscoveredAccount>();
    const warnings: string[] = [];
    const usedPorts = new Set<number>(existingAccounts.map((account) => account.cdpPort));

    const cockpitInstancesPath = path.join(os.homedir(), '.antigravity_cockpit', 'instances.json');
    const cockpitResult = parseCockpitInstances(readCockpitInstancesFile(cockpitInstancesPath), usedPorts);
    for (const account of cockpitResult.accounts) {
        discovered.set(account.name, account);
    }
    warnings.push(...cockpitResult.warnings);

    for (const line of await getProcessCommandLines()) {
        const account = parseCommandLineAccount(line);
        if (!account) continue;

        const alreadyKnown = [...discovered.values()].some((existing) =>
            existing.cdpPort === account.cdpPort ||
            existing.userDataDir === account.userDataDir,
        );
        if (discovered.has(account.name) || alreadyKnown) continue;

        usedPorts.add(account.cdpPort);
        discovered.set(account.name, { ...account, source: 'running-process' });
    }

    for (const dir of listCockpitCandidateDirs()) {
        for (const filePath of collectJsonFiles(dir)) {
            if (filePath === cockpitInstancesPath) continue;

            let raw = '';
            try {
                raw = fs.readFileSync(filePath, 'utf-8');
            } catch {
                continue;
            }

            for (const account of parseJsonTextForAccounts(raw)) {
                if (discovered.has(account.name) || usedPorts.has(account.cdpPort)) continue;
                usedPorts.add(account.cdpPort);
                discovered.set(account.name, { ...account, source: `file:${filePath}` });
            }
        }
    }

    return {
        accounts: [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name)),
        warnings,
    };
}
