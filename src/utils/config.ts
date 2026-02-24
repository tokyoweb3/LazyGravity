import { ConfigLoader } from './configLoader';

export interface AppConfig {
    discordToken: string;
    clientId: string;
    guildId?: string;
    allowedUserIds: string[];
    workspaceBaseDir: string;
    autoApproveFileEdits: boolean;
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
