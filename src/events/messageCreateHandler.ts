import { EmbedBuilder, Message, TextChannel } from 'discord.js';

import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { UserPreferenceRepository } from '../database/userPreferenceRepository';
import { formatAsPlainText } from '../utils/plainTextFormatter';
import type { PlatformChannel } from '../platform/types';
import { wrapDiscordChannel } from '../platform/discord/wrappers';
import {
    CdpBridge,
    ensureApprovalDetector as ensureApprovalDetectorFn,
    ensureErrorPopupDetector as ensureErrorPopupDetectorFn,
    ensurePlanningDetector as ensurePlanningDetectorFn,
    ensureRunCommandDetector as ensureRunCommandDetectorFn,
    getCurrentCdp as getCurrentCdpFn,
    registerApprovalSessionChannel as registerApprovalSessionChannelFn,
    registerApprovalWorkspaceChannel as registerApprovalWorkspaceChannelFn,
} from '../services/cdpBridgeManager';
import { ChatSessionService } from '../services/chatSessionService';
import { CdpService } from '../services/cdpService';
import { ChannelManager } from '../services/channelManager';
import { MODE_DISPLAY_NAMES, ModeService } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TitleGeneratorService } from '../services/titleGeneratorService';
import {
    cleanupInboundImageAttachments as cleanupInboundImageAttachmentsFn,
    downloadInboundImageAttachments as downloadInboundImageAttachmentsFn,
    InboundImageAttachment,
    isImageAttachment as isImageAttachmentFn,
} from '../utils/imageHandler';
import { listAccountNames, resolveValidAccountName } from '../utils/accountUtils';
import { logger } from '../utils/logger';

export interface MessageCreateHandlerDeps {
    config: { allowedUserIds: string[]; extractionMode?: import('../utils/config').ExtractionMode };
    bridge: CdpBridge;
    modeService: ModeService;
    modelService: ModelService;
    slashCommandHandler: SlashCommandHandler;
    wsHandler: WorkspaceCommandHandler;
    chatSessionService: ChatSessionService;
    chatSessionRepo: ChatSessionRepository;
    channelManager: ChannelManager;
    titleGenerator: TitleGeneratorService;
    client: any;
    sendPromptToAntigravity: (
        bridge: CdpBridge,
        message: Message,
        prompt: string,
        cdp: CdpService,
        modeService: ModeService,
        modelService: ModelService,
        inboundImages?: InboundImageAttachment[],
        options?: any,
    ) => Promise<void>;
    autoRenameChannel: (
        message: Message,
        chatSessionRepo: ChatSessionRepository,
        titleGenerator: TitleGeneratorService,
        channelManager: ChannelManager,
        cdp?: CdpService,
    ) => Promise<void>;
    handleScreenshot: (target: Message, cdp: CdpService | null) => Promise<void>;
    getCurrentCdp?: (bridge: CdpBridge) => CdpService | null;
    ensureApprovalDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    ensureErrorPopupDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    ensurePlanningDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    ensureRunCommandDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    registerApprovalWorkspaceChannel?: (bridge: CdpBridge, projectName: string, channel: PlatformChannel) => void;
    registerApprovalSessionChannel?: (bridge: CdpBridge, projectName: string, sessionTitle: string, channel: PlatformChannel) => void;
    downloadInboundImageAttachments?: (message: Message) => Promise<InboundImageAttachment[]>;
    cleanupInboundImageAttachments?: (attachments: InboundImageAttachment[]) => Promise<void>;
    isImageAttachment?: (contentType: string | null | undefined, fileName: string | null | undefined) => boolean;
    userPrefRepo?: UserPreferenceRepository;
    accountPrefRepo?: AccountPreferenceRepository;
    channelPrefRepo?: ChannelPreferenceRepository;
    antigravityAccounts?: { name: string; cdpPort: number }[];
}

export function createMessageCreateHandler(deps: MessageCreateHandlerDeps) {
    const getCurrentCdp = deps.getCurrentCdp ?? getCurrentCdpFn;
    const ensureApprovalDetector = deps.ensureApprovalDetector ?? ensureApprovalDetectorFn;
    const ensureErrorPopupDetector = deps.ensureErrorPopupDetector ?? ensureErrorPopupDetectorFn;
    const ensurePlanningDetector = deps.ensurePlanningDetector ?? ensurePlanningDetectorFn;
    const ensureRunCommandDetector = deps.ensureRunCommandDetector ?? ensureRunCommandDetectorFn;
    const registerApprovalWorkspaceChannel = deps.registerApprovalWorkspaceChannel ?? registerApprovalWorkspaceChannelFn;
    const registerApprovalSessionChannel = deps.registerApprovalSessionChannel ?? registerApprovalSessionChannelFn;
    const downloadInboundImageAttachments = deps.downloadInboundImageAttachments ?? downloadInboundImageAttachmentsFn;
    const cleanupInboundImageAttachments = deps.cleanupInboundImageAttachments ?? cleanupInboundImageAttachmentsFn;
    const isImageAttachment = deps.isImageAttachment ?? isImageAttachmentFn;

    const getAccountPort = (accountName: string): number | null => {
        const match = (deps.antigravityAccounts ?? []).find((account) => account.name === accountName);
        return match ? match.cdpPort : null;
    };

    // Per-workspace prompt queue: serializes send→response cycles
    const workspaceQueues = new Map<string, Promise<void>>();
    const workspaceQueueDepths = new Map<string, number>();

    function enqueueForWorkspace(
        workspacePath: string,
        task: () => Promise<void>,
    ): Promise<void> {
        // .catch: ensure a prior rejection never stalls the chain
        const current = (workspaceQueues.get(workspacePath) ?? Promise.resolve()).catch(() => { });
        const next = current.then(async () => {
            try {
                await task();
            } catch (err: any) {
                logger.error('[WorkspaceQueue] task error:', err?.message || err);
            }
        });
        workspaceQueues.set(workspacePath, next);
        return next;
    }

    return async (message: Message): Promise<void> => {
        if (message.author.bot) return;

        if (!deps.config.allowedUserIds.includes(message.author.id)) {
            return;
        }

        const parsed = parseMessageContent(message.content);

        if (parsed.isCommand && parsed.commandName) {
            if (parsed.commandName === 'autoaccept') {
                const result = deps.bridge.autoAccept.handle(parsed.args?.[0]);
                await message.reply({ content: result.message }).catch(logger.error);
                return;
            }

            if (parsed.commandName === 'screenshot') {
                await deps.handleScreenshot(message, getCurrentCdp(deps.bridge));
                await message.reply({ content: '💡 You can also use the slash command `/screenshot`.' }).catch(() => { });
                return;
            }

            if (parsed.commandName === 'status') {
                const activeNames = deps.bridge.pool.getActiveWorkspaceNames();
                const currentMode = deps.modeService.getCurrentMode();

                const statusFields = [
                    { name: 'CDP Connection', value: activeNames.length > 0 ? `🟢 ${activeNames.length} project(s) connected` : '⚪ Disconnected', inline: true },
                    { name: 'Mode', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                    { name: 'Auto Approve', value: deps.bridge.autoAccept.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                    {
                        name: 'Account',
                        value: resolveValidAccountName(
                            deps.bridge.selectedAccountByChannel?.get(message.channelId)
                                ?? deps.channelPrefRepo?.getAccountName(message.channelId)
                                ?? deps.accountPrefRepo?.getAccountName(message.author.id)
                                ?? 'default',
                            deps.antigravityAccounts,
                        ),
                        inline: true,
                    },
                ];

                let statusDescription = '';
                if (activeNames.length > 0) {
                    const lines = activeNames.map((name) => {
                        const cdp = deps.bridge.pool.getConnected(name);
                        const contexts = cdp ? cdp.getContexts().length : 0;
                        const detectorActive = deps.bridge.pool.getApprovalDetector(name)?.isActive() ? ' [Detecting]' : '';
                        return `• **${name}** — Contexts: ${contexts}${detectorActive}`;
                    });
                    statusDescription = `**Connected Projects:**\n${lines.join('\n')}`;
                } else {
                    statusDescription = 'Send a message to auto-connect to a project.';
                }

                const statusOutputFormat = deps.userPrefRepo?.getOutputFormat(message.author.id) ?? 'embed';
                if (statusOutputFormat === 'plain') {
                    const chunks = formatAsPlainText({
                        title: '🔧 Bot Status',
                        description: statusDescription,
                        fields: statusFields,
                        footerText: 'Use the slash command /status for more detailed information',
                    });
                    await message.reply({ content: chunks[0] });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle('🔧 Bot Status')
                    .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                    .addFields(...statusFields)
                    .setDescription(statusDescription)
                    .setFooter({ text: '💡 Use the slash command /status for more detailed information' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                return;
            }

            if (parsed.commandName === 'account') {
                const accountNames = listAccountNames(deps.antigravityAccounts);
                const requested = parsed.args?.[0];

                if (!requested) {
                    const current = resolveValidAccountName(
                        deps.bridge.selectedAccountByChannel?.get(message.channelId)
                            ?? deps.channelPrefRepo?.getAccountName(message.channelId)
                            ?? deps.accountPrefRepo?.getAccountName(message.author.id)
                            ?? 'default',
                        deps.antigravityAccounts,
                    );
                    await message.reply(`Current account: **${current}**\nAvailable: ${accountNames.join(', ')}`).catch(() => {});
                    return;
                }

                if (!accountNames.includes(requested)) {
                    await message.reply(`⚠️ Unknown account: **${requested}**`).catch(() => {});
                    return;
                }

                deps.accountPrefRepo?.setAccountName(message.author.id, requested);
                deps.channelPrefRepo?.setAccountName(message.channelId, requested);
                deps.bridge.selectedAccountByChannel?.set(message.channelId, requested);

                const channelWorkspace = deps.wsHandler.getWorkspaceForChannel(message.channelId);
                if (channelWorkspace) {
                    deps.bridge.pool.setPreferredAccountForWorkspace?.(channelWorkspace, requested);
                }

                logger.info(
                    `[AccountSwitch] source=text channel=${message.channelId} user=${message.author.id} ` +
                    `account=${requested} port=${getAccountPort(requested) ?? 'unknown'} ` +
                    `workspace=${channelWorkspace ?? 'unbound'}`,
                );

                await message.reply(`✅ Switched account to **${requested}**.`).catch(() => {});
                return;
            }

            const slashOnlyCommands = ['help', 'stop', 'model', 'mode', 'project', 'chat', 'new', 'cleanup', 'join', 'mirror', 'output'];
            if (slashOnlyCommands.includes(parsed.commandName)) {
                await message.reply({
                    content: `💡 Please use \`/${parsed.commandName}\` as a slash command.\nType \`/${parsed.commandName}\` in the Discord input field to see suggestions.`,
                }).catch(logger.error);
                return;
            }

            const result = await deps.slashCommandHandler.handleCommand(parsed.commandName, parsed.args || []);

            await message.reply({
                content: result.message,
            }).catch(logger.error);

            if (result.prompt) {
                const cdp = getCurrentCdp(deps.bridge);
                if (cdp) {
                    await deps.sendPromptToAntigravity(deps.bridge, message, result.prompt, cdp, deps.modeService, deps.modelService, [], {
                        chatSessionService: deps.chatSessionService,
                        chatSessionRepo: deps.chatSessionRepo,
                        channelManager: deps.channelManager,
                        titleGenerator: deps.titleGenerator,
                        userPrefRepo: deps.userPrefRepo,
                        extractionMode: deps.config.extractionMode,
                    });
                } else {
                    await message.reply('Not connected to CDP. Send a message first to connect to a project.');
                }
            }
            return;
        }

        const hasImageAttachments = Array.from(message.attachments.values())
            .some((attachment) => isImageAttachment(attachment.contentType, attachment.name));
        if (message.content.trim() || hasImageAttachments) {
            const promptText = message.content.trim() || 'Please review the attached images and respond accordingly.';
            const inboundImages = await downloadInboundImageAttachments(message);

            if (hasImageAttachments && inboundImages.length === 0) {
                await message.reply('Failed to retrieve attached images. Please wait and try again.').catch(() => { });
                return;
            }

            const workspacePath = deps.wsHandler.getWorkspaceForChannel(message.channelId);

            try {
                if (workspacePath) {
                    const projectLabel = deps.bridge.pool.extractProjectName(workspacePath);

                    // Track queue depth for hourglass reactions
                    const currentDepth = workspaceQueueDepths.get(workspacePath) ?? 0;
                    workspaceQueueDepths.set(workspacePath, currentDepth + 1);
                    const newDepth = currentDepth + 1;

                    if (currentDepth > 0) {
                        logger.info(
                            `[Queue:${projectLabel}] Enqueued (depth: ${newDepth}, channel: ${message.channelId})`,
                        );
                        await message.react('⏳').catch(() => { });
                    } else {
                        logger.info(
                            `[Queue:${projectLabel}] Processing immediately (depth: ${newDepth}, channel: ${message.channelId})`,
                        );
                    }

                    const queueStartTime = Date.now();
                    await enqueueForWorkspace(workspacePath, async () => {
                        const waitMs = Date.now() - queueStartTime;
                        if (waitMs > 100) {
                            logger.info(
                                `[Queue:${projectLabel}] Task started after ${Math.round(waitMs / 1000)}s wait (channel: ${message.channelId})`,
                            );
                        }

                        // Remove hourglass when task starts processing
                        const botId = message.client.user?.id;
                        if (botId) {
                            await message.reactions.resolve('⏳')?.users.remove(botId).catch(() => { });
                        }

                        try {
                            const selectedAccount = resolveValidAccountName(
                                deps.bridge.selectedAccountByChannel?.get(message.channelId)
                                    ?? deps.channelPrefRepo?.getAccountName(message.channelId)
                                    ?? deps.accountPrefRepo?.getAccountName(message.author.id)
                                    ?? 'default',
                                deps.antigravityAccounts,
                            );
                            const selectedPort = getAccountPort(selectedAccount);
                            deps.bridge.selectedAccountByChannel?.set(message.channelId, selectedAccount);
                            deps.bridge.pool.setPreferredAccountForWorkspace?.(workspacePath, selectedAccount);

                            logger.info(
                                `[Route] channel=${message.channelId} user=${message.author.id} ` +
                                `project=${projectLabel} account=${selectedAccount} ` +
                                `port=${selectedPort ?? 'unknown'} workspacePath=${workspacePath}`,
                            );

                            const cdp = await deps.bridge.pool.getOrConnect(workspacePath, { name: selectedAccount });
                            const projectName = deps.bridge.pool.extractProjectName(workspacePath);

                            deps.bridge.lastActiveWorkspace = projectName;
                            const platformChannel = wrapDiscordChannel(message.channel as TextChannel);
                            deps.bridge.lastActiveChannel = platformChannel;
                            registerApprovalWorkspaceChannel(deps.bridge, projectName, platformChannel);

                            ensureApprovalDetector(deps.bridge, cdp, projectName);
                            ensureErrorPopupDetector(deps.bridge, cdp, projectName);
                            ensurePlanningDetector(deps.bridge, cdp, projectName);
                            ensureRunCommandDetector(deps.bridge, cdp, projectName);

                            const session = deps.chatSessionRepo.findByChannelId(message.channelId);
                            if (session?.displayName) {
                                registerApprovalSessionChannel(deps.bridge, projectName, session.displayName, platformChannel);
                            }

                            if (session?.isRenamed && session.displayName) {
                                let activationResult = await deps.chatSessionService.activateSessionByTitle(cdp, session.displayName);
                                if (!activationResult.ok) {
                                    // Recovery: Antigravity may have renamed the session.
                                    // Check if the currently active chat is the renamed version.
                                    const currentInfo = await deps.chatSessionService.getCurrentSessionInfo(cdp);
                                    const isRecoverable = currentInfo.hasActiveChat
                                        && currentInfo.title.trim() !== ''
                                        && currentInfo.title !== session.displayName;

                                    if (isRecoverable) {
                                        const siblings = deps.chatSessionRepo.findByCategoryId(session.categoryId);
                                        const ownedByOther = siblings.some(
                                            (s) => s.channelId !== message.channelId
                                                && s.displayName === currentInfo.title,
                                        );

                                        if (!ownedByOther) {
                                            const recoveredTitle = currentInfo.title;
                                            const retryResult = await deps.chatSessionService.activateSessionByTitle(cdp, recoveredTitle);
                                            if (retryResult.ok) {
                                                logger.info(
                                                    `[SessionRecovery] Adopting renamed title: ` +
                                                    `"${session.displayName}" -> "${recoveredTitle}" ` +
                                                    `(channel: ${message.channelId})`,
                                                );
                                                deps.chatSessionRepo.updateDisplayName(message.channelId, recoveredTitle);
                                                registerApprovalSessionChannel(deps.bridge, projectName, recoveredTitle, platformChannel);
                                            }
                                            activationResult = retryResult;
                                        }
                                    }

                                    if (!activationResult.ok) {
                                        const reason = activationResult.error ? ` (${activationResult.error})` : '';
                                        await message.reply(
                                            `⚠️ Could not route this message to the bound session (${session.displayName}). ` +
                                            `Please open /chat and verify the session${reason}.`,
                                        ).catch(() => { });
                                        return;
                                    }
                                }
                            } else if (session && !session.isRenamed) {
                                try {
                                    const chatResult = await deps.chatSessionService.startNewChat(cdp);
                                    if (!chatResult.ok) {
                                        logger.warn('[MessageCreate] Failed to start new chat in Antigravity:', chatResult.error);
                                        (message.channel as any).send(`⚠️ Could not open a new chat in Antigravity. Sending to existing chat.`).catch(() => { });
                                    }
                                } catch (err) {
                                    logger.error('[MessageCreate] startNewChat error:', err);
                                    (message.channel as any).send(`⚠️ Could not open a new chat in Antigravity. Sending to existing chat.`).catch(() => { });
                                }
                            }

                            await deps.autoRenameChannel(message, deps.chatSessionRepo, deps.titleGenerator, deps.channelManager, cdp);

                            // Re-register session channel after autoRenameChannel sets displayName
                            const updatedSession = deps.chatSessionRepo.findByChannelId(message.channelId);
                            if (updatedSession?.displayName) {
                                registerApprovalSessionChannel(deps.bridge, projectName, updatedSession.displayName, platformChannel);
                            }

                            // Register echo hash so UserMessageDetector skips this message
                            const userMsgDetector = deps.bridge.pool.getUserMessageDetector?.(projectName);
                            if (userMsgDetector) {
                                userMsgDetector.addEchoHash(promptText);
                            }

                            // Wait for full response cycle (onComplete/onTimeout) before releasing the queue.
                            // Safety timeout (360s) prevents permanent queue deadlock if onFullCompletion
                            // is never called due to a bug.
                            const QUEUE_SAFETY_TIMEOUT_MS = 360_000;
                            const promptStartTime = Date.now();
                            await new Promise<void>((resolve) => {
                                const safetyTimer = setTimeout(() => {
                                    logger.warn(
                                        `[Queue:${projectName}] Safety timeout — releasing queue after 360s ` +
                                        `(channel: ${message.channelId})`,
                                    );
                                    resolve();
                                }, QUEUE_SAFETY_TIMEOUT_MS);
                                let settled = false;
                                const settle = () => {
                                    if (settled) return;
                                    settled = true;
                                    clearTimeout(safetyTimer);
                                    const elapsed = Math.round((Date.now() - promptStartTime) / 1000);
                                    logger.info(
                                        `[Queue:${projectName}] Prompt completed in ${elapsed}s ` +
                                        `(channel: ${message.channelId})`,
                                    );
                                    resolve();
                                };
                                deps.sendPromptToAntigravity(deps.bridge, message, promptText, cdp, deps.modeService, deps.modelService, inboundImages, {
                                    chatSessionService: deps.chatSessionService,
                                    chatSessionRepo: deps.chatSessionRepo,
                                    channelManager: deps.channelManager,
                                    titleGenerator: deps.titleGenerator,
                                    userPrefRepo: deps.userPrefRepo,
                                    extractionMode: deps.config.extractionMode,
                                    onFullCompletion: settle,
                                }).catch((err: any) => {
                                    // sendPromptToAntigravity rejected before onFullCompletion fired
                                    // (e.g. setup code threw before top-level try/catch).
                                    // Release the queue immediately instead of waiting for safety timeout.
                                    logger.error(
                                        `[Queue:${projectName}] sendPromptToAntigravity rejected early ` +
                                        `(channel: ${message.channelId}):`, err?.message || err,
                                    );
                                    settle();
                                });
                            });
                        } catch (e: any) {
                            logger.error(
                                `[Queue:${projectLabel}] Task failed (channel: ${message.channelId}):`,
                                e.message,
                            );
                            await message.reply(`Failed to connect to workspace: ${e.message}`);
                        } finally {
                            const remainingDepth = (workspaceQueueDepths.get(workspacePath) ?? 1) - 1;
                            workspaceQueueDepths.set(workspacePath, remainingDepth);
                            if (remainingDepth > 0) {
                                logger.info(
                                    `[Queue:${projectLabel}] Task done, ${remainingDepth} remaining`,
                                );
                            }
                        }
                    });
                } else {
                    await message.reply('No project is configured for this channel. Please create or select one with `/project`.');
                }
            } finally {
                await cleanupInboundImageAttachments(inboundImages);
            }
        }
    };
}
