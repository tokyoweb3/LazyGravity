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
     */
    async handleJoinSelect(
        interaction: StringSelectMenuInteraction,
        bridge: CdpBridge,
    ): Promise<void> {
        const selectedTitle = interaction.values[0];

        // Resolve workspace from channel binding
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const workspaceName = binding?.workspacePath ?? session?.workspacePath;

        if (!workspaceName) {
            await interaction.editReply({
                content: t('⚠️ No project is bound to this channel.'),
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

        // Activate the selected session in Antigravity
        const result = await this.chatSessionService.activateSessionByTitle(cdp, selectedTitle);

        if (!result.ok) {
            await interaction.editReply({
                content: t(`⚠️ Failed to join session: ${result.error}`),
            });
            return;
        }

        // Update session display name in the database
        const existingSession = this.chatSessionRepo.findByChannelId(interaction.channelId);
        if (existingSession) {
            this.chatSessionRepo.updateDisplayName(existingSession.channelId, selectedTitle);
        }

        const embed = new EmbedBuilder()
            .setTitle(t('🔗 Joined Session'))
            .setDescription(t(`Connected to: **${selectedTitle}**`))
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
