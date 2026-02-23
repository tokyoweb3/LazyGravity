import * as dotenv from 'dotenv';
import * as os from 'os';
import * as path from 'path';

// Force load .env file from process current working directory
dotenv.config();

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
 * レスポンス配信経路は stream に一本化する。
 * 互換のため環境変数は読むが、値に関わらず stream を返す。
 */
export function resolveResponseDeliveryMode(): ResponseDeliveryMode {
    const requested = (
        process.env.LAZYGRAVITY_RESPONSE_DELIVERY ||
        process.env.LAZYGRAVITY_RESPONSE_MODE ||
        'stream'
    ).trim().toLowerCase();

    if (requested !== 'stream') {
        return 'stream';
    }
    return 'stream';
}

export function loadConfig(): AppConfig {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        throw new Error('Missing required environment variable: DISCORD_TOKEN');
    }

    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
        throw new Error('Missing required environment variable: CLIENT_ID');
    }

    const allowedIdsStr = process.env.ALLOWED_USER_IDS;
    if (!allowedIdsStr) {
        throw new Error('Missing required environment variable: ALLOWED_USER_IDS');
    }

    // Parse allowed IDs, splitting by comma and removing whitespace
    const allowedUserIds = allowedIdsStr.split(',').map((id) => id.trim()).filter((id) => id.length > 0);

    // Default workspace base directory is ~/Code for instance
    const defaultDir = path.join(os.homedir(), 'Code');
    const rawDir = process.env.WORKSPACE_BASE_DIR || defaultDir;
    // チルダ(~)をホームディレクトリに展開（dotenvは自動展開しないため）
    const workspaceBaseDir = rawDir.startsWith('~/')
        ? path.join(os.homedir(), rawDir.slice(2))
        : rawDir === '~'
            ? os.homedir()
            : rawDir;

    // ギルドID（スラッシュコマンドの即時反映用）
    const guildId = process.env.GUILD_ID || undefined;
    const autoApproveFileEdits = (process.env.AUTO_APPROVE_FILE_EDITS || '').toLowerCase() === 'true';

    return {
        discordToken: token,
        clientId,
        guildId,
        allowedUserIds,
        workspaceBaseDir,
        autoApproveFileEdits,
    };
}
