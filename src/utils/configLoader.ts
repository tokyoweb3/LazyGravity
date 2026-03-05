import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { AppConfig, ExtractionMode } from './config';
import type { LogLevel } from './logger';
import type { PlatformType } from '../platform/types';

// Load .env at module init time (same as the original config.ts behavior).
// dotenv will NOT override already-set env vars by default.
dotenv.config();

const CONFIG_DIR_NAME = '.lazy-gravity';
const CONFIG_FILE_NAME = 'config.json';
const DEFAULT_DB_NAME = 'antigravity.db';

/**
 * JSON-serializable shape stored in ~/.lazy-gravity/config.json.
 * Every field is optional — missing keys fall through to env / defaults.
 */
export interface PersistedConfig {
    discordToken?: string;
    clientId?: string;
    guildId?: string;
    allowedUserIds?: string[];
    workspaceBaseDir?: string;
    autoApproveFileEdits?: boolean;
    logLevel?: LogLevel;
    extractionMode?: 'legacy' | 'structured';
    telegramToken?: string;
    telegramAllowedUserIds?: string[];
    platforms?: PlatformType[];
    language?: 'en' | 'ja';
    antigravityAccounts?: AntigravityAccountConfig[];
}

export interface AntigravityAccountConfig {
    name: string;
    cdpPort: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (no side-effects)
// ---------------------------------------------------------------------------

function getConfigDir(): string {
    return path.join(os.homedir(), CONFIG_DIR_NAME);
}

function getConfigFilePath(): string {
    return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

function getDefaultDbPath(): string {
    return path.join(getConfigDir(), DEFAULT_DB_NAME);
}

/** Expand leading `~` or `~/` to the user's home directory. */
function expandTilde(raw: string): string {
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

function readPersistedConfig(filePath: string): PersistedConfig {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PersistedConfig;
}

/**
 * Merge layers with priority: env vars > persisted config > defaults.
 * Returns a fresh AppConfig object (immutable pattern).
 */
function mergeConfig(persisted: PersistedConfig): AppConfig {
    // Resolve platforms FIRST so we only validate credentials for enabled platforms
    const platforms = resolvePlatforms(
        process.env.PLATFORMS,
        persisted.platforms,
    );

    // Discord credentials — only required when Discord is an active platform
    let discordToken: string | undefined;
    let clientId: string | undefined;
    let allowedUserIds: string[] = [];

    if (platforms.includes('discord')) {
        discordToken = process.env.DISCORD_BOT_TOKEN ?? persisted.discordToken;
        if (!discordToken) {
            throw new Error('Missing required environment variable: DISCORD_BOT_TOKEN');
        }

        clientId = process.env.CLIENT_ID ?? persisted.clientId;
        if (!clientId) {
            throw new Error('Missing required environment variable: CLIENT_ID');
        }

        allowedUserIds = resolveAllowedUserIds(persisted);
        if (allowedUserIds.length === 0) {
            throw new Error('Missing required environment variable: ALLOWED_USER_IDS');
        }
    }

    const defaultDir = path.join(os.homedir(), 'Code');
    const rawDir = process.env.WORKSPACE_BASE_DIR ?? persisted.workspaceBaseDir ?? defaultDir;
    const workspaceBaseDir = expandTilde(rawDir);

    const guildId = process.env.GUILD_ID ?? persisted.guildId ?? undefined;

    const autoApproveFileEdits = resolveBoolean(
        process.env.AUTO_APPROVE_FILE_EDITS,
        persisted.autoApproveFileEdits,
        false,
    );

    const logLevel = resolveLogLevel(
        process.env.LOG_LEVEL,
        persisted.logLevel,
    );

    const extractionMode = resolveExtractionMode(
        process.env.EXTRACTION_MODE,
        persisted.extractionMode,
    );

    const language = resolveLanguage(process.env.BOT_LANGUAGE, persisted.language);

    const antigravityAccounts = resolveAntigravityAccounts(process.env.ANTIGRAVITY_ACCOUNTS, persisted.antigravityAccounts);

    // Telegram credentials — only required when Telegram is an active platform
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? persisted.telegramToken ?? undefined;
    const telegramAllowedUserIds = resolveTelegramAllowedUserIds(persisted);

    if (platforms.includes('telegram') && !telegramToken) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is required when platforms include "telegram"',
        );
    }

    return {
        discordToken,
        clientId,
        guildId,
        allowedUserIds,
        workspaceBaseDir,
        autoApproveFileEdits,
        logLevel,
        extractionMode,
        language,
        antigravityAccounts,
        telegramToken,
        telegramAllowedUserIds,
        platforms,
    };
}

function resolveAllowedUserIds(persisted: PersistedConfig): string[] {
    const envValue = process.env.ALLOWED_USER_IDS;
    if (envValue) {
        return envValue
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
    }
    if (persisted.allowedUserIds && persisted.allowedUserIds.length > 0) {
        return [...persisted.allowedUserIds];
    }
    return [];
}

const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'none'];

function resolveLogLevel(
    envValue: string | undefined,
    persistedValue: LogLevel | undefined,
): LogLevel {
    const raw = envValue?.toLowerCase() ?? persistedValue;
    if (raw && VALID_LOG_LEVELS.includes(raw as LogLevel)) {
        return raw as LogLevel;
    }
    return 'info';
}

function resolveExtractionMode(
    envValue: string | undefined,
    persistedValue: 'legacy' | 'structured' | undefined,
): ExtractionMode {
    const raw = envValue ?? persistedValue;
    if (raw === 'legacy') return 'legacy';
    return 'structured';
}

function resolveTelegramAllowedUserIds(persisted: PersistedConfig): string[] | undefined {
    const envValue = process.env.TELEGRAM_ALLOWED_USER_IDS;
    if (envValue) {
        return envValue
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
    }
    if (persisted.telegramAllowedUserIds && persisted.telegramAllowedUserIds.length > 0) {
        return [...persisted.telegramAllowedUserIds];
    }
    return undefined;
}

const VALID_PLATFORMS: readonly PlatformType[] = ['discord', 'telegram'];

function resolvePlatforms(
    envValue: string | undefined,
    persistedValue: PlatformType[] | undefined,
): PlatformType[] {
    if (envValue) {
        const parsed = envValue
            .split(',')
            .map((p) => p.trim().toLowerCase())
            .filter((p): p is PlatformType => VALID_PLATFORMS.includes(p as PlatformType));
        if (parsed.length > 0) return parsed;
    }
    if (persistedValue && persistedValue.length > 0) {
        const validated = persistedValue.filter(
            (p): p is PlatformType => VALID_PLATFORMS.includes(p as PlatformType),
        );
        if (validated.length > 0) return validated;
    }
    return ['discord'];
}



function resolveLanguage(envValue: string | undefined, persistedValue: 'en' | 'ja' | undefined): 'en' | 'ja' {
    const raw = (envValue ?? persistedValue ?? 'ja').toLowerCase();
    return raw === 'en' ? 'en' : 'ja';
}

function resolveAntigravityAccounts(
    envValue: string | undefined,
    persistedValue: AntigravityAccountConfig[] | undefined,
): AntigravityAccountConfig[] {
    if (envValue && envValue.trim().length > 0) {
        const parsed = envValue
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .map((item, index) => {
                const [nameRaw, portRaw] = item.split(':');
                const port = Number(portRaw);
                if (!nameRaw || !Number.isInteger(port) || port <= 0) return null;
                return { name: nameRaw.trim(), cdpPort: port };
            })
            .filter((x): x is AntigravityAccountConfig => x !== null);
        if (parsed.length > 0) return parsed;
    }

    if (persistedValue && persistedValue.length > 0) {
        const normalized = persistedValue
            .map((account) => ({ name: String(account.name || '').trim(), cdpPort: Number(account.cdpPort) }))
            .filter((account) => account.name.length > 0 && Number.isInteger(account.cdpPort) && account.cdpPort > 0);
        if (normalized.length > 0) return normalized;
    }

    return [{ name: 'default', cdpPort: 9222 }];
}

function resolveBoolean(
    envValue: string | undefined,
    persistedValue: boolean | undefined,
    defaultValue: boolean,
): boolean {
    if (envValue !== undefined) return envValue.toLowerCase() === 'true';
    if (persistedValue !== undefined) return persistedValue;
    return defaultValue;
}

// ---------------------------------------------------------------------------
// Public API (ConfigLoader namespace)
// ---------------------------------------------------------------------------

export const ConfigLoader = {
    /** Return the config directory path (~/.lazy-gravity/). */
    getConfigDir,

    /** Return the full path to config.json. */
    getConfigFilePath,

    /** Return the default database file path (~/.lazy-gravity/antigravity.db). */
    getDefaultDbPath,

    /** Check whether ~/.lazy-gravity/config.json exists on disk. */
    configExists(): boolean {
        return fs.existsSync(getConfigFilePath());
    },

    /** Read persisted config from disk. Returns empty object if file doesn't exist. */
    readPersisted(): PersistedConfig {
        return readPersistedConfig(getConfigFilePath());
    },

    /**
     * Load config using resolution order:
     *   env vars  >  ~/.lazy-gravity/config.json  >  .env  >  defaults
     */
    load(persistedOverride?: PersistedConfig): AppConfig {
        const persisted = persistedOverride ?? readPersistedConfig(getConfigFilePath());
        return mergeConfig(persisted);
    },

    /**
     * Persist the given config to ~/.lazy-gravity/config.json.
     * Creates the directory if it doesn't exist.
     */
    save(config: Partial<PersistedConfig>): void {
        const dir = getConfigDir();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Merge with existing persisted config so partial saves are additive
        const existing = readPersistedConfig(getConfigFilePath());
        const merged: PersistedConfig = { ...existing, ...config };

        fs.writeFileSync(getConfigFilePath(), JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    },
};
