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
export const WORKSPACE_SELECT_ID = 'workspace_select';

/**
 * /workspace スラッシュコマンドのハンドラー。
 * ワークスペース選択時にDiscordカテゴリ + session-1 チャンネルを自動作成してバインドする。
 */
export class WorkspaceCommandHandler {
    private readonly bindingRepo: WorkspaceBindingRepository;
    private readonly chatSessionRepo: ChatSessionRepository;
    private readonly workspaceService: WorkspaceService;
    private readonly channelManager: ChannelManager;

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
     * /workspace — ワークスペース一覧をセレクトメニューで表示
     */
    public async handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('Workspace')
            .setColor(0x5865F2)
            .setDescription('ワークスペースを選択すると、専用カテゴリとセッションチャンネルを自動作成します')
            .setTimestamp();

        const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

        const workspaces = this.workspaceService.scanWorkspaces();
        if (workspaces.length > 0) {
            const options = workspaces.slice(0, 25).map((ws) => ({
                label: ws,
                value: ws,
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(WORKSPACE_SELECT_ID)
                .setPlaceholder('ワークスペースを選択...')
                .addOptions(options);

            if (workspaces.length > 25) {
                selectMenu.setPlaceholder(`ワークスペースを選択... (${workspaces.length}件中25件表示)`);
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
     * セレクトメニューでワークスペースが選択された時の処理。
     * カテゴリ + session-1 チャンネルを作成し、バインドする。
     */
    public async handleSelectMenu(
        interaction: StringSelectMenuInteraction,
        guild: Guild,
    ): Promise<void> {
        const workspacePath = interaction.values[0];

        if (!this.workspaceService.exists(workspacePath)) {
            await interaction.update({
                content: `❌ ワークスペース \`${workspacePath}\` が見つかりません。`,
                embeds: [],
                components: [],
            });
            return;
        }

        // カテゴリを確保
        const categoryResult = await this.channelManager.ensureCategory(guild, workspacePath);
        const categoryId = categoryResult.categoryId;

        // セッション番号を取得（通常は 1）
        const sessionNumber = this.chatSessionRepo.getNextSessionNumber(categoryId);
        const channelName = `session-${sessionNumber}`;

        // セッションチャンネルを作成
        const sessionResult = await this.channelManager.createSessionChannel(guild, categoryId, channelName);
        const channelId = sessionResult.channelId;

        // ワークスペースバインディングを登録
        this.bindingRepo.upsert({
            channelId,
            workspacePath,
            guildId: guild.id,
        });

        // チャットセッションを登録
        this.chatSessionRepo.create({
            channelId,
            categoryId,
            workspacePath,
            sessionNumber,
            guildId: guild.id,
        });

        const fullPath = this.workspaceService.getWorkspacePath(workspacePath);

        const embed = new EmbedBuilder()
            .setTitle('Workspace')
            .setColor(0x00AA00)
            .setDescription(
                `✅ **${workspacePath}** のワークスペースを作成しました\n` +
                `→ <#${channelId}>`
            )
            .addFields({ name: 'フルパス', value: `\`${fullPath}\`` })
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: [],
        });
    }

    /**
     * チャンネルIDからバインドされたワークスペースパスを取得する
     */
    public getWorkspaceForChannel(channelId: string): string | undefined {
        const binding = this.bindingRepo.findByChannelId(channelId);
        if (!binding) return undefined;
        return this.workspaceService.getWorkspacePath(binding.workspacePath);
    }
}
