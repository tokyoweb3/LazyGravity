import { ConfigLoader } from './configLoader';
import type { LogLevel } from './logger';
import type { PlatformType } from '../platform/types';
import type { AntigravityAccountConfig } from './configLoader';

export type ExtractionMode = 'legacy' | 'structured';

export interface AppConfig {
    language?: 'en' | 'ja';
    antigravityAccounts?: AntigravityAccountConfig[];
    /** Discord Bot Token (optional — only required when 'discord' is in platforms). */
    discordToken?: string;
    /** Discord Application Client ID (optional — only required when 'discord' is in platforms). */
    clientId?: string;
    guildId?: string;
    allowedUserIds: string[];
    workspaceBaseDir: string;
    autoApproveFileEdits: boolean;
    logLevel: LogLevel;
    extractionMode: ExtractionMode;
    /** Telegram Bot Token (optional — required when 'telegram' is in platforms). */
    telegramToken?: string;
    /** Allowed Telegram user IDs (numeric strings). */
    telegramAllowedUserIds?: string[];
    /** Active platforms. Defaults to ['discord']. */
    platforms: PlatformType[];
}

export type ResponseDeliveryMode = 'stream';

/**
 * Response delivery is fixed to 'stream'.
 * Env vars are read for backward compatibility but the value is always 'stream'.
 */
export function resolveResponseDeliveryMode(): ResponseDeliveryMode {
    return 'stream';
}

/**
 * Load application config.
 * Delegates to ConfigLoader which resolves:
 *   env vars  >  ~/.lazy-gravity/config.json  >  .env  >  defaults
 */
export function loadConfig(): AppConfig {
    return ConfigLoader.load();
}
