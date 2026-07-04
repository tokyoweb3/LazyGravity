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

export type ResolveAccountForChannel = (channelId: string, userId: string) => string;

/**
 * Handler for chat session related commands
 *
 * Commands:
 *   - /new: Create a new session channel under the category + start a new chat in Antigravity
 *   - /chat: Display current session info + list all sessions in the same project (unified)
 */
export class ChatCommandHandler {
    private readonly chatSessionService: ChatSessionService;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly channelManager: ChannelManager;
    private readonly pool: CdpConnectionPool | null;
    private readonly workspaceService: WorkspaceService;
    private readonly resolveAccountForChannel: ResolveAccountForChannel | null;

    constructor(
        chatSessionService: ChatSessionService,
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
        channelManager: ChannelManager,
        workspaceService: WorkspaceService,
        pool?: CdpConnectionPool,
        resolveAccountForChannel?: ResolveAccountForChannel,
    ) {
        this.chatSessionService = chatSessionService;
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
        this.channelManager = channelManager;
        this.workspaceService = workspaceService;
        this.pool = pool ?? null;
        this.resolveAccountForChannel = resolveAccountForChannel ?? null;
    }

    /**
     * /new -- Create a new session channel under the category and start a new chat in Antigravity
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

        const currentSession = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const parentId = currentSession?.categoryId ?? ('parentId' in channel ? channel.parentId : null);

        const workspaceName = currentSession?.workspacePath ?? binding?.workspacePath;
        if (!parentId || !workspaceName) {
            await interaction.editReply({
                content: t('⚠️ Please run in a project category channel.\nUse `/project` to create a project first.'),
            });
            return;
        }

        // Convert workspace name to full path
        const workspacePath = this.workspaceService.getWorkspacePath(workspaceName);

        // Switch project (connect to the correct workbench page)
        let workspaceCdp;
        const selectedAccount = this.resolveAccountForChannel?.(interaction.channelId, interaction.user.id) ?? 'default';
        if (this.pool) {
            try {
                workspaceCdp = await this.pool.getOrConnect(workspacePath, { name: selectedAccount });
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

        // Start a new chat in the IDE
        const newChatResult = await this.chatSessionService.startNewChat(workspaceCdp);
        if (!newChatResult.ok) {
            // Log but don't fail the command, as the channel still needs to be created
            // and the user might just have to click it manually if the IDE state is strange.
            import('../utils/logger').then(({ logger }) => {
                logger.warn(`[/new] Could not start new chat in IDE automatically: ${newChatResult.error}`);
            });
        }

        const customNameRaw = interaction.options.getString('name');
        
        let safeCustomName: string | null = null;
        if (customNameRaw) {
            // Import TitleGeneratorService to sanitize the channel name if needed,
            // or just do basic sanitization inline.
            safeCustomName = customNameRaw
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9\-_\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, '-')
                .replace(/-{2,}/g, '-')
                .replace(/^-+|-+$/g, '')
                .substring(0, 80);
            
            if (!safeCustomName) safeCustomName = null;
        }

        // Create a new session channel
        const sessionNumber = this.chatSessionRepo.getNextSessionNumber(parentId);
        const channelName = safeCustomName ? `${sessionNumber}-${safeCustomName}` : `session-${sessionNumber}`;
        const sessionResult = await this.channelManager.createSessionChannel(guild, parentId, channelName);
        const newChannelId = sessionResult.channelId;

        // Register binding and session
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
            activeAccountName: selectedAccount,
            guildId: guild.id,
        });
        
        if (safeCustomName) {
            // Set the display name and mark it as renamed so autoRenameChannel skips it
            this.chatSessionRepo.updateDisplayName(newChannelId, safeCustomName);
            
            // Try to make the IDE's DOM match the Discord channel
            if (workspaceCdp) {
                const renameResult = await this.chatSessionService.renameCurrentChatInUI(workspaceCdp, safeCustomName);
                if (!renameResult.ok) {
                    import('../utils/logger').then(({ logger }) => {
                        logger.warn(`[/new] Could not rename chat in IDE automatically: ${renameResult.error}`);
                    });
                }
            }
        }

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
     * /chat -- Display current session info + list all sessions in the same project (unified view)
     */
    async handleChat(interaction: ChatInputCommandInteraction): Promise<void> {
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);

        if (!session) {
            // Channel not managed by session -- get info directly from Antigravity
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
                );
                const categoryId = (interaction.channel as any)?.parentId;
                const isProjectChannel = categoryId ? !!this.bindingRepo.findByChannelId(categoryId) : false;
                const desc = isProjectChannel
                    ? t('※ Unbound project channel.\nSend a message or use `/new` to start a chat session.')
                    : t('※ Non-session channel.\nUse `/project` to create a project first.');

                embed.setDescription(desc)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // Get all sessions in the same category
        const allSessions = this.chatSessionRepo.findByCategoryId(session.categoryId);

        // Build session list
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
