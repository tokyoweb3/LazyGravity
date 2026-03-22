import { SESSION_SELECT_ID } from '../ui/sessionPickerUi';
import { handleTelegramJoinSelect } from './telegramJoinCommand';
import { t } from "../utils/i18n";
import { logger } from '../utils/logger';
import type { LogLevel } from '../utils/logger';
import { logBuffer } from '../utils/logBuffer';
import {
    Client, GatewayIntentBits, Events, Message,
    ChatInputCommandInteraction, Interaction,
    AttachmentBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
    StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import Database from 'better-sqlite3';
import fs from 'fs';

import { wrapDiscordChannel } from '../platform/discord/wrappers';
import type { PlatformType } from '../platform/types';
import { loadConfig, resolveResponseDeliveryMode } from '../utils/config';
import type { ExtractionMode } from '../utils/config';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { registerSlashCommands } from '../commands/registerSlashCommands';

import { ModeService, AVAILABLE_MODES, MODE_DISPLAY_NAMES, MODE_DESCRIPTIONS, MODE_UI_NAMES } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { applyDefaultModel } from '../services/defaultModelApplicator';
import { TemplateRepository } from '../database/templateRepository';
import { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
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
import { JoinCommandHandler } from '../commands/joinCommandHandler';
import { isSessionSelectId } from '../ui/sessionPickerUi';

// CDP integration services
import { CdpService } from '../services/cdpService';
import { ChatSessionService } from '../services/chatSessionService';
import { ResponseMonitor, RESPONSE_SELECTORS, captureResponseMonitorBaseline } from '../services/responseMonitor';
import { ensureAntigravityRunning } from '../services/antigravityLauncher';
import { getAntigravityCdpHint } from '../utils/pathUtils';
import { AutoAcceptService } from '../services/autoAcceptService';
import { PromptDispatcher } from '../services/promptDispatcher';
import {
    buildApprovalCustomId,
    CdpBridge,
    ensureApprovalDetector,
    ensureErrorPopupDetector,
    ensurePlanningDetector,
    ensureRunCommandDetector,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
    parseErrorPopupCustomId,
    parsePlanningCustomId,
    parseRunCommandCustomId,
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
import { sendAccountUI } from '../ui/accountUi';
import { sendOutputUI, OUTPUT_BTN_EMBED, OUTPUT_BTN_PLAIN } from '../ui/outputUi';
import { handleScreenshot } from '../ui/screenshotUi';
import { UserPreferenceRepository, OutputFormat } from '../database/userPreferenceRepository';
import { inferParentScopeChannelId, listAccountNames, resolveScopedAccountName } from '../utils/accountUtils';
import { formatAsPlainText, splitPlainText } from '../utils/plainTextFormatter';
import { createInteractionCreateHandler } from '../events/interactionCreateHandler';
import { createMessageCreateHandler } from '../events/messageCreateHandler';
import {
    findTrajectoryEntriesByTitle,
    findLatestTrajectoryEntryByTitle,
    transferConversationByConversationId,
    transferConversationByTitle,
    waitForConversationPersistence,
    waitForConversationPersistenceByConversationId,
} from '../services/conversationTransferService';
import { quitAntigravityProfile } from '../services/antigravityProcessService';

// Telegram platform support
import { Bot, InputFile } from 'grammy';
import { TelegramAdapter } from '../platform/telegram/telegramAdapter';
import { TelegramBindingRepository } from '../database/telegramBindingRepository';
import { createTelegramMessageHandler } from './telegramMessageHandler';
import { createTelegramSelectHandler } from './telegramProjectCommand';
import { EventRouter } from './eventRouter';
import { createPlatformButtonHandler } from '../handlers/buttonHandler';
import { createPlatformSelectHandler } from '../handlers/selectHandler';
import { createApprovalButtonAction } from '../handlers/approvalButtonAction';
import { createPlanningButtonAction } from '../handlers/planningButtonAction';
import { createErrorPopupButtonAction } from '../handlers/errorPopupButtonAction';
import { createRunCommandButtonAction } from '../handlers/runCommandButtonAction';
import { createModelButtonAction } from '../handlers/modelButtonAction';
import { createAutoAcceptButtonAction } from '../handlers/autoAcceptButtonAction';
import { createTemplateButtonAction } from '../handlers/templateButtonAction';
import { createModeSelectAction } from '../handlers/modeSelectAction';
import { createAccountSelectAction } from '../handlers/accountSelectAction';
import { selectTelegramStartupChatId } from './telegramStartupTarget';

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
        userPrefRepo?: UserPreferenceRepository;
        onFullCompletion?: () => void;
        extractionMode?: ExtractionMode;
    }
): Promise<void> {
    // Completion signal — called exactly once when the entire prompt lifecycle ends
    let completionSignaled = false;
    const signalCompletion = (exitPath: string) => {
        if (completionSignaled) return;
        completionSignaled = true;
        logger.debug(`[sendPrompt:${message.channelId}] signalCompletion via ${exitPath}`);
        options?.onFullCompletion?.();
    };

    // Resolve output format once at the start (no mid-response switches)
    const outputFormat: OutputFormat = options?.userPrefRepo?.getOutputFormat(message.author.id) ?? 'embed';

    // Add reaction to acknowledge command receipt
    await message.react('👀').catch(() => { });

    const channel = (message.channel && 'send' in message.channel) ? message.channel as any : null;
    const monitorTraceId = `${message.channelId}:${message.id}`;
    const enqueueGeneral = createSerialTaskQueueForTest('general', monitorTraceId);
    const enqueueResponse = createSerialTaskQueueForTest('response', monitorTraceId);
    const enqueueActivity = createSerialTaskQueueForTest('activity', monitorTraceId);

    const logDeliveryError = (scope: string, error: unknown): void => {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.warn(`[DiscordDelivery:${monitorTraceId}] ${scope} failed: ${messageText}`);
    };

    const sendEmbed = (
        title: string,
        description: string,
        color: number,
        fields?: { name: string; value: string; inline?: boolean }[],
        footerText?: string,
    ): Promise<void> => enqueueGeneral(async () => {
        if (!channel) return;

        if (outputFormat === 'plain') {
            const chunks = formatAsPlainText({ title, description, fields, footerText });
            for (const chunk of chunks) {
                await channel.send({ content: chunk }).catch((error: unknown) => {
                    logDeliveryError('sendEmbed/plain/send', error);
                });
            }
            return;
        }

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
        await channel.send({ embeds: [embed] }).catch((error: unknown) => {
            logDeliveryError('sendEmbed/embed/send', error);
        });
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
            }).catch((error: unknown) => {
                logDeliveryError('sendGeneratedImages/send', error);
            });
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
            `Not connected to Antigravity.\nStart with \`${getAntigravityCdpHint(9223)}\`, then send a message to auto-connect.`,
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
        signalCompletion('cdp-disconnected');
        return;
    }

    // Apply default model preference on CDP connect
    const defaultModelResult = await applyDefaultModel(cdp, modelService);
    if (defaultModelResult.stale && defaultModelResult.staleMessage && channel) {
        await channel.send(defaultModelResult.staleMessage).catch((error: unknown) => {
            logDeliveryError('defaultModelResult/send', error);
        });
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

        if (outputFormat === 'plain') {
            const formatted = formatForDiscord((rawText || '').trim());
            const plainChunks = splitPlainText(
                `**${title}**\n${formatted}\n_${footerText}_`,
            );
            const renderKey = `${title}|plain|${footerText}|${plainChunks.join('\n<<<PAGE_BREAK>>>\n')}`;
            if (renderKey === lastLiveResponseKey && liveResponseMessages.length > 0) return;
            lastLiveResponseKey = renderKey;

            for (let i = 0; i < plainChunks.length; i++) {
                if (!liveResponseMessages[i]) {
                    liveResponseMessages[i] = await channel.send({ content: plainChunks[i] }).catch((error: unknown) => {
                        logDeliveryError('liveResponse/plain/send', error);
                        return null;
                    });
                    continue;
                }
                await liveResponseMessages[i].edit({ content: plainChunks[i] }).catch(async (error: unknown) => {
                    logDeliveryError('liveResponse/plain/edit', error);
                    liveResponseMessages[i] = await channel.send({ content: plainChunks[i] }).catch((sendError: unknown) => {
                        logDeliveryError('liveResponse/plain/resend', sendError);
                        return null;
                    });
                });
            }
            while (liveResponseMessages.length > plainChunks.length) {
                const extra = liveResponseMessages.pop();
                if (!extra) continue;
                await extra.delete().catch(() => { });
            }
            return;
        }

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
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch((error: unknown) => {
                    logDeliveryError('liveResponse/embed/send', error);
                    return null;
                });
                continue;
            }

            await liveResponseMessages[i].edit({ embeds: [embed] }).catch(async (error: unknown) => {
                logDeliveryError('liveResponse/embed/edit', error);
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch((sendError: unknown) => {
                    logDeliveryError('liveResponse/embed/resend', sendError);
                    return null;
                });
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

        if (outputFormat === 'plain') {
            const formatted = formatForDiscord((rawText || '').trim());
            const plainContent = `**${title}**\n${formatted}\n_${footerText}_`;
            const plainChunks = splitPlainText(plainContent);
            const renderKey = `${title}|plain|${footerText}|${plainChunks.join('\n<<<PAGE_BREAK>>>\n')}`;
            if (renderKey === lastLiveActivityKey && liveActivityMessages.length > 0) return;
            lastLiveActivityKey = renderKey;

            for (let i = 0; i < plainChunks.length; i++) {
                if (!liveActivityMessages[i]) {
                    liveActivityMessages[i] = await channel.send({ content: plainChunks[i] }).catch((error: unknown) => {
                        logDeliveryError('liveActivity/plain/send', error);
                        return null;
                    });
                    continue;
                }
                await liveActivityMessages[i].edit({ content: plainChunks[i] }).catch(async (error: unknown) => {
                    logDeliveryError('liveActivity/plain/edit', error);
                    liveActivityMessages[i] = await channel.send({ content: plainChunks[i] }).catch((sendError: unknown) => {
                        logDeliveryError('liveActivity/plain/resend', sendError);
                        return null;
                    });
                });
            }
            while (liveActivityMessages.length > plainChunks.length) {
                const extra = liveActivityMessages.pop();
                if (!extra) continue;
                await extra.delete().catch(() => { });
            }
            return;
        }

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
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch((error: unknown) => {
                    logDeliveryError('liveActivity/embed/send', error);
                    return null;
                });
                continue;
            }

            await liveActivityMessages[i].edit({ embeds: [embed] }).catch(async (error: unknown) => {
                logDeliveryError('liveActivity/embed/edit', error);
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch((sendError: unknown) => {
                    logDeliveryError('liveActivity/embed/resend', sendError);
                    return null;
                });
            });
        }

        while (liveActivityMessages.length > descriptions.length) {
            const extra = liveActivityMessages.pop();
            if (!extra) continue;
            await extra.delete().catch(() => { });
        }
    }, `upsert-activity:${opts?.source ?? 'unknown'}`);


    try {
        const baseline = await captureResponseMonitorBaseline(cdp);

        logger.prompt(prompt);

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
            signalCompletion('inject-failed');
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
            extractionMode: options?.extractionMode,
            initialBaselineText: baseline.text,
            initialSeenProcessLogKeys: baseline.processLogKeys,

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

                try {
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
                                await channel.send({ ...modelsPayload }).catch((error: unknown) => {
                                    logDeliveryError('quota/modelsPayload/send', error);
                                });
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
                                const projectName = session
                                    ? bridge.pool.extractProjectName(session.workspacePath)
                                    : cdp.getCurrentWorkspaceName();
                                if (projectName) {
                                    registerApprovalSessionChannel(bridge, projectName, sessionInfo.title, wrapDiscordChannel(message.channel as any));
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
                } finally {
                    signalCompletion('onComplete');
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
                } finally {
                    signalCompletion('onTimeout');
                }
            },
        });

        await monitor.start();

        // 1-second elapsed timer — updates footer independently of process log events
        const elapsedTimer = setInterval(() => {
            if (isFinalized) {
                clearInterval(elapsedTimer);
                return;
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
                    source: 'elapsed-tick',
                    expectedVersion: activityVersion,
                    skipWhenFinalized: true,
                },
            ).catch(() => { });
        }, 1000);

    } catch (e: any) {
        isFinalized = true;
        await sendEmbed(
            `${PHASE_ICONS.error} Error`,
            t(`Error occurred during processing: ${e.message}`),
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
        signalCompletion('top-level-catch');
    }
}

// =============================================================================
// Bot main entry point
// =============================================================================

export const startBot = async (cliLogLevel?: LogLevel) => {
    const config = loadConfig();
    logger.setLogLevel(cliLogLevel ?? config.logLevel);

    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'antigravity.db';
    const db = new Database(dbPath);
    const modeService = new ModeService();
    const modelService = new ModelService();
    const templateRepo = new TemplateRepository(db);
    const userPrefRepo = new UserPreferenceRepository(db);
    const accountPrefRepo = new AccountPreferenceRepository(db);
    const channelPrefRepo = new ChannelPreferenceRepository(db);

    // Eagerly load default model from DB (single-user bot optimization)
    try {
        const firstUser = db.prepare('SELECT user_id FROM user_preferences LIMIT 1').get() as { user_id: string } | undefined;
        if (firstUser) {
            const savedDefault = userPrefRepo.getDefaultModel(firstUser.user_id);
            modelService.loadDefaultModel(savedDefault);
        }
    } catch {
        // DB may not have user_preferences yet — safe to ignore
    }
    const workspaceBindingRepo = new WorkspaceBindingRepository(db);
    const chatSessionRepo = new ChatSessionRepository(db);
    const workspaceService = new WorkspaceService(config.workspaceBaseDir);
    const channelManager = new ChannelManager();

    // Auto-launch Antigravity with CDP port if not already running
    await ensureAntigravityRunning();

    // Initialize CDP bridge (lazy connection: pool creation only)
    const accountPorts = Object.fromEntries(
        (config.antigravityAccounts ?? []).map((account) => [account.name, account.cdpPort]),
    );
    const accountUserDataDirs = Object.fromEntries(
        (config.antigravityAccounts ?? [])
            .filter((account) => typeof account.userDataDir === 'string' && account.userDataDir.trim().length > 0)
            .map((account) => [account.name, account.userDataDir!.trim()]),
    );
    const bridge = initCdpBridge(config.autoApproveFileEdits, accountPorts, accountUserDataDirs);

    // Initialize CDP-dependent services (constructor CDP dependency removed)
    const chatSessionService = new ChatSessionService();
    const titleGenerator = new TitleGeneratorService();
    const promptDispatcher = new PromptDispatcher({
        bridge,
        modeService,
        modelService,
        sendPromptImpl: sendPromptToAntigravity,
    });

    // Initialize command handlers (joinHandler is created after client, see below)
    const wsHandler = new WorkspaceCommandHandler(
        workspaceBindingRepo,
        chatSessionRepo,
        workspaceService,
        channelManager,
        async (workspaceName, newChannelId, sourceChannelId, userId) => {
            const workspacePath = workspaceService.getWorkspacePath(workspaceName);
            const selectedAccount = resolveScopedAccountName({
                channelId: sourceChannelId,
                userId,
                sessionAccountName: chatSessionRepo.findByChannelId(sourceChannelId)?.activeAccountName ?? null,
                parentChannelId: null,
                selectedAccountByChannel: bridge.selectedAccountByChannel,
                channelPrefRepo,
                accountPrefRepo,
                accounts: config.antigravityAccounts,
            });

            chatSessionRepo.setActiveAccountName(newChannelId, selectedAccount);
            bridge.selectedAccountByChannel?.set(newChannelId, selectedAccount);
            bridge.pool.setPreferredAccountForWorkspace(workspacePath, selectedAccount);

            const cdp = new CdpService({
                accountName: selectedAccount,
                accountPorts,
                accountUserDataDirs,
                cdpCallTimeout: 15000,
                maxReconnectAttempts: 0,
            });

            try {
                await cdp.openWorkspace(workspacePath);
            } finally {
                await cdp.disconnect().catch(() => {});
            }

            await bridge.pool.getOrConnect(workspacePath, { name: selectedAccount });
        },
    );
    const chatHandler = new ChatCommandHandler(
        chatSessionService,
        chatSessionRepo,
        workspaceBindingRepo,
        channelManager,
        workspaceService,
        bridge.pool,
        (channelId, userId) => resolveScopedAccountName({
            channelId,
            userId,
            sessionAccountName: chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null,
            parentChannelId: null,
            selectedAccountByChannel: bridge.selectedAccountByChannel,
            channelPrefRepo,
            accountPrefRepo,
            accounts: config.antigravityAccounts,
        }),
    );
    const cleanupHandler = new CleanupCommandHandler(chatSessionRepo, workspaceBindingRepo);

    const slashCommandHandler = new SlashCommandHandler(templateRepo);

    // Discord platform — only initialise the Discord client when the platform is enabled
    if (config.platforms.includes('discord')) {

    if (!config.discordToken || !config.clientId) {
        logger.error('Discord platform enabled but discordToken or clientId is missing. Skipping Discord initialization.');
    } else {

    const discordToken = config.discordToken;
    const discordClientId = config.clientId;

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    const joinHandler = new JoinCommandHandler(
        chatSessionService,
        chatSessionRepo,
        workspaceBindingRepo,
        channelManager,
        bridge.pool,
        workspaceService,
        client,
        config.extractionMode,
        (channelId, userId) => resolveScopedAccountName({
            channelId,
            userId,
            sessionAccountName: chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null,
            parentChannelId: null,
            selectedAccountByChannel: bridge.selectedAccountByChannel,
            channelPrefRepo,
            accountPrefRepo,
            accounts: config.antigravityAccounts,
        }),
    );

    client.once(Events.ClientReady, async (readyClient) => {
        logger.info(`Ready! Logged in as ${readyClient.user.tag} | extractionMode=${config.extractionMode}`);

        try {
            await registerSlashCommands(discordToken, discordClientId, config.guildId);
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
        parseRunCommandCustomId,
        joinHandler,
        userPrefRepo,
        accountPrefRepo,
        channelPrefRepo,
        chatSessionRepo,
        antigravityAccounts: config.antigravityAccounts,
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
            accountPrefRepoArg,
            channelPrefRepoArg,
            antigravityAccountsArg,
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
            joinHandler,
            userPrefRepo,
            accountPrefRepoArg,
            channelPrefRepoArg,
            antigravityAccountsArg,
            chatSessionRepo,
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
                    const selectedAccount = resolveScopedAccountName({
                        channelId,
                        userId: interaction.user.id,
                        sessionAccountName: chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null,
                        parentChannelId: inferParentScopeChannelId(
                            channelId,
                            (interaction.channel as any)?.parentId ?? null,
                        ),
                        selectedAccountByChannel: bridge.selectedAccountByChannel,
                        channelPrefRepo,
                        accountPrefRepo,
                        accounts: config.antigravityAccounts,
                    });
                    bridge.selectedAccountByChannel?.set(channelId, selectedAccount);

                    cdp = await bridge.pool.getOrConnect(workspacePath, { name: selectedAccount });
                    const projectName = bridge.pool.extractProjectName(workspacePath);
                    bridge.lastActiveWorkspace = projectName;
                    const platformCh = wrapDiscordChannel(interaction.channel as any);
                    bridge.lastActiveChannel = platformCh;
                    registerApprovalWorkspaceChannel(bridge, projectName, platformCh);
                    const session = chatSessionRepo.findByChannelId(channelId);
                    if (session?.displayName) {
                        registerApprovalSessionChannel(bridge, projectName, session.displayName, platformCh);
                    }
                    ensureApprovalDetector(bridge, cdp, projectName, selectedAccount);
                    ensureErrorPopupDetector(bridge, cdp, projectName, selectedAccount);
                    ensurePlanningDetector(bridge, cdp, projectName, selectedAccount);
                    ensureRunCommandDetector(bridge, cdp, projectName, selectedAccount);
                } catch (e: any) {
                    await interaction.followUp({
                        content: `Failed to connect to workspace: ${e.message}`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
            } else {
                const selectedAccount = resolveScopedAccountName({
                    channelId,
                    userId: interaction.user.id,
                    sessionAccountName: chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null,
                    parentChannelId: inferParentScopeChannelId(
                        channelId,
                        (interaction.channel as any)?.parentId ?? null,
                    ),
                    selectedAccountByChannel: bridge.selectedAccountByChannel,
                    channelPrefRepo,
                    accountPrefRepo,
                    accounts: config.antigravityAccounts,
                });
                cdp = bridge.lastActiveWorkspace
                    ? bridge.pool.getConnected(bridge.lastActiveWorkspace, selectedAccount)
                    : null;
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
                        userPrefRepo,
                        extractionMode: config.extractionMode,
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
        userPrefRepo,
        accountPrefRepo,
        channelPrefRepo,
        antigravityAccounts: config.antigravityAccounts,
    }));

    await client.login(discordToken);

    } // end: else (credentials present)
    } // end: Discord platform gate

    // Telegram platform
    if (config.platforms.includes('telegram') && config.telegramToken) {
        try {
            const telegramBot = new Bot(config.telegramToken);
            // Attach toInputFile so wrappers can convert Buffer to grammY InputFile
            (telegramBot as any).toInputFile = (data: Buffer, filename?: string) => new InputFile(data, filename);
            // Retry getMe() up to 3 times to handle transient network failures
            const botInfo = await (async () => {
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        return await telegramBot.api.getMe();
                    } catch (err: any) {
                        if (attempt === 3) throw err;
                        logger.warn(`[Telegram] getMe() failed (attempt ${attempt}/3): ${err?.message ?? err}. Retrying in 3s...`);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
                throw new Error('getMe() failed after 3 attempts');
            })();

            const telegramBindingRepo = new TelegramBindingRepository(db);
            const telegramAdapter = new TelegramAdapter(telegramBot as any, String(botInfo.id));

            const activeMonitors = new Map<string, ResponseMonitor>();
            const telegramHandler = createTelegramMessageHandler({
                bridge,
                telegramBindingRepo,
                workspaceService,
                modeService,
                modelService,
                extractionMode: config.extractionMode,
                templateRepo,
                fetchQuota: () => bridge.quota.fetchQuota(),
                activeMonitors,
                botToken: config.telegramToken,
                botApi: telegramBot.api as any,
                chatSessionService,
                accountPrefRepo,
                channelPrefRepo,
                antigravityAccounts: config.antigravityAccounts,
            });

            // Compose select handlers: project select + mode select
            const projectSelectHandler = createTelegramSelectHandler({
                botApi: telegramBot.api as any,
                bridge,
                workspaceService,
                telegramBindingRepo,
            });
            const modeSelectAction = createModeSelectAction({ bridge, modeService });
            const accountSelectAction = createAccountSelectAction({
                bridge,
                accountPrefRepo,
                channelPrefRepo,
                chatSessionRepo,
                antigravityAccounts: config.antigravityAccounts,
                getWorkspacePathForChannel: (channelId: string) => {
                    const binding = telegramBindingRepo.findByChatId(channelId);
                    if (!binding) return null;
                    return workspaceService
                        ? workspaceService.getWorkspacePath(binding.workspacePath)
                        : binding.workspacePath;
                },
            });
            const telegramSelectHandler = createPlatformSelectHandler({
                actions: [
                    modeSelectAction,
                    accountSelectAction,
                ],
            });
            // Composite handler that routes to the right handler
            const compositeSelectHandler = async (interaction: import('../platform/types').PlatformSelectInteraction) => {
                if (interaction.customId === SESSION_SELECT_ID) {
                    await handleTelegramJoinSelect({
                        bridge,
                        botApi: telegramBot.api as any,
                        telegramBindingRepo,
                        workspaceService,
                        chatSessionService,
                        accountPrefRepo,
                        channelPrefRepo,
                        antigravityAccounts: config.antigravityAccounts,
                    }, interaction);
                    return;
                }
                if (interaction.customId === 'mode_select' || interaction.customId === 'account_select') {
                    await telegramSelectHandler(interaction);
                    return;
                }
                await projectSelectHandler(interaction);
            };

            const allowedUsers = new Map<PlatformType, ReadonlySet<string>>();
            if (config.telegramAllowedUserIds && config.telegramAllowedUserIds.length > 0) {
                allowedUsers.set('telegram', new Set(config.telegramAllowedUserIds));
            } else {
                logger.warn('Telegram platform enabled but TELEGRAM_ALLOWED_USER_IDS is empty — all users will be denied access.');
            }

            const telegramButtonHandler = createPlatformButtonHandler({
                actions: [
                    createApprovalButtonAction({ bridge }),
                    createPlanningButtonAction({ bridge }),
                    createErrorPopupButtonAction({ bridge }),
                    createRunCommandButtonAction({ bridge }),
                    createModelButtonAction({ bridge, fetchQuota: () => bridge.quota.fetchQuota(), modelService, userPrefRepo }),
                    createAutoAcceptButtonAction({ autoAcceptService: bridge.autoAccept }),
                    createTemplateButtonAction({ bridge, templateRepo }),
                ],
            });

            const eventRouter = new EventRouter(
                { allowedUsers },
                {
                    onMessage: telegramHandler,
                    onButtonInteraction: telegramButtonHandler,
                    onSelectInteraction: compositeSelectHandler,
                },
            );
            // Register bot commands BEFORE starting polling so Telegram shows "/" suggestions
            await telegramBot.api.setMyCommands([
                { command: 'start', description: 'Welcome message' },
                { command: 'project', description: 'Manage workspace bindings' },
                { command: 'status', description: 'Show bot status and connections' },
                { command: 'mode', description: 'Switch execution mode' },
                { command: 'model', description: 'Switch LLM model' },
                { command: 'screenshot', description: 'Capture Antigravity screenshot' },
                { command: 'autoaccept', description: 'Toggle auto-accept mode' },
                { command: 'account', description: 'Switch Antigravity account' },
                { command: 'project_reopen', description: 'Reopen bound project in account' },
                { command: 'template', description: 'List prompt templates' },
                { command: 'template_add', description: 'Add a prompt template' },
                { command: 'template_delete', description: 'Delete a prompt template' },
                { command: 'project_create', description: 'Create a new workspace' },
                { command: 'new', description: 'Start a new chat session' },
                { command: 'join', description: 'Take over an existing session' },
                { command: 'mirror', description: 'Toggle PC-to-Telegram message mirroring' },
                { command: 'logs', description: 'Show recent log entries' },
                { command: 'stop', description: 'Interrupt active LLM generation' },
                { command: 'help', description: 'Show available commands' },
                { command: 'ping', description: 'Check bot latency' },
            ]).catch((e: unknown) => {
                logger.warn('Failed to register Telegram commands:', e instanceof Error ? e.message : e);
            });

            eventRouter.registerAdapter(telegramAdapter);
            await eventRouter.startAll();

            logger.info(`Telegram bot started: @${botInfo.username} (${config.telegramAllowedUserIds?.length ?? 0} allowed users)`);

            // Send startup message to one Telegram target:
            // prefer a group named "general", otherwise the first private chat.
            const bindings = telegramBindingRepo.findAll();
            if (bindings.length > 0) {
                const os = await import('os');
                const pkg = await import('../../package.json');
                const version = pkg.default?.version ?? pkg.version ?? 'unknown';
                const projects = workspaceService.scanWorkspaces();
                const activeWorkspaces = bridge.pool.getActiveWorkspaceNames();
                const cdpStatus = activeWorkspaces.length > 0
                    ? `Connected (${activeWorkspaces.join(', ')})`
                    : 'Not connected';

                const startupText = [
                    '<b>LazyGravity Online</b>',
                    '',
                    `Version: ${version}`,
                    `Node.js: ${process.versions.node}`,
                    `OS: ${os.platform()} ${os.release()}`,
                    `CDP: ${cdpStatus}`,
                    `Model: ${modelService.getCurrentModel()}`,
                    `Mode: ${modeService.getCurrentMode()}`,
                    `Projects: ${projects.length} registered`,
                    `Extraction: ${config.extractionMode}`,
                    '',
                    `<i>Started at ${new Date().toLocaleString()}</i>`,
                ].join('\n');

                const sendWithRetry = async (chatId: number | string, text: string, retries = 3, delayMs = 2000): Promise<void> => {
                    for (let attempt = 1; attempt <= retries; attempt++) {
                        try {
                            await telegramBot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
                            return;
                        } catch (err) {
                            if (attempt < retries) {
                                logger.debug(`[Telegram] Startup message attempt ${attempt}/${retries} failed, retrying in ${delayMs}ms...`);
                                await new Promise((r) => setTimeout(r, delayMs));
                            } else {
                                throw err;
                            }
                        }
                    }
                };

                const targetChatId = await selectTelegramStartupChatId(telegramBot.api, bindings);
                if (targetChatId) {
                    try {
                        await sendWithRetry(targetChatId, startupText);
                        logger.info(`Telegram startup message sent to chat ${targetChatId}.`);
                    } catch (error: any) {
                        logger.warn(`[Telegram] Startup message failed for chat ${targetChatId} after retries: ${error?.message ?? 'unknown error'}`);
                    }
                }
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error('Failed to start Telegram adapter:', message);
        }
    }
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
export async function handleSlashInteraction(
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
    joinHandler?: JoinCommandHandler,
    userPrefRepo?: UserPreferenceRepository,
    accountPrefRepo?: AccountPreferenceRepository,
    channelPrefRepo?: ChannelPreferenceRepository,
    antigravityAccounts: AntigravityAccountConfig[] = [{ name: 'default', cdpPort: 9222 }],
    chatSessionRepo?: ChatSessionRepository,
): Promise<void> {
    const commandName = interaction.commandName;
    const getAccountPort = (accountName: string): number | null => {
        const match = antigravityAccounts.find((account) => account.name === accountName);
        return match ? match.cdpPort : null;
    };
    const parentChannelId = inferParentScopeChannelId(
        interaction.channelId,
        (interaction.channel as any)?.parentId ?? null,
    );
    const getSessionAccountName = (): string | null =>
        chatSessionRepo?.findByChannelId(interaction.channelId)?.activeAccountName ?? null;
    const resolveSelectedAccount = (): string =>
        resolveScopedAccountName({
            channelId: interaction.channelId,
            userId: interaction.user.id,
            sessionAccountName: getSessionAccountName(),
            parentChannelId,
            selectedAccountByChannel: bridge.selectedAccountByChannel,
            channelPrefRepo,
            accountPrefRepo,
            accounts: antigravityAccounts,
        });
    const getChannelWorkspacePath = (): string | undefined =>
        wsHandler.getWorkspaceForChannel(interaction.channelId);
    const getChannelCdp = (): CdpService | null =>
        (() => {
            const workspacePath = getChannelWorkspacePath();
            if (workspacePath) {
                const projectName = bridge.pool.extractProjectName(workspacePath);
                return bridge.pool.getConnected(projectName, resolveSelectedAccount());
            }

            return bridge.lastActiveWorkspace
                ? bridge.pool.getConnected(bridge.lastActiveWorkspace, resolveSelectedAccount())
                : null;
        })();
    const ensureChannelCdp = async (): Promise<CdpService | null> => {
        const existing = getChannelCdp();
        if (existing) return existing;

        const workspacePath = getChannelWorkspacePath();
        if (!workspacePath) return null;

        try {
            return await bridge.pool.getOrConnect(workspacePath, { name: resolveSelectedAccount() });
        } catch {
            return null;
        }
    };

    switch (commandName) {
        case 'help': {
            const helpFields = [
                {
                    name: '💬 Chat', value: [
                        '`/new` — Start a new chat session',
                        '`/chat` — Show current session info + list',
                    ].join('\n')
                },
                {
                    name: '🔗 Session', value: [
                        '`/join` — Join an existing Antigravity session',
                        '`/mirror` — Toggle PC→Discord mirroring ON/OFF',
                    ].join('\n')
                },
                {
                    name: '⏹️ Control', value: [
                        '`/stop` — Interrupt active LLM generation',
                        '`/project reopen` — Reopen the bound project in the selected account',
                        '`/screenshot` — Capture Antigravity screen',
                    ].join('\n')
                },
                {
                    name: '⚙️ Settings', value: [
                        '`/mode` — Display and change execution mode',
                        '`/model [name]` — Display and change LLM model',
                        '`/output [format]` — Toggle Embed / Plain Text output',
                    ].join('\n')
                },
                {
                    name: '📁 Projects', value: [
                        '`/project` — Display project list',
                        '`/project create <name>` — Create a new project',
                        '`/project reopen` — Reopen the bound project in the selected account',
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
                        '`/account` — Show and switch Antigravity account',
                        '`/logs [lines] [level]` — View recent bot logs',
                        '`/cleanup [days]` — Clean up unused channels/categories',
                        '`/help` — Show this help',
                    ].join('\n')
                },
            ];

            const helpOutputFormat = userPrefRepo?.getOutputFormat(interaction.user.id) ?? 'embed';
            if (helpOutputFormat === 'plain') {
                const chunks = formatAsPlainText({
                    title: '📖 LazyGravity Commands',
                    description: 'Commands for controlling Antigravity from Discord.',
                    fields: helpFields,
                    footerText: 'Text messages are sent directly to Antigravity',
                });
                await interaction.editReply({ content: chunks[0] });
                break;
            }

            const embed = new EmbedBuilder()
                .setTitle('📖 LazyGravity Commands')
                .setColor(0x5865F2)
                .setDescription('Commands for controlling Antigravity from Discord.')
                .addFields(...helpFields)
                .setFooter({ text: 'Text messages are sent directly to Antigravity' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'mode': {
            await sendModeUI(interaction, modeService, { getCurrentCdp: () => getChannelCdp() });
            break;
        }

        case 'model': {
            const modelName = interaction.options.getString('name');
            if (!modelName) {
                const cdp = await ensureChannelCdp();
                if (!cdp) {
                    await interaction.editReply({ content: 'Not connected to CDP.' });
                    break;
                }
                await sendModelsUI(interaction, {
                    getCurrentCdp: () => cdp,
                    fetchQuota: async () => bridge.quota.fetchQuota(),
                });
            } else {
                const cdp = await ensureChannelCdp();
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
                const cdp = getChannelCdp();
                return cdp ? 'CDP Connected' : 'Disconnected';
            })();
            const currentMode = modeService.getCurrentMode();
            const session = chatSessionRepo?.findByChannelId(interaction.channelId);

            const mirroringWorkspaces = activeNames.filter(
                (name) => bridge.pool.getUserMessageDetector(name)?.isActive(),
            );
            const mirrorStatus = mirroringWorkspaces.length > 0
                ? `📡 ON (${mirroringWorkspaces.join(', ')})`
                : '⚪ OFF';
            const currentAccount = resolveSelectedAccount();
            const originalAccount = session?.originAccountName ?? '(unset)';
            const conversationTitle = session?.displayName ?? '(New chat / no saved title)';

            const statusFields = [
                { name: 'CDP Connection', value: activeNames.length > 0 ? `🟢 ${activeNames.length} project(s) connected` : '⚪ Disconnected', inline: true },
                { name: 'Mode', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                { name: 'Auto Approve', value: autoAcceptService.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                { name: 'Mirroring', value: mirrorStatus, inline: true },
                { name: 'Active Account', value: currentAccount, inline: true },
                { name: 'Original Account', value: originalAccount, inline: true },
                { name: 'Conversation Title', value: conversationTitle, inline: false },
            ];

            let statusDescription = '';
            if (activeNames.length > 0) {
                const lines = activeNames.map((name) => {
                    const cdp = bridge.pool.getConnected(name);
                    const contexts = cdp ? cdp.getContexts().length : 0;
                    const detectorActive = bridge.pool.getApprovalDetector(name)?.isActive() ? ' [Detecting]' : '';
                    const mirrorActive = bridge.pool.getUserMessageDetector(name)?.isActive() ? ' [Mirror]' : '';
                    return `• **${name}** — Contexts: ${contexts}${detectorActive}${mirrorActive}`;
                });
                statusDescription = `**Connected Projects:**\n${lines.join('\n')}`;
            } else {
                statusDescription = 'Send a message to auto-connect to a project.';
            }

            const statusOutputFormat = userPrefRepo?.getOutputFormat(interaction.user.id) ?? 'embed';
            if (statusOutputFormat === 'plain') {
                const chunks = formatAsPlainText({
                    title: '🔧 Bot Status',
                    description: statusDescription,
                    fields: statusFields,
                });
                await interaction.editReply({ content: chunks[0] });
                break;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔧 Bot Status')
                .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                .addFields(...statusFields)
                .setDescription(statusDescription)
                .setTimestamp();

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

        case 'account': {
            if (!accountPrefRepo) {
                await interaction.editReply({ content: 'Account preference service not available.' });
                break;
            }

            const requested = interaction.options.getString('name');
            if (!requested) {
                const current = resolveSelectedAccount();
                const names = listAccountNames(antigravityAccounts);
                await sendAccountUI(interaction, current, names);
                break;
            }

            if (!listAccountNames(antigravityAccounts).includes(requested)) {
                await interaction.editReply({ content: `⚠️ Unknown account: **${requested}**` });
                break;
            }

            bridge.selectedAccountByChannel?.set(interaction.channelId, requested);
            const currentSession = chatSessionRepo?.findByChannelId(interaction.channelId);
            if (currentSession) {
                chatSessionRepo?.setActiveAccountName(interaction.channelId, requested);
            } else {
                accountPrefRepo.setAccountName(interaction.user.id, requested);
                channelPrefRepo?.setAccountName(interaction.channelId, requested);
            }

            const channelWorkspace = wsHandler.getWorkspaceForChannel(interaction.channelId);

            logger.info(
                `[AccountSwitch] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
                `account=${requested} port=${getAccountPort(requested) ?? 'unknown'} ` +
                `workspace=${channelWorkspace ?? 'unbound'}`,
            );

            await interaction.editReply({ content: `✅ Switched session account to **${requested}**.` });
            break;
        }

        case 'output': {
            if (!userPrefRepo) {
                await interaction.editReply({ content: 'Output preference service not available.' });
                break;
            }

            const requestedFormat = interaction.options.getString('format');
            if (!requestedFormat) {
                const currentFormat = userPrefRepo.getOutputFormat(interaction.user.id);
                await sendOutputUI(interaction, currentFormat);
                break;
            }

            const format: OutputFormat = requestedFormat === 'plain' ? 'plain' : 'embed';
            userPrefRepo.setOutputFormat(interaction.user.id, format);
            const label = format === 'plain' ? 'Plain Text' : 'Embed';
            await interaction.editReply({ content: `Output format changed to **${label}**.` });
            break;
        }

        case 'screenshot': {
            await handleScreenshot(interaction, getChannelCdp());
            break;
        }

        case 'stop': {
            const cdp = getChannelCdp();
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
            } else if (wsSub === 'account') {
                const requested = interaction.options.getString('name');
                const names = listAccountNames(antigravityAccounts);
                const currentProjectAccount = channelPrefRepo?.getAccountName(interaction.channelId) ?? null;

                if (!requested) {
                    await interaction.editReply({
                        content: `Project channel account: **${currentProjectAccount ?? 'unset'}**\nAvailable: ${names.join(', ')}`,
                    });
                    break;
                }

                if (!names.includes(requested)) {
                    await interaction.editReply({ content: `⚠️ Unknown account: **${requested}**` });
                    break;
                }

                channelPrefRepo?.setAccountName(interaction.channelId, requested);
                bridge.selectedAccountByChannel?.set(interaction.channelId, requested);

                const channelWorkspace = wsHandler.getWorkspaceForChannel(interaction.channelId);
                logger.info(
                    `[ProjectAccountSwitch] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
                    `account=${requested} port=${getAccountPort(requested) ?? 'unknown'} ` +
                    `workspace=${channelWorkspace ?? 'unbound'}`,
                );

                await interaction.editReply({ content: `✅ Bound this project channel to account **${requested}**.` });
                break;
            } else if (wsSub === 'reopen') {
                const workspacePath = wsHandler.getWorkspaceForChannel(interaction.channelId);
                if (!workspacePath) {
                    await interaction.editReply({
                        content: '⚠️ No project is bound to this channel. Use `/project` first.',
                    });
                    break;
                }

                if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
                    await interaction.editReply({
                        content: `❌ Project folder does not exist: \`${workspacePath}\``,
                    });
                    break;
                }

                const requestedReopenAccount = interaction.options.getString('account');
                const availableAccountNames = listAccountNames(antigravityAccounts);
                if (requestedReopenAccount && !availableAccountNames.includes(requestedReopenAccount)) {
                    await interaction.editReply({ content: `⚠️ Unknown account: **${requestedReopenAccount}**` });
                    break;
                }

                const selectedAccount = requestedReopenAccount || resolveSelectedAccount();
                const port = getAccountPort(selectedAccount);
                const accountPorts = Object.fromEntries(
                    antigravityAccounts.map((account) => [account.name, account.cdpPort]),
                );
                const accountUserDataDirs = Object.fromEntries(
                    antigravityAccounts
                        .filter((account) => typeof account.userDataDir === 'string' && account.userDataDir.trim().length > 0)
                        .map((account) => [account.name, account.userDataDir!.trim()]),
                );
                const projectName = bridge.pool.extractProjectName(workspacePath);
                const previousPreferredAccount = bridge.pool.getPreferredAccountForWorkspace(workspacePath);
                const session = chatSessionRepo?.findByChannelId(interaction.channelId);
                const savedConversationTitle = session?.displayName?.trim() || '';
                const savedConversationId = session?.conversationId?.trim() || '';
                const originAccountName = session?.originAccountName?.trim() || '';

                logger.info(
                    `[ProjectReopenCommand] channel=${interaction.channelId} user=${interaction.user.id} ` +
                    `project=${projectName} account=${selectedAccount} ` +
                    `port=${port ?? 'unknown'} workspacePath=${workspacePath}`,
                );

                try {
                    const inspectWorkspaceRuntime = async (
                        accountName: string,
                    ): Promise<{ isOpen: boolean; isGenerating: boolean; sessionTitle: string; hasActiveChat: boolean }> => {
                        const cdp = new CdpService({
                            accountName,
                            accountPorts,
                            accountUserDataDirs,
                            cdpCallTimeout: 15000,
                            maxReconnectAttempts: 0,
                        });

                        try {
                            const connected = await cdp.discoverAndConnectForWorkspace(workspacePath).catch(() => false);
                            if (!connected) {
                                return {
                                    isOpen: false,
                                    isGenerating: false,
                                    sessionTitle: '',
                                    hasActiveChat: false,
                                };
                            }

                            const runtimeState = await cdp.inspectWorkspaceRuntimeState();
                            return {
                                isOpen: true,
                                isGenerating: runtimeState.isGenerating,
                                sessionTitle: runtimeState.sessionTitle,
                                hasActiveChat: runtimeState.hasActiveChat,
                            };
                        } finally {
                            await cdp.disconnect().catch(() => {});
                        }
                    };

                    const quitAccountInstanceGracefully = async (
                        accountName: string,
                        role: 'origin' | 'target',
                    ): Promise<void> => {
                        const closed = await quitAntigravityProfile(accountName).catch(() => false);
                        if (!closed) {
                            throw new Error(
                                `Could not quit the ${role} account **${accountName}** cleanly. ` +
                                `Use Cmd+Q on that Antigravity instance, then rerun \`/project reopen\`.`,
                            );
                        }

                        logger.info(
                            `[ProjectReopenCommand] Quit ${role} Antigravity account before reopen for channel=${interaction.channelId} ` +
                            `account=${accountName} project=${projectName} closed=${closed}`,
                        );
                    };

                    const accountsToInspect = Array.from(
                        new Set([
                            selectedAccount,
                            ...(savedConversationTitle && originAccountName && originAccountName !== selectedAccount
                                ? [originAccountName]
                                : []),
                        ]),
                    );
                    const busySessions: string[] = [];
                    for (const accountName of accountsToInspect) {
                        const runtime = await inspectWorkspaceRuntime(accountName);
                        if (!runtime.isOpen || !runtime.isGenerating) {
                            continue;
                        }

                        const sessionTitle = runtime.hasActiveChat
                            ? runtime.sessionTitle
                            : (savedConversationTitle || '(Untitled)');
                        const role = accountName === selectedAccount ? 'target' : 'origin';
                        busySessions.push(`${role} account **${accountName}** is still running session **${sessionTitle}**`);
                    }

                    if (busySessions.length > 0) {
                        throw new Error(
                            `${busySessions.join(' and ')}. Use \`/stop\` in that session, close the workspace, then rerun \`/project reopen\`.`,
                        );
                    }

                    if (
                        savedConversationTitle
                        && originAccountName
                        && originAccountName !== selectedAccount
                    ) {
                        let transferResult;
                        let resolvedConversationId = savedConversationId;

                        await quitAccountInstanceGracefully(originAccountName, 'origin');

                        if (resolvedConversationId) {
                            await waitForConversationPersistenceByConversationId(originAccountName, resolvedConversationId, {
                                timeoutMs: 20000,
                                pollIntervalMs: 500,
                            });
                        } else {
                            const persistedEntry = await waitForConversationPersistence(originAccountName, savedConversationTitle, {
                                timeoutMs: 20000,
                                pollIntervalMs: 500,
                            });
                            const latestEntry = findLatestTrajectoryEntryByTitle(originAccountName, savedConversationTitle);
                            resolvedConversationId = latestEntry?.conversationId ?? persistedEntry.conversationId;

                            if (resolvedConversationId && chatSessionRepo) {
                                chatSessionRepo.setConversationId(interaction.channelId, resolvedConversationId);
                            }
                        }

                        await quitAccountInstanceGracefully(selectedAccount, 'target');

                        transferResult = resolvedConversationId
                            ? transferConversationByConversationId(
                                originAccountName,
                                selectedAccount,
                                resolvedConversationId,
                            )
                            : transferConversationByTitle(
                                originAccountName,
                                selectedAccount,
                                savedConversationTitle,
                            );
                        logger.info(
                            `[ProjectReopenCommand] Imported conversation for channel=${interaction.channelId} ` +
                            `title="${savedConversationTitle}" sourceAccount=${originAccountName} ` +
                            `targetAccount=${selectedAccount} conversationId=${transferResult.conversationId}`,
                        );

                        if (chatSessionRepo && transferResult.conversationId) {
                            chatSessionRepo.setConversationId(interaction.channelId, transferResult.conversationId);
                        }
                    } else {
                        await quitAccountInstanceGracefully(selectedAccount, 'target');
                    }

                    const cdp = new CdpService({
                        accountName: selectedAccount,
                        accountPorts,
                        accountUserDataDirs,
                        cdpCallTimeout: 15000,
                        maxReconnectAttempts: 0,
                    });

                    try {
                        await cdp.openWorkspace(workspacePath);

                        if (savedConversationTitle) {
                            const reopenSessionService = new ChatSessionService();
                            const activationResult = await reopenSessionService.activateSessionByTitle(
                                cdp,
                                savedConversationTitle,
                                {
                                    maxWaitMs: 15000,
                                    retryIntervalMs: 500,
                                    allowVisibilityWarmupMs: 4000,
                                },
                            );

                            if (!activationResult.ok) {
                                throw new Error(
                                    `Workspace reopened in account "${selectedAccount}", but failed to activate session ` +
                                    `"${savedConversationTitle}" in Antigravity: ${activationResult.error || 'unknown error'}`,
                                );
                            }
                        }
                    } finally {
                        await cdp.disconnect().catch(() => {});
                    }

                    bridge.selectedAccountByChannel?.set(interaction.channelId, selectedAccount);
                    bridge.pool.setPreferredAccountForWorkspace(workspacePath, selectedAccount);

                    if (chatSessionRepo && session) {
                        chatSessionRepo.setActiveAccountName(interaction.channelId, selectedAccount);
                        logger.info(
                            `[ProjectReopenCommand] Updated session routing for channel=${interaction.channelId} ` +
                            `project=${projectName} oldAccount=${session.activeAccountName ?? previousPreferredAccount ?? 'unknown'} ` +
                            `newAccount=${selectedAccount} title="${savedConversationTitle || '(unset)'}"`,
                        );
                    }

                    const finalOriginAccount = chatSessionRepo?.findByChannelId(interaction.channelId)?.originAccountName
                        ?? session?.originAccountName
                        ?? '(unset)';
                    await interaction.editReply({
                        content: [
                            `✅ Reopened **${projectName}** in account **${selectedAccount}**${port ? ` (CDP ${port})` : ''}.`,
                            `Active Account: **${selectedAccount}**`,
                            `Origin Account: **${finalOriginAccount}**`,
                            `Conversation Title: **${savedConversationTitle || '(New chat / no saved title)'}**`,
                        ].join('\n'),
                    });
                } catch (error: any) {
                    logger.error('[ProjectReopenCommand] Failed to reopen workspace:', error);
                    await interaction.editReply({
                        content: `❌ Failed to reopen project in account **${selectedAccount}**: ${error?.message || String(error)}`,
                    });
                }
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

        case 'join': {
            if (joinHandler) {
                await joinHandler.handleJoin(interaction, bridge);
            } else {
                await interaction.editReply({ content: t('⚠️ Join handler not available.') });
            }
            break;
        }

        case 'mirror': {
            if (joinHandler) {
                await joinHandler.handleMirror(interaction, bridge);
            } else {
                await interaction.editReply({ content: t('⚠️ Mirror handler not available.') });
            }
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

        case 'logs': {
            const lines = interaction.options.getInteger('lines') ?? 50;
            const level = interaction.options.getString('level') as LogLevel | null;
            const entries = logBuffer.getRecent(lines, level ?? undefined);

            if (entries.length === 0) {
                await interaction.editReply({ content: 'No log entries found.' });
                break;
            }

            const formatted = entries
                .map((e) => `${e.timestamp.slice(11, 19)} ${e.message}`)
                .join('\n');

            const MAX_CONTENT = 1900;
            const codeBlock = formatted.length <= MAX_CONTENT
                ? `\`\`\`\n${formatted}\n\`\`\``
                : `\`\`\`\n${formatted.slice(0, MAX_CONTENT)}\n\`\`\`\n(truncated — showing ${MAX_CONTENT} chars of ${formatted.length})`;

            await interaction.editReply({ content: codeBlock });
            break;
        }

        default:
            await interaction.editReply({
                content: `Unknown command: /${commandName}`,
            });
    }
}
