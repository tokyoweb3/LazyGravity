import { t } from "../utils/i18n";
import {
    ChatInputCommandInteraction,
    ButtonInteraction,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    Guild,
    ChannelType,
    TextChannel,
    CategoryChannel,
} from 'discord.js';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { logger } from '../utils/logger';

/** クリーンアップ対象のセッションチャンネル情報 */
interface InactiveSession {
    channelId: string;
    channelName: string;
    categoryId: string | null;
    categoryName: string | null;
    lastActivityAt: Date;
    daysSinceActivity: number;
}

/** クリーンアップ対象のカテゴリ情報 */
interface InactiveCategory {
    categoryId: string;
    categoryName: string;
    sessionCount: number;
    oldestActivity: Date;
    daysSinceOldestActivity: number;
}

/** クリーンアップスキャン結果 */
interface CleanupScanResult {
    inactiveSessions: InactiveSession[];
    inactiveCategories: InactiveCategory[];
    totalScanned: number;
    thresholdDays: number;
}

/** ボタンのカスタムID */
export const CLEANUP_ARCHIVE_BTN = 'cleanup_archive';
export const CLEANUP_DELETE_BTN = 'cleanup_delete';
export const CLEANUP_CANCEL_BTN = 'cleanup_cancel';

/**
 * /cleanup コマンドのハンドラー。
 * 指定された日数間の活動がないセッションチャンネルおよびカテゴリを検出し、
 * アーカイブまたは削除の確認を行う。
 */
export class CleanupCommandHandler {
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;

    /** 直近のスキャン結果を保持（ボタン押下時に参照） */
    private lastScanResult: CleanupScanResult | null = null;

    constructor(
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
    ) {
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
    }

    /**
     * /cleanup [days] — 未使用チャンネル/カテゴリをスキャンし、確認UIを表示
     */
    async handleCleanup(
        interaction: ChatInputCommandInteraction,
    ): Promise<void> {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({
                content: t('⚠️ This command can only be used in a server.'),
            });
            return;
        }

        const days = interaction.options.getInteger('days') ?? 7;

        if (days < 1 || days > 365) {
            await interaction.editReply({
                content: t('⚠️ Please specify a number of days between 1 and 365.'),
            });
            return;
        }

        // スキャン実行
        const scanResult = await this.scanInactiveChannels(guild, days);
        this.lastScanResult = scanResult;

        const totalInactive = scanResult.inactiveSessions.length;
        const totalInactiveCategories = scanResult.inactiveCategories.length;

        if (totalInactive === 0 && totalInactiveCategories === 0) {
            const embed = new EmbedBuilder()
                .setTitle(t('🧹 Cleanup Scan Complete'))
                .setDescription(
                    t(`No inactive sessions or categories found (threshold: ${days} days).\n\nScanned ${scanResult.totalScanned} channels total.`)
                )
                .setColor(0x2ECC71)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // セッション一覧を構築
        const sessionLines = scanResult.inactiveSessions.map((s) => {
            const name = s.channelName;
            const category = s.categoryName ? `📂 ${s.categoryName}` : '(カテゴリなし)';
            return `• <#${s.channelId}> — ${category} — 最終活動: **${s.daysSinceActivity}日前**`;
        });

        // カテゴリ一覧を構築
        const categoryLines = scanResult.inactiveCategories.map((c) => {
            return `• 📂 **${c.categoryName}** (${c.sessionCount}セッション) — 最終活動: **${c.daysSinceOldestActivity}日前**`;
        });

        // Embed構築（Discord Embedの制限に注意: descriptionは4096文字まで）
        let description = '';

        if (categoryLines.length > 0) {
            description += `**🗂️ 非活性カテゴリ (${totalInactiveCategories}件)**\n`;
            description += `${t('All sessions within these categories have been inactive.')}\n`;
            description += categoryLines.slice(0, 15).join('\n');
            if (categoryLines.length > 15) {
                description += `\n...他 ${categoryLines.length - 15} 件`;
            }
            description += '\n\n';
        }

        if (sessionLines.length > 0) {
            description += `**💬 非活性セッション (${totalInactive}件)**\n`;
            description += sessionLines.slice(0, 20).join('\n');
            if (sessionLines.length > 20) {
                description += `\n...他 ${sessionLines.length - 20} 件`;
            }
        }

        // 4096文字の制限に収まるよう切り詰める
        if (description.length > 4000) {
            description = description.substring(0, 3950) + '\n\n...(一部省略)';
        }

        const embed = new EmbedBuilder()
            .setTitle(t('🧹 Cleanup Scan Results'))
            .setDescription(description)
            .setColor(0xF39C12)
            .addFields(
                {
                    name: t('Threshold'),
                    value: t(`${days} days of inactivity`),
                    inline: true,
                },
                {
                    name: t('Scanned'),
                    value: `${scanResult.totalScanned} channels`,
                    inline: true,
                },
                {
                    name: t('Found'),
                    value: `${totalInactive} sessions, ${totalInactiveCategories} categories`,
                    inline: true,
                },
            )
            .setFooter({
                text: t('Choose an action below. Archive hides channels, Delete removes them permanently.'),
            })
            .setTimestamp();

        // アクションボタン
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(CLEANUP_ARCHIVE_BTN)
                .setLabel(t('📦 Archive All'))
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(CLEANUP_DELETE_BTN)
                .setLabel(t('🗑️ Delete All'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(CLEANUP_CANCEL_BTN)
                .setLabel(t('Cancel'))
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.editReply({
            embeds: [embed],
            components: [row],
        });
    }

    /**
     * ボタン押下時の処理: アーカイブ
     */
    async handleArchive(interaction: ButtonInteraction): Promise<void> {
        if (!this.lastScanResult) {
            await interaction.update({
                content: t('⚠️ No scan results found. Please run `/cleanup` again.'),
                embeds: [],
                components: [],
            });
            return;
        }

        const guild = interaction.guild;
        if (!guild) return;

        await interaction.deferUpdate();

        const result = this.lastScanResult;
        let archivedCount = 0;
        let failedCount = 0;

        // セッションチャンネルをアーカイブ（ロック + 権限制限で非表示化）
        for (const session of result.inactiveSessions) {
            try {
                const channel = guild.channels.cache.get(session.channelId);
                if (channel && channel.type === ChannelType.GuildText) {
                    const textChannel = channel as TextChannel;
                    // チャンネル名にアーカイブ接頭辞を追加
                    const archivedName = `archived-${textChannel.name}`;
                    await textChannel.setName(archivedName);

                    // チャンネルに @everyone のメッセージ送信権限を拒否してロック
                    const everyoneRole = guild.roles.everyone;
                    await textChannel.permissionOverwrites.create(everyoneRole, {
                        SendMessages: false,
                        ViewChannel: false,
                    });

                    archivedCount++;
                }
            } catch (e) {
                logger.error(`[Cleanup] チャンネル ${session.channelId} のアーカイブに失敗:`, e);
                failedCount++;
            }
        }

        // 非活性カテゴリのアーカイブ
        for (const category of result.inactiveCategories) {
            try {
                const categoryChannel = guild.channels.cache.get(category.categoryId);
                if (categoryChannel && categoryChannel.type === ChannelType.GuildCategory) {
                    const cat = categoryChannel as CategoryChannel;
                    const archivedName = `📦-archived-${cat.name.replace(/^🗂️-/, '')}`;
                    await cat.setName(archivedName);

                    // カテゴリ全体を非表示
                    const everyoneRole = guild.roles.everyone;
                    await cat.permissionOverwrites.create(everyoneRole, {
                        ViewChannel: false,
                    });

                    archivedCount++;
                }
            } catch (e) {
                logger.error(`[Cleanup] カテゴリ ${category.categoryId} のアーカイブに失敗:`, e);
                failedCount++;
            }
        }

        this.lastScanResult = null;

        const embed = new EmbedBuilder()
            .setTitle(t('📦 Cleanup Complete — Archived'))
            .setDescription(
                t(`Successfully archived ${archivedCount} channels/categories.`) +
                (failedCount > 0 ? `\n⚠️ ${failedCount} failed.` : '')
            )
            .setColor(0x2ECC71)
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [],
        });
    }

    /**
     * ボタン押下時の処理: 削除
     */
    async handleDelete(interaction: ButtonInteraction): Promise<void> {
        if (!this.lastScanResult) {
            await interaction.update({
                content: t('⚠️ No scan results found. Please run `/cleanup` again.'),
                embeds: [],
                components: [],
            });
            return;
        }

        const guild = interaction.guild;
        if (!guild) return;

        await interaction.deferUpdate();

        const result = this.lastScanResult;
        let deletedCount = 0;
        let failedCount = 0;

        // セッションチャンネルの削除
        for (const session of result.inactiveSessions) {
            try {
                const channel = guild.channels.cache.get(session.channelId);
                if (channel) {
                    await channel.delete(`Cleanup: ${result.thresholdDays} days inactive`);
                    // DBからもバインディング・セッション情報を削除
                    this.chatSessionRepo.deleteByChannelId(session.channelId);
                    this.bindingRepo.deleteByChannelId(session.channelId);
                    deletedCount++;
                }
            } catch (e) {
                logger.error(`[Cleanup] チャンネル ${session.channelId} の削除に失敗:`, e);
                failedCount++;
            }
        }

        // 非活性カテゴリの削除（配下が空の場合のみカテゴリ自体を削除）
        for (const category of result.inactiveCategories) {
            try {
                const categoryChannel = guild.channels.cache.get(category.categoryId);
                if (categoryChannel && categoryChannel.type === ChannelType.GuildCategory) {
                    // カテゴリ配下の残存チャンネルを確認
                    const children = guild.channels.cache.filter(
                        (ch) => 'parentId' in ch && ch.parentId === category.categoryId
                    );

                    // 配下チャンネルも削除
                    for (const [, child] of children) {
                        try {
                            // DBからもレコード削除
                            this.chatSessionRepo.deleteByChannelId(child.id);
                            this.bindingRepo.deleteByChannelId(child.id);
                            await child.delete(`Cleanup: category ${category.categoryName} removed`);
                            deletedCount++;
                        } catch (e) {
                            logger.error(`[Cleanup] カテゴリ配下チャンネル ${child.id} の削除に失敗:`, e);
                            failedCount++;
                        }
                    }

                    // カテゴリ自体を削除
                    await categoryChannel.delete(`Cleanup: ${result.thresholdDays} days inactive`);
                    deletedCount++;
                }
            } catch (e) {
                logger.error(`[Cleanup] カテゴリ ${category.categoryId} の削除に失敗:`, e);
                failedCount++;
            }
        }

        this.lastScanResult = null;

        const embed = new EmbedBuilder()
            .setTitle(t('🗑️ Cleanup Complete — Deleted'))
            .setDescription(
                t(`Successfully deleted ${deletedCount} channels/categories.`) +
                (failedCount > 0 ? `\n⚠️ ${failedCount} failed.` : '')
            )
            .setColor(0xE74C3C)
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [],
        });
    }

    /**
     * ボタン押下時の処理: キャンセル
     */
    async handleCancel(interaction: ButtonInteraction): Promise<void> {
        this.lastScanResult = null;

        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle(t('🧹 Cleanup Cancelled'))
                    .setDescription(t('No changes were made.'))
                    .setColor(0x888888)
                    .setTimestamp(),
            ],
            components: [],
        });
    }

    /**
     * 非活性チャンネル/カテゴリをスキャンする
     */
    private async scanInactiveChannels(
        guild: Guild,
        thresholdDays: number,
    ): Promise<CleanupScanResult> {
        const now = new Date();
        const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

        // 全チャンネルをフェッチ
        const allChannels = await guild.channels.fetch();

        // Bot管理のカテゴリ（🗂️- プレフィックスつき）を検出
        const botCategories = allChannels.filter(
            (ch): ch is CategoryChannel =>
                ch !== null && ch.type === ChannelType.GuildCategory && ch.name.startsWith('🗂️-')
        );

        const inactiveSessions: InactiveSession[] = [];
        const categoryActivityMap = new Map<string, { sessions: InactiveSession[]; active: boolean; channel: CategoryChannel }>();

        let totalScanned = 0;

        // 各カテゴリ配下のテキストチャンネルを走査
        for (const [, category] of botCategories) {
            const children = allChannels.filter(
                (ch): ch is TextChannel =>
                    ch !== null &&
                    ch.type === ChannelType.GuildText &&
                    'parentId' in ch &&
                    ch.parentId === category.id
            );

            const sessionsInCategory: InactiveSession[] = [];
            let categoryHasActive = false;

            for (const [, child] of children) {
                totalScanned++;

                // 最終メッセージの日時を取得
                const lastActivity = await this.getLastActivityDate(child);
                const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000));

                if (daysSince >= thresholdDays) {
                    const session: InactiveSession = {
                        channelId: child.id,
                        channelName: child.name,
                        categoryId: category.id,
                        categoryName: category.name,
                        lastActivityAt: lastActivity,
                        daysSinceActivity: daysSince,
                    };
                    inactiveSessions.push(session);
                    sessionsInCategory.push(session);
                } else {
                    categoryHasActive = true;
                }
            }

            categoryActivityMap.set(category.id, {
                sessions: sessionsInCategory,
                active: categoryHasActive,
                channel: category,
            });
        }

        // カテゴリ全体が非活性かどうかを判定
        const inactiveCategories: InactiveCategory[] = [];

        for (const [categoryId, data] of categoryActivityMap) {
            // カテゴリ内の全セッションが非活性の場合のみ（かつ少なくとも1セッションが存在する場合）
            if (!data.active && data.sessions.length > 0) {
                // 最も古いアクティビティ日時を取得
                const oldestActivity = data.sessions.reduce(
                    (oldest, s) => (s.lastActivityAt < oldest ? s.lastActivityAt : oldest),
                    data.sessions[0].lastActivityAt,
                );
                const daysSince = Math.floor(
                    (now.getTime() - oldestActivity.getTime()) / (24 * 60 * 60 * 1000)
                );

                inactiveCategories.push({
                    categoryId,
                    categoryName: data.channel.name,
                    sessionCount: data.sessions.length,
                    oldestActivity,
                    daysSinceOldestActivity: daysSince,
                });
            }
        }

        return {
            inactiveSessions,
            inactiveCategories,
            totalScanned,
            thresholdDays,
        };
    }

    /**
     * チャンネルの最終活動日時を取得する。
     * 最後のメッセージのタイムスタンプ、またはチャンネル作成日時のいずれか新しい方を返す。
     */
    private async getLastActivityDate(channel: TextChannel): Promise<Date> {
        try {
            // 最新の1メッセージを取得（降順）
            const messages = await channel.messages.fetch({ limit: 1 });
            if (messages.size > 0) {
                const lastMessage = messages.values().next().value;
                if (lastMessage) {
                    return lastMessage.createdAt;
                }
            }
        } catch (e) {
            logger.warn(`[Cleanup] チャンネル ${channel.id} のメッセージ取得に失敗:`, e);
        }

        // メッセージがない場合はチャンネルの作成日時を使用
        return channel.createdAt;
    }

    /**
     * 現在のスキャン結果を取得する（テスト用）
     */
    getLastScanResult(): CleanupScanResult | null {
        return this.lastScanResult;
    }
}
