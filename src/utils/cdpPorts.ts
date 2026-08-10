/** Default CDP port list scanned for Antigravity connections. */
export const DEFAULT_CDP_PORTS = [9222, 9223, 9333, 9444, 9555, 9666] as const;

/**
 * Representation of account metadata containing connection settings.
 */
export interface AntigravityAccountConfigLike {
    /** Account name. */
    name: string;
    /** Debugging port. */
    cdpPort: number;
    /** User data directory path. */
    userDataDir?: string;
}

/**
 * Helper to parse a raw string port value into integer.
 * @param raw Raw port string.
 * @returns Parsed port integer, or null if invalid.
 */
function parsePort(raw: string | undefined): number | null {
    const port = Number(raw);
    if (!Number.isInteger(port)) return null;
    if (port < 1 || port > 65535) return null;
    return port;
}

/**
 * Normalizes accounts configurations list and fills default parameters if empty.
 * @param accounts Candidate accounts.
 * @returns Normalized list of accounts.
 */
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

/**
 * Parses raw configuration environment string into accounts arrays.
 * Format: name:port[@userDataDir],...
 * @param rawValue Raw environment string value.
 * @returns Array of parsed account configurations.
 */
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

/**
 * Serializes accounts list back into formatted environment string format.
 * @param accounts Normalized accounts list.
 * @returns Serialized format string.
 */
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

/**
 * Extracts distinct list of ports from raw accounts value string.
 * @param rawValue Raw value string.
 * @returns Array of port integers.
 */
export function getConfiguredCdpPorts(rawValue?: string): number[] {
    return getCdpCandidatePorts(rawValue);
}

/**
 * Constructs a name-to-port dictionary mapping object.
 * @param rawValue Raw value string.
 * @returns Name-to-port dictionary mappings.
 */
export function getAccountPortMap(rawValue?: string): Record<string, number> {
    return Object.fromEntries(
        parseAntigravityAccounts(rawValue).map((account) => [account.name, account.cdpPort]),
    );
}

/**
 * Resolves deduplicated candidate CDP ports prioritizing custom env overrides.
 * @param accountsEnv Raw ANTIGRAVITY_ACCOUNTS env string.
 * @param singlePortEnv Raw CDP_PORT env string.
 * @returns Deduplicated array of candidate ports.
 */
export function getCdpCandidatePorts(
    accountsEnv?: string,
    singlePortEnv?: string,
): number[] {
    const candidatePorts = new Set<number>();

    const singlePort = parsePort(singlePortEnv ?? process.env.CDP_PORT);
    if (singlePort !== null) {
        candidatePorts.add(singlePort);
    }

    const rawAccounts = accountsEnv ?? process.env.ANTIGRAVITY_ACCOUNTS;
    if (rawAccounts && rawAccounts.trim().length > 0) {
        for (const account of parseAntigravityAccounts(rawAccounts)) {
            candidatePorts.add(account.cdpPort);
        }
    }

    for (const port of DEFAULT_CDP_PORTS) {
        candidatePorts.add(port);
    }

    return Array.from(candidatePorts);
}

/** CDP port list scanned for Antigravity connections */
export const CDP_PORTS = DEFAULT_CDP_PORTS;

