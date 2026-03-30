/** Default CDP port list scanned for Antigravity connections. */
export const DEFAULT_CDP_PORTS = [9222, 9223, 9333, 9444, 9555, 9666] as const;

export interface AntigravityAccountConfigLike {
    name: string;
    cdpPort: number;
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
        normalized.push({ name, cdpPort });
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
            const [nameRaw, portRaw] = entry.split(':');
            const name = nameRaw?.trim();
            const cdpPort = parsePort(portRaw?.trim());
            if (!name || cdpPort === null) return null;
            return { name, cdpPort };
        })
        .filter((account): account is AntigravityAccountConfigLike => account !== null);

    return normalizeAntigravityAccounts(parsed);
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
