import { t } from "../utils/i18n";
import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ChannelType,
} from 'discord.js';
import { ChatSessionService } from '../services/chatSessionService';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChannelManager } from '../services/channelManager';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import { WorkspaceService } from '../services/workspaceService';

/**
 * チャットセッション関連コマンドのハンドラー
 *
 * コマンド:
 *   - /new: カテゴリ配下に新セッションチャンネル作成 + Antigravityで新規チャット開始
 *   - /chat: 現在のセッション情報 + 同プロジェクトの全セッション一覧を表示（統合）
 */
export class ChatCommandHandler {
    private readonly chatSessionService: ChatSessionService;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly channelManager: ChannelManager;
    private readonly pool: CdpConnectionPool | null;
    private readonly workspaceService: WorkspaceService;

    constructor(
        chatSessionService: ChatSessionService,
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
        channelManager: ChannelManager,
        workspaceService: WorkspaceService,
        pool?: CdpConnectionPool,
    ) {
        this.chatSessionService = chatSessionService;
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
        this.channelManager = channelManager;
        this.workspaceService = workspaceService;
        this.pool = pool ?? null;
    }

    /**
     * /new — カテゴリ配下に新セッションチャンネルを作成し、Antigravityで新規チャット開始
     */
    async handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: t('⚠️ This command can only be used in a server.') });
            return;
        }

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.editReply({ content: t('⚠️ Please execute in a text channel.') });
            return;
        }

        // 現在のチャンネルがプロジェクトカテゴリ配下かを確認
        const parentId = 'parentId' in channel ? channel.parentId : null;
        if (!parentId) {
            await interaction.editReply({
                content: t('⚠️ Please run in a project category channel.\nUse `/project` to create a project first.'),
            });
            return;
        }

        // プロジェクトパスを特定
        const currentSession = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);

        const workspaceName = currentSession?.workspacePath ?? binding?.workspacePath;
        if (!workspaceName) {
            await interaction.editReply({
                content: t('⚠️ Please run in a project category channel.\nUse `/project` to create a project first.'),
            });
            return;
        }

        // ワークスペース名をフルパスに変換
        const workspacePath = this.workspaceService.getWorkspacePath(workspaceName);

        // プロジェクト切替（正しいworkbenchページに接続）
        let workspaceCdp;
        if (this.pool) {
            try {
                workspaceCdp = await this.pool.getOrConnect(workspacePath);
            } catch (e: any) {
                await interaction.editReply({
                    content: t(`⚠️ Failed to switch project: ${e.message}`),
                });
                return;
            }
        }

        if (!workspaceCdp) {
            await interaction.editReply({
                content: t('⚠️ CDP pool is not initialized or cannot connect to workspace.'),
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
            workspacePath: workspaceName,
            guildId: guild.id,
        });

        this.chatSessionRepo.create({
            channelId: newChannelId,
            categoryId: parentId,
            workspacePath: workspaceName,
            sessionNumber,
            guildId: guild.id,
        });

        const embed = new EmbedBuilder()
            .setTitle(t('💬 Started a new session'))
            .setDescription(t(`Created a new chat session\n→ <#${newChannelId}>`))
            .setColor(0x00CC88)
            .addFields(
                { name: t('Session'), value: channelName, inline: true },
                { name: t('Project'), value: workspacePath, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * /chat — 現在のセッション情報 + 同プロジェクトの全セッション一覧を統合表示
     */
    async handleChat(interaction: ChatInputCommandInteraction): Promise<void> {
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);

        if (!session) {
            // セッション管理外のチャンネル — Antigravityから直接情報を取得
            const activeNames = this.pool?.getActiveWorkspaceNames() ?? [];
            const anyCdp = activeNames.length > 0 ? this.pool?.getConnected(activeNames[0]) : null;
            const info = anyCdp
                ? await this.chatSessionService.getCurrentSessionInfo(anyCdp)
                : { title: t('(CDP Disconnected)'), hasActiveChat: false };

            const embed = new EmbedBuilder()
                .setTitle(t('💬 Chat Session Info'))
                .setColor(info.hasActiveChat ? 0x00CC88 : 0x888888)
                .addFields(
                    { name: t('Title'), value: info.title, inline: true },
                    { name: t('Status'), value: info.hasActiveChat ? t('🟢 Active') : t('⚪ Inactive'), inline: true },
                )
                .setDescription(t('※ Non-session channel.\nUse `/project` to create a project first.'))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // 同カテゴリの全セッションを取得
        const allSessions = this.chatSessionRepo.findByCategoryId(session.categoryId);

        // セッション一覧を構築
        const sessionList = allSessions.map((s) => {
            const name = s.displayName ? `${s.displayName}` : `session-${s.sessionNumber}`;
            const current = s.channelId === interaction.channelId ? t(' ← **Current**') : '';
            return `• <#${s.channelId}> — ${name}${current}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(t('💬 Chat Session Info'))
            .setColor(0x00CC88)
            .addFields(
                { name: t('Current session'), value: t(`#${session.sessionNumber} — ${session.displayName || '(Unset)'}`), inline: false },
                { name: t('Project'), value: session.workspacePath, inline: true },
                { name: t('Total sessions'), value: `${allSessions.length}`, inline: true },
            )
            .setDescription(t(`**Sessions:**\n${sessionList}`))
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}
