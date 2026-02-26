import { t } from '../utils/i18n';
import {
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    StringSelectMenuInteraction,
} from 'discord.js';
import { ChatSessionService } from '../services/chatSessionService';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChannelManager } from '../services/channelManager';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import {
    CdpBridge,
    ensureUserMessageDetector,
    getCurrentChatTitle,
} from '../services/cdpBridgeManager';
import { CdpService } from '../services/cdpService';
import { ResponseMonitor } from '../services/responseMonitor';
import { buildSessionPickerUI } from '../ui/sessionPickerUi';
import { logger } from '../utils/logger';

/** Maximum embed description length (Discord limit is 4096) */
const MAX_EMBED_DESC = 4000;

/**
 * Handler for /join and /mirror commands
 *
 * /join   — List Antigravity sessions and connect to one via a select menu.
 * /mirror — Toggle PC-to-Discord message mirroring ON/OFF.
 */
export class JoinCommandHandler {
    private readonly chatSessionService: ChatSessionService;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly channelManager: ChannelManager;
    private readonly pool: CdpConnectionPool;
    private readonly client: Client;

    /** Active ResponseMonitors per workspace (for AI response mirroring) */
    private readonly activeResponseMonitors = new Map<string, ResponseMonitor>();

    constructor(
        chatSessionService: ChatSessionService,
        chatSessionRepo: ChatSessionRepository,
        bindingRepo: WorkspaceBindingRepository,
        channelManager: ChannelManager,
        pool: CdpConnectionPool,
        client: Client,
    ) {
        this.chatSessionService = chatSessionService;
        this.chatSessionRepo = chatSessionRepo;
        this.bindingRepo = bindingRepo;
        this.channelManager = channelManager;
        this.pool = pool;
        this.client = client;
    }

    /**
     * /join — Show session picker for the workspace bound to this channel.
     */
    async handleJoin(
        interaction: ChatInputCommandInteraction,
        bridge: CdpBridge,
    ): Promise<void> {
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
     *   3. If no → create a new channel, bind it, activate session, start mirroring
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

        this.chatSessionRepo.updateDisplayName(newChannelId, selectedTitle);

        // Step 6: Start mirroring (routes dynamically to all bound session channels)
        this.startMirroring(bridge, cdp, workspaceName);

        const embed = new EmbedBuilder()
            .setTitle(t('🔗 Joined Session'))
            .setDescription(t(
                `Connected to: **${selectedTitle}**\n→ <#${newChannelId}>\n\n` +
                `📡 Mirroring is **ON** — PC messages will appear in the new channel.\n` +
                `Use \`/mirror\` to toggle.`,
            ))
            .setColor(0x2ECC71)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    }

    /**
     * /mirror — Toggle mirroring ON/OFF for the current channel's workspace.
     */
    async handleMirror(
        interaction: ChatInputCommandInteraction,
        bridge: CdpBridge,
    ): Promise<void> {
        const binding = this.bindingRepo.findByChannelId(interaction.channelId);
        const session = this.chatSessionRepo.findByChannelId(interaction.channelId);
        const workspaceName = binding?.workspacePath ?? session?.workspacePath;
        const dirName = workspaceName ? this.pool.extractDirName(workspaceName) : null;

        if (!dirName || !workspaceName) {
            await interaction.editReply({
                content: t('⚠️ No project is bound to this channel. Use `/project` first.'),
            });
            return;
        }

        const detector = this.pool.getUserMessageDetector(dirName);

        if (detector?.isActive()) {
            // Turn OFF — stop user message detector and any active response monitor
            detector.stop();
            const responseMonitor = this.activeResponseMonitors.get(dirName);
            if (responseMonitor?.isActive()) {
                await responseMonitor.stop();
                this.activeResponseMonitors.delete(dirName);
            }

            const embed = new EmbedBuilder()
                .setTitle(t('📡 Mirroring OFF'))
                .setDescription(t('PC-to-Discord message mirroring has been stopped.'))
                .setColor(0x95A5A6)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } else {
            // Turn ON
            let cdp;
            try {
                cdp = await this.pool.getOrConnect(workspaceName);
            } catch (e: any) {
                await interaction.editReply({
                    content: t(`⚠️ Failed to connect to project: ${e.message}`),
                });
                return;
            }

            this.startMirroring(bridge, cdp, workspaceName);

            const embed = new EmbedBuilder()
                .setTitle(t('📡 Mirroring ON'))
                .setDescription(t(
                    'PC-to-Discord message mirroring is now active.\n' +
                    'Messages typed in Antigravity will appear in the corresponding session channel.',
                ))
                .setColor(0x2ECC71)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
    }

    /**
     * Start user message mirroring for a workspace.
     *
     * When a PC message is detected, the callback resolves the correct Discord
     * channel via chatSessionRepo.findByDisplayName. Only explicitly joined
     * sessions (with a displayName binding) receive mirrored messages.
     */
    private startMirroring(
        bridge: CdpBridge,
        cdp: CdpService,
        workspaceName: string,
    ): void {
        const dirName = this.pool.extractDirName(workspaceName);

        ensureUserMessageDetector(bridge, cdp, dirName, (info) => {
            this.routeMirroredMessage(cdp, dirName, workspaceName, info)
                .catch((err) => {
                    logger.error('[Mirror] Error routing mirrored message:', err);
                });
        });
    }

    /**
     * Route a mirrored PC message to the correct Discord channel and
     * start a passive ResponseMonitor to capture the AI response.
     *
     * Routing: chatSessionRepo.findByDisplayName only — no fallbacks.
     * Sessions without an explicit channel binding are silently skipped.
     */
    private async routeMirroredMessage(
        cdp: CdpService,
        dirName: string,
        workspaceName: string,
        info: { text: string },
    ): Promise<void> {
        const chatTitle = await getCurrentChatTitle(cdp);

        if (!chatTitle) {
            logger.debug('[Mirror] No chat title detected, skipping');
            return;
        }

        const session = this.chatSessionRepo.findByDisplayName(workspaceName, chatTitle);
        if (!session) {
            logger.debug(`[Mirror] No bound channel for session "${chatTitle}", skipping`);
            return;
        }

        const channel = this.client.channels.cache.get(session.channelId);
        if (!channel || !('send' in channel)) return;
        const sendable = channel as { send: (...args: any[]) => Promise<any> };

        // Mirror the user message
        const userEmbed = new EmbedBuilder()
            .setDescription(`🖥️ ${info.text}`)
            .setColor(0x95A5A6)
            .setFooter({ text: `Typed in Antigravity · ${chatTitle}` })
            .setTimestamp();

        await sendable.send({ embeds: [userEmbed] }).catch((err: Error) => {
            logger.error('[Mirror] Failed to send user message:', err);
        });

        // Start passive ResponseMonitor to capture the AI response
        this.startResponseMirror(cdp, dirName, sendable, chatTitle);
    }

    /**
     * Start a passive ResponseMonitor that sends the AI response to Discord
     * when generation completes.
     */
    private startResponseMirror(
        cdp: CdpService,
        dirName: string,
        channel: { send: (...args: any[]) => Promise<any> },
        chatTitle: string,
    ): void {
        // Stop previous monitor if still running
        const prev = this.activeResponseMonitors.get(dirName);
        if (prev?.isActive()) {
            prev.stop().catch(() => {});
        }

        const monitor = new ResponseMonitor({
            cdpService: cdp,
            pollIntervalMs: 2000,
            maxDurationMs: 300000,
            onComplete: (finalText: string) => {
                this.activeResponseMonitors.delete(dirName);
                if (!finalText || finalText.trim().length === 0) return;

                const text = finalText.length > MAX_EMBED_DESC
                    ? finalText.slice(0, MAX_EMBED_DESC) + '\n…(truncated)'
                    : finalText;

                const embed = new EmbedBuilder()
                    .setDescription(text)
                    .setColor(0x5865F2)
                    .setFooter({ text: `Antigravity response · ${chatTitle}` })
                    .setTimestamp();

                channel.send({ embeds: [embed] }).catch((err: Error) => {
                    logger.error('[Mirror] Failed to send AI response:', err);
                });
            },
            onTimeout: () => {
                this.activeResponseMonitors.delete(dirName);
            },
        });

        this.activeResponseMonitors.set(dirName, monitor);
        monitor.startPassive().catch((err) => {
            logger.error('[Mirror] Failed to start response monitor:', err);
            this.activeResponseMonitors.delete(dirName);
        });
    }
}
