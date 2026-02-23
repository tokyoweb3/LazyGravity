import { EmbedBuilder, Message } from 'discord.js';

import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { CdpBridge, ensureApprovalDetector as ensureApprovalDetectorFn, getCurrentCdp as getCurrentCdpFn } from '../services/cdpBridgeManager';
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
    ensureApprovalDetector?: (bridge: CdpBridge, cdp: CdpService, workspaceDirName: string, client: any) => void;
    downloadInboundImageAttachments?: (message: Message) => Promise<InboundImageAttachment[]>;
    cleanupInboundImageAttachments?: (attachments: InboundImageAttachment[]) => Promise<void>;
    isImageAttachment?: (contentType: string | null | undefined, fileName: string | null | undefined) => boolean;
}

export function createMessageCreateHandler(deps: MessageCreateHandlerDeps) {
    const getCurrentCdp = deps.getCurrentCdp ?? getCurrentCdpFn;
    const ensureApprovalDetector = deps.ensureApprovalDetector ?? ensureApprovalDetectorFn;
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
                await message.reply({ content: '💡 スラッシュコマンド `/screenshot` でも同じ操作ができます。' }).catch(() => { });
                return;
            }

            if (parsed.commandName === 'status') {
                const activeNames = deps.bridge.pool.getActiveWorkspaceNames();
                const currentMode = deps.modeService.getCurrentMode();

                const embed = new EmbedBuilder()
                    .setTitle('🔧 Bot ステータス')
                    .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                    .addFields(
                        { name: 'CDP接続', value: activeNames.length > 0 ? `🟢 ${activeNames.length} プロジェクト接続中` : '⚪ 未接続', inline: true },
                        { name: 'モード', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                        { name: '自動承認', value: deps.bridge.autoAccept.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                    )
                    .setFooter({ text: '💡 スラッシュコマンド /status でより詳しい情報が見られます' })
                    .setTimestamp();

                if (activeNames.length > 0) {
                    const lines = activeNames.map((name) => {
                        const cdp = deps.bridge.pool.getConnected(name);
                        const contexts = cdp ? cdp.getContexts().length : 0;
                        const detectorActive = deps.bridge.pool.getApprovalDetector(name)?.isActive() ? ' [検出中]' : '';
                        return `• **${name}** — コンテキスト: ${contexts}${detectorActive}`;
                    });
                    embed.setDescription(`**接続中のプロジェクト:**\n${lines.join('\n')}`);
                } else {
                    embed.setDescription('メッセージを送信すると自動的にプロジェクトに接続します。');
                }

                await message.reply({ embeds: [embed] });
                return;
            }

            const slashOnlyCommands = ['help', 'stop', 'model', 'mode', 'project', 'chat', 'new', 'cleanup'];
            if (slashOnlyCommands.includes(parsed.commandName)) {
                await message.reply({
                    content: `💡 \`/${parsed.commandName}\` はスラッシュコマンドとして使用してください。\nDiscordの入力欄で \`/${parsed.commandName}\` と入力すると候補が表示されます。`,
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
                    });
                } else {
                    await message.reply('CDPに未接続です。先にメッセージを送信してプロジェクトに接続してください。');
                }
            }
            return;
        }

        const hasImageAttachments = Array.from(message.attachments.values())
            .some((attachment) => isImageAttachment(attachment.contentType, attachment.name));
        if (message.content.trim() || hasImageAttachments) {
            const promptText = message.content.trim() || '添付画像を確認して対応してください。';
            const inboundImages = await downloadInboundImageAttachments(message);

            if (hasImageAttachments && inboundImages.length === 0) {
                await message.reply('添付画像の取得に失敗しました。時間をおいて再送してください。').catch(() => { });
                return;
            }

            const workspacePath = deps.wsHandler.getWorkspaceForChannel(message.channelId);

            try {
                if (workspacePath) {
                    try {
                        const cdp = await deps.bridge.pool.getOrConnect(workspacePath);
                        const dirName = deps.bridge.pool.extractDirName(workspacePath);

                        deps.bridge.lastActiveWorkspace = dirName;
                        deps.bridge.lastActiveChannel = message.channel;

                        ensureApprovalDetector(deps.bridge, cdp, dirName, deps.client);

                        const session = deps.chatSessionRepo.findByChannelId(message.channelId);
                        if (session && !session.isRenamed) {
                            try {
                                const chatResult = await deps.chatSessionService.startNewChat(cdp);
                                if (!chatResult.ok) {
                                    logger.warn('[MessageCreate] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                    (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                                }
                            } catch (err) {
                                logger.error('[MessageCreate] startNewChat エラー:', err);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                            }
                        }

                        await deps.autoRenameChannel(message, deps.chatSessionRepo, deps.titleGenerator, deps.channelManager, cdp);

                        await deps.sendPromptToAntigravity(deps.bridge, message, promptText, cdp, deps.modeService, deps.modelService, inboundImages, {
                            chatSessionService: deps.chatSessionService,
                            chatSessionRepo: deps.chatSessionRepo,
                            channelManager: deps.channelManager,
                            titleGenerator: deps.titleGenerator,
                        });
                    } catch (e: any) {
                        await message.reply(`ワークスペース接続に失敗しました: ${e.message}`);
                        return;
                    }
                } else {
                    const cdp = getCurrentCdp(deps.bridge);
                    if (cdp) {
                        deps.bridge.lastActiveChannel = message.channel;

                        const session = deps.chatSessionRepo.findByChannelId(message.channelId);
                        if (session && !session.isRenamed) {
                            try {
                                const chatResult = await deps.chatSessionService.startNewChat(cdp);
                                if (!chatResult.ok) {
                                    logger.warn('[MessageCreate|Fallback] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                    (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                                }
                            } catch (err) {
                                logger.error('[MessageCreate|Fallback] startNewChat エラー:', err);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                            }
                        }

                        await deps.autoRenameChannel(message, deps.chatSessionRepo, deps.titleGenerator, deps.channelManager, cdp);
                        await deps.sendPromptToAntigravity(deps.bridge, message, promptText, cdp, deps.modeService, deps.modelService, inboundImages, {
                            chatSessionService: deps.chatSessionService,
                            chatSessionRepo: deps.chatSessionRepo,
                            channelManager: deps.channelManager,
                            titleGenerator: deps.titleGenerator,
                        });
                    } else {
                        await message.reply('プロジェクトが設定されていません。`/project` でプロジェクトを作成してください。');
                    }
                }
            } finally {
                await cleanupInboundImageAttachments(inboundImages);
            }
        }
    };
}
