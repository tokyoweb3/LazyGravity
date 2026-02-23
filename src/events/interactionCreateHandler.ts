import {
    ActionRowBuilder,
    ButtonBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Interaction,
    MessageFlags,
} from 'discord.js';

import { t } from '../utils/i18n';
import { logger } from '../utils/logger';
import { ChatCommandHandler } from '../commands/chatCommandHandler';
import {
    CleanupCommandHandler,
    CLEANUP_ARCHIVE_BTN,
    CLEANUP_CANCEL_BTN,
    CLEANUP_DELETE_BTN,
} from '../commands/cleanupCommandHandler';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { WorkspaceCommandHandler, PROJECT_SELECT_ID, WORKSPACE_SELECT_ID } from '../commands/workspaceCommandHandler';
import { CdpBridge } from '../services/cdpBridgeManager';
import { CdpService } from '../services/cdpService';
import { MODE_DISPLAY_NAMES, ModeService } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { AutoAcceptService } from '../services/autoAcceptService';

export interface InteractionCreateHandlerDeps {
    config: { allowedUserIds: string[] };
    bridge: CdpBridge;
    cleanupHandler: CleanupCommandHandler;
    modeService: ModeService;
    modelService: ModelService;
    slashCommandHandler: SlashCommandHandler;
    wsHandler: WorkspaceCommandHandler;
    chatHandler: ChatCommandHandler;
    client: any;
    sendModeUI: (target: { editReply: (opts: any) => Promise<any> }, modeService: ModeService) => Promise<void>;
    sendModelsUI: (
        target: { editReply: (opts: any) => Promise<any> },
        deps: { getCurrentCdp: () => CdpService | null; fetchQuota: () => Promise<any[]> },
    ) => Promise<void>;
    handleScreenshot?: (...args: any[]) => Promise<void>;
    getCurrentCdp: (bridge: CdpBridge) => CdpService | null;
    parseApprovalCustomId: (customId: string) => { action: 'approve' | 'always_allow' | 'deny'; workspaceDirName: string | null } | null;
    handleSlashInteraction: (
        interaction: ChatInputCommandInteraction,
        handler: SlashCommandHandler,
        bridge: CdpBridge,
        wsHandler: WorkspaceCommandHandler,
        chatHandler: ChatCommandHandler,
        cleanupHandler: CleanupCommandHandler,
        modeService: ModeService,
        modelService: ModelService,
        autoAcceptService: AutoAcceptService,
        client: any,
    ) => Promise<void>;
}

export function createInteractionCreateHandler(deps: InteractionCreateHandlerDeps) {
    return async (interaction: Interaction): Promise<void> => {
        if (interaction.isButton()) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                const approvalAction = deps.parseApprovalCustomId(interaction.customId);
                if (approvalAction) {
                    const workspaceDirName = approvalAction.workspaceDirName ?? deps.bridge.lastActiveWorkspace;
                    const detector = workspaceDirName
                        ? deps.bridge.pool.getApprovalDetector(workspaceDirName)
                        : undefined;

                    if (!detector) {
                        try {
                            await interaction.reply({ content: t('Approval detector not found.'), flags: MessageFlags.Ephemeral });
                        } catch { /* ignore */ }
                        return;
                    }

                    let success = false;
                    let actionLabel = '';
                    if (approvalAction.action === 'approve') {
                        success = await detector.approveButton();
                        actionLabel = t('Allow');
                    } else if (approvalAction.action === 'always_allow') {
                        success = await detector.alwaysAllowButton();
                        actionLabel = t('Allow Chat');
                    } else {
                        success = await detector.denyButton();
                        actionLabel = t('Deny');
                    }

                    try {
                        if (success) {
                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('承認リクエスト');
                            const historyText = `${actionLabel} by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(approvalAction.action === 'deny' ? 0xE74C3C : 0x2ECC71)
                                .addFields({ name: '処理履歴', value: historyText, inline: false })
                                .setTimestamp();

                            const disabledRows = interaction.message.components
                                .map((row) => {
                                    const rowAny = row as any;
                                    if (!Array.isArray(rowAny.components)) return null;

                                    const nextRow = new ActionRowBuilder<ButtonBuilder>();
                                    const disabledButtons = rowAny.components
                                        .map((component: any) => {
                                            const componentType = component?.type ?? component?.data?.type;
                                            if (componentType !== 2) return null;
                                            const payload = typeof component?.toJSON === 'function'
                                                ? component.toJSON()
                                                : component;
                                            return ButtonBuilder.from(payload).setDisabled(true);
                                        })
                                        .filter((button: ButtonBuilder | null): button is ButtonBuilder => button !== null);
                                    if (disabledButtons.length === 0) return null;
                                    nextRow.addComponents(...disabledButtons);
                                    return nextRow;
                                })
                                .filter((row): row is ActionRowBuilder<ButtonBuilder> => row !== null);

                            await interaction.update({
                                embeds: [updatedEmbed],
                                components: disabledRows,
                            });
                        } else {
                            await interaction.reply({ content: '承認ボタンが見つかりませんでした。', flags: MessageFlags.Ephemeral });
                        }
                    } catch (interactionError: any) {
                        if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                            logger.warn('[Approval] interaction期限切れ。チャンネルに直接応答します。');
                            if (interaction.channel && 'send' in interaction.channel) {
                                const fallbackMessage = success
                                    ? `${actionLabel}しました。`
                                    : '承認ボタンが見つかりませんでした。';
                                await (interaction.channel as any).send(fallbackMessage).catch(logger.error);
                            }
                        } else {
                            throw interactionError;
                        }
                    }
                    return;
                }

                if (interaction.customId === CLEANUP_ARCHIVE_BTN) {
                    await deps.cleanupHandler.handleArchive(interaction);
                    return;
                }
                if (interaction.customId === CLEANUP_DELETE_BTN) {
                    await deps.cleanupHandler.handleDelete(interaction);
                    return;
                }
                if (interaction.customId === CLEANUP_CANCEL_BTN) {
                    await deps.cleanupHandler.handleCancel(interaction);
                    return;
                }

                if (interaction.customId === 'model_refresh_btn') {
                    await interaction.deferUpdate();
                    await deps.sendModelsUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        {
                            getCurrentCdp: () => deps.getCurrentCdp(deps.bridge),
                            fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                        },
                    );
                    return;
                }

                if (interaction.customId.startsWith('model_btn_')) {
                    await interaction.deferUpdate();

                    const modelName = interaction.customId.replace('model_btn_', '');
                    const cdp = deps.getCurrentCdp(deps.bridge);

                    if (!cdp) {
                        await interaction.followUp({ content: 'CDPに未接続です。', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const res = await cdp.setUiModel(modelName);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || 'モデルの変更に失敗しました。', flags: MessageFlags.Ephemeral });
                    } else {
                        await deps.sendModelsUI(
                            { editReply: async (data: any) => await interaction.editReply(data) },
                            {
                                getCurrentCdp: () => deps.getCurrentCdp(deps.bridge),
                                fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                            },
                        );
                        await interaction.followUp({ content: `モデルを **${res.model}** に変更しました！`, flags: MessageFlags.Ephemeral });
                    }
                    return;
                }
            } catch (error) {
                logger.error('ボタンインタラクションの処理中にエラーが発生:', error);

                try {
                    if (!(interaction as any).replied && !(interaction as any).deferred) {
                        await interaction.reply({ content: 'ボタン操作の処理中にエラーが発生しました。', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.followUp({ content: 'ボタン操作の処理中にエラーが発生しました。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('エラーメッセージの送信にも失敗しました:', e);
                }
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'mode_select') {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await interaction.deferUpdate();
            } catch (deferError: any) {
                if (deferError?.code === 10062 || deferError?.code === 40060) {
                    logger.warn('[Mode] deferUpdate期限切れ。スキップします。');
                    return;
                }
                logger.error('[Mode] deferUpdate失敗:', deferError);
                return;
            }

            try {
                const selectedMode = interaction.values[0];

                deps.modeService.setMode(selectedMode);

                const cdp = deps.getCurrentCdp(deps.bridge);
                if (cdp) {
                    const res = await cdp.setUiMode(selectedMode);
                    if (!res.ok) {
                        logger.warn(`[Mode] UIモード切替失敗: ${res.error}`);
                    }
                }

                await deps.sendModeUI({ editReply: async (data: any) => await interaction.editReply(data) }, deps.modeService);
                await interaction.followUp({ content: `モードを **${MODE_DISPLAY_NAMES[selectedMode] || selectedMode}** に変更しました！`, flags: MessageFlags.Ephemeral });
            } catch (error: any) {
                logger.error('モードDropdown処理中にエラー:', error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'モード変更中にエラーが発生しました。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('エラーメッセージの送信にも失敗:', e);
                }
            }
            return;
        }

        if (interaction.isStringSelectMenu() && (interaction.customId === PROJECT_SELECT_ID || interaction.customId === WORKSPACE_SELECT_ID)) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            if (!interaction.guild) {
                await interaction.reply({ content: 'サーバー内でのみ使用できます。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await deps.wsHandler.handleSelectMenu(interaction, interaction.guild);
            } catch (error) {
                logger.error('ワークスペース選択エラー:', error);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const commandInteraction = interaction as ChatInputCommandInteraction;

        if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
            await commandInteraction.reply({
                content: 'このコマンドを使用する権限がありません。',
                flags: MessageFlags.Ephemeral,
            }).catch(logger.error);
            return;
        }

        try {
            await commandInteraction.deferReply();
        } catch (deferError: any) {
            if (deferError?.code === 10062) {
                logger.warn('[SlashCommand] インタラクション期限切れ（deferReply失敗）。スキップします。');
                return;
            }
            throw deferError;
        }

        try {
            await deps.handleSlashInteraction(
                commandInteraction,
                deps.slashCommandHandler,
                deps.bridge,
                deps.wsHandler,
                deps.chatHandler,
                deps.cleanupHandler,
                deps.modeService,
                deps.modelService,
                deps.bridge.autoAccept,
                deps.client,
            );
        } catch (error) {
            logger.error('スラッシュコマンドの処理でエラーが発生:', error);
            try {
                await commandInteraction.editReply({ content: 'コマンドの処理中にエラーが発生しました。' });
            } catch (replyError) {
                logger.error('エラー応答の送信にも失敗:', replyError);
            }
        }
    };
}
