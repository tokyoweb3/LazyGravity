import { t } from '../utils/i18n';
import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    StringSelectMenuInteraction,
} from 'discord.js';
import { ChatSessionService } from '../services/chatSessionService';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChannelManager } from '../services/channelManager';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import { CdpBridge } from '../services/cdpBridgeManager';
import { buildSessionPickerUI } from '../ui/sessionPickerUi';

/**
 * Handler for /join and /detach commands.
 *
 * /join — List Antigravity sessions and connect to one via a select menu.
 * /detach — Disconnect monitoring from the current session (Antigravity continues running).
 */
export class JoinDetachCommandHandler {
    private readonly chatSessionService: ChatSessionService;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly channelManager: ChannelManager;
    private readonly pool: CdpConnectionPool;

    constructor(
        chatSessionService: ChatSessionService,
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
        channelManager: ChannelManager,
        pool: CdpConnectionPool,
    ) {
        this.chatSessionService = chatSessionService;
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
        this.channelManager = channelManager;
        this.pool = pool;
    }

    /**
     * /join — Show session picker for the workspace bound to this channel.
     */
    async handleJoin(
        interaction: ChatInputCommandInteraction,
        bridge: CdpBridge,
    ): Promise<void> {
        // Resolve workspace from channel binding
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const workspaceName = binding?.workspacePath ?? session?.workspacePath;

        if (!workspaceName) {
            await interaction.editReply({
                content: t('⚠️ No project is bound to this channel. Use `/project` first.'),
            });
            return;
        }

        let cdp;
        try {
            cdp = await this.pool.getOrConnect(workspaceName);
        } catch (e: any) {
            await interaction.editReply({
                content: t(`⚠️ Failed to connect to project: ${e.message}`),
            });
            return;
        }

        const sessions = await this.chatSessionService.listAllSessions(cdp);
        const { embeds, components } = buildSessionPickerUI(sessions);

        await interaction.editReply({ embeds, components });
    }

    /**
     * Handle session selection from the /join picker.
     *
     * Flow:
     *   1. Check if a channel already exists for this session (by displayName)
     *   2. If yes → reply with a link to that channel
     *   3. If no → create a new channel, bind it, set displayName, activate session
     */
    async handleJoinSelect(
        interaction: StringSelectMenuInteraction,
        bridge: CdpBridge,
    ): Promise<void> {
        const selectedTitle = interaction.values[0];
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply({ content: t('⚠️ This command can only be used in a server.') });
            return;
        }

        // Resolve workspace from channel binding
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const workspaceName = binding?.workspacePath ?? session?.workspacePath;

        if (!workspaceName) {
            await interaction.editReply({ content: t('⚠️ No project is bound to this channel.') });
            return;
        }

        // Step 1: Check if a channel already exists for this session
        const existingSession = this.chatSessionRepo.findByDisplayName(workspaceName, selectedTitle);
        if (existingSession) {
            const embed = new EmbedBuilder()
                .setTitle(t('🔗 Session Already Connected'))
                .setDescription(t(`This session already has a channel:\n→ <#${existingSession.channelId}>`))
                .setColor(0x3498DB)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed], components: [] });
            return;
        }

        // Step 2: Connect to CDP
        let cdp;
        try {
            cdp = await this.pool.getOrConnect(workspaceName);
        } catch (e: any) {
            await interaction.editReply({ content: t(`⚠️ Failed to connect to project: ${e.message}`) });
            return;
        }

        // Step 3: Activate the session in Antigravity
        const activateResult = await this.chatSessionService.activateSessionByTitle(cdp, selectedTitle);
        if (!activateResult.ok) {
            await interaction.editReply({ content: t(`⚠️ Failed to join session: ${activateResult.error}`) });
            return;
        }

        // Step 4: Create a new Discord channel for this session
        const categoryResult = await this.channelManager.ensureCategory(guild, workspaceName);
        const categoryId = categoryResult.categoryId;
        const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
        const channelName = this.channelManager.sanitizeChannelName(`${sessionNumber}-${selectedTitle}`);
        const channelResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
        const newChannelId = channelResult.channelId;

        // Step 5: Register binding and session
        this.bindingRepo.upsert({
            channelId: newChannelId,
            workspacePath: workspaceName,
            guildId: guild.id,
        });

        this.chatSessionRepo.create({
            channelId: newChannelId,
            categoryId,
            workspacePath: workspaceName,
            sessionNumber,
            guildId: guild.id,
        });

        // Set displayName immediately (marks isRenamed = true)
        this.chatSessionRepo.updateDisplayName(newChannelId, selectedTitle);

        const embed = new EmbedBuilder()
            .setTitle(t('🔗 Joined Session'))
            .setDescription(t(`Connected to: **${selectedTitle}**\n→ <#${newChannelId}>`))
            .setColor(0x2ECC71)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    }

    /**
     * /detach — Disconnect monitoring from the current session.
     */
    async handleDetach(
        interaction: ChatInputCommandInteraction,
    ): Promise<void> {
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const workspaceName = binding?.workspacePath ?? session?.workspacePath;
        const dirName = workspaceName ? this.pool.extractDirName(workspaceName) : null;

        // Stop user message detector if running
        if (dirName) {
            const detector = this.pool.getUserMessageDetector(dirName);
            if (detector) {
                await detector.stop();
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(t('🔌 Detached'))
            .setDescription(t('Disconnected from session monitoring. Antigravity continues running.'))
            .setColor(0x95A5A6)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}
