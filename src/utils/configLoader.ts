import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { AppConfig, ExtractionMode } from './config';

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
    extractionMode?: 'legacy' | 'structured';
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
    const token = process.env.DISCORD_BOT_TOKEN ?? persisted.discordToken;
    if (!token) {
        throw new Error('Missing required environment variable: DISCORD_BOT_TOKEN');
    }

    const clientId = process.env.CLIENT_ID ?? persisted.clientId;
    if (!clientId) {
        throw new Error('Missing required environment variable: CLIENT_ID');
    }

    const allowedUserIds = resolveAllowedUserIds(persisted);
    if (allowedUserIds.length === 0) {
        throw new Error('Missing required environment variable: ALLOWED_USER_IDS');
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

    const extractionMode = resolveExtractionMode(
        process.env.EXTRACTION_MODE,
        persisted.extractionMode,
    );

    return {
        discordToken: token,
        clientId,
        guildId,
        allowedUserIds,
        workspaceBaseDir,
        autoApproveFileEdits,
        extractionMode,
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

function resolveExtractionMode(
    envValue: string | undefined,
    persistedValue: 'legacy' | 'structured' | undefined,
): ExtractionMode {
    const raw = envValue ?? persistedValue;
    if (raw === 'legacy') return 'legacy';
    return 'structured';
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
