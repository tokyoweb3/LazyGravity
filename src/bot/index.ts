import { t } from "../utils/i18n";
import { logger } from '../utils/logger';
import {
    Client, GatewayIntentBits, Events, Message,
    ChatInputCommandInteraction, Interaction,
    AttachmentBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
    StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import Database from 'better-sqlite3';

import { loadConfig, resolveResponseDeliveryMode } from '../utils/config';
import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { registerSlashCommands } from '../commands/registerSlashCommands';

import { ModeService, AVAILABLE_MODES, MODE_DISPLAY_NAMES, MODE_DESCRIPTIONS, MODE_UI_NAMES } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TemplateRepository } from '../database/templateRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceService } from '../services/workspaceService';
import {
    WorkspaceCommandHandler,
    PROJECT_SELECT_ID,
    WORKSPACE_SELECT_ID,
} from '../commands/workspaceCommandHandler';
import { ChatCommandHandler } from '../commands/chatCommandHandler';
import {
    CleanupCommandHandler,
    CLEANUP_ARCHIVE_BTN,
    CLEANUP_DELETE_BTN,
    CLEANUP_CANCEL_BTN,
} from '../commands/cleanupCommandHandler';
import { ChannelManager } from '../services/channelManager';
import { TitleGeneratorService } from '../services/titleGeneratorService';

// CDP integration services
import { CdpService } from '../services/cdpService';
import { ChatSessionService } from '../services/chatSessionService';
import { ResponseMonitor, RESPONSE_SELECTORS } from '../services/responseMonitor';
import { ensureAntigravityRunning } from '../services/antigravityLauncher';
import { AutoAcceptService } from '../services/autoAcceptService';
import { PromptDispatcher } from '../services/promptDispatcher';
import {
    buildApprovalCustomId,
    CdpBridge,
    ensureApprovalDetector,
    ensureErrorPopupDetector,
    ensurePlanningDetector,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
    parseErrorPopupCustomId,
    parsePlanningCustomId,
    registerApprovalSessionChannel,
    registerApprovalWorkspaceChannel,
} from '../services/cdpBridgeManager';
import { buildModeModelLines, fitForSingleEmbedDescription, splitForEmbedDescription } from '../utils/streamMessageFormatter';
import { formatForDiscord, splitOutputAndLogs } from '../utils/discordFormatter';
import { ProcessLogBuffer } from '../utils/processLogBuffer';
import {
    buildPromptWithAttachmentUrls,
    cleanupInboundImageAttachments,
    downloadInboundImageAttachments,
    InboundImageAttachment,
    isImageAttachment,
    toDiscordAttachment,
} from '../utils/imageHandler';
import { sendModeUI } from '../ui/modeUi';
import { sendModelsUI, buildModelsUI } from '../ui/modelsUi';
import { sendTemplateUI } from '../ui/templateUi';
import { sendAutoAcceptUI } from '../ui/autoAcceptUi';
import { handleScreenshot } from '../ui/screenshotUi';
import { createInteractionCreateHandler } from '../events/interactionCreateHandler';
import { createMessageCreateHandler } from '../events/messageCreateHandler';

// =============================================================================
// Embed color palette (color-coded by phase)
// =============================================================================
const PHASE_COLORS = {
    sending: 0x5865F2,     // Blue
    thinking: 0x9B59B6,    // Purple
    generating: 0xF39C12,  // Gold
    complete: 0x2ECC71,    // Green
    timeout: 0xE74C3C,     // Red
    error: 0xC0392B,       // Dark Red
} as const;

const PHASE_ICONS = {
    sending: '📡',
    thinking: '🧠',
    generating: '✍️',
    complete: '✅',
    timeout: '⏰',
    error: '❌',
} as const;

const MAX_OUTBOUND_GENERATED_IMAGES = 4;
const RESPONSE_DELIVERY_MODE = resolveResponseDeliveryMode();

/** Tracks channel IDs where /stop was explicitly invoked by the user */
const userStopRequestedChannels = new Set<string>();
export const getResponseDeliveryModeForTest = (): string => RESPONSE_DELIVERY_MODE;

export function createSerialTaskQueueForTest(queueName: string, traceId: string): (task: () => Promise<void>, label?: string) => Promise<void> {
    let queue: Promise<void> = Promise.resolve();
    let queueDepth = 0;
    let taskSeq = 0;

    return (task: () => Promise<void>, label: string = 'queue-task'): Promise<void> => {
        taskSeq += 1;
        const seq = taskSeq;
        queueDepth += 1;

        queue = queue.then(async () => {
            try {
                await task();
            } catch (err: any) {
                logger.error(`[sendQueue:${traceId}:${queueName}] error #${seq} label=${label}:`, err?.message || err);
            } finally {
                queueDepth = Math.max(0, queueDepth - 1);
            }
        });

        return queue;
    };
}

/**
 * Send a Discord message (prompt) to Antigravity, wait for the response, and relay it back to Discord
 *
 * Message strategy:
 *   - Send new messages per phase instead of editing, to preserve history
 *   - Visualize the flow of planning/analysis/execution confirmation/implementation as logs
 */
async function sendPromptToAntigravity(
    bridge: CdpBridge,
    message: Message,
    prompt: string,
    cdp: CdpService,
    modeService: ModeService,
    modelService: ModelService,
    inboundImages: InboundImageAttachment[] = [],
    options?: {
        chatSessionService: ChatSessionService;
        chatSessionRepo: ChatSessionRepository;
        channelManager: ChannelManager;
        titleGenerator: TitleGeneratorService;
    }
): Promise<void> {
    // Add reaction to acknowledge command receipt
    await message.react('👀').catch(() => { });

    const channel = (message.channel && 'send' in message.channel) ? message.channel as any : null;
    const monitorTraceId = `${message.channelId}:${message.id}`;
    const enqueueGeneral = createSerialTaskQueueForTest('general', monitorTraceId);
    const enqueueResponse = createSerialTaskQueueForTest('response', monitorTraceId);
    const enqueueActivity = createSerialTaskQueueForTest('activity', monitorTraceId);

    const sendEmbed = (
        title: string,
        description: string,
        color: number,
        fields?: { name: string; value: string; inline?: boolean }[],
        footerText?: string,
    ): Promise<void> => enqueueGeneral(async () => {
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        if (fields && fields.length > 0) {
            embed.addFields(...fields);
        }
        if (footerText) {
            embed.setFooter({ text: footerText });
        }
        await channel.send({ embeds: [embed] }).catch(() => { });
    }, 'send-embed');

    const shouldTryGeneratedImages = (inputPrompt: string, responseText: string): boolean => {
        const prompt = (inputPrompt || '').toLowerCase();
        const response = (responseText || '').toLowerCase();
        const imageIntentPattern = /(image|images|png|jpg|jpeg|gif|webp|illustration|diagram|render)/i;
        const imageUrlPattern = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i;

        if (imageIntentPattern.test(prompt)) return true;
        if (response.includes('![') || imageUrlPattern.test(response)) return true;
        return false;
    };

    const sendGeneratedImages = async (responseText: string): Promise<void> => {
        if (!channel) return;
        if (!shouldTryGeneratedImages(prompt, responseText)) return;

        const extracted = await cdp.extractLatestResponseImages(MAX_OUTBOUND_GENERATED_IMAGES);
        if (extracted.length === 0) return;

        const files: AttachmentBuilder[] = [];
        for (let i = 0; i < extracted.length; i++) {
            const attachment = await toDiscordAttachment(extracted[i], i);
            if (attachment) files.push(attachment);
        }
        if (files.length === 0) return;

        await enqueueGeneral(async () => {
            await channel.send({
                content: t(`🖼️ Detected generated images (${files.length})`),
                files,
            }).catch(() => { });
        }, 'send-generated-images');
    };

    const tryEmergencyExtractText = async (): Promise<string> => {
        try {
            const contextId = cdp.getPrimaryContextId();
            const expression = `(() => {
                const panel = document.querySelector('.antigravity-agent-side-panel');
                const scope = panel || document;

                const candidateSelectors = [
                    '.rendered-markdown',
                    '.leading-relaxed.select-text',
                    '.flex.flex-col.gap-y-3',
                    '[data-message-author-role="assistant"]',
                    '[data-message-role="assistant"]',
                    '[class*="assistant-message"]',
                    '[class*="message-content"]',
                    '[class*="markdown-body"]',
                    '.prose',
                ];

                const looksLikeActivity = (text) => {
                    const normalized = (text || '').trim().toLowerCase();
                    if (!normalized) return true;
                    const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran)/i;
                    return activityPattern.test(normalized) && normalized.length <= 220;
                };

                const clean = (text) => (text || '').replace(/\\r/g, '').replace(/\\n{3,}/g, '\\n\\n').trim();

                const candidates = [];
                const seen = new Set();
                for (const selector of candidateSelectors) {
                    const nodes = scope.querySelectorAll(selector);
                    for (const node of nodes) {
                        if (!node || seen.has(node)) continue;
                        seen.add(node);
                        candidates.push(node);
                    }
                }

                for (let i = candidates.length - 1; i >= 0; i--) {
                    const node = candidates[i];
                    const text = clean(node.innerText || node.textContent || '');
                    if (!text || text.length < 20) continue;
                    if (looksLikeActivity(text)) continue;
                    if (/^(good|bad)$/i.test(text)) continue;
                    return text;
                }

                return '';
            })()`;

            const callParams: Record<string, unknown> = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;
            const res = await cdp.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            return typeof value === 'string' ? value.trim() : '';
        } catch {
            return '';
        }
    };

    const clearWatchingReaction = async (): Promise<void> => {
        const botId = message.client.user?.id;
        if (botId) {
            await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
        }
    };

    if (!cdp.isConnected()) {
        await sendEmbed(
            `${PHASE_ICONS.error} Connection Error`,
            'Not connected to Antigravity.\nStart with `open -a Antigravity --args --remote-debugging-port=9223`, then send a message to auto-connect.',
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
        return;
    }

    const localMode = modeService.getCurrentMode();
    const modeName = MODE_UI_NAMES[localMode] || localMode;
    const currentModel = (await cdp.getCurrentModel()) || modelService.getCurrentModel();
    const fastModel = currentModel;
    const planModel = currentModel;

    await sendEmbed(
        `${PHASE_ICONS.sending} [${modeName} - ${currentModel}${localMode === 'plan' ? ' (Thinking)' : ''}] Sending...`,
        buildModeModelLines(modeName, fastModel, planModel).join('\n'),
        PHASE_COLORS.sending,
    );

    let isFinalized = false;
    let lastProgressText = '';
    let lastActivityLogText = '';
    const LIVE_RESPONSE_MAX_LEN = 3800;
    const LIVE_ACTIVITY_MAX_LEN = 3800;
    const processLogBuffer = new ProcessLogBuffer({
        maxChars: LIVE_ACTIVITY_MAX_LEN,
        maxEntries: 120,
        maxEntryLength: 220,
    });
    const liveResponseMessages: any[] = [];
    const liveActivityMessages: any[] = [];
    let lastLiveResponseKey = '';
    let lastLiveActivityKey = '';
    let liveResponseUpdateVersion = 0;
    let liveActivityUpdateVersion = 0;

    const ACTIVITY_PLACEHOLDER = t('Collecting process logs...');

    const buildLiveResponseDescriptions = (text: string): string[] => {
        const normalized = (text || '').trim();
        if (!normalized) {
            return [t('Waiting for output...')];
        }
        return splitForEmbedDescription(formatForDiscord(normalized), LIVE_RESPONSE_MAX_LEN);
    };

    const buildLiveActivityDescriptions = (text: string): string[] => {
        const normalized = (text || '').trim();
        if (!normalized) return [ACTIVITY_PLACEHOLDER];
        const formatted = formatForDiscord(normalized);
        return [fitForSingleEmbedDescription(formatted, LIVE_ACTIVITY_MAX_LEN)];
    };

    const appendProcessLogs = (text: string): string => {
        const normalized = (text || '').trim();
        if (!normalized) return processLogBuffer.snapshot();
        return processLogBuffer.append(normalized);
    };

    const upsertLiveResponseEmbeds = (
        title: string,
        rawText: string,
        color: number,
        footerText: string,
        opts?: {
            source?: string;
            expectedVersion?: number;
            skipWhenFinalized?: boolean;
        },
    ): Promise<void> => enqueueResponse(async () => {
        if (opts?.skipWhenFinalized && isFinalized) return;
        if (opts?.expectedVersion !== undefined && opts.expectedVersion !== liveResponseUpdateVersion) return;
        if (!channel) return;
        const descriptions = buildLiveResponseDescriptions(rawText);
        const renderKey = `${title}|${color}|${footerText}|${descriptions.join('\n<<<PAGE_BREAK>>>\n')}`;
        if (renderKey === lastLiveResponseKey && liveResponseMessages.length > 0) {
            return;
        }
        lastLiveResponseKey = renderKey;

        for (let i = 0; i < descriptions.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(descriptions.length > 1 ? `${title} (${i + 1}/${descriptions.length})` : title)
                .setDescription(descriptions[i])
                .setColor(color)
                .setFooter({ text: footerText })
                .setTimestamp();

            if (!liveResponseMessages[i]) {
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
                continue;
            }

            await liveResponseMessages[i].edit({ embeds: [embed] }).catch(async () => {
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
            });
        }

        // Delete excess messages if page count decreased
        while (liveResponseMessages.length > descriptions.length) {
            const extra = liveResponseMessages.pop();
            if (!extra) continue;
            await extra.delete().catch(() => { });
        }
    }, `upsert-response:${opts?.source ?? 'unknown'}`);

    const upsertLiveActivityEmbeds = (
        title: string,
        rawText: string,
        color: number,
        footerText: string,
        opts?: {
            source?: string;
            expectedVersion?: number;
            skipWhenFinalized?: boolean;
        },
    ): Promise<void> => enqueueActivity(async () => {
        if (opts?.skipWhenFinalized && isFinalized) return;
        if (opts?.expectedVersion !== undefined && opts.expectedVersion !== liveActivityUpdateVersion) return;
        if (!channel) return;

        const descriptions = buildLiveActivityDescriptions(rawText);
        const renderKey = `${title}|${color}|${footerText}|${descriptions.join('\n<<<PAGE_BREAK>>>\n')}`;
        if (renderKey === lastLiveActivityKey && liveActivityMessages.length > 0) {
            return;
        }
        lastLiveActivityKey = renderKey;

        for (let i = 0; i < descriptions.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(descriptions.length > 1 ? `${title} (${i + 1}/${descriptions.length})` : title)
                .setDescription(descriptions[i])
                .setColor(color)
                .setFooter({ text: footerText })
                .setTimestamp();

            if (!liveActivityMessages[i]) {
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
                continue;
            }

            await liveActivityMessages[i].edit({ embeds: [embed] }).catch(async () => {
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
            });
        }

        while (liveActivityMessages.length > descriptions.length) {
            const extra = liveActivityMessages.pop();
            if (!extra) continue;
            await extra.delete().catch(() => { });
        }
    }, `upsert-activity:${opts?.source ?? 'unknown'}`);


    try {

        let injectResult;
        if (inboundImages.length > 0) {
            injectResult = await cdp.injectMessageWithImageFiles(
                prompt,
                inboundImages.map((image) => image.localPath),
            );

            if (!injectResult.ok) {
                await sendEmbed(
                    t('🖼️ Attached image fallback'),
                    t('Failed to attach image directly, resending via URL reference.'),
                    PHASE_COLORS.thinking,
                );
                injectResult = await cdp.injectMessage(buildPromptWithAttachmentUrls(prompt, inboundImages));
            }
        } else {
            injectResult = await cdp.injectMessage(prompt);
        }

        if (!injectResult.ok) {
            isFinalized = true;
            await sendEmbed(
                `${PHASE_ICONS.error} Message Injection Failed`,
                `Failed to send message: ${injectResult.error}`,
                PHASE_COLORS.error,
            );
            await clearWatchingReaction();
            await message.react('❌').catch(() => { });
            return;
        }

        const startTime = Date.now();
        await upsertLiveActivityEmbeds(
            `${PHASE_ICONS.thinking} Process Log`,
            '',
            PHASE_COLORS.thinking,
            t('⏱️ Elapsed: 0s | Process log'),
            { source: 'initial' },
        );

        const monitor = new ResponseMonitor({
            cdpService: cdp,
            pollIntervalMs: 2000,
            maxDurationMs: 300000,
            stopGoneConfirmCount: 3,

            onPhaseChange: (_phase, _text) => {
                // Phase transitions are already logged inside ResponseMonitor.setPhase()
            },

            onProcessLog: (logText) => {
                if (isFinalized) return;
                if (logText && logText.trim().length > 0) {
                    lastActivityLogText = appendProcessLogs(logText);
                }
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                liveActivityUpdateVersion += 1;
                const activityVersion = liveActivityUpdateVersion;
                upsertLiveActivityEmbeds(
                    `${PHASE_ICONS.thinking} Process Log`,
                    lastActivityLogText || ACTIVITY_PLACEHOLDER,
                    PHASE_COLORS.thinking,
                    t(`⏱️ Elapsed: ${elapsed}s | Process log`),
                    {
                        source: 'process-log',
                        expectedVersion: activityVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });
            },

            onProgress: (text) => {
                if (isFinalized) return;
                // Live output streaming disabled: RESPONSE_TEXT currently includes process logs (see #1).
                const separated = splitOutputAndLogs(text);
                if (separated.output && separated.output.trim().length > 0) {
                    lastProgressText = separated.output;
                }
            },

            onComplete: async (finalText) => {
                isFinalized = true;

                // If the user explicitly pressed /stop, skip output display entirely
                const wasStoppedByUser = userStopRequestedChannels.delete(message.channelId);
                if (wasStoppedByUser) {
                    logger.info(`[sendPromptToAntigravity:${monitorTraceId}] Stopped by user — skipping output`);
                    await clearWatchingReaction();
                    await message.react('⏹️').catch(() => { });
                    return;
                }

                try {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    const isQuotaError = monitor.getPhase() === 'quotaReached' || monitor.getQuotaDetected();

                    // Quota early exit — skip text extraction, output logging, and embed entirely
                    if (isQuotaError) {
                        const finalLogText = lastActivityLogText || processLogBuffer.snapshot();
                        if (finalLogText && finalLogText.trim().length > 0) {
                            logger.divider('Process Log');
                            console.info(finalLogText);
                        }
                        logger.divider();

                        liveActivityUpdateVersion += 1;
                        await upsertLiveActivityEmbeds(
                            `${PHASE_ICONS.thinking} Process Log`,
                            finalLogText || ACTIVITY_PLACEHOLDER,
                            PHASE_COLORS.thinking,
                            t(`⏱️ Time: ${elapsed}s | Process log`),
                            {
                                source: 'complete',
                                expectedVersion: liveActivityUpdateVersion,
                            },
                        );

                        liveResponseUpdateVersion += 1;
                        await upsertLiveResponseEmbeds(
                            '⚠️ Model Quota Reached',
                            'Model quota limit reached. Please wait or switch to a different model.',
                            0xFF6B6B,
                            t(`⏱️ Time: ${elapsed}s | Quota Reached`),
                            {
                                source: 'complete',
                                expectedVersion: liveResponseUpdateVersion,
                            },
                        );

                        try {
                            const modelsPayload = await buildModelsUI(cdp, () => bridge.quota.fetchQuota());
                            if (modelsPayload && channel) {
                                await channel.send({ ...modelsPayload });
                            }
                        } catch (e) {
                            logger.error('[Quota] Failed to send model selection UI:', e);
                        }

                        await clearWatchingReaction();
                        await message.react('⚠️').catch(() => { });
                        return;
                    }

                    // Normal path — extract final text
                    const responseText = (finalText && finalText.trim().length > 0)
                        ? finalText
                        : lastProgressText;
                    const emergencyText = (!responseText || responseText.trim().length === 0)
                        ? await tryEmergencyExtractText()
                        : '';
                    const finalResponseText = responseText && responseText.trim().length > 0
                        ? responseText
                        : emergencyText;
                    const separated = splitOutputAndLogs(finalResponseText);
                    const finalOutputText = separated.output || finalResponseText;
                    // Process logs are now collected by onProcessLog callback directly;
                    // sanitizeActivityLines is NOT applied because it would strip the very
                    // content we want to display (activity messages, tool names, etc.)
                    const finalLogText = lastActivityLogText || processLogBuffer.snapshot();
                    if (finalLogText && finalLogText.trim().length > 0) {
                        logger.divider('Process Log');
                        console.info(finalLogText);
                    }
                    if (finalOutputText && finalOutputText.trim().length > 0) {
                        logger.divider(`Output (${finalOutputText.length} chars)`);
                        console.info(finalOutputText);
                    }
                    logger.divider();

                    liveActivityUpdateVersion += 1;
                    const activityVersion = liveActivityUpdateVersion;
                    await upsertLiveActivityEmbeds(
                        `${PHASE_ICONS.thinking} Process Log`,
                        finalLogText || ACTIVITY_PLACEHOLDER,
                        PHASE_COLORS.thinking,
                        t(`⏱️ Time: ${elapsed}s | Process log`),
                        {
                            source: 'complete',
                            expectedVersion: activityVersion,
                        },
                    );

                    liveResponseUpdateVersion += 1;
                    const responseVersion = liveResponseUpdateVersion;
                    if (finalOutputText && finalOutputText.trim().length > 0) {
                        await upsertLiveResponseEmbeds(
                            `${PHASE_ICONS.complete} Final Output`,
                            finalOutputText,
                            PHASE_COLORS.complete,
                            t(`⏱️ Time: ${elapsed}s | Complete`),
                            {
                                source: 'complete',
                                expectedVersion: responseVersion,
                            },
                        );
                    } else {
                        await upsertLiveResponseEmbeds(
                            `${PHASE_ICONS.complete} Complete`,
                            t('Failed to extract response. Use `/screenshot` to verify.'),
                            PHASE_COLORS.complete,
                            t(`⏱️ Time: ${elapsed}s | Complete`),
                            {
                                source: 'complete',
                                expectedVersion: responseVersion,
                            },
                        );
                    }

                    if (options && message.guild) {
                        try {
                            const sessionInfo = await options.chatSessionService.getCurrentSessionInfo(cdp);
                            if (sessionInfo && sessionInfo.hasActiveChat && sessionInfo.title && sessionInfo.title !== t('(Untitled)')) {
                                const session = options.chatSessionRepo.findByChannelId(message.channelId);
                                const workspaceDirName = session
                                    ? bridge.pool.extractDirName(session.workspacePath)
                                    : cdp.getCurrentWorkspaceName();
                                if (workspaceDirName) {
                                    registerApprovalSessionChannel(bridge, workspaceDirName, sessionInfo.title, message.channel);
                                }

                                const newName = options.titleGenerator.sanitizeForChannelName(sessionInfo.title);
                                if (session && session.displayName !== sessionInfo.title) {
                                    const formattedName = `${session.sessionNumber}-${newName}`;
                                    await options.channelManager.renameChannel(message.guild, message.channelId, formattedName);
                                    options.chatSessionRepo.updateDisplayName(message.channelId, sessionInfo.title);
                                }
                            }
                        } catch (e) {
                            logger.error('[Rename] Failed to get title from Antigravity and rename:', e);
                        }
                    }

                    await sendGeneratedImages(finalOutputText || '');
                    await clearWatchingReaction();
                    await message.react(finalOutputText && finalOutputText.trim().length > 0 ? '✅' : '⚠️').catch(() => { });
                } catch (error) {
                    logger.error(`[sendPromptToAntigravity:${monitorTraceId}] onComplete failed:`, error);
                }
            },

            onTimeout: async (lastText) => {
                isFinalized = true;
                try {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);

                    const timeoutText = (lastText && lastText.trim().length > 0)
                        ? lastText
                        : lastProgressText;
                    const separated = splitOutputAndLogs(timeoutText || '');
                    const sanitizedTimeoutLogs = lastActivityLogText || processLogBuffer.snapshot();
                    const payload = separated.output && separated.output.trim().length > 0
                        ? t(`${separated.output}\n\n[Monitor Ended] Timeout after 5 minutes.`)
                        : 'Monitor ended after 5 minutes. No text was retrieved.';

                    liveResponseUpdateVersion += 1;
                    const responseVersion = liveResponseUpdateVersion;
                    await upsertLiveResponseEmbeds(
                        `${PHASE_ICONS.timeout} Timeout`,
                        payload,
                        PHASE_COLORS.timeout,
                        `⏱️ Elapsed: ${elapsed}s | Timeout`,
                        {
                            source: 'timeout',
                            expectedVersion: responseVersion,
                        },
                    );

                    liveActivityUpdateVersion += 1;
                    const activityVersion = liveActivityUpdateVersion;
                    await upsertLiveActivityEmbeds(
                        `${PHASE_ICONS.thinking} Process Log`,
                        sanitizedTimeoutLogs || ACTIVITY_PLACEHOLDER,
                        PHASE_COLORS.thinking,
                        t(`⏱️ Time: ${elapsed}s | Process log`),
                        {
                            source: 'timeout',
                            expectedVersion: activityVersion,
                        },
                    );
                    await clearWatchingReaction();
                    await message.react('⚠️').catch(() => { });
                } catch (error) {
                    logger.error(`[sendPromptToAntigravity:${monitorTraceId}] onTimeout failed:`, error);
                }
            },
        });

        await monitor.start();

    } catch (e: any) {
        isFinalized = true;
        await sendEmbed(
            `${PHASE_ICONS.error} Error`,
            t(`Error occurred during processing: ${e.message}`),
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
    }
}

// =============================================================================
// Bot main entry point
// =============================================================================

export const startBot = async () => {
    const config = loadConfig();

    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'antigravity.db';
    const db = new Database(dbPath);
    const modeService = new ModeService();
    const modelService = new ModelService();
    const templateRepo = new TemplateRepository(db);
    const workspaceBindingRepo = new WorkspaceBindingRepository(db);
    const chatSessionRepo = new ChatSessionRepository(db);
    const workspaceService = new WorkspaceService(config.workspaceBaseDir);
    const channelManager = new ChannelManager();

    // Auto-launch Antigravity with CDP port if not already running
    await ensureAntigravityRunning();

    // Initialize CDP bridge (lazy connection: pool creation only)
    const bridge = initCdpBridge(config.autoApproveFileEdits);

    // Initialize CDP-dependent services (constructor CDP dependency removed)
    const chatSessionService = new ChatSessionService();
    const titleGenerator = new TitleGeneratorService();
    const promptDispatcher = new PromptDispatcher({
        bridge,
        modeService,
        modelService,
        sendPromptImpl: sendPromptToAntigravity,
    });

    // Initialize command handlers
    const wsHandler = new WorkspaceCommandHandler(workspaceBindingRepo, chatSessionRepo, workspaceService, channelManager);
    const chatHandler = new ChatCommandHandler(chatSessionService, chatSessionRepo, workspaceBindingRepo, channelManager, workspaceService, bridge.pool);
    const cleanupHandler = new CleanupCommandHandler(chatSessionRepo, workspaceBindingRepo);

    const slashCommandHandler = new SlashCommandHandler(templateRepo);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once(Events.ClientReady, async (readyClient) => {
        logger.info(`Ready! Logged in as ${readyClient.user.tag} | extractionMode=${config.extractionMode}`);

        try {
            await registerSlashCommands(config.discordToken, config.clientId, config.guildId);
        } catch (error) {
            logger.warn('Failed to register slash commands, but text commands remain available.');
        }

        // Startup dashboard embed
        try {
            const os = await import('os');
            const pkg = await import('../../package.json');
            const version = pkg.default?.version ?? pkg.version ?? 'unknown';
            const projects = workspaceService.scanWorkspaces();

            // Check CDP connection status
            const activeWorkspaces = bridge.pool.getActiveWorkspaceNames();
            const cdpStatus = activeWorkspaces.length > 0
                ? `Connected (${activeWorkspaces.join(', ')})`
                : 'Not connected';

            const dashboardEmbed = new EmbedBuilder()
                .setTitle('LazyGravity Online')
                .setColor(0x57F287)
                .addFields(
                    { name: 'Version', value: version, inline: true },
                    { name: 'Node.js', value: process.versions.node, inline: true },
                    { name: 'OS', value: `${os.platform()} ${os.release()}`, inline: true },
                    { name: 'CDP', value: cdpStatus, inline: true },
                    { name: 'Model', value: modelService.getCurrentModel(), inline: true },
                    { name: 'Mode', value: modeService.getCurrentMode(), inline: true },
                    { name: 'Projects', value: `${projects.length} registered`, inline: true },
                    { name: 'Extraction', value: config.extractionMode, inline: true },
                )
                .setFooter({ text: `Started at ${new Date().toLocaleString()}` })
                .setTimestamp();

            // Send to the first available text channel in the guild
            const guild = readyClient.guilds.cache.first();
            if (guild) {
                const channel = guild.channels.cache.find(
                    (ch) => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(readyClient.user)?.has('SendMessages'),
                );
                if (channel && channel.isTextBased()) {
                    await channel.send({ embeds: [dashboardEmbed] });
                    logger.info('Startup dashboard embed sent.');
                }
            }
        } catch (error) {
            logger.warn('Failed to send startup dashboard embed:', error);
        }
    });

    // [Discord Interactions API] Slash command interaction handler
    client.on(Events.InteractionCreate, createInteractionCreateHandler({
        config,
        bridge,
        cleanupHandler,
        modeService,
        modelService,
        slashCommandHandler,
        wsHandler,
        chatHandler,
        client,
        sendModeUI,
        sendModelsUI,
        sendAutoAcceptUI,
        getCurrentCdp,
        parseApprovalCustomId,
        parseErrorPopupCustomId,
        parsePlanningCustomId,
        handleSlashInteraction: async (
            interaction,
            handler,
            bridgeArg,
            wsHandlerArg,
            chatHandlerArg,
            cleanupHandlerArg,
            modeServiceArg,
            modelServiceArg,
            autoAcceptServiceArg,
            clientArg,
        ) => handleSlashInteraction(
            interaction,
            handler,
            bridgeArg,
            wsHandlerArg,
            chatHandlerArg,
            cleanupHandlerArg,
            modeServiceArg,
            modelServiceArg,
            autoAcceptServiceArg,
            clientArg,
            promptDispatcher,
            templateRepo,
        ),
        handleTemplateUse: async (interaction, templateId) => {
            const template = templateRepo.findById(templateId);
            if (!template) {
                await interaction.followUp({
                    content: 'Template not found. It may have been deleted.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // Resolve CDP via workspace binding (same flow as text messages)
            const channelId = interaction.channelId;
            const workspacePath = wsHandler.getWorkspaceForChannel(channelId);

            let cdp: CdpService | null = null;
            if (workspacePath) {
                try {
                    cdp = await bridge.pool.getOrConnect(workspacePath);
                    const dirName = bridge.pool.extractDirName(workspacePath);
                    bridge.lastActiveWorkspace = dirName;
                    bridge.lastActiveChannel = interaction.channel;
                    registerApprovalWorkspaceChannel(bridge, dirName, interaction.channel as any);
                    const session = chatSessionRepo.findByChannelId(channelId);
                    if (session?.displayName) {
                        registerApprovalSessionChannel(bridge, dirName, session.displayName, interaction.channel as any);
                    }
                    ensureApprovalDetector(bridge, cdp, dirName, client);
                    ensureErrorPopupDetector(bridge, cdp, dirName, client);
                    ensurePlanningDetector(bridge, cdp, dirName, client);
                } catch (e: any) {
                    await interaction.followUp({
                        content: `Failed to connect to workspace: ${e.message}`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
            } else {
                cdp = getCurrentCdp(bridge);
            }

            if (!cdp) {
                await interaction.followUp({
                    content: 'Not connected to CDP. Please connect to a project first.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const followUp = await interaction.followUp({
                content: `Executing template **${template.name}**...`,
            });

            if (followUp instanceof Message) {
                await promptDispatcher.send({
                    message: followUp,
                    prompt: template.prompt,
                    cdp,
                    inboundImages: [],
                    options: {
                        chatSessionService,
                        chatSessionRepo,
                        channelManager,
                        titleGenerator,
                    },
                });
            }
        },
    }));

    // [Text message handler]
    client.on(Events.MessageCreate, createMessageCreateHandler({
        config,
        bridge,
        modeService,
        modelService,
        slashCommandHandler,
        wsHandler,
        chatSessionService,
        chatSessionRepo,
        channelManager,
        titleGenerator,
        client,
        sendPromptToAntigravity: async (
            _bridge,
            message,
            prompt,
            cdp,
            _modeService,
            _modelService,
            inboundImages = [],
            options,
        ) => promptDispatcher.send({
            message,
            prompt,
            cdp,
            inboundImages,
            options,
        }),
        autoRenameChannel,
        handleScreenshot,
    }));

    await client.login(config.discordToken);
};

/**
 * Auto-rename channel on first message send
 */
async function autoRenameChannel(
    message: Message,
    chatSessionRepo: ChatSessionRepository,
    titleGenerator: TitleGeneratorService,
    channelManager: ChannelManager,
    cdp?: CdpService,
): Promise<void> {
    const session = chatSessionRepo.findByChannelId(message.channelId);
    if (!session || session.isRenamed) return;

    const guild = message.guild;
    if (!guild) return;

    try {
        const title = await titleGenerator.generateTitle(message.content, cdp);
        const newName = `${session.sessionNumber}-${title}`;
        await channelManager.renameChannel(guild, message.channelId, newName);
        chatSessionRepo.updateDisplayName(message.channelId, title);
    } catch (err) {
        logger.error('[AutoRename] Rename failed:', err);
    }
}

/**
 * Handle Discord Interactions API slash commands
 */
async function handleSlashInteraction(
    interaction: ChatInputCommandInteraction,
    handler: SlashCommandHandler,
    bridge: CdpBridge,
    wsHandler: WorkspaceCommandHandler,
    chatHandler: ChatCommandHandler,
    cleanupHandler: CleanupCommandHandler,
    modeService: ModeService,
    modelService: ModelService,
    autoAcceptService: AutoAcceptService,
    _client: Client,
    promptDispatcher: PromptDispatcher,
    templateRepo: TemplateRepository,
): Promise<void> {
    const commandName = interaction.commandName;

    switch (commandName) {
        case 'help': {
            const embed = new EmbedBuilder()
                .setTitle('📖 LazyGravity Commands')
                .setColor(0x5865F2)
                .setDescription('Commands for controlling Antigravity from Discord.')
                .addFields(
                    {
                        name: '💬 Chat', value: [
                            '`/new` — Start a new chat session',
                            '`/chat` — Show current session info + list',
                        ].join('\n')
                    },
                    {
                        name: '⏹️ Control', value: [
                            '`/stop` — Interrupt active LLM generation',
                            '`/screenshot` — Capture Antigravity screen',
                        ].join('\n')
                    },
                    {
                        name: '⚙️ Settings', value: [
                            '`/mode` — Display and change execution mode',
                            '`/model [name]` — Display and change LLM model',
                        ].join('\n')
                    },
                    {
                        name: '📁 Projects', value: [
                            '`/project` — Display project list',
                            '`/project create <name>` — Create a new project',
                        ].join('\n')
                    },
                    {
                        name: '📝 Templates', value: [
                            '`/template list` — Show templates with execute buttons (click to run)',
                            '`/template add <name> <prompt>` — Register a template',
                            '`/template delete <name>` — Delete a template',
                        ].join('\n')
                    },
                    {
                        name: '🔧 System', value: [
                            '`/status` — Display overall bot status',
                            '`/autoaccept` — Toggle auto-approve mode for approval dialogs via buttons',
                            '`/cleanup [days]` — Clean up unused channels/categories',
                            '`/help` — Show this help',
                        ].join('\n')
                    },
                )
                .setFooter({ text: 'Text messages are sent directly to Antigravity' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'mode': {
            await sendModeUI(interaction, modeService);
            break;
        }

        case 'model': {
            const modelName = interaction.options.getString('name');
            if (!modelName) {
                await sendModelsUI(interaction, {
                    getCurrentCdp: () => getCurrentCdp(bridge),
                    fetchQuota: async () => bridge.quota.fetchQuota(),
                });
            } else {
                const cdp = getCurrentCdp(bridge);
                if (!cdp) {
                    await interaction.editReply({ content: 'Not connected to CDP.' });
                    break;
                }
                const res = await cdp.setUiModel(modelName);
                if (res.ok) {
                    await interaction.editReply({ content: `Model changed to **${res.model}**.` });
                } else {
                    await interaction.editReply({ content: res.error || 'Failed to change model.' });
                }
            }
            break;
        }

        case 'template': {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'list') {
                const templates = templateRepo.findAll();
                await sendTemplateUI(interaction, templates);
                break;
            }

            let args: string[];
            switch (subcommand) {
                case 'add': {
                    const name = interaction.options.getString('name', true);
                    const prompt = interaction.options.getString('prompt', true);
                    args = ['add', name, prompt];
                    break;
                }
                case 'delete': {
                    const name = interaction.options.getString('name', true);
                    args = ['delete', name];
                    break;
                }
                default:
                    args = [];
            }

            const result = await handler.handleCommand('template', args);
            await interaction.editReply({ content: result.message });
            break;
        }

        case 'status': {
            const activeNames = bridge.pool.getActiveWorkspaceNames();
            const currentModel = (() => {
                const cdp = getCurrentCdp(bridge);
                return cdp ? 'CDP Connected' : 'Disconnected';
            })();
            const currentMode = modeService.getCurrentMode();

            const embed = new EmbedBuilder()
                .setTitle('🔧 Bot Status')
                .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                .addFields(
                    { name: 'CDP Connection', value: activeNames.length > 0 ? `🟢 ${activeNames.length} project(s) connected` : '⚪ Disconnected', inline: true },
                    { name: 'Mode', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                    { name: 'Auto Approve', value: autoAcceptService.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                )
                .setTimestamp();

            if (activeNames.length > 0) {
                const lines = activeNames.map((name) => {
                    const cdp = bridge.pool.getConnected(name);
                    const contexts = cdp ? cdp.getContexts().length : 0;
                    const detectorActive = bridge.pool.getApprovalDetector(name)?.isActive() ? ' [Detecting]' : '';
                    return `• **${name}** — Contexts: ${contexts}${detectorActive}`;
                });
                embed.setDescription(`**Connected Projects:**\n${lines.join('\n')}`);
            } else {
                embed.setDescription('Send a message to auto-connect to a project.');
            }

            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'autoaccept': {
            const requestedMode = interaction.options.getString('mode');
            if (!requestedMode) {
                await sendAutoAcceptUI(interaction, autoAcceptService);
                break;
            }

            const result = autoAcceptService.handle(requestedMode);
            await interaction.editReply({ content: result.message });
            break;
        }

        case 'screenshot': {
            await handleScreenshot(interaction, getCurrentCdp(bridge));
            break;
        }

        case 'stop': {
            const cdp = getCurrentCdp(bridge);
            if (!cdp) {
                await interaction.editReply({ content: '⚠️ Not connected to CDP. Please connect to a project first.' });
                break;
            }

            try {
                const contextId = cdp.getPrimaryContextId();
                const callParams: Record<string, unknown> = {
                    expression: RESPONSE_SELECTORS.CLICK_STOP_BUTTON,
                    returnByValue: true,
                    awaitPromise: false,
                };
                if (contextId !== null) {
                    callParams.contextId = contextId;
                }

                const result = await cdp.call('Runtime.evaluate', callParams);
                const value = result?.result?.value;

                if (value?.ok) {
                    userStopRequestedChannels.add(interaction.channelId);
                    const embed = new EmbedBuilder()
                        .setTitle('⏹️ Generation Interrupted')
                        .setDescription('AI response generation was safely stopped.')
                        .setColor(0xE74C3C)
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ Could Not Stop')
                        .setDescription(value?.error || 'Stop button not found. The LLM may not be running.')
                        .setColor(0xF39C12)
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                }
            } catch (e: any) {
                await interaction.editReply({ content: `❌ Error during stop processing: ${e.message}` });
            }
            break;
        }

        case 'project': {
            const wsSub = interaction.options.getSubcommand(false);
            if (wsSub === 'create') {
                if (!interaction.guild) {
                    await interaction.editReply({ content: 'This command can only be used in a server.' });
                    break;
                }
                await wsHandler.handleCreate(interaction, interaction.guild);
            } else {
                // /project list or /project (default)
                await wsHandler.handleShow(interaction);
            }
            break;
        }

        case 'new': {
            await chatHandler.handleNew(interaction);
            break;
        }

        case 'chat': {
            await chatHandler.handleChat(interaction);
            break;
        }

        case 'cleanup': {
            await cleanupHandler.handleCleanup(interaction);
            break;
        }

        case 'ping': {
            const apiLatency = interaction.client.ws.ping;
            await interaction.editReply({ content: `🏓 Pong! API Latency is **${apiLatency}ms**.` });
            break;
        }

        default:
            await interaction.editReply({
                content: `Unknown command: /${commandName}`,
            });
    }
}
