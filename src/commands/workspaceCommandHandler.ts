import { t } from "../utils/i18n";
import fs from 'fs';
import { logger } from '../utils/logger';
import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    StringSelectMenuInteraction,
    EmbedBuilder,
    Guild,
    DiscordAPIError,
} from 'discord.js';
import { WorkspaceBindingRepository, WorkspaceBindingRecord } from '../database/workspaceBindingRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceService } from '../services/workspaceService';
import { ChannelManager } from '../services/channelManager';
import { buildProjectListUI } from '../ui/projectListUi';

// Re-export for backward compatibility
export { PROJECT_SELECT_ID, WORKSPACE_SELECT_ID } from '../ui/projectListUi';

/**
 * Handler for the /project slash command.
 * When a project is selected, auto-creates a Discord category + session-1 channel and binds them.
 */
export class WorkspaceCommandHandler {
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly workspaceService: WorkspaceService;
    private readonly channelManager: ChannelManager;
    private readonly onSessionChannelCreated?: (
        workspacePath: string,
        channelId: string,
        sourceChannelId: string,
        userId: string,
    ) => Promise<void>;

    private processingWorkspaces: Set<string> = new Set();

    /**
     * Filters out stale bindings where the Discord channel no longer exists.
     * Deletes stale bindings from the repository.
     */
    private async getValidBindings(bindings: WorkspaceBindingRecord[], guild: Guild): Promise<WorkspaceBindingRecord[]> {
        const validBindings: WorkspaceBindingRecord[] = [];
        for (const b of bindings) {
            try {
                // Try fetching the channel from Discord API
                try {
                    const channel = await guild.channels.fetch(b.channelId);
                    if (channel) validBindings.push(b);
                } catch (error) {
                    // Only cleanup for confirmed deleted channels (code 10003)
                    if (error instanceof DiscordAPIError && error.code === 10003) {
                        logger.info(`[Cleanup] Removed stale binding for deleted channel ${b.channelId}`);
                        this.chatSessionRepo.deleteByChannelId(b.channelId);
                        this.bindingRepo.deleteByChannelId(b.channelId);
                        continue;
                    }

                    // Transient failures: preserve binding for next validation attempt
                    logger.error(`[Cleanup] Failed to validate binding for channel ${b.channelId}`, error);
                    validBindings.push(b);
                }
            } catch (error) {
                logger.error(`[Cleanup] Failed to remove stale binding for channel ${b.channelId}`, error);
                this.chatSessionRepo.deleteByChannelId(b.channelId);
                this.bindingRepo.deleteByChannelId(b.channelId);
            }
        }
        return validBindings;
    }

    constructor(
        bindingRepo: WorkspaceBindingRepository,
        chatSessionRepo: ChatSessionRepository,
        workspaceService: WorkspaceService,
        channelManager: ChannelManager,
        onSessionChannelCreated?: (
            workspacePath: string,
            channelId: string,
            sourceChannelId: string,
            userId: string,
        ) => Promise<void>,
    ) {
        this.bindingRepo = bindingRepo;
        this.chatSessionRepo = chatSessionRepo;
        this.workspaceService = workspaceService;
        this.channelManager = channelManager;
        this.onSessionChannelCreated = onSessionChannelCreated;
    }

    /**
     * /project list -- Display project list via select menu
     */
    public async handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
        const workspaces = this.workspaceService.scanWorkspaces();
        const { embeds, components } = buildProjectListUI(workspaces, 0);

        await interaction.editReply({ embeds, components });
    }

    /**
     * Handle page navigation button press.
     * Re-scans workspaces and renders the requested page.
     */
    public async handlePageButton(interaction: ButtonInteraction, page: number): Promise<void> {
        await interaction.deferUpdate();

        const workspaces = this.workspaceService.scanWorkspaces();
        const { embeds, components } = buildProjectListUI(workspaces, page);

        await interaction.editReply({ embeds, components });
    }

    /**
     * Handler for when a project is selected from the select menu.
     * Creates a category + session-1 channel and binds them.
     */
    public async handleSelectMenu(
        interaction: StringSelectMenuInteraction,
        guild: Guild,
    ): Promise<void> {
        const respond = async (payload: Record<string, unknown>) => {
            if (typeof interaction.editReply === 'function') {
                await interaction.editReply(payload);
                return;
            }
            await interaction.update(payload);
        };
        const workspacePath = interaction.values[0];

        if (!this.workspaceService.exists(workspacePath)) {
            await respond({
                content: t(`❌ Project \`${workspacePath}\` not found.`),
                embeds: [],
                components: [],
            });
            return;
        }

        // Check if the same project is already bound (prevent duplicates)
        let existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(workspacePath, guild.id);
        existingBindings = await this.getValidBindings(existingBindings, guild);

        if (existingBindings.length > 0) {
            const channelLinks = existingBindings.map(b => `<#${b.channelId}>`).join(', ');
            const fullPath = this.workspaceService.getWorkspacePath(workspacePath);

            const embed = new EmbedBuilder()
                .setTitle('📁 Projects')
                .setColor(0xFFA500)
                .setDescription(
                    t(`⚠️ Project **${workspacePath}** already exists\n`) +
                    `→ ${channelLinks}`
                )
                .addFields({ name: t('Full Path'), value: `\`${fullPath}\`` })
                .setTimestamp();

            await respond({
                embeds: [embed],
                components: [],
            });
            return;
        }

        // Lock project being processed (prevent rapid repeated clicks)
        if (this.processingWorkspaces.has(workspacePath)) {
            await respond({
                content: t(`⏳ **${workspacePath}** is being created. Please wait.`),
                embeds: [],
                components: [],
            });
            return;
        }

        this.processingWorkspaces.add(workspacePath);

        try {
            // Ensure category exists
            const categoryResult = await this.channelManager.ensureCategory(guild, workspacePath);
            const categoryId = categoryResult.categoryId;

            // Get session number (usually 1)
            const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
            const channelName = `session-${sessionNumber}`;

            // Create session channel
            const sessionResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
            const channelId = sessionResult.channelId;

            // Register binding and session
            this.bindingRepo.upsert({
                channelId,
                workspacePath,
                guildId: guild.id,
            });

            this.chatSessionRepo.create({
                channelId,
                categoryId,
                workspacePath,
                sessionNumber,
                guildId: guild.id,
            });

            await this.onSessionChannelCreated?.(
                workspacePath,
                channelId,
                interaction.channelId,
                interaction.user.id,
            );

            const fullPath = this.workspaceService.getWorkspacePath(workspacePath);

            const embed = new EmbedBuilder()
                .setTitle('📁 Projects')
                .setColor(0x00AA00)
                .setDescription(
                    t(`✅ Project **${workspacePath}** created\n`) +
                    `→ <#${channelId}>`
                )
                .addFields({ name: t('Full Path'), value: `\`${fullPath}\`` })
                .setTimestamp();

            await respond({
                embeds: [embed],
                components: [],
            });
        } finally {
            this.processingWorkspaces.delete(workspacePath);
        }
        return;
    }

    /**
     * /project create <name> -- Create a new project directory,
     * auto-create a category + session-1 channel and bind them.
     */
    public async handleCreate(
        interaction: ChatInputCommandInteraction,
        guild: Guild,
    ): Promise<void> {
        const name = interaction.options.getString('name', true);

        // Path traversal check
        let fullPath: string;
        try {
            fullPath = this.workspaceService.validatePath(name);
        } catch (e: any) {
            await interaction.editReply({
                content: t(`❌ Invalid project name: ${e.message}`),
            });
            return;
        }

        // Check for existing project
        if (this.workspaceService.exists(name)) {
            let existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(name, guild.id);
            existingBindings = await this.getValidBindings(existingBindings, guild);

            if (existingBindings.length > 0) {
                const channelLinks = existingBindings.map(b => `<#${b.channelId}>`).join(', ');
                await interaction.editReply({
                    content: t(`⚠️ Project **${name}** already exists → ${channelLinks}`),
                });
                return;
            }
            // Directory exists but not bound -- continue
        }

        // Lock project being processed
        if (this.processingWorkspaces.has(name)) {
            await interaction.editReply({
                content: t(`⏳ **${name}** is being created.`),
            });
            return;
        }

        this.processingWorkspaces.add(name);

        try {
            if (!this.workspaceService.exists(name)) {
                // Create directory
                fs.mkdirSync(fullPath, { recursive: true });
            }

            // Ensure category exists
            const categoryResult = await this.channelManager.ensureCategory(guild, name);
            const categoryId = categoryResult.categoryId;

            // Get session number (usually 1)
            const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
            const channelName = `session-${sessionNumber}`;

            // Create session channel
            const sessionResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
            const channelId = sessionResult.channelId;

            // Register binding and session
            this.bindingRepo.upsert({
                channelId,
                workspacePath: name,
                guildId: guild.id,
            });

            this.chatSessionRepo.create({
                channelId,
                categoryId,
                workspacePath: name,
                sessionNumber,
                guildId: guild.id,
            });

            await this.onSessionChannelCreated?.(
                name,
                channelId,
                interaction.channelId,
                interaction.user.id,
            );

            const embed = new EmbedBuilder()
                .setTitle('📁 Project Created')
                .setColor(0x00AA00)
                .setDescription(
                    t(`✅ Project **${name}** created\n`) +
                    `→ <#${channelId}>`
                )
                .addFields({ name: t('Full Path'), value: `\`${fullPath}\`` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } finally {
            this.processingWorkspaces.delete(name);
        }
    }

    /**
     * Get the bound project path from a channel ID
     */
    public getWorkspaceForChannel(channelId: string): string | undefined {
        const binding = this.bindingRepo.findByChannelId(channelId);
        if (binding) {
            return this.workspaceService.getWorkspacePath(binding.workspacePath);
        }

        const session = this.chatSessionRepo.findByChannelId(channelId);
        if (!session) return undefined;

        return this.workspaceService.getWorkspacePath(session.workspacePath);
    }
}
