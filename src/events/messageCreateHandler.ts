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
    ensureQuestionDetector as ensureQuestionDetectorFn,
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
import { ArtifactService } from '../services/artifactService';
import {
    cleanupInboundImageAttachments as cleanupInboundImageAttachmentsFn,
    downloadInboundImageAttachments as downloadInboundImageAttachmentsFn,
    InboundImageAttachment,
    isImageAttachment as isImageAttachmentFn,
} from '../utils/imageHandler';
import { listAccountNames, resolveScopedAccountName } from '../utils/accountUtils';
import { logger } from '../utils/logger';
import { HeartbeatService } from '../services/heartbeatService';
import { WorkspaceQueue } from '../bot/workspaceQueue';

/**
 * Dependencies injected into message create handler factory.
 */
export interface MessageCreateHandlerDeps {
    /** Configuration options including allowed user lists and timeout values. */
    config: { allowedUserIds: string[]; extractionMode?: import('../utils/config').ExtractionMode; responseTimeoutMs?: number };
    /** Active CDP bridge manager reference. */
    bridge: CdpBridge;
    /** Current ModeService instance. */
    modeService: ModeService;
    /** Current ModelService instance. */
    modelService: ModelService;
    /** Registered slash commands handler helper. */
    slashCommandHandler: SlashCommandHandler;
    /** Workspace binding and directory configurations handler. */
    wsHandler: WorkspaceCommandHandler;
    /** Sessions service interface. */
    chatSessionService: ChatSessionService;
    /** Sessions local repository store. */
    chatSessionRepo: ChatSessionRepository;
    /** Bound channels tracker manager. */
    channelManager: ChannelManager;
    /** Channel titles AI generator service. */
    titleGenerator: TitleGeneratorService;
    /** Optional Artifacts storage/retrieval service. */
    artifactService?: ArtifactService;
    /** Discord client reference. */
    client: any;
    /** Handler helper function sending prompts to the active Antigravity workspace. */
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
    /** Handler helper function running channel auto-rename routine. */
    autoRenameChannel: (
        message: Message,
        chatSessionRepo: ChatSessionRepository,
        titleGenerator: TitleGeneratorService,
        channelManager: ChannelManager,
        cdp?: CdpService,
    ) => Promise<void>;
    /** Handler helper function generating/sending workspace screenshots. */
    handleScreenshot: (target: Message, cdp: CdpService | null) => Promise<void>;
    /** Optional getter returning currently connected CdpService. */
    getCurrentCdp?: (bridge: CdpBridge) => CdpService | null;
    /** Optional listener registers for approvals detector. */
    ensureApprovalDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    /** Optional listener registers for error popup detector. */
    ensureErrorPopupDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    /** Optional listener registers for planning detector. */
    ensurePlanningDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    /** Optional listener registers for run commands detector. */
    ensureRunCommandDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string) => void;
    /** Optional listener registers for questions detector. */
    ensureQuestionDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string, accountName?: string) => void;
    /** Optional workspace approvals channel registrar callback. */
    registerApprovalWorkspaceChannel?: (bridge: CdpBridge, projectName: string, channel: PlatformChannel) => void;
    /** Optional session approvals channel registrar callback. */
    registerApprovalSessionChannel?: (bridge: CdpBridge, projectName: string, sessionTitle: string, channel: PlatformChannel) => void;
    /** Helper downloading image attachments to local disk temporarily. */
    downloadInboundImageAttachments?: (message: Message) => Promise<InboundImageAttachment[]>;
    /** Helper cleaning up temporarily downloaded images. */
    cleanupInboundImageAttachments?: (attachments: InboundImageAttachment[]) => Promise<void>;
    /** Helper validating if attachment mimetype corresponds to images. */
    isImageAttachment?: (contentType: string | null | undefined, fileName: string | null | undefined) => boolean;
    /** User preferences repository database accessor. */
    userPrefRepo?: UserPreferenceRepository;
    /** Account preferences repository database accessor. */
    accountPrefRepo?: AccountPreferenceRepository;
    /** Channel preferences repository database accessor. */
    channelPrefRepo?: ChannelPreferenceRepository;
    /** Mappings list of configured accounts. */
    antigravityAccounts?: { name: string; cdpPort: number }[];
    /** Heartbeat tracker service emitter. */
    heartbeatService?: HeartbeatService;
    /** Workspace execution request coordinator queue. */
    workspaceQueue?: WorkspaceQueue;
}

/**
 * Factory creating Discord event listener callback on new messages.
 * @param deps Injected dependencies.
 * @returns Event listener callback function.
 */
export function createMessageCreateHandler(deps: MessageCreateHandlerDeps) {
    const workspaceQueue = deps.workspaceQueue ?? new WorkspaceQueue();
    const getCurrentCdp = deps.getCurrentCdp ?? getCurrentCdpFn;
    const ensureApprovalDetector = deps.ensureApprovalDetector ?? ensureApprovalDetectorFn;
    const ensureErrorPopupDetector = deps.ensureErrorPopupDetector ?? ensureErrorPopupDetectorFn;
    const ensurePlanningDetector = deps.ensurePlanningDetector ?? ensurePlanningDetectorFn;
    const ensureRunCommandDetector = deps.ensureRunCommandDetector ?? ensureRunCommandDetectorFn;
    const ensureQuestionDetector = deps.ensureQuestionDetector ?? ensureQuestionDetectorFn;
    const registerApprovalWorkspaceChannel = deps.registerApprovalWorkspaceChannel ?? registerApprovalWorkspaceChannelFn;
    const registerApprovalSessionChannel = deps.registerApprovalSessionChannel ?? registerApprovalSessionChannelFn;
    const downloadInboundImageAttachments = deps.downloadInboundImageAttachments ?? downloadInboundImageAttachmentsFn;
    const cleanupInboundImageAttachments = deps.cleanupInboundImageAttachments ?? cleanupInboundImageAttachmentsFn;
    const isImageAttachment = deps.isImageAttachment ?? isImageAttachmentFn;
    const getParentChannelId = (message: Message): string | null => {
        const parentId = (message.channel as any)?.parentId;
        return typeof parentId === 'string' && parentId.length > 0 ? parentId : null;
    };

    const getAccountPort = (accountName: string): number | null => {
        const match = (deps.antigravityAccounts ?? []).find((account) => account.name === accountName);
        return match ? match.cdpPort : null;
    };
    const getSessionAccountName = (channelId: string): string | null =>
        deps.chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null;

    return async (message: Message): Promise<void> => {
        if (message.author.bot) return;

        if (!deps.config.allowedUserIds.includes(message.author.id)) {
            return;
        }

        if (deps.heartbeatService) {
            deps.heartbeatService.recordActivity();
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
                const session = deps.chatSessionRepo.findByChannelId(message.channelId);
                const currentAccount = resolveScopedAccountName({
                    channelId: message.channelId,
                    userId: message.author.id,
                    sessionAccountName: getSessionAccountName(message.channelId),
                    parentChannelId: getParentChannelId(message),
                    selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
                    channelPrefRepo: deps.channelPrefRepo,
                    accountPrefRepo: deps.accountPrefRepo,
                    accounts: deps.antigravityAccounts,
                });
                const conversationTitle = session?.displayName ?? '(New chat / no saved title)';

                const statusFields = [
                    { name: 'CDP Connection', value: activeNames.length > 0 ? `🟢 ${activeNames.length} project(s) connected` : '⚪ Disconnected', inline: true },
                    { name: 'Mode', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                    { name: 'Auto Approve', value: deps.bridge.autoAccept.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                    { name: 'Active Account', value: currentAccount, inline: true },
                    { name: 'Original Account', value: session?.originAccountName ?? '(unset)', inline: true },
                    { name: 'Conversation Title', value: conversationTitle, inline: false },
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
                    const current = resolveScopedAccountName({
                        channelId: message.channelId,
                        userId: message.author.id,
                        sessionAccountName: getSessionAccountName(message.channelId),
                        parentChannelId: getParentChannelId(message),
                        selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
                        channelPrefRepo: deps.channelPrefRepo,
                        accountPrefRepo: deps.accountPrefRepo,
                        accounts: deps.antigravityAccounts,
                    });
                    await message.reply(`Current account: **${current}**\nAvailable: ${accountNames.join(', ')}`).catch(() => {});
                    return;
                }

                if (!accountNames.includes(requested)) {
                    await message.reply(`⚠️ Unknown account: **${requested}**`).catch(() => {});
                    return;
                }

                deps.bridge.selectedAccountByChannel?.set(message.channelId, requested);
                const currentSession = deps.chatSessionRepo.findByChannelId(message.channelId);
                if (currentSession) {
                    deps.chatSessionRepo.setActiveAccountName(message.channelId, requested);
                } else {
                    deps.accountPrefRepo?.setAccountName(message.author.id, requested);
                    deps.channelPrefRepo?.setAccountName(message.channelId, requested);
                }

                const channelWorkspace = deps.wsHandler.getWorkspaceForChannel(message.channelId);

                logger.info(
                    `[AccountSwitch] source=text channel=${message.channelId} user=${message.author.id} ` +
                    `account=${requested} port=${getAccountPort(requested) ?? 'unknown'} ` +
                    `workspace=${channelWorkspace ?? 'unbound'}`,
                );

                await message.reply(`✅ Switched session account to **${requested}**.`).catch(() => {});
                return;
            }

            const slashOnlyCommands = ['help', 'stop', 'model', 'mode', 'project', 'chat', 'new', 'cleanup', 'join', 'mirror', 'output', 'heartbeat'];
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
                        artifactService: deps.artifactService,
                        extractionMode: deps.config.extractionMode,
                        responseTimeoutMs: deps.config.responseTimeoutMs,
                    });
                } else {
                    await message.reply('Not connected to CDP. Send a message first to connect to a project.');
                }
            }
            return;
        }

        const allAttachments = Array.from(message.attachments.values());
        const hasImageAttachments = allAttachments.some((attachment) => isImageAttachment(attachment.contentType, attachment.name));
        
        const MAX_TEXT_ATTACHMENT_SIZE = 50 * 1024; // 50KB
        const textAttachments = allAttachments.filter((a) => {
            if (isImageAttachment(a.contentType, a.name)) return false;
            if (a.size > MAX_TEXT_ATTACHMENT_SIZE) return false;
            const isTextType = a.contentType?.startsWith('text/') || a.contentType?.startsWith('application/json') || a.contentType?.startsWith('application/javascript');
            const hasTextExt = a.name?.match(/\.(txt|md|js|ts|py|json|html|css|csv|log|sh|yml|yaml|xml)$/i);
            return isTextType || hasTextExt;
        });

        if (message.content.trim() || hasImageAttachments || textAttachments.length > 0) {
            let promptText = message.content.trim() || 'Please review the attached content and respond accordingly.';

            // Prepend reply context if replying to a message
            if (message.reference && message.reference.messageId) {
                try {
                    const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
                    if (repliedTo) {
                        const cleanContent = (repliedTo.content || '(Attachment/Embed)').trim();
                        const truncated = cleanContent.length > 500 ? cleanContent.substring(0, 500) + '...' : cleanContent;
                        promptText = `[Replying to context: "${truncated}"]\n\n${promptText}`;
                    }
                } catch (e) {
                    logger.warn('[MessageCreate] Failed to fetch replied-to message context:', e);
                }
            }

            // Fetch and append text attachments in parallel with a small concurrency cap
            const CONCURRENCY_LIMIT = 3;
            for (let i = 0; i < textAttachments.length; i += CONCURRENCY_LIMIT) {
                const chunk = textAttachments.slice(i, i + CONCURRENCY_LIMIT);
                const results = await Promise.all(chunk.map(async (textAtt) => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 10000);
                        
                        const res = await fetch(textAtt.url, { signal: controller.signal as any });
                        clearTimeout(timeoutId);
                        
                        if (res.ok) {
                            const content = await res.text();
                            return `\n\n[Attached File: ${textAtt.name}]\n\`\`\`\n${content}\n\`\`\``;
                        } else {
                            logger.warn(`[MessageCreate] Non-ok status fetching text attachment ${textAtt.name}: ${res.status}`);
                            return '';
                        }
                    } catch (e) {
                        logger.warn(`[MessageCreate] Failed to fetch text attachment ${textAtt.name}:`, e);
                        return '';
                    }
                }));
                promptText += results.join('');
            }

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
                    const currentDepth = workspaceQueue.getDepth(workspacePath);
                    const newDepth = workspaceQueue.incrementDepth(workspacePath);

                    if (currentDepth > 0) {
                        logger.info(
                            `[Queue:${projectLabel}] Enqueued (depth: ${newDepth}, channel: ${message.channelId})`,
                        );
                        message.react('⏳').catch(() => { });
                    } else {
                        logger.info(
                            `[Queue:${projectLabel}] Processing immediately (depth: ${newDepth}, channel: ${message.channelId})`,
                        );
                    }

                    const queueStartTime = Date.now();
                    await workspaceQueue.enqueue(workspacePath, async () => {
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
                            const selectedAccount = resolveScopedAccountName({
                                channelId: message.channelId,
                                userId: message.author.id,
                                sessionAccountName: getSessionAccountName(message.channelId),
                                parentChannelId: getParentChannelId(message),
                                selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
                                channelPrefRepo: deps.channelPrefRepo,
                                accountPrefRepo: deps.accountPrefRepo,
                                accounts: deps.antigravityAccounts,
                            });
                            const selectedPort = getAccountPort(selectedAccount);
                            deps.bridge.selectedAccountByChannel?.set(message.channelId, selectedAccount);

                            logger.info(
                                `[Route] channel=${message.channelId} user=${message.author.id} ` +
                                `project=${projectLabel} account=${selectedAccount} ` +
                                `port=${selectedPort ?? 'unknown'} workspacePath=${workspacePath}`,
                            );

                            const previousPreferredAccount = deps.bridge.pool.getPreferredAccountForWorkspace?.(workspacePath) ?? null;
                            const cdp = await deps.bridge.pool.getOrConnect(workspacePath, { name: selectedAccount });
                            const projectName = deps.bridge.pool.extractProjectName(workspacePath);
                            deps.bridge.pool.setPreferredAccountForWorkspace?.(workspacePath, selectedAccount);

                            deps.bridge.lastActiveWorkspace = projectName;
                            const platformChannel = wrapDiscordChannel(message.channel as TextChannel);
                            deps.bridge.lastActiveChannel = platformChannel;
                            registerApprovalWorkspaceChannel(deps.bridge, projectName, platformChannel);

                            ensureApprovalDetector(deps.bridge, cdp, projectName, selectedAccount);
                            ensureErrorPopupDetector(deps.bridge, cdp, projectName, selectedAccount);
                            ensurePlanningDetector(deps.bridge, cdp, projectName, selectedAccount);
                            ensureRunCommandDetector(deps.bridge, cdp, projectName, selectedAccount);
                            ensureQuestionDetector(deps.bridge, cdp, projectName, selectedAccount);

                            let session = deps.chatSessionRepo.findByChannelId(message.channelId);
                            const staleSessionAccount = session?.isRenamed
                                && (
                                    (session.activeAccountName && session.activeAccountName !== selectedAccount)
                                    || (!session.activeAccountName && previousPreferredAccount && previousPreferredAccount !== selectedAccount)
                                );
                            if (session && staleSessionAccount) {
                                logger.info(
                                    `[SessionAccountReset] channel=${message.channelId} ` +
                                    `project=${projectName} oldAccount=${session.activeAccountName ?? previousPreferredAccount ?? 'unknown'} ` +
                                    `newAccount=${selectedAccount}`,
                                );
                                deps.chatSessionRepo.setActiveAccountName?.(message.channelId, selectedAccount);
                                session = deps.chatSessionRepo.findByChannelId(message.channelId);
                            }

                            if (session) {
                                deps.chatSessionRepo.setActiveAccountName?.(message.channelId, selectedAccount);
                                deps.chatSessionRepo.initializeOriginAccountName?.(message.channelId, selectedAccount);
                            }

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
                                                deps.chatSessionRepo.setActiveAccountName?.(message.channelId, selectedAccount);
                                                deps.chatSessionRepo.initializeOriginAccountName?.(message.channelId, selectedAccount);
                                                registerApprovalSessionChannel(deps.bridge, projectName, recoveredTitle, platformChannel);
                                            }
                                            activationResult = retryResult;
                                        }
                                    }

                                    if (!activationResult.ok) {
                                        const isDeleted = activationResult.error?.includes('Conversation not found in Past Conversations');
                                        let replyText = `⚠️ Could not route this message to the bound session (${session.displayName}).\n*Reason: ${activationResult.error}*`;
                                        
                                        if (isDeleted) {
                                            deps.chatSessionRepo.deleteByChannelId(message.channelId);
                                            replyText += `\n\n💡 **Tip**: This session appears to have been deleted in the IDE. I have unbound this channel so your next message will start a fresh chat. You can also type \`/new\` anytime.`;
                                        } else {
                                            replyText += `\n\n💡 If this session is broken, type \`/new\` to force a new chat.`;
                                        }

                                        await message.reply(replyText).catch(() => { });
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
                                    artifactService: deps.artifactService,
                                    extractionMode: deps.config.extractionMode,
                                    responseTimeoutMs: deps.config.responseTimeoutMs,
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
                            const remainingDepth = workspaceQueue.decrementDepth(workspacePath);
                            if (remainingDepth > 0) {
                                logger.info(
                                    `[Queue:${projectLabel}] Task done, ${remainingDepth} remaining`,
                                );
                            }
                        }
                    });
                } else {
                    await message.reply(
                        'No project is configured for this channel. Use `/project` to bind one, ' +
                        'or `/project reopen` if this is a previously used session.',
                    );
                }
            } finally {
                await cleanupInboundImageAttachments(inboundImages);
            }
        }
    };
}
