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
    const workspaceBaseDir = process.env.WORKSPACE_BASE_DIR || defaultDir;

    // ギルドID（スラッシュコマンドの即時反映用）
    const guildId = process.env.GUILD_ID || undefined;

    return {
        discordToken: token,
        clientId,
        guildId,
        allowedUserIds,
        workspaceBaseDir,
    };
}
