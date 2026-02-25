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
    parsePlanningCustomId: (customId: string) => { action: 'open' | 'proceed'; workspaceDirName: string | null; channelId: string | null } | null;
    parseErrorPopupCustomId: (customId: string) => { action: 'dismiss' | 'copy_debug' | 'retry'; workspaceDirName: string | null; channelId: string | null } | null;
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

/** Disable all buttons in message component rows. */
function disableAllButtons(components: readonly any[]): ActionRowBuilder<ButtonBuilder>[] {
    return components
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

                            await interaction.update({
                                embeds: [updatedEmbed],
                                components: disableAllButtons(interaction.message.components),
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

                const planningAction = deps.parsePlanningCustomId(interaction.customId);
                if (planningAction) {
                    if (planningAction.channelId && planningAction.channelId !== interaction.channelId) {
                        await interaction.reply({
                            content: t('This planning action is linked to a different session channel.'),
                            flags: MessageFlags.Ephemeral,
                        }).catch(logger.error);
                        return;
                    }

                    const planWorkspaceDirName = planningAction.workspaceDirName ?? deps.bridge.lastActiveWorkspace;
                    const planDetector = planWorkspaceDirName
                        ? deps.bridge.pool.getPlanningDetector(planWorkspaceDirName)
                        : undefined;

                    if (!planDetector) {
                        try {
                            await interaction.reply({ content: t('Planning detector not found.'), flags: MessageFlags.Ephemeral });
                        } catch { /* ignore */ }
                        return;
                    }

                    try {
                        if (planningAction.action === 'open') {
                            await interaction.deferUpdate();

                            const clicked = await planDetector.clickOpenButton();
                            if (!clicked) {
                                await interaction.followUp({ content: t('Open button not found.'), flags: MessageFlags.Ephemeral });
                                return;
                            }

                            // Wait for DOM to update after Open click
                            await new Promise((resolve) => setTimeout(resolve, 500));

                            // Extract plan content with retry
                            let planContent: string | null = null;
                            for (let attempt = 0; attempt < 3; attempt++) {
                                planContent = await planDetector.extractPlanContent();
                                if (planContent) break;
                                await new Promise((resolve) => setTimeout(resolve, 500));
                            }

                            // Update original embed with action history
                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Planning Mode');
                            const historyText = `Open by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(0x3498DB)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            await interaction.editReply({
                                embeds: [updatedEmbed],
                                components: interaction.message.components,
                            });

                            // Send plan content as a new message in the same channel
                            if (planContent && interaction.channel && 'send' in interaction.channel) {
                                // Discord embed description limit is 4096 chars
                                const MAX_PLAN_CONTENT = 4096;
                                const truncated = planContent.length > MAX_PLAN_CONTENT
                                    ? planContent.substring(0, MAX_PLAN_CONTENT - 15) + '\n\n(truncated)'
                                    : planContent;

                                const planEmbed = new EmbedBuilder()
                                    .setTitle(t('Plan Content'))
                                    .setDescription(truncated)
                                    .setColor(0x3498DB)
                                    .setTimestamp();

                                await (interaction.channel as any).send({ embeds: [planEmbed] }).catch(logger.error);
                            } else if (!planContent) {
                                await interaction.followUp({
                                    content: t('Could not extract plan content from the editor.'),
                                    flags: MessageFlags.Ephemeral,
                                }).catch(logger.error);
                            }
                        } else {
                            // Proceed action
                            const clicked = await planDetector.clickProceedButton();

                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Planning Mode');
                            const historyText = `Proceed by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(clicked ? 0x2ECC71 : 0xE74C3C)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            try {
                                await interaction.update({
                                    embeds: [updatedEmbed],
                                    components: disableAllButtons(interaction.message.components),
                                });
                            } catch (interactionError: any) {
                                if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                                    logger.warn('[Planning] Interaction expired. Responding directly in the channel.');
                                    if (interaction.channel && 'send' in interaction.channel) {
                                        const fallbackMessage = clicked
                                            ? t('Proceed completed. Implementation started.')
                                            : t('Proceed button not found.');
                                        await (interaction.channel as any).send(fallbackMessage).catch(logger.error);
                                    }
                                } else {
                                    throw interactionError;
                                }
                            }
                        }
                    } catch (planError: any) {
                        if (planError?.code === 10062 || planError?.code === 40060) {
                            logger.warn('[Planning] Interaction expired.');
                        } else {
                            logger.error('[Planning] Error handling planning button:', planError);
                            try {
                                if (!(interaction as any).replied && !(interaction as any).deferred) {
                                    await interaction.reply({ content: t('An error occurred while processing the planning action.'), flags: MessageFlags.Ephemeral });
                                } else {
                                    await interaction.followUp({ content: t('An error occurred while processing the planning action.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                                }
                            } catch { /* ignore */ }
                        }
                    }
                    return;
                }

                const errorPopupAction = deps.parseErrorPopupCustomId(interaction.customId);
                if (errorPopupAction) {
                    if (errorPopupAction.channelId && errorPopupAction.channelId !== interaction.channelId) {
                        await interaction.reply({
                            content: t('This error popup action is linked to a different session channel.'),
                            flags: MessageFlags.Ephemeral,
                        }).catch(logger.error);
                        return;
                    }

                    const errorWorkspaceDirName = errorPopupAction.workspaceDirName ?? deps.bridge.lastActiveWorkspace;
                    const errorDetector = errorWorkspaceDirName
                        ? deps.bridge.pool.getErrorPopupDetector(errorWorkspaceDirName)
                        : undefined;

                    if (!errorDetector) {
                        try {
                            await interaction.reply({ content: t('Error popup detector not found.'), flags: MessageFlags.Ephemeral });
                        } catch { /* ignore */ }
                        return;
                    }

                    try {
                        if (errorPopupAction.action === 'dismiss') {
                            const clicked = await errorDetector.clickDismissButton();

                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Agent Error');
                            const historyText = `Dismiss by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(clicked ? 0x95A5A6 : 0xE74C3C)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            try {
                                await interaction.update({
                                    embeds: [updatedEmbed],
                                    components: disableAllButtons(interaction.message.components),
                                });
                            } catch (interactionError: any) {
                                if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                                    logger.warn('[ErrorPopup] Interaction expired. Responding directly in the channel.');
                                    if (interaction.channel && 'send' in interaction.channel) {
                                        const fallbackMessage = clicked
                                            ? t('Error popup dismissed.')
                                            : t('Dismiss button not found.');
                                        await (interaction.channel as any).send(fallbackMessage).catch(logger.error);
                                    }
                                } else {
                                    throw interactionError;
                                }
                            }
                        } else if (errorPopupAction.action === 'copy_debug') {
                            await interaction.deferUpdate();

                            const clicked = await errorDetector.clickCopyDebugInfoButton();
                            if (!clicked) {
                                await interaction.followUp({ content: t('Copy debug info button not found.'), flags: MessageFlags.Ephemeral });
                                return;
                            }

                            // Wait for clipboard to be populated
                            await new Promise((resolve) => setTimeout(resolve, 300));

                            const clipboardContent = await errorDetector.readClipboard();

                            // Update original embed with action history
                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Agent Error');
                            const historyText = `Copy debug info by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(0x3498DB)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            await interaction.editReply({
                                embeds: [updatedEmbed],
                                components: interaction.message.components,
                            });

                            // Send debug info as a new message
                            if (clipboardContent && interaction.channel && 'send' in interaction.channel) {
                                const MAX_DEBUG_CONTENT = 4096;
                                const truncated = clipboardContent.length > MAX_DEBUG_CONTENT
                                    ? clipboardContent.substring(0, MAX_DEBUG_CONTENT - 15) + '\n\n(truncated)'
                                    : clipboardContent;

                                const debugEmbed = new EmbedBuilder()
                                    .setTitle(t('Debug Info'))
                                    .setDescription(`\`\`\`\n${truncated}\n\`\`\``)
                                    .setColor(0x3498DB)
                                    .setTimestamp();

                                await (interaction.channel as any).send({ embeds: [debugEmbed] }).catch(logger.error);
                            } else if (!clipboardContent) {
                                await interaction.followUp({
                                    content: t('Could not read debug info from clipboard.'),
                                    flags: MessageFlags.Ephemeral,
                                }).catch(logger.error);
                            }
                        } else {
                            // Retry action
                            const clicked = await errorDetector.clickRetryButton();

                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Agent Error');
                            const historyText = `Retry by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(clicked ? 0x2ECC71 : 0xE74C3C)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            try {
                                await interaction.update({
                                    embeds: [updatedEmbed],
                                    components: disableAllButtons(interaction.message.components),
                                });
                            } catch (interactionError: any) {
                                if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                                    logger.warn('[ErrorPopup] Interaction expired. Responding directly in the channel.');
                                    if (interaction.channel && 'send' in interaction.channel) {
                                        const fallbackMessage = clicked
                                            ? t('Retry initiated.')
                                            : t('Retry button not found.');
                                        await (interaction.channel as any).send(fallbackMessage).catch(logger.error);
                                    }
                                } else {
                                    throw interactionError;
                                }
                            }
                        }
                    } catch (errorPopupError: any) {
                        if (errorPopupError?.code === 10062 || errorPopupError?.code === 40060) {
                            logger.warn('[ErrorPopup] Interaction expired.');
                        } else {
                            logger.error('[ErrorPopup] Error handling error popup button:', errorPopupError);
                            try {
                                if (!(interaction as any).replied && !(interaction as any).deferred) {
                                    await interaction.reply({ content: t('An error occurred while processing the error popup action.'), flags: MessageFlags.Ephemeral });
                                } else {
                                    await interaction.followUp({ content: t('An error occurred while processing the error popup action.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                                }
                            } catch { /* ignore */ }
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
