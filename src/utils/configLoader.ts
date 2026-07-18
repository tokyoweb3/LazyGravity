import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { AppConfig, ExtractionMode } from './config';
import type { LogLevel } from './logger';
import type { PlatformType } from '../platform/types';
import {
    normalizeAntigravityAccounts,
    parseAntigravityAccounts,
} from './cdpPorts';

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
    /** Bot token credential. */
    discordToken?: string;
    /** Client application ID. */
    clientId?: string;
    /** Discord guild/server ID. */
    guildId?: string;
    /** Allowed Discord user IDs list. */
    allowedUserIds?: string[];
    /** Default base workspace directory path. */
    workspaceBaseDir?: string;
    /** Auto approve file edits toggle flag. */
    autoApproveFileEdits?: boolean;
    /** Log severity level limit. */
    logLevel?: LogLevel;
    /** Output extraction mode. */
    extractionMode?: 'legacy' | 'structured';
    /** Telegram token credential. */
    telegramToken?: string;
    /** Allowed Telegram user IDs list. */
    telegramAllowedUserIds?: string[];
    /** Platforms enabled list. */
    platforms?: PlatformType[];
    /** Response monitor timeout in ms. */
    responseTimeoutMs?: number;
    /** Serialized or object config accounts array. */
    antigravityAccounts?: string | AntigravityAccountConfig[];
    /** CDP target hostname. */
    cdpHost?: string;
    /** Heartbeat notification enabled state. */
    heartbeatEnabled?: boolean;
    /** Heartbeat notification frequency interval in ms. */
    heartbeatIntervalMs?: number;
    /** Heartbeat notification destination channel. */
    heartbeatChannelId?: string;
    /** Last heartbeat notification message ID. */
    heartbeatLastMessageId?: string;
}

/**
 * Config item representation for accounts.
 */
export interface AntigravityAccountConfig {
    /** Account name. */
    name: string;
    /** CDP port identifier. */
    cdpPort: number;
    /** Custom user data directory. */
    userDataDir?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (no side-effects)
// ---------------------------------------------------------------------------

/**
 * Gets the home config directory path.
 * @returns Absolute path string.
 */
function getConfigDir(): string {
    return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Gets the config.json filepath.
 * @returns Absolute filepath string.
 */
function getConfigFilePath(): string {
    return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Gets the default SQLite database path location.
 * @returns Database filepath string.
 */
function getDefaultDbPath(): string {
    return path.join(getConfigDir(), DEFAULT_DB_NAME);
}

/** Expand leading `~` or `~/` to the user's home directory.
 * @param raw Input path string.
 * @returns Expanded absolute path string.
 */
function expandTilde(raw: string): string {
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

/**
 * Reads config.json contents safely.
 * @param filePath Config json file location.
 * @returns Read PersistedConfig options object.
 */
function readPersistedConfig(filePath: string): PersistedConfig {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PersistedConfig;
}

/**
 * Merge layers with priority: env vars > persisted config > defaults.
 * Returns a fresh AppConfig object (immutable pattern).
 * @param persisted Parsed config options from disk.
 * @returns Constructed AppConfig container.
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

    const responseTimeoutMs = resolvePositiveInt(
        process.env.RESPONSE_TIMEOUT_MS,
        persisted.responseTimeoutMs,
        900000,
    );
    const antigravityAccounts = resolveAntigravityAccounts(
        process.env.ANTIGRAVITY_ACCOUNTS,
        persisted.antigravityAccounts,
    );

    // Telegram credentials — only required when Telegram is an active platform
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? persisted.telegramToken ?? undefined;
    const telegramAllowedUserIds = resolveTelegramAllowedUserIds(persisted);

    const rawCdpHost = (process.env.CDP_HOST ?? persisted.cdpHost ?? '').trim();
    const cdpHost = rawCdpHost || '127.0.0.1';

    if (platforms.includes('telegram') && !telegramToken) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is required when platforms include "telegram"',
        );
    }

    const heartbeatEnabled = resolveBoolean(
        process.env.HEARTBEAT_ENABLED,
        persisted.heartbeatEnabled,
        false,
    );

    const heartbeatIntervalMs = resolvePositiveInt(
        process.env.HEARTBEAT_INTERVAL_MS,
        persisted.heartbeatIntervalMs,
        3600000,
    );

    const heartbeatChannelId = process.env.HEARTBEAT_CHANNEL_ID ?? persisted.heartbeatChannelId ?? undefined;
    const heartbeatLastMessageId = persisted.heartbeatLastMessageId ?? undefined;

    return {
        discordToken,
        clientId,
        guildId,
        allowedUserIds,
        workspaceBaseDir,
        autoApproveFileEdits,
        logLevel,
        extractionMode,
        responseTimeoutMs,
        antigravityAccounts,
        telegramToken,
        telegramAllowedUserIds,
        platforms,
        cdpHost,
        heartbeatEnabled,
        heartbeatIntervalMs,
        heartbeatChannelId,
        heartbeatLastMessageId,
    };
}

/**
 * Resolves allowed Discord user IDs list.
 * @param persisted Persisted configuration values.
 * @returns Array of user ID strings.
 */
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

/**
 * Resolves active LogLevel settings parameter.
 * @param envValue Environment string value.
 * @param persistedValue Configured persisted log level.
 * @returns Active LogLevel string.
 */
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

/**
 * Resolves output parsing/extraction mode parameters.
 * @param envValue Environment string value.
 * @param persistedValue Configured persisted extraction mode.
 * @returns Active ExtractionMode string.
 */
function resolveExtractionMode(
    envValue: string | undefined,
    persistedValue: 'legacy' | 'structured' | undefined,
): ExtractionMode {
    const raw = envValue ?? persistedValue;
    if (raw === 'legacy') return 'legacy';
    return 'structured';
}

/**
 * Resolves allowed Telegram operator user IDs list.
 * @param persisted Persisted configuration values.
 * @returns Array of user ID strings or undefined.
 */
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

/**
 * Resolves configured accounts connections metadata configurations.
 * @param envValue Environment string value.
 * @param persistedValue Configured persisted accounts value.
 * @returns Normalized accounts configurations list.
 */
function resolveAntigravityAccounts(
    envValue: string | undefined,
    persistedValue: string | AntigravityAccountConfig[] | undefined,
): AntigravityAccountConfig[] {
    if (envValue && envValue.trim().length > 0) {
        return parseAntigravityAccounts(envValue);
    }

    if (typeof persistedValue === 'string' && persistedValue.trim().length > 0) {
        return parseAntigravityAccounts(persistedValue);
    }

    return Array.isArray(persistedValue)
        ? normalizeAntigravityAccounts(persistedValue)
        : normalizeAntigravityAccounts(undefined);
}

const VALID_PLATFORMS: readonly PlatformType[] = ['discord', 'telegram'];

/**
 * Resolves active platform adapters configuration list.
 * @param envValue Environment platforms configuration string.
 * @param persistedValue Persisted configurations enabled platforms.
 * @returns Array of enabled platform types.
 */
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

/**
 * Resolves a simple boolean toggle flag.
 * @param envValue Environment toggle string.
 * @param persistedValue Persisted boolean parameter.
 * @param defaultValue Default fallback boolean state.
 * @returns Resolved boolean parameter state.
 */
function resolveBoolean(
    envValue: string | undefined,
    persistedValue: boolean | undefined,
    defaultValue: boolean,
): boolean {
    if (envValue !== undefined) return envValue.toLowerCase() === 'true';
    if (persistedValue !== undefined) return persistedValue;
    return defaultValue;
}

/**
 * Resolve a non-negative integer value from env var > persisted config > default.
 * Returns the default if the env/persisted value is not a valid non-negative integer.
 * @param envValue Environment string integer.
 * @param persistedValue Persisted integer.
 * @param defaultValue Default fallback integer value.
 * @returns Resolved integer configuration value.
 */
function resolvePositiveInt(
    envValue: string | undefined,
    persistedValue: number | undefined,
    defaultValue: number,
): number {
    if (envValue !== undefined) {
        const parsed = parseInt(envValue, 10);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    if (persistedValue !== undefined && persistedValue >= 0) return persistedValue;
    return defaultValue;
}

// ---------------------------------------------------------------------------
// Public API (ConfigLoader namespace)
// ---------------------------------------------------------------------------

/** Public ConfigLoader namespace containing load, read, and save configurations scripts. */
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
