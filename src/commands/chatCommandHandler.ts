import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ChannelType,
} from 'discord.js';
import { ChatSessionService } from '../services/chatSessionService';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChannelManager } from '../services/channelManager';

/**
 * /chat コマンドのハンドラー
 *
 * サブコマンド:
 *   - new: カテゴリ配下に新セッションチャンネル作成 + Antigravityで新規チャット開始
 *   - status: 現在のチャットセッション情報を表示
 *   - list: 同カテゴリの全セッション一覧を表示
 */
export class ChatCommandHandler {
    private readonly chatSessionService: ChatSessionService;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly channelManager: ChannelManager;

    constructor(
        chatSessionService: ChatSessionService,
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
        channelManager: ChannelManager,
    ) {
        this.chatSessionService = chatSessionService;
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
        this.channelManager = channelManager;
    }

    /**
     * /chat new — カテゴリ配下に新セッションチャンネルを作成し、Antigravityで新規チャット開始
     */
    async handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: '⚠️ サーバー内でのみ使用できます。' });
            return;
        }

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.editReply({ content: '⚠️ テキストチャンネルで実行してください。' });
            return;
        }

        // 現在のチャンネルがワークスペースカテゴリ配下かを確認
        const parentId = 'parentId' in channel ? channel.parentId : null;
        if (!parentId) {
            await interaction.editReply({
                content: '⚠️ ワークスペースカテゴリ配下のチャンネルで実行してください。\n`/workspace` でワークスペースを作成してから使用してください。',
            });
            return;
        }

        // ワークスペースパスを特定
        const currentSession = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);

        const workspacePath = currentSession?.workspacePath ?? binding?.workspacePath;
        if (!workspacePath) {
            await interaction.editReply({
                content: '⚠️ ワークスペースカテゴリ配下のチャンネルで実行してください。\n`/workspace` でワークスペースを作成してから使用してください。',
            });
            return;
        }

        // Antigravityで新規チャットを開始
        const chatResult = await this.chatSessionService.startNewChat();
        if (!chatResult.ok) {
            await interaction.editReply({
                content: `❌ Antigravityでの新規チャット開始に失敗しました: ${chatResult.error}`,
            });
            return;
        }

        // 新しいセッションチャンネルを作成
        const sessionNumber = this.chatSessionRepo.getNextSessionNumber(parentId);
        const channelName = `session-${sessionNumber}`;
        const sessionResult = await this.channelManager.createSessionChannel(guild, parentId, channelName);
        const newChannelId = sessionResult.channelId;

        // バインディングとセッションを登録
        this.bindingRepo.upsert({
            channelId: newChannelId,
            workspacePath,
            guildId: guild.id,
        });

        this.chatSessionRepo.create({
            channelId: newChannelId,
            categoryId: parentId,
            workspacePath,
            sessionNumber,
            guildId: guild.id,
        });

        const embed = new EmbedBuilder()
            .setTitle('💬 新しいセッションを開始しました')
            .setDescription(`新しいチャットセッションを作成しました\n→ <#${newChannelId}>`)
            .setColor(0x00CC88)
            .addFields(
                { name: 'セッション', value: channelName, inline: true },
                { name: 'ワークスペース', value: workspacePath, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * /chat status — 現在のチャットセッション情報を表示
     */
    async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);

        if (!session) {
            // Antigravityから直接情報を取得（フォールバック）
            const info = await this.chatSessionService.getCurrentSessionInfo();

            const embed = new EmbedBuilder()
                .setTitle('💬 チャットセッション情報')
                .setColor(info.hasActiveChat ? 0x00CC88 : 0x888888)
                .addFields(
                    { name: 'タイトル', value: info.title, inline: true },
                    { name: 'ステータス', value: info.hasActiveChat ? '🟢 アクティブ' : '⚪ 非アクティブ', inline: true },
                )
                .setDescription('※ セッション管理外のチャンネルです')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // 同カテゴリの全セッションを取得
        const allSessions = this.chatSessionRepo.findByCategoryId(session.categoryId);

        const embed = new EmbedBuilder()
            .setTitle('💬 チャットセッション情報')
            .setColor(0x00CC88)
            .addFields(
                { name: 'セッション番号', value: `#${session.sessionNumber}`, inline: true },
                { name: 'ワークスペース', value: session.workspacePath, inline: true },
                { name: '表示名', value: session.displayName || '(未設定)', inline: true },
                { name: 'リネーム済み', value: session.isRenamed ? 'はい' : 'いいえ', inline: true },
                { name: '同ワークスペースのセッション数', value: `${allSessions.length}`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * /chat list — 同カテゴリの全セッションを一覧表示
     */
    async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
        const channel = interaction.channel;
        const parentId = channel && 'parentId' in channel ? channel.parentId : null;

        if (!parentId) {
            await interaction.editReply({
                content: '⚠️ ワークスペースカテゴリ配下のチャンネルで実行してください。',
            });
            return;
        }

        const sessions = this.chatSessionRepo.findByCategoryId(parentId);

        if (sessions.length === 0) {
            await interaction.editReply({
                content: '📋 このカテゴリにはセッションが登録されていません。',
            });
            return;
        }

        const sessionList = sessions.map((s) => {
            const name = s.displayName ? `${s.displayName}` : `session-${s.sessionNumber}`;
            const current = s.channelId === interaction.channelId ? ' ← 現在' : '';
            return `• <#${s.channelId}> — ${name}${current}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('📋 セッション一覧')
            .setDescription(sessionList)
            .setColor(0x5865F2)
            .addFields(
                { name: 'ワークスペース', value: sessions[0].workspacePath, inline: true },
                { name: '合計', value: `${sessions.length} セッション`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}
