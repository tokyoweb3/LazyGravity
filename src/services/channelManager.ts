import { Guild, ChannelType } from 'discord.js';

/**
 * Result of auto-creating a channel/category
 */
export interface EnsureChannelResult {
    /** Category ID */
    categoryId: string;
    /** Text channel ID */
    channelId: string;
    /** Whether newly created (false = reused existing) */
    created: boolean;
}

/**
 * Result of ensuring a category
 */
export interface EnsureCategoryResult {
    categoryId: string;
    created: boolean;
}

/**
 * Result of creating a session channel
 */
export interface CreateSessionChannelResult {
    channelId: string;
}

/** Category name prefix emoji */
const CATEGORY_PREFIX = '🗂️-';
/** Default channel name under the category */
const DEFAULT_CHANNEL_NAME = 'general';

/**
 * Class that manages Discord categories and channels corresponding to workspace paths.
 * Creates the category/channel if they don't exist for the given workspace name,
 * or returns the existing channel ID if they do.
 */
export class ChannelManager {

    /**
     * Ensure a category exists for the given workspace path.
     * Creates a new one if it doesn't exist, returns the existing ID otherwise.
     */
    public async ensureCategory(guild: Guild, workspacePath: string): Promise<EnsureCategoryResult> {
        if (!workspacePath || workspacePath.trim() === '') {
            throw new Error('Workspace path not specified');
        }

        const sanitizedName = this.sanitizeCategoryName(workspacePath);
        const categoryName = `${CATEGORY_PREFIX}${sanitizedName}`;

        // Search from cache first
        let existingCategory = guild.channels.cache.find(
            (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName
        );

        // If not in cache, fetch all channels and retry
        if (!existingCategory) {
            const channels = await guild.channels.fetch();
            // Collection.find doesn't return null, but fetch results may contain null entries
            const found = channels.find(
                (ch) => ch !== null && ch !== undefined && ch.type === ChannelType.GuildCategory && ch.name === categoryName
            );
            if (found) {
                existingCategory = found;
            }
        }

        if (existingCategory) {
            return { categoryId: existingCategory.id, created: false };
        }

        const newCategory = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
        });

        return { categoryId: newCategory.id, created: true };
    }

    /**
     * Create a new session channel under the category.
     */
    public async createSessionChannel(
        guild: Guild,
        categoryId: string,
        channelName: string,
    ): Promise<CreateSessionChannelResult> {
        const newChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
        });

        return { channelId: newChannel.id };
    }

    /**
     * Rename a channel.
     */
    public async renameChannel(guild: Guild, channelId: string, newName: string): Promise<void> {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            throw new Error(`Channel ${channelId} not found`);
        }

        await channel.setName(newName);
    }

    /**
     * Ensure a category and text channel exist for the given workspace path.
     * Kept for backward compatibility. Internally calls ensureCategory + createSessionChannel('general').
     */
    public async ensureChannel(guild: Guild, workspacePath: string): Promise<EnsureChannelResult> {
        if (!workspacePath || workspacePath.trim() === '') {
            throw new Error('Workspace path not specified');
        }

        const categoryResult = await this.ensureCategory(guild, workspacePath);
        const categoryId = categoryResult.categoryId;

        // Search for existing default channel (under the category)
        const existingTextChannel = guild.channels.cache.find(
            (ch) =>
                ch.type === ChannelType.GuildText &&
                'parentId' in ch &&
                ch.parentId === categoryId &&
                ch.name === DEFAULT_CHANNEL_NAME
        );

        if (existingTextChannel) {
            return {
                categoryId,
                channelId: existingTextChannel.id,
                created: false,
            };
        }

        const sessionResult = await this.createSessionChannel(guild, categoryId, DEFAULT_CHANNEL_NAME);

        return {
            categoryId,
            channelId: sessionResult.channelId,
            created: true,
        };
    }

    /**
     * Sanitize text into a format suitable for Discord channel names (public utility).
     */
    public sanitizeChannelName(name: string): string {
        return this.sanitizeCategoryName(name);
    }

    /**
     * Sanitize a workspace path into a format suitable for Discord category names.
     */
    public sanitizeCategoryName(name: string): string {
        let sanitized = name
            .toLowerCase()
            .replace(/\/+$/, '')
            .replace(/\//g, '-')
            .replace(/[^a-z0-9\-_\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        if (sanitized.length > 100) {
            sanitized = sanitized.substring(0, 100);
        }

        return sanitized;
    }
}
