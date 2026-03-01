import { EmbedBuilder, Message } from 'discord.js';

import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { UserPreferenceRepository } from '../database/userPreferenceRepository';
import { formatAsPlainText } from '../utils/plainTextFormatter';
import {
    CdpBridge,
    ensureApprovalDetector as ensureApprovalDetectorFn,
    ensureErrorPopupDetector as ensureErrorPopupDetectorFn,
    ensurePlanningDetector as ensurePlanningDetectorFn,
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
import { logger } from '../utils/logger';

export interface MessageCreateHandlerDeps {
    config: { allowedUserIds: string[] };
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
    ensureApprovalDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string, client: any) => void;
    ensureErrorPopupDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string, client: any) => void;
    ensurePlanningDetector?: (bridge: CdpBridge, cdp: CdpService, projectName: string, client: any) => void;
    registerApprovalWorkspaceChannel?: (bridge: CdpBridge, projectName: string, channel: Message['channel']) => void;
    registerApprovalSessionChannel?: (bridge: CdpBridge, projectName: string, sessionTitle: string, channel: Message['channel'], oldSessionTitle?: string) => void;
    downloadInboundImageAttachments?: (message: Message) => Promise<InboundImageAttachment[]>;
    cleanupInboundImageAttachments?: (attachments: InboundImageAttachment[]) => Promise<void>;
    isImageAttachment?: (contentType: string | null | undefined, fileName: string | null | undefined) => boolean;
    userPrefRepo?: UserPreferenceRepository;
}

export function createMessageCreateHandler(deps: MessageCreateHandlerDeps) {
    const getCurrentCdp = deps.getCurrentCdp ?? getCurrentCdpFn;
    const ensureApprovalDetector = deps.ensureApprovalDetector ?? ensureApprovalDetectorFn;
    const ensureErrorPopupDetector = deps.ensureErrorPopupDetector ?? ensureErrorPopupDetectorFn;
    const ensurePlanningDetector = deps.ensurePlanningDetector ?? ensurePlanningDetectorFn;
    const registerApprovalWorkspaceChannel = deps.registerApprovalWorkspaceChannel ?? registerApprovalWorkspaceChannelFn;
    const registerApprovalSessionChannel = deps.registerApprovalSessionChannel ?? registerApprovalSessionChannelFn;
    const downloadInboundImageAttachments = deps.downloadInboundImageAttachments ?? downloadInboundImageAttachmentsFn;
    const cleanupInboundImageAttachments = deps.cleanupInboundImageAttachments ?? cleanupInboundImageAttachmentsFn;
    const isImageAttachment = deps.isImageAttachment ?? isImageAttachmentFn;

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
                    try {
                        const cdp = await deps.bridge.pool.getOrConnect(workspacePath);
                        const projectName = deps.bridge.pool.extractProjectName(workspacePath);

                        deps.bridge.lastActiveWorkspace = projectName;
                        deps.bridge.lastActiveChannel = message.channel;
                        registerApprovalWorkspaceChannel(deps.bridge, projectName, message.channel);

                        ensureApprovalDetector(deps.bridge, cdp, projectName, deps.client);
                        ensureErrorPopupDetector(deps.bridge, cdp, projectName, deps.client);
                        ensurePlanningDetector(deps.bridge, cdp, projectName, deps.client);

                        const session = deps.chatSessionRepo.findByChannelId(message.channelId);
                        if (session?.displayName) {
                            registerApprovalSessionChannel(deps.bridge, projectName, session.displayName, message.channel);
                        }

                        if (session?.isRenamed && session.displayName) {
                            const activationResult = await deps.chatSessionService.activateSessionByTitle(cdp, session.displayName);
                            if (!activationResult.ok) {
                                // Attempt recovery: the session may have been renamed by Antigravity
                                const currentInfo = await deps.chatSessionService.getCurrentSessionInfo(cdp);
                                const isRecoverable = currentInfo.hasActiveChat
                                    && currentInfo.title.trim() !== ''
                                    && currentInfo.title !== '(Untitled)'
                                    && currentInfo.title !== session.displayName;

                                if (isRecoverable) {
                                    // Check if current session belongs to another channel in the same workspace
                                    const siblings = deps.chatSessionRepo.findByCategoryId(session.categoryId);
                                    const ownedByOther = siblings.some(
                                        (s) => s.channelId !== message.channelId && s.displayName === currentInfo.title,
                                    );

                                    if (!ownedByOther) {
                                        // Session was renamed — adopt the new title
                                        const oldTitle = session.displayName;
                                        deps.chatSessionRepo.updateDisplayName(message.channelId, currentInfo.title);
                                        registerApprovalSessionChannel(
                                            deps.bridge, projectName, currentInfo.title, message.channel, oldTitle,
                                        );
                                        if (message.guild) {
                                            const newName = deps.titleGenerator.sanitizeForChannelName(currentInfo.title);
                                            const formattedName = `${session.sessionNumber}-${newName}`;
                                            await deps.channelManager.renameChannel(
                                                message.guild, message.channelId, formattedName,
                                            ).catch(() => {});
                                        }
                                        logger.info(
                                            `[MessageCreate] Session title recovery: "${oldTitle}" → "${currentInfo.title}"`,
                                        );
                                        // Fall through to send prompt — session is already active
                                    } else {
                                        // Current session belongs to another channel
                                        const reason = activationResult.error ? ` (${activationResult.error})` : '';
                                        await message.reply(
                                            `⚠️ Could not route this message to the bound session (${session.displayName}). ` +
                                            `Please open /chat and verify the session${reason}.`,
                                        ).catch(() => {});
                                        return;
                                    }
                                } else {
                                    const reason = activationResult.error ? ` (${activationResult.error})` : '';
                                    await message.reply(
                                        `⚠️ Could not route this message to the bound session (${session.displayName}). ` +
                                        `Please open /chat and verify the session${reason}.`,
                                    ).catch(() => {});
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
                            registerApprovalSessionChannel(deps.bridge, projectName, updatedSession.displayName, message.channel);
                        }

                        // Register echo hash so UserMessageDetector skips this message
                        const userMsgDetector = deps.bridge.pool.getUserMessageDetector?.(projectName);
                        if (userMsgDetector) {
                            userMsgDetector.addEchoHash(promptText);
                        }

                        await deps.sendPromptToAntigravity(deps.bridge, message, promptText, cdp, deps.modeService, deps.modelService, inboundImages, {
                            chatSessionService: deps.chatSessionService,
                            chatSessionRepo: deps.chatSessionRepo,
                            channelManager: deps.channelManager,
                            titleGenerator: deps.titleGenerator,
                            userPrefRepo: deps.userPrefRepo,
                        });
                    } catch (e: any) {
                        await message.reply(`Failed to connect to workspace: ${e.message}`);
                        return;
                    }
                } else {
                    await message.reply('No project is configured for this channel. Please create or select one with `/project`.');
                }
            } finally {
                await cleanupInboundImageAttachments(inboundImages);
            }
        }
    };
}
