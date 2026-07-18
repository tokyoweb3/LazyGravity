import { ConfigLoader } from './configLoader';
import type { LogLevel } from './logger';
import type { PlatformType } from '../platform/types';
import type { AntigravityAccountConfig } from './configLoader';

/** Extraction mode setting option string. */
export type ExtractionMode = 'legacy' | 'structured';

/**
 * Interface defining the application config structure.
 */
export interface AppConfig {
    /** Discord Bot Token (optional — only required when 'discord' is in platforms). */
    discordToken?: string;
    /** Discord Application Client ID (optional — only required when 'discord' is in platforms). */
    clientId?: string;
    /** Discord Guild identifier. */
    guildId?: string;
    /** Allowed Discord user IDs. */
    allowedUserIds: string[];
    /** Base workspace path. */
    workspaceBaseDir: string;
    /** Auto approve file edits flag. */
    autoApproveFileEdits: boolean;
    /** Logging level setting. */
    logLevel: LogLevel;
    /** Dom extraction mode strategy. */
    extractionMode: ExtractionMode;
    /** Cdp target server host. */
    cdpHost: string;
    /** Named Antigravity instances mapped to CDP ports and optional user-data-dir. */
    antigravityAccounts: AntigravityAccountConfig[];
    /** Telegram Bot Token (optional — required when 'telegram' is in platforms). */
    telegramToken?: string;
    /** Allowed Telegram user IDs (numeric strings). */
    telegramAllowedUserIds?: string[];
    /** Active platforms. Defaults to ['discord']. */
    platforms: PlatformType[];
    /** Response monitor inactivity timeout in ms. 0 = disabled. Default: 900000 (15 min). */
    responseTimeoutMs: number;
    /** Heartbeat enabled flag. */
    heartbeatEnabled: boolean;
    /** Heartbeat log interval in milliseconds. */
    heartbeatIntervalMs: number;
    /** Heartbeat destination channel identifier. */
    heartbeatChannelId?: string;
    /** Heartbeat last message identifier trace. */
    heartbeatLastMessageId?: string;
}

/** Response delivery mode setting type. */
export type ResponseDeliveryMode = 'stream';

/**
 * Response delivery is fixed to 'stream'.
 * Env vars are read for backward compatibility but the value is always 'stream'.
 * @returns Fixed 'stream' ResponseDeliveryMode.
 */
export function resolveResponseDeliveryMode(): ResponseDeliveryMode {
    return 'stream';
}

/**
 * Load application config.
 * Delegates to ConfigLoader which resolves:
 *   env vars  >  ~/.lazy-gravity/config.json  >  .env  >  defaults
 * @returns Configured AppConfig details.
 */
export function loadConfig(): AppConfig {
    return ConfigLoader.load();
}
