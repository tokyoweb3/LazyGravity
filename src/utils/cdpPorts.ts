/** Default CDP port list scanned for Antigravity connections. */
export const DEFAULT_CDP_PORTS = [9222, 9223, 9333, 9444, 9555, 9666] as const;

export interface AntigravityAccountConfigLike {
    name: string;
    cdpPort: number;
    userDataDir?: string;
}

function parsePort(raw: string | undefined): number | null {
    const port = Number(raw);
    if (!Number.isInteger(port)) return null;
    if (port < 1 || port > 65535) return null;
    return port;
}

export function normalizeAntigravityAccounts(
    accounts: readonly AntigravityAccountConfigLike[] | undefined,
): AntigravityAccountConfigLike[] {
    if (!accounts || accounts.length === 0) {
        return [{ name: 'default', cdpPort: DEFAULT_CDP_PORTS[0] }];
    }

    const seenNames = new Set<string>();
    const normalized: AntigravityAccountConfigLike[] = [];

    for (const account of accounts) {
        const name = String(account.name || '').trim();
        const cdpPort = parsePort(String(account.cdpPort));
        if (!name || cdpPort === null || seenNames.has(name)) continue;
        seenNames.add(name);
        const userDataDir = typeof account.userDataDir === 'string'
            ? account.userDataDir.trim()
            : '';
        normalized.push({
            name,
            cdpPort,
            ...(userDataDir ? { userDataDir } : {}),
        });
    }

    return normalized.length > 0
        ? normalized
        : [{ name: 'default', cdpPort: DEFAULT_CDP_PORTS[0] }];
}

export function parseAntigravityAccounts(
    rawValue: string | undefined,
): AntigravityAccountConfigLike[] {
    if (!rawValue || rawValue.trim().length === 0) {
        return [{ name: 'default', cdpPort: DEFAULT_CDP_PORTS[0] }];
    }

    const parsed = rawValue
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => {
            const colonIndex = entry.indexOf(':');
            if (colonIndex <= 0) return null;

            const name = entry.slice(0, colonIndex).trim();
            const rest = entry.slice(colonIndex + 1).trim();
            const atIndex = rest.indexOf('@');
            const portRaw = atIndex >= 0 ? rest.slice(0, atIndex).trim() : rest;
            const userDataDirRaw = atIndex >= 0 ? rest.slice(atIndex + 1).trim() : '';
            const cdpPort = parsePort(portRaw);
            if (!name || cdpPort === null) return null;
            return {
                name,
                cdpPort,
                ...(userDataDirRaw ? { userDataDir: userDataDirRaw } : {}),
            };
        })
        .filter((account): account is AntigravityAccountConfigLike => account !== null);

    return normalizeAntigravityAccounts(parsed);
}

export function serializeAntigravityAccounts(
    accounts: readonly AntigravityAccountConfigLike[] | undefined,
): string {
    return normalizeAntigravityAccounts(accounts)
        .map((account) => {
            const userDataDir = typeof account.userDataDir === 'string'
                ? account.userDataDir.trim()
                : '';
            return userDataDir
                ? `${account.name}:${account.cdpPort}@${userDataDir}`
                : `${account.name}:${account.cdpPort}`;
        })
        .join(',');
}

export function getConfiguredCdpPorts(rawValue?: string): number[] {
    if (!rawValue || rawValue.trim().length === 0) {
        return [...DEFAULT_CDP_PORTS];
    }

    const accounts = parseAntigravityAccounts(rawValue);
    const uniquePorts = new Set<number>();

    for (const account of accounts) {
        uniquePorts.add(account.cdpPort);
    }

    return uniquePorts.size > 0 ? [...uniquePorts] : [...DEFAULT_CDP_PORTS];
}

export function getAccountPortMap(rawValue?: string): Record<string, number> {
    return Object.fromEntries(
        parseAntigravityAccounts(rawValue).map((account) => [account.name, account.cdpPort]),
    );
}

/** CDP port list scanned for Antigravity connections */
export const CDP_PORTS = DEFAULT_CDP_PORTS;
