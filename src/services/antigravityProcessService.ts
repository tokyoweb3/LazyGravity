import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAntigravityProfilePaths } from './conversationTransferService';

interface CockpitInstancesFile {
    instances?: Array<{
        name?: unknown;
        userDataDir?: unknown;
        lastPid?: unknown;
        extraArgs?: unknown;
    }>;
    defaultSettings?: {
        extraArgs?: unknown;
        lastPid?: unknown;
    };
}

interface RunningProcess {
    pid: number;
    ppid: number;
    args: string;
}

function readCockpitInstances(): CockpitInstancesFile {
    const instancesPath = path.join(os.homedir(), '.antigravity_cockpit', 'instances.json');
    if (!fs.existsSync(instancesPath)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(instancesPath, 'utf8')) as CockpitInstancesFile;
    } catch {
        return {};
    }
}

function getRecordedPid(profileName: string, userDataDir: string): number | null {
    const parsed = readCockpitInstances();
    const match = parsed.instances?.find((instance) => {
        const name = typeof instance.name === 'string' ? instance.name.trim().toLowerCase() : '';
        const dir = typeof instance.userDataDir === 'string' ? instance.userDataDir.trim() : '';
        return name === profileName.trim().toLowerCase() || dir === userDataDir;
    });

    const rawPid = match?.lastPid;
    return Number.isInteger(rawPid) && Number(rawPid) > 0 ? Number(rawPid) : null;
}

function extractRemoteDebuggingPort(extraArgs: unknown): number | null {
    if (typeof extraArgs !== 'string' || extraArgs.trim().length === 0) {
        return null;
    }

    const match = extraArgs.match(/--remote-debugging-port=(\d+)/);
    if (!match) {
        return null;
    }

    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 ? port : null;
}

function getRecordedPort(profileName: string, userDataDir: string): number | null {
    const parsed = readCockpitInstances();
    const normalizedProfile = profileName.trim().toLowerCase();

    if (normalizedProfile === 'default') {
        const defaultPort = extractRemoteDebuggingPort(parsed.defaultSettings?.extraArgs);
        if (defaultPort) {
            return defaultPort;
        }
    }

    const match = parsed.instances?.find((instance) => {
        const name = typeof instance.name === 'string' ? instance.name.trim().toLowerCase() : '';
        const dir = typeof instance.userDataDir === 'string' ? instance.userDataDir.trim() : '';
        return name === normalizedProfile || dir === userDataDir;
    });

    return extractRemoteDebuggingPort(match?.extraArgs);
}

function isAntigravityProcess(args: string): boolean {
    const lowered = args.toLowerCase();
    return lowered.includes('/applications/antigravity.app/') || lowered.includes(' antigravity');
}

function isAntigravityMainProcess(args: string): boolean {
    const lowered = args.toLowerCase();
    return lowered.includes('/applications/antigravity.app/contents/macos/electron')
        || lowered.includes('/applications/antigravity.app/contents/macos/antigravity')
        || lowered.includes('\\antigravity.exe')
        || lowered.includes('/antigravity.exe')
        || (lowered.includes('antigravity') && lowered.includes('--remote-debugging-port'));
}

function findRootAntigravityPid(processes: RunningProcess[], startPid: number): number {
    const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
    let current = byPid.get(startPid);
    let lastAntigravityPid = startPid;

    while (current) {
        if (isAntigravityProcess(current.args)) {
            lastAntigravityPid = current.pid;
        }

        const parent = byPid.get(current.ppid);
        if (!parent || !isAntigravityProcess(parent.args)) {
            break;
        }
        current = parent;
    }

    return lastAntigravityPid;
}

function execFileAsync(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

async function listRunningProcesses(): Promise<RunningProcess[]> {
    const stdout = await execFileAsync('ps', ['-Ao', 'pid,ppid,args']);
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
            if (!match) {
                return null;
            }
            return {
                pid: Number(match[1]),
                ppid: Number(match[2]),
                args: match[3],
            };
        })
        .filter((item): item is RunningProcess => !!item);
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export async function findRunningAntigravityPid(profileName: string): Promise<number | null> {
    const profile = resolveAntigravityProfilePaths(profileName);
    const processes = await listRunningProcesses().catch(() => []);
    const recordedPort = getRecordedPort(profile.profileName, profile.userDataDir);
    const normalizedDir = profile.userDataDir.toLowerCase();

    if (recordedPort) {
        const byPort = processes.find((proc) => {
            const args = proc.args.toLowerCase();
            return isAntigravityMainProcess(args) && args.includes(`--remote-debugging-port=${recordedPort}`);
        });
        if (byPort) {
            return byPort.pid;
        }
    }

    const recordedPid = getRecordedPid(profile.profileName, profile.userDataDir);
    if (recordedPid && isPidAlive(recordedPid)) {
        const proc = processes.find((candidate) => candidate.pid === recordedPid);
        if (proc && isAntigravityProcess(proc.args)) {
            return findRootAntigravityPid(processes, recordedPid);
        }
    }

    const matched = processes.find((proc) => {
        const args = proc.args.toLowerCase();
        return isAntigravityProcess(args) && args.includes(normalizedDir);
    });
    if (matched) {
        return findRootAntigravityPid(processes, matched.pid);
    }

    return null;
}

async function isProfileStopped(profileName: string): Promise<boolean> {
    const profile = resolveAntigravityProfilePaths(profileName);
    const processes = await listRunningProcesses().catch(() => []);
    const recordedPort = getRecordedPort(profile.profileName, profile.userDataDir);
    const normalizedDir = profile.userDataDir.toLowerCase();

    const hasMain = recordedPort
        ? processes.some((proc) => {
            const args = proc.args.toLowerCase();
            return isAntigravityMainProcess(args) && args.includes(`--remote-debugging-port=${recordedPort}`);
        })
        : false;

    const hasProfileProcess = processes.some((proc) => {
        const args = proc.args.toLowerCase();
        return isAntigravityProcess(args) && args.includes(normalizedDir);
    });

    return !hasMain && !hasProfileProcess;
}

export async function quitAntigravityProfile(profileName: string, timeoutMs = 15000): Promise<boolean> {
    const pid = await findRunningAntigravityPid(profileName);
    if (!pid) {
        return true;
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        return false;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (!isPidAlive(pid) && await isProfileStopped(profileName)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return false;
}
