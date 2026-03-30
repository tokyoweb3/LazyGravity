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
import { disableAllButtons } from '../utils/discordButtonUtils';
import { TEMPLATE_BTN_PREFIX, parseTemplateButtonId } from '../ui/templateUi';
import {
    AUTOACCEPT_BTN_OFF,
    AUTOACCEPT_BTN_ON,
    AUTOACCEPT_BTN_REFRESH,
} from '../ui/autoAcceptUi';
import {
    OUTPUT_BTN_EMBED,
    OUTPUT_BTN_PLAIN,
    sendOutputUI,
} from '../ui/outputUi';
import { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import { UserPreferenceRepository, OutputFormat } from '../database/userPreferenceRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
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
import { ChatSessionService } from '../services/chatSessionService';
import { JoinCommandHandler } from '../commands/joinCommandHandler';
import { isSessionSelectId } from '../ui/sessionPickerUi';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import { inferParentScopeChannelId, listAccountNames, resolveScopedAccountName } from '../utils/accountUtils';
import { ACCOUNT_SELECT_ID, sendAccountUI } from '../ui/accountUi';

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
    sendModeUI: (target: { editReply: (opts: any) => Promise<any> }, modeService: ModeService, deps?: import('../ui/modeUi').ModeUiDeps) => Promise<void>;
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
    parseApprovalCustomId: (customId: string) => { action: 'approve' | 'always_allow' | 'deny'; projectName: string | null; channelId: string | null } | null;
    parsePlanningCustomId: (customId: string) => { action: 'open' | 'proceed'; projectName: string | null; channelId: string | null } | null;
    parseErrorPopupCustomId: (customId: string) => { action: 'dismiss' | 'copy_debug' | 'retry'; projectName: string | null; channelId: string | null } | null;
    parseRunCommandCustomId: (customId: string) => { action: 'run' | 'reject'; projectName: string | null; channelId: string | null } | null;
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
        accountPrefRepo?: AccountPreferenceRepository,
        channelPrefRepo?: ChannelPreferenceRepository,
        antigravityAccounts?: AntigravityAccountConfig[],
        chatSessionRepo?: ChatSessionRepository,
    ) => Promise<void>;
    handleTemplateUse?: (interaction: ButtonInteraction, templateId: number) => Promise<void>;
    joinHandler?: JoinCommandHandler;
    userPrefRepo?: UserPreferenceRepository;
    accountPrefRepo?: AccountPreferenceRepository;
    channelPrefRepo?: ChannelPreferenceRepository;
    antigravityAccounts?: AntigravityAccountConfig[];
    chatSessionRepo?: ChatSessionRepository;
    chatSessionService?: ChatSessionService;
}

export function createInteractionCreateHandler(deps: InteractionCreateHandlerDeps) {
    const getParentChannelId = (interaction: Interaction): string | null =>
        inferParentScopeChannelId(
            (interaction as any).channelId,
            (interaction as any).channel?.parentId ?? null,
        );
    const getSessionAccountName = (channelId: string): string | null =>
        deps.chatSessionRepo?.findByChannelId(channelId)?.activeAccountName ?? null;
    const resolveSelectedAccount = (channelId: string, userId: string, parentChannelId?: string | null): string =>
        resolveScopedAccountName({
            channelId,
            userId,
            sessionAccountName: getSessionAccountName(channelId),
            parentChannelId,
            selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
            channelPrefRepo: deps.channelPrefRepo,
            accountPrefRepo: deps.accountPrefRepo,
            accounts: deps.antigravityAccounts,
        });
    const getChannelCdp = (channelId: string, userId: string): CdpService | null =>
        (() => {
            const workspacePath = deps.wsHandler.getWorkspaceForChannel(channelId);
            if (workspacePath) {
                const projectName = deps.bridge.pool.extractProjectName(workspacePath);
                return deps.bridge.pool.getConnected(
                    projectName,
                    resolveSelectedAccount(channelId, userId),
                );
            }

            return deps.bridge.lastActiveWorkspace
                ? deps.bridge.pool.getConnected(
                    deps.bridge.lastActiveWorkspace,
                    resolveSelectedAccount(channelId, userId),
                )
                : null;
        })();
    const ensureBoundSessionActive = async (
        channelId: string,
        userId: string,
        cdp: CdpService,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
        const savedTitle = deps.chatSessionRepo?.findByChannelId(channelId)?.displayName?.trim() || '';
        if (!savedTitle || savedTitle === t('(Untitled)') || !deps.chatSessionService) {
            return { ok: true };
        }

        const current = await deps.chatSessionService.getCurrentSessionInfo(cdp);
        if (current.title.trim() === savedTitle) {
            return { ok: true };
        }

        logger.info(
            `[ModelCommand] source=button channel=${channelId} user=${userId} ` +
            `restoringSession target="${savedTitle}" current="${current.title.trim() || '(unknown)'}"`,
        );
        const activation = await deps.chatSessionService.activateSessionByTitle(cdp, savedTitle, {
            maxWaitMs: 8000,
            retryIntervalMs: 300,
            allowVisibilityWarmupMs: 1000,
        });
        if (!activation.ok) {
            return {
                ok: false,
                error: `Failed to activate saved session "${savedTitle}" before model action: ${activation.error || 'unknown'}`,
            };
        }

        const refresh = await deps.chatSessionService.refreshSessionViewIfStuck(cdp, savedTitle);
        if (!refresh.ok) {
            logger.warn(
                `[ModelCommand] source=button channel=${channelId} user=${userId} ` +
                `sessionRefreshWarning target="${savedTitle}" error="${refresh.error || 'unknown'}"`,
            );
        }
        return { ok: true };
    };

    return async (interaction: Interaction): Promise<void> => {
        if (interaction.isAutocomplete()) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.respond([]).catch(logger.error);
                return;
            }

            try {
                if (interaction.commandName === 'project') {
                    const subcommand = interaction.options.getSubcommand(false);
                    const focused = interaction.options.getFocused(true);

                    if (subcommand === 'account' && focused.name === 'name') {
                        const names = listAccountNames(deps.antigravityAccounts);
                        const currentAccount = resolveSelectedAccount(
                            interaction.channelId,
                            interaction.user.id,
                            getParentChannelId(interaction),
                        );
                        const needle = String(focused.value || '').trim().toLowerCase();
                        const choices = names
                            .filter((name) => !needle || name.toLowerCase().includes(needle))
                            .slice(0, 25)
                            .map((name) => ({
                                name: name === currentAccount ? `${name} (current)` : name,
                                value: name,
                            }));

                        await interaction.respond(choices);
                        return;
                    }
                }
            } catch (error) {
                logger.error('Autocomplete handling error:', error);
            }

            await interaction.respond([]).catch(logger.error);
            return;
        }

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

                    const projectName = approvalAction.projectName ?? deps.bridge.lastActiveWorkspace;
                    const detector = projectName
                        ? deps.bridge.pool.getApprovalDetector(
                            projectName,
                            resolveSelectedAccount(
                                interaction.channelId,
                                interaction.user.id,
                                getParentChannelId(interaction),
                            ),
                        )
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

                    const planWorkspaceDirName = planningAction.projectName ?? deps.bridge.lastActiveWorkspace;
                    const planDetector = planWorkspaceDirName
                        ? deps.bridge.pool.getPlanningDetector(
                            planWorkspaceDirName,
                            resolveSelectedAccount(
                                interaction.channelId,
                                interaction.user.id,
                                getParentChannelId(interaction),
                            ),
                        )
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

                    const errorWorkspaceDirName = errorPopupAction.projectName ?? deps.bridge.lastActiveWorkspace;
                    const errorDetector = errorWorkspaceDirName
                        ? deps.bridge.pool.getErrorPopupDetector(
                            errorWorkspaceDirName,
                            resolveSelectedAccount(interaction.channelId, interaction.user.id, getParentChannelId(interaction)),
                        )
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

                const runCommandAction = deps.parseRunCommandCustomId(interaction.customId);
                if (runCommandAction) {
                    if (runCommandAction.channelId && runCommandAction.channelId !== interaction.channelId) {
                        await interaction.reply({
                            content: t('This run command action is linked to a different session channel.'),
                            flags: MessageFlags.Ephemeral,
                        }).catch(logger.error);
                        return;
                    }

                    const runCmdWorkspace = runCommandAction.projectName ?? deps.bridge.lastActiveWorkspace;
                    const runCmdDetector = runCmdWorkspace
                        ? deps.bridge.pool.getRunCommandDetector(
                            runCmdWorkspace,
                            resolveSelectedAccount(interaction.channelId, interaction.user.id, getParentChannelId(interaction)),
                        )
                        : undefined;

                    if (!runCmdDetector) {
                        try {
                            await interaction.reply({ content: t('Run command detector not found.'), flags: MessageFlags.Ephemeral });
                        } catch { /* ignore */ }
                        return;
                    }

                    let success = false;
                    let actionLabel = '';
                    if (runCommandAction.action === 'run') {
                        success = await runCmdDetector.runButton();
                        actionLabel = t('Run');
                    } else {
                        success = await runCmdDetector.rejectButton();
                        actionLabel = t('Reject');
                    }

                    try {
                        if (success) {
                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('Run Command');
                            const historyText = `${actionLabel} by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(runCommandAction.action === 'reject' ? 0xE74C3C : 0x2ECC71)
                                .addFields({ name: 'Action History', value: historyText, inline: false })
                                .setTimestamp();

                            await interaction.update({
                                embeds: [updatedEmbed],
                                components: disableAllButtons(interaction.message.components),
                            });
                        } else {
                            await interaction.reply({ content: t('Run command button not found.'), flags: MessageFlags.Ephemeral });
                        }
                    } catch (interactionError: any) {
                        if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                            logger.warn('[RunCommand] Interaction expired. Responding directly in the channel.');
                            if (interaction.channel && 'send' in interaction.channel) {
                                const fallbackMessage = success
                                    ? `${actionLabel} completed.`
                                    : t('Run command button not found.');
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

                if (interaction.customId === 'model_set_default_btn') {
                    await interaction.deferUpdate();
                    const cdp = getChannelCdp(interaction.channelId, interaction.user.id);
                    if (!cdp) {
                        await interaction.followUp({ content: 'Not connected to CDP.', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const sessionReady = await ensureBoundSessionActive(interaction.channelId, interaction.user.id, cdp);
                    if (!sessionReady.ok) {
                        await interaction.followUp({ content: sessionReady.error, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const currentModel = await cdp.getCurrentModel();
                    if (!currentModel) {
                        await interaction.followUp({ content: 'No current model detected.', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    deps.modelService.setDefaultModel(currentModel);
                    if (deps.userPrefRepo) {
                        deps.userPrefRepo.setDefaultModel(interaction.user.id, currentModel);
                    }
                    await deps.sendModelsUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        {
                            getCurrentCdp: () => getChannelCdp(interaction.channelId, interaction.user.id),
                            fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                        },
                    );
                    await interaction.followUp({ content: `Default model set to **${currentModel}**.`, flags: MessageFlags.Ephemeral });
                    return;
                }

                if (interaction.customId === 'model_clear_default_btn') {
                    await interaction.deferUpdate();
                    const cdp = getChannelCdp(interaction.channelId, interaction.user.id);
                    if (cdp) {
                        const sessionReady = await ensureBoundSessionActive(interaction.channelId, interaction.user.id, cdp);
                        if (!sessionReady.ok) {
                            await interaction.followUp({ content: sessionReady.error, flags: MessageFlags.Ephemeral });
                            return;
                        }
                    }
                    deps.modelService.setDefaultModel(null);
                    if (deps.userPrefRepo) {
                        deps.userPrefRepo.setDefaultModel(interaction.user.id, null);
                    }
                    await deps.sendModelsUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        {
                            getCurrentCdp: () => getChannelCdp(interaction.channelId, interaction.user.id),
                            fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                        },
                    );
                    await interaction.followUp({ content: 'Default model cleared.', flags: MessageFlags.Ephemeral });
                    return;
                }

                if (interaction.customId === 'model_refresh_btn') {
                    await interaction.deferUpdate();
                    const cdp = getChannelCdp(interaction.channelId, interaction.user.id);
                    if (cdp) {
                        const sessionReady = await ensureBoundSessionActive(interaction.channelId, interaction.user.id, cdp);
                        if (!sessionReady.ok) {
                            await interaction.followUp({ content: sessionReady.error, flags: MessageFlags.Ephemeral });
                            return;
                        }
                    }
                    await deps.sendModelsUI(
                        { editReply: async (data: any) => await interaction.editReply(data) },
                        {
                            getCurrentCdp: () => getChannelCdp(interaction.channelId, interaction.user.id),
                            fetchQuota: async () => deps.bridge.quota.fetchQuota(),
                        },
                    );
                    return;
                }

                if (interaction.customId.startsWith('model_btn_')) {
                    await interaction.deferUpdate();

                    const modelName = interaction.customId.replace('model_btn_', '');
                    const cdp = getChannelCdp(interaction.channelId, interaction.user.id);

                    if (!cdp) {
                        await interaction.followUp({ content: 'Not connected to CDP.', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const sessionReady = await ensureBoundSessionActive(interaction.channelId, interaction.user.id, cdp);
                    if (!sessionReady.ok) {
                        await interaction.followUp({ content: sessionReady.error, flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const res = await cdp.setUiModel(modelName);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || 'Failed to change model.', flags: MessageFlags.Ephemeral });
                    } else {
                        await deps.sendModelsUI(
                            { editReply: async (data: any) => await interaction.editReply(data) },
                            {
                                getCurrentCdp: () => getChannelCdp(interaction.channelId, interaction.user.id),
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

                if (interaction.customId === OUTPUT_BTN_EMBED || interaction.customId === OUTPUT_BTN_PLAIN) {
                    if (deps.userPrefRepo) {
                        await interaction.deferUpdate();

                        const format: OutputFormat = interaction.customId === OUTPUT_BTN_PLAIN ? 'plain' : 'embed';
                        deps.userPrefRepo.setOutputFormat(interaction.user.id, format);

                        await sendOutputUI(
                            { editReply: async (data: any) => await interaction.editReply(data) },
                            format,
                        );

                        const label = format === 'plain' ? 'Plain Text' : 'Embed';
                        await interaction.followUp({
                            content: `Output format changed to **${label}**.`,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
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

                const cdp = getChannelCdp(interaction.channelId, interaction.user.id);
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

        if (interaction.isStringSelectMenu() && interaction.customId === ACCOUNT_SELECT_ID) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await interaction.deferUpdate();
            } catch (deferError: any) {
                if (deferError?.code === 10062 || deferError?.code === 40060) {
                    logger.warn('[Account] deferUpdate expired. Skipping.');
                    return;
                }
                logger.error('[Account] deferUpdate failed:', deferError);
                return;
            }

            try {
                if (!deps.accountPrefRepo) {
                    await interaction.followUp({
                        content: 'Account preference service not available.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(logger.error);
                    return;
                }

                const selectedAccount = interaction.values[0];
                const names = listAccountNames(deps.antigravityAccounts);

                if (!selectedAccount || !names.includes(selectedAccount)) {
                    await interaction.followUp({
                        content: `⚠️ Unknown account: **${selectedAccount || 'N/A'}**`,
                        flags: MessageFlags.Ephemeral,
                    }).catch(logger.error);
                    return;
                }

                deps.bridge.selectedAccountByChannel?.set(interaction.channelId, selectedAccount);
                const currentSession = deps.chatSessionRepo?.findByChannelId(interaction.channelId);
                if (currentSession) {
                    deps.chatSessionRepo?.setActiveAccountName(interaction.channelId, selectedAccount);
                } else {
                    deps.accountPrefRepo.setAccountName(interaction.user.id, selectedAccount);
                    deps.channelPrefRepo?.setAccountName(interaction.channelId, selectedAccount);
                }

                const channelWorkspace = deps.wsHandler.getWorkspaceForChannel(interaction.channelId);

                const selectedPort = deps.antigravityAccounts?.find((a) => a.name === selectedAccount)?.cdpPort;
                logger.info(
                    `[AccountSwitch] source=select channel=${interaction.channelId} user=${interaction.user.id} ` +
                    `account=${selectedAccount} port=${selectedPort ?? 'unknown'} ` +
                    `workspace=${channelWorkspace ?? 'unbound'}`,
                );

                await sendAccountUI(
                    { editReply: async (data: any) => await interaction.editReply(data) },
                    selectedAccount,
                    names,
                );

                await interaction.followUp({
                    content: `✅ Switched session account to **${selectedAccount}**.`,
                    flags: MessageFlags.Ephemeral,
                }).catch(logger.error);
            } catch (error: any) {
                logger.error('Error during account dropdown handling:', error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({
                            content: 'An error occurred while switching account.',
                            flags: MessageFlags.Ephemeral,
                        }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('Failed to send error message:', e);
                }
            }
            return;
        }

        if (interaction.isStringSelectMenu() && isSessionSelectId(interaction.customId)) {
            if (!deps.config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await interaction.deferUpdate();
            } catch (deferError: any) {
                if (deferError?.code === 10062 || deferError?.code === 40060) {
                    logger.warn('[SessionSelect] deferUpdate expired. Skipping.');
                    return;
                }
                logger.error('[SessionSelect] deferUpdate failed:', deferError);
                return;
            }

            try {
                if (deps.joinHandler) {
                    await deps.joinHandler.handleJoinSelect(interaction, deps.bridge);
                }
            } catch (error) {
                logger.error('Session selection error:', error);
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
                await interaction.deferUpdate();
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
            if (commandInteraction.commandName === 'logs') {
                await commandInteraction.deferReply({ flags: MessageFlags.Ephemeral });
            } else {
                await commandInteraction.deferReply();
            }
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
                deps.accountPrefRepo,
                deps.channelPrefRepo,
                deps.antigravityAccounts,
                deps.chatSessionRepo,
            );
        } catch (error) {
            logger.error(
                `[SlashCommand] command=${commandInteraction.commandName} channel=${commandInteraction.channelId} ` +
                `user=${commandInteraction.user.id} failed:`,
                error,
            );
            try {
                await commandInteraction.editReply({ content: 'An error occurred while processing the command.' });
            } catch (replyError) {
                logger.error('Failed to send error response:', replyError);
            }
        }
    };
}
