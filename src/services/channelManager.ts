import { Guild, ChannelType } from 'discord.js';

/**
 * チャンネル/カテゴリ自動生成の結果
 */
export interface EnsureChannelResult {
    /** カテゴリのID */
    categoryId: string;
    /** テキストチャンネルのID */
    channelId: string;
    /** 新規作成されたかどうか（false = 既存を流用） */
    created: boolean;
}

/**
 * カテゴリ確保の結果
 */
export interface EnsureCategoryResult {
    categoryId: string;
    created: boolean;
}

/**
 * セッションチャンネル作成の結果
 */
export interface CreateSessionChannelResult {
    channelId: string;
}

/** カテゴリ名のプレフィックス絵文字 */
const CATEGORY_PREFIX = '🗂️-';
/** カテゴリ配下のデフォルトチャンネル名 */
const DEFAULT_CHANNEL_NAME = 'general';

/**
 * ワークスペースパスに対応するDiscordカテゴリ・チャンネルを管理するクラス。
 * 指定されたワークスペース名に対し、該当するカテゴリ・チャンネルが無ければ作成し、
 * 存在すれば既存のチャンネルIDを返す。
 */
export class ChannelManager {

    /**
     * ワークスペースパスに対応するカテゴリを確保する。
     * 存在しなければ新規作成、存在すれば既存のIDを返す。
     */
    public async ensureCategory(guild: Guild, workspacePath: string): Promise<EnsureCategoryResult> {
        if (!workspacePath || workspacePath.trim() === '') {
            throw new Error('ワークスペースパスが指定されていません');
        }

        const sanitizedName = this.sanitizeCategoryName(workspacePath);
        const categoryName = `${CATEGORY_PREFIX}${sanitizedName}`;

        const existingCategory = guild.channels.cache.find(
            (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName
        );

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
     * カテゴリ配下に新しいセッションチャンネルを作成する。
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
     * チャンネル名をリネームする。
     */
    public async renameChannel(guild: Guild, channelId: string, newName: string): Promise<void> {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            throw new Error(`チャンネル ${channelId} が見つかりません`);
        }

        await channel.setName(newName);
    }

    /**
     * ワークスペースパスに対応するカテゴリとテキストチャンネルを確保する。
     * 後方互換のため維持。内部で ensureCategory + createSessionChannel('general') を呼ぶ。
     */
    public async ensureChannel(guild: Guild, workspacePath: string): Promise<EnsureChannelResult> {
        if (!workspacePath || workspacePath.trim() === '') {
            throw new Error('ワークスペースパスが指定されていません');
        }

        const categoryResult = await this.ensureCategory(guild, workspacePath);
        const categoryId = categoryResult.categoryId;

        // 既存のdefaultチャンネルを検索（カテゴリ配下）
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
     * テキストをDiscordチャンネル名に適した形式にサニタイズする（公開ユーティリティ）。
     */
    public sanitizeChannelName(name: string): string {
        return this.sanitizeCategoryName(name);
    }

    /**
     * ワークスペースパスをDiscordカテゴリ名として使用可能な形式にサニタイズする。
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
