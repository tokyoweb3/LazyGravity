import { t } from "../utils/i18n";
import fs from 'fs';
import {
    ChatInputCommandInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    ActionRowBuilder,
    EmbedBuilder,
    Guild,
} from 'discord.js';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceService } from '../services/workspaceService';
import { ChannelManager } from '../services/channelManager';

/** Select menu custom ID */
export const PROJECT_SELECT_ID = 'project_select';
/** Backward compatibility: also accept old ID */
export const WORKSPACE_SELECT_ID = 'workspace_select';

/**
 * Handler for the /project slash command.
 * When a project is selected, auto-creates a Discord category + session-1 channel and binds them.
 */
export class WorkspaceCommandHandler {
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly workspaceService: WorkspaceService;
    private readonly channelManager: ChannelManager;

    private processingWorkspaces: Set<string> = new Set();

    constructor(
        bindingRepo: WorkspaceBindingRepository,
        chatSessionRepo: ChatSessionRepository,
        workspaceService: WorkspaceService,
        channelManager: ChannelManager,
    ) {
        this.bindingRepo = bindingRepo;
        this.chatSessionRepo = chatSessionRepo;
        this.workspaceService = workspaceService;
        this.channelManager = channelManager;
    }

    /**
     * /project list -- Display project list via select menu
     */
    public async handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('📁 Projects')
            .setColor(0x5865F2)
            .setDescription(t('Select a project to auto-create a category and session channel'))
            .setTimestamp();

        const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

        const workspaces = this.workspaceService.scanWorkspaces();
        if (workspaces.length > 0) {
            const options = workspaces.slice(0, 25).map((ws) => ({
                label: ws,
                value: ws,
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(PROJECT_SELECT_ID)
                .setPlaceholder(t('Select a project...'))
                .addOptions(options);

            if (workspaces.length > 25) {
                selectMenu.setPlaceholder(t(`Select a project... (Showing 25 of ${workspaces.length})`));
            }

            components.push(
                new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
            );
        }

        await interaction.editReply({
            embeds: [embed],
            components,
        });
    }

    /**
     * Handler for when a project is selected from the select menu.
     * Creates a category + session-1 channel and binds them.
     */
    public async handleSelectMenu(
        interaction: StringSelectMenuInteraction,
        guild: Guild,
    ): Promise<void> {
        const workspacePath = interaction.values[0];

        if (!this.workspaceService.exists(workspacePath)) {
            await interaction.update({
                content: t(`❌ Project \`${workspacePath}\` not found.`),
                embeds: [],
                components: [],
            });
            return;
        }

        // Check if the same project is already bound (prevent duplicates)
        const existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(workspacePath, guild.id);
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

            await interaction.update({
                embeds: [embed],
                components: [],
            });
            return;
        }

        // Lock project being processed (prevent rapid repeated clicks)
        if (this.processingWorkspaces.has(workspacePath)) {
            await interaction.update({
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

            await interaction.update({
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
            const existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(name, guild.id);
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
        if (!binding) return undefined;
        return this.workspaceService.getWorkspacePath(binding.workspacePath);
    }
}
