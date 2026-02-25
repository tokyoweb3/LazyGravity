import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Interaction,
    Message,
    MessageFlags,
} from 'discord.js';

import { t } from '../utils/i18n';
import { logger } from '../utils/logger';
import { TEMPLATE_BTN_PREFIX, parseTemplateButtonId } from '../ui/templateUi';
import {
    AUTOACCEPT_BTN_OFF,
    AUTOACCEPT_BTN_ON,
    AUTOACCEPT_BTN_REFRESH,
} from '../ui/autoAcceptUi';
import { ChatCommandHandler } from '../commands/chatCommandHandler';
import {
    CleanupCommandHandler,
    CLEANUP_ARCHIVE_BTN,
    CLEANUP_CANCEL_BTN,
    CLEANUP_DELETE_BTN,
} from '../commands/cleanupCommandHandler';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { PROJECT_PAGE_PREFIX, parseProjectPageId, isProjectSelectId } from '../ui/projectListUi';
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
    sendAutoAcceptUI: (
        target: { editReply: (opts: any) => Promise<any> },
        autoAcceptService: AutoAcceptService,
    ) => Promise<void>;
    handleScreenshot?: (...args: any[]) => Promise<void>;
    getCurrentCdp: (bridge: CdpBridge) => CdpService | null;
    parseApprovalCustomId: (customId: string) => { action: 'approve' | 'always_allow' | 'deny'; workspaceDirName: string | null; channelId: string | null } | null;
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
    handleTemplateUse?: (interaction: ButtonInteraction, templateId: number) => Promise<void>;
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
                    if (approvalAction.channelId && approvalAction.channelId !== interaction.channelId) {
                        await interaction.reply({
                            content: t('This approval action is linked to a different session channel.'),
                            flags: MessageFlags.Ephemeral,
                        }).catch(logger.error);
                        return;
                    }

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
                                : new EmbedBuilder().setTitle('Approval Request');
                            const historyText = `${actionLabel} by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(approvalAction.action === 'deny' ? 0xE74C3C : 0x2ECC71)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
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
                            await interaction.reply({ content: 'Approval button not found.', flags: MessageFlags.Ephemeral });
                        }
                    } catch (interactionError: any) {
                        if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                            logger.warn('[Approval] Interaction expired. Responding directly in the channel.');
                            if (interaction.channel && 'send' in interaction.channel) {
                                const fallbackMessage = success
                                    ? `${actionLabel} completed.`
                                    : 'Approval button not found.';
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
                        await interaction.followUp({ content: 'Not connected to CDP.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const res = await cdp.setUiModel(modelName);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || 'Failed to change model.', flags: MessageFlags.Ephemeral });
                    } else {
                        await deps.sendModelsUI(
                            { editReply: async (data: any) => await interaction.editReply(data) },
                            {
                                getCurrentCdp: () => deps.getCurrentCdp(deps.bridge),
                                fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                            },
                        );
                        await interaction.followUp({ content: `Model changed to **${res.model}**!`, flags: MessageFlags.Ephemeral });
                    }
                    return;
                }

                if (interaction.customId === AUTOACCEPT_BTN_REFRESH) {
                    await interaction.deferUpdate();
                    await deps.sendAutoAcceptUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        deps.bridge.autoAccept,
                    );
                    return;
                }

                if (interaction.customId === AUTOACCEPT_BTN_ON || interaction.customId === AUTOACCEPT_BTN_OFF) {
                    await interaction.deferUpdate();

                    const action = interaction.customId === AUTOACCEPT_BTN_ON ? 'on' : 'off';
                    const result = deps.bridge.autoAccept.handle(action);

                    await deps.sendAutoAcceptUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        deps.bridge.autoAccept,
                    );

                    await interaction.followUp({
                        content: result.message,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (interaction.customId.startsWith(`${PROJECT_PAGE_PREFIX}:`)) {
                    const page = parseProjectPageId(interaction.customId);
                    if (!isNaN(page) && page >= 0) {
                        await deps.wsHandler.handlePageButton(interaction, page);
                    }
                    return;
                }

                if (interaction.customId.startsWith(TEMPLATE_BTN_PREFIX)) {
                    await interaction.deferUpdate();
                    const templateId = parseTemplateButtonId(interaction.customId);
                    if (!isNaN(templateId) && deps.handleTemplateUse) {
                        await deps.handleTemplateUse(interaction, templateId);
                    }
                    return;
                }
            } catch (error) {
                logger.error('Error during button interaction handling:', error);

                try {
                    if (!(interaction as any).replied && !(interaction as any).deferred) {
                        await interaction.reply({ content: 'An error occurred while processing the button action.', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.followUp({ content: 'An error occurred while processing the button action.', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('Failed to send error message as well:', e);
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
                    logger.warn('[Mode] deferUpdate expired. Skipping.');
                    return;
                }
                logger.error('[Mode] deferUpdate failed:', deferError);
                return;
            }

            try {
                const selectedMode = interaction.values[0];

                deps.modeService.setMode(selectedMode);

                const cdp = deps.getCurrentCdp(deps.bridge);
                if (cdp) {
                    const res = await cdp.setUiMode(selectedMode);
                    if (!res.ok) {
                        logger.warn(`[Mode] UI mode switch failed: ${res.error}`);
                    }
                }

                await deps.sendModeUI({ editReply: async (data: any) => await interaction.editReply(data) }, deps.modeService);
                await interaction.followUp({ content: `Mode changed to **${MODE_DISPLAY_NAMES[selectedMode] || selectedMode}**!`, flags: MessageFlags.Ephemeral });
            } catch (error: any) {
                logger.error('Error during mode dropdown handling:', error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'An error occurred while changing the mode.', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('Failed to send error message:', e);
                }
            }
            return;
        }

        if (interaction.isStringSelectMenu() && isProjectSelectId(interaction.customId)) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            if (!interaction.guild) {
                await interaction.reply({ content: 'This can only be used in a server.', flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await deps.wsHandler.handleSelectMenu(interaction, interaction.guild);
            } catch (error) {
                logger.error('Workspace selection error:', error);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const commandInteraction = interaction as ChatInputCommandInteraction;

        if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
            await commandInteraction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral,
            }).catch(logger.error);
            return;
        }

        try {
            await commandInteraction.deferReply();
        } catch (deferError: any) {
            if (deferError?.code === 10062) {
                logger.warn('[SlashCommand] Interaction expired (deferReply failed). Skipping.');
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
            logger.error('Error during slash command handling:', error);
            try {
                await commandInteraction.editReply({ content: 'An error occurred while processing the command.' });
            } catch (replyError) {
                logger.error('Failed to send error response:', replyError);
            }
        }
    };
}
