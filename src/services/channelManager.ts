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
     * ワークスペースパスに対応するカテゴリとテキストチャンネルを確保する。
     * 存在しなければ新規作成、存在すれば既存のIDを返す。
     *
     * @param guild - 操作対象のDiscordギルド
     * @param workspacePath - ワークスペースの相対パス（例: "frontend", "backend/api"）
     * @returns カテゴリID, チャンネルID, 作成フラグ
     * @throws ワークスペースパスが空の場合
     * @throws Discord APIがエラーを返した場合
     */
    public async ensureChannel(guild: Guild, workspacePath: string): Promise<EnsureChannelResult> {
        // 入力バリデーション
        if (!workspacePath || workspacePath.trim() === '') {
            throw new Error('ワークスペースパスが指定されていません');
        }

        // カテゴリ名をサニタイズ
        const sanitizedName = this.sanitizeCategoryName(workspacePath);
        const categoryName = `${CATEGORY_PREFIX}${sanitizedName}`;

        // 既存のカテゴリを検索
        const existingCategory = guild.channels.cache.find(
            (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName
        );

        let categoryId: string;
        let created = false;

        if (existingCategory) {
            // 既存カテゴリが見つかった
            categoryId = existingCategory.id;
        } else {
            // カテゴリを新規作成
            const newCategory = await guild.channels.create({
                name: categoryName,
                type: ChannelType.GuildCategory,
            });
            categoryId = newCategory.id;
            created = true;
        }

        // 既存のテキストチャンネルを検索（カテゴリ配下）
        const existingTextChannel = guild.channels.cache.find(
            (ch) =>
                ch.type === ChannelType.GuildText &&
                'parentId' in ch &&
                ch.parentId === categoryId &&
                ch.name === DEFAULT_CHANNEL_NAME
        );

        if (existingTextChannel) {
            // 既存のテキストチャンネルが見つかった => 作成不要
            return {
                categoryId,
                channelId: existingTextChannel.id,
                created: false,
            };
        }

        // テキストチャンネルを新規作成
        const newTextChannel = await guild.channels.create({
            name: DEFAULT_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: categoryId,
        });

        return {
            categoryId,
            channelId: newTextChannel.id,
            created: true,
        };
    }

    /**
     * ワークスペースパスをDiscordカテゴリ名として使用可能な形式にサニタイズする。
     *
     * - 小文字に変換
     * - 末尾のスラッシュを除去
     * - スラッシュをハイフンに変換
     * - Discordチャンネル名で使えない文字を除去
     * - 連続するハイフンを1つにまとめる
     * - 100文字に切り詰め
     *
     * @param name - サニタイズ前のワークスペースパス
     * @returns サニタイズ後の文字列
     */
    public sanitizeCategoryName(name: string): string {
        let sanitized = name
            // 小文字に変換
            .toLowerCase()
            // 末尾のスラッシュを除去
            .replace(/\/+$/, '')
            // スラッシュをハイフンに変換
            .replace(/\//g, '-')
            // Discordチャンネル名では英数字、ハイフン、アンダースコアのみ許可
            .replace(/[^a-z0-9\-_\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, '-')
            // 連続するハイフンを1つにまとめる
            .replace(/-{2,}/g, '-')
            // 先頭・末尾のハイフンを除去
            .replace(/^-+|-+$/g, '');

        // 100文字制限
        if (sanitized.length > 100) {
            sanitized = sanitized.substring(0, 100);
        }

        return sanitized;
    }
}
