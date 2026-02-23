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

/** セレクトメニューのカスタムID */
export const PROJECT_SELECT_ID = 'project_select';
/** 後方互換: 旧IDも受け付ける */
export const WORKSPACE_SELECT_ID = 'workspace_select';

/**
 * /project スラッシュコマンドのハンドラー。
 * プロジェクト選択時にDiscordカテゴリ + session-1 チャンネルを自動作成してバインドする。
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
     * /project list — プロジェクト一覧をセレクトメニューで表示
     */
    public async handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('📁 プロジェクト')
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
     * セレクトメニューでプロジェクトが選択された時の処理。
     * カテゴリ + session-1 チャンネルを作成し、バインドする。
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

        // 同一プロジェクトが既にバインドされているか確認（重複防止）
        const existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(workspacePath, guild.id);
        if (existingBindings.length > 0) {
            const channelLinks = existingBindings.map(b => `<#${b.channelId}>`).join(', ');
            const fullPath = this.workspaceService.getWorkspacePath(workspacePath);

            const embed = new EmbedBuilder()
                .setTitle('📁 プロジェクト')
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

        // 処理中のプロジェクトをロック（連打防止）
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
            // カテゴリを確保
            const categoryResult = await this.channelManager.ensureCategory(guild, workspacePath);
            const categoryId = categoryResult.categoryId;

            // セッション番号を取得（通常は 1）
            const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
            const channelName = `session-${sessionNumber}`;

            // セッションチャンネルを作成
            const sessionResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
            const channelId = sessionResult.channelId;

            // バインディングとセッションを登録
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
                .setTitle('📁 プロジェクト')
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
     * /project create <name> — 新しいプロジェクトディレクトリを作成し、
     * カテゴリ + session-1 チャンネルを自動作成してバインドする。
     */
    public async handleCreate(
        interaction: ChatInputCommandInteraction,
        guild: Guild,
    ): Promise<void> {
        const name = interaction.options.getString('name', true);

        // パストラバーサルチェック
        let fullPath: string;
        try {
            fullPath = this.workspaceService.validatePath(name);
        } catch (e: any) {
            await interaction.editReply({
                content: t(`❌ Invalid project name: ${e.message}`),
            });
            return;
        }

        // 既存チェック
        if (this.workspaceService.exists(name)) {
            const existingBindings = this.bindingRepo.findByWorkspacePathAndGuildId(name, guild.id);
            if (existingBindings.length > 0) {
                const channelLinks = existingBindings.map(b => `<#${b.channelId}>`).join(', ');
                await interaction.editReply({
                    content: t(`⚠️ Project **${name}** already exists → ${channelLinks}`),
                });
                return;
            }
            // ディレクトリは存在するがバインドされていない場合は続行
        }

        // 処理中のプロジェクトをロック
        if (this.processingWorkspaces.has(name)) {
            await interaction.editReply({
                content: t(`⏳ **${name}** is being created.`),
            });
            return;
        }

        this.processingWorkspaces.add(name);

        try {
            if (!this.workspaceService.exists(name)) {
                // ディレクトリを作成
                fs.mkdirSync(fullPath, { recursive: true });
            }

            // カテゴリを確保
            const categoryResult = await this.channelManager.ensureCategory(guild, name);
            const categoryId = categoryResult.categoryId;

            // セッション番号を取得（通常は 1）
            const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
            const channelName = `session-${sessionNumber}`;

            // セッションチャンネルを作成
            const sessionResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
            const channelId = sessionResult.channelId;

            // バインディングとセッションを登録
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
     * チャンネルIDからバインドされたプロジェクトパスを取得する
     */
    public getWorkspaceForChannel(channelId: string): string | undefined {
        const binding = this.bindingRepo.findByChannelId(channelId);
        if (!binding) return undefined;
        return this.workspaceService.getWorkspacePath(binding.workspacePath);
    }
}
