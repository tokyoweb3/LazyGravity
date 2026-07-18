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
import { execFile } from 'child_process';
import path from 'path';

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
import { ArtifactThreadRepository } from '../database/artifactThreadRepository';
import { ScheduleRepository, ScheduleRecord } from '../database/scheduleRepository';
import { ScheduleService } from '../services/scheduleService';
import cronParser from 'cron-parser';
import { WorkspaceQueue } from './workspaceQueue';
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
import { ensureAntigravityRunning, startAntigravity, stopAntigravity } from '../services/antigravityLauncher';
import { getAntigravityCdpHint, getAntigravityCliPath } from '../utils/pathUtils';
import { fileOpenCache } from '../utils/fileOpenCache';
import { AutoAcceptService } from '../services/autoAcceptService';
import { PromptDispatcher } from '../services/promptDispatcher';
import {
    buildApprovalCustomId,
    CdpBridge,
    ensureApprovalDetector,
    ensureErrorPopupDetector,
    ensurePlanningDetector,
    ensureRunCommandDetector,
    ensureQuestionDetector,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
    parseErrorPopupCustomId,
    parsePlanningCustomId,
    buildFileChangeCustomId,
    parseFileChangeCustomId,
    parseRunCommandCustomId,
    registerApprovalSessionChannel,
    registerApprovalWorkspaceChannel,
} from '../services/cdpBridgeManager';
import { buildModeModelLines, fitForSingleEmbedDescription, splitForEmbedDescription } from '../utils/streamMessageFormatter';
import { formatForDiscord, splitOutputAndLogs } from '../utils/discordFormatter';
import { renderDiscordResponse } from '../platform/discord/discordResponseRenderer';
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
import { sendArtifactsUI, sendArtifactPickerUI, ARTIFACT_SELECT_ID } from '../ui/artifactsUi';
import { ArtifactService } from '../services/artifactService';
import { UserPreferenceRepository, OutputFormat } from '../database/userPreferenceRepository';
import { inferParentScopeChannelId, listAccountNames, resolveScopedAccountName } from '../utils/accountUtils';
import { formatAsPlainText, splitPlainText } from '../utils/plainTextFormatter';
import { createInteractionCreateHandler } from '../events/interactionCreateHandler';
import { createMessageCreateHandler } from '../events/messageCreateHandler';
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
import { HeartbeatService, parseInterval, formatDuration, formatRelativeTime } from '../services/heartbeatService';
import { createErrorPopupButtonAction } from '../handlers/errorPopupButtonAction';
import { createRunCommandButtonAction } from '../handlers/runCommandButtonAction';
import { createModelButtonAction } from '../handlers/modelButtonAction';
import { createQuestionSelectAction } from '../handlers/questionSelectAction';
import { createTemplateButtonAction } from '../handlers/templateButtonAction';
import { createFileChangeButtonAction } from '../handlers/fileChangeButtonAction';
import { createAutoAcceptButtonAction } from '../handlers/autoAcceptButtonAction';
import { createGenericActionButtonAction } from '../handlers/genericActionButtonAction';
import { createModeSelectAction } from '../handlers/modeSelectAction';
import { createAccountSelectAction } from '../handlers/accountSelectAction';
import { selectTelegramStartupChatId } from './telegramStartupTarget';
import { DEFAULT_CHANNEL_NAME } from '../services/channelManager';

/**
 * Normalize a candidate startup channel name for preference checks.
 */
function normalizeStartupChannelName(name: string): string {
    return name.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Prefer the shared default channel name plus the localized 常规 variant.
 */
function isPreferredDiscordStartupChannel(name: string): boolean {
    const normalized = normalizeStartupChannelName(name);
    return normalized === DEFAULT_CHANNEL_NAME || normalized === '常规';
}

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
/**
 * Test helper to retrieve the response delivery mode.
 * @returns Response delivery mode string.
 */
export const getResponseDeliveryModeForTest = (): string => RESPONSE_DELIVERY_MODE;

/**
 * Test helper to instantiate a serial task queue executor.
 * @param queueName Target queue identifier label.
 * @param traceId Diagnostic correlation trace ID.
 * @returns Queue runner executor function.
 */
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

// Shared fileOpenCache is imported from utils/fileOpenCache

/**
 * Send a user's prompt to Antigravity and monitor generation.
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
        artifactService?: ArtifactService;
        onFullCompletion?: () => void;
        onMonitorCreated?: (monitor: { stop: () => Promise<void> }) => void;
        extractionMode?: ExtractionMode;
        responseTimeoutMs?: number;
        resumeOnly?: boolean;
    }

): Promise<void> {
    // Completion signal — called exactly once when the entire prompt lifecycle ends
    let completionSignaled = false;
    let onApprovalRef: ((info: any) => void) | null = null;
    const signalCompletion = (exitPath: string) => {
        if (completionSignaled) return;
        completionSignaled = true;
        logger.debug(`[sendPrompt:${message.channelId}] signalCompletion via ${exitPath}`);
        if (onApprovalRef) {
            cdp.off('approval_required', onApprovalRef);
        }
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
            components?: any[]; // using any[] to avoid missing type imports like ActionRowBuilder
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
                const messageOpts: any = { content: plainChunks[i] };
                if (i === plainChunks.length - 1 && opts?.components?.length) {
                    messageOpts.components = opts.components;
                }
                
                if (!liveResponseMessages[i]) {
                    liveResponseMessages[i] = await channel.send(messageOpts).catch((error: unknown) => {
                        logDeliveryError('liveResponse/plain/send', error);
                        return null;
                    });
                    continue;
                }
                await liveResponseMessages[i].edit(messageOpts).catch(async (error: unknown) => {
                    logDeliveryError('liveResponse/plain/edit', error);
                    liveResponseMessages[i] = await channel.send(messageOpts).catch((sendError: unknown) => {
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
                const messageOpts: any = { embeds: [embed] };
                if (i === descriptions.length - 1 && opts?.components?.length) {
                    messageOpts.components = opts.components;
                }
                liveResponseMessages[i] = await channel.send(messageOpts).catch((error: unknown) => {
                    logDeliveryError('liveResponse/embed/send', error);
                    return null;
                });
                continue;
            }

            const messageOpts: any = { embeds: [embed] };
            if (i === descriptions.length - 1 && opts?.components?.length) {
                messageOpts.components = opts.components;
            }
            await liveResponseMessages[i].edit(messageOpts).catch(async (error: unknown) => {
                logDeliveryError('liveResponse/embed/edit', error);
                liveResponseMessages[i] = await channel.send(messageOpts).catch((sendError: unknown) => {
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

        let injectResult: any = { ok: true };
        if (!options?.resumeOnly) {
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
        let earlyConvIdResolved = false;
        let earlyConvIdInFlight = false;
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
            maxDurationMs: options?.responseTimeoutMs,
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
                // Try to resolve conversation_id early if not already bound
                const { artifactService, chatSessionRepo, chatSessionService } = options || {};
                if (!earlyConvIdResolved && !earlyConvIdInFlight && artifactService && chatSessionRepo && chatSessionService) {
                    earlyConvIdInFlight = true;
                    chatSessionService.getCurrentSessionInfo(cdp)
                        .then((sessionInfo) => {
                            if (sessionInfo && sessionInfo.title && sessionInfo.title !== t('(Untitled)')) {
                                const session = chatSessionRepo.findByChannelId(message.channelId);
                                const workspaceDirName = (session
                                    ? bridge.pool.extractProjectName(session.workspacePath)
                                    : cdp.getCurrentWorkspaceName()) ?? undefined;
                                const convId = artifactService.findConversationByTitle(sessionInfo.title, workspaceDirName);
                                if (convId) {
                                    chatSessionRepo.setConversationId(message.channelId, convId);
                                    earlyConvIdResolved = true;
                                    logger.debug(`[EarlyBinding] Saved conversation_id: "${convId}" for channel: ${message.channelId}`);
                                }
                            }
                        })
                        .catch(() => {})
                        .finally(() => {
                            earlyConvIdInFlight = false;
                        });
                }
            },

            onProgress: (text) => {
                if (isFinalized) return;
                // Live output streaming disabled: RESPONSE_TEXT currently includes process logs (see #1).
                const separated = splitOutputAndLogs(text);
                if (separated.output && separated.output.trim().length > 0) {
                    lastProgressText = separated.output;
                }
            },

            onComplete: async (finalText, citedFiles, fileChanges) => {
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
                    
                    const components: any[] = [];
                    if (!citedFiles) citedFiles = [];

                    // Only pause when newly created conversation folders and files need to flush to disk
                    const existingConvId = options?.chatSessionRepo?.findByChannelId(message.channelId)?.conversationId;
                    if (!existingConvId) {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    let activeConversationId: string | undefined = undefined;

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

                                // Persist conversation_id for artifact picker resolution
                                if (options.artifactService) {
                                    const session = options.chatSessionRepo.findByChannelId(message.channelId);
                                    let workspaceDirName: string | undefined;
                                    if (session && session.workspacePath) {
                                        workspaceDirName = bridge.pool.extractProjectName(session.workspacePath);
                                    }
                                    const convId = options.artifactService.findConversationByTitle(sessionInfo.title, workspaceDirName);
                                    if (convId) {
                                        options.chatSessionRepo.setConversationId(message.channelId, convId);
                                        activeConversationId = convId;
                                    }
                                }
                            }
                        } catch (e) {
                            logger.error('[Rename] Failed to get title from Antigravity and rename:', e);
                        }
                    }

                    const classifiedForFiles = monitor.getLastClassified();
                    if (classifiedForFiles?.fileChanges && classifiedForFiles.fileChanges.length > 0) {
                        for (const fc of classifiedForFiles.fileChanges) {
                            if (!citedFiles.includes(fc.path)) {
                                citedFiles.push(fc.path);
                            }
                        }
                    }

                    if (!activeConversationId && options?.chatSessionRepo) {
                        activeConversationId = options.chatSessionRepo.findByChannelId(message.channelId)?.conversationId ?? undefined;
                    }



                    if (activeConversationId && options?.artifactService) {
                        const artifacts = options.artifactService.listArtifacts(activeConversationId);
                        const planArt = artifacts.find(art => 
                            art.artifactType === 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN' || 
                            art.filename.toLowerCase() === 'implementation_plan.md'
                        );
                        let planTime = 0;
                        if (planArt) {
                            try {
                                planTime = fs.statSync(planArt.absolutePath).mtimeMs;
                            } catch { /* ignore */ }
                        }

                        for (const art of artifacts) {
                            const nameWithExt = art.filename;
                            const nameWithoutExt = art.filename.replace(/\.[^/.]+$/, "");
                            const regex = new RegExp(`\\b${nameWithoutExt.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
                            
                            const mentionsArtifact = finalOutputText.includes(nameWithExt) || finalOutputText.includes(`\`${nameWithoutExt}\``) || regex.test(finalOutputText);
                            
                            const isTask = art.artifactType === 'ARTIFACT_TYPE_TASK' || nameWithExt.toLowerCase() === 'task.md';
                            const isWalkthrough = art.artifactType === 'ARTIFACT_TYPE_WALKTHROUGH' || nameWithExt.toLowerCase() === 'walkthrough.md';
                            
                            let isSpecialArtifact = false;
                            if (isTask || isWalkthrough) {
                                let artTime = 0;
                                try {
                                    artTime = fs.statSync(art.absolutePath).mtimeMs;
                                } catch { /* ignore */ }
                                if (artTime > planTime) {
                                    isSpecialArtifact = true;
                                }
                            }

                            if ((mentionsArtifact || isSpecialArtifact) && !citedFiles.includes(nameWithExt)) {
                                citedFiles.push(nameWithExt);
                            }
                        }
                    }

                    if (citedFiles && citedFiles.length > 0) {
                        // Strip trailing punctuation and deduplicate
                        let uniqueFiles = Array.from(new Set(citedFiles.map(f => {
                            let clean = f.trim();
                            while (clean.match(/[.,;:!?]$/)) {
                                clean = clean.slice(0, -1);
                            }
                            return clean;
                        })));
                        // Filter out obviously bad paths
                        uniqueFiles = uniqueFiles.filter(f => f.length > 0 && f !== 'unknown');
                        
                        const row = new ActionRowBuilder();
                        // Max 5 buttons per row in Discord
                        for (let i = 0; i < Math.min(uniqueFiles.length, 5); i++) {
                            let fileUrl = uniqueFiles[i];
                            
                            let isArtifactMatch = false;
                            let artifactDisplayName = fileUrl;
                            if (activeConversationId && options?.artifactService) {
                                const artifacts = options.artifactService.listArtifacts(activeConversationId);
                                const rawName = fileUrl.replace(/^file:\/\/\//, '');
                                const matched = artifacts.find(a => 
                                    a.filename.toLowerCase() === fileUrl.toLowerCase() || 
                                    a.filename.toLowerCase() === rawName.toLowerCase()
                                );
                                if (matched) {
                                    isArtifactMatch = true;
                                    fileUrl = `file:///${matched.absolutePath.replace(/\\/g, '/')}`;
                                    artifactDisplayName = matched.filename;
                                }
                            }

                            const wsPath = cdp.getCurrentWorkspacePath();
                            if (!wsPath) {
                                continue;
                            }

                            if (!isArtifactMatch) {
                                if (!fileUrl.startsWith('file:///') && !path.isAbsolute(fileUrl)) {
                                    fileUrl = `file:///${path.resolve(wsPath, fileUrl).replace(/\\/g, '/')}`;
                                }
                                
                                let fsPath = fileUrl.replace(/^file:\/\/\//, '');
                                if (path.sep === '/' && !fsPath.startsWith('/')) {
                                    fsPath = '/' + fsPath;
                                } else if (process.platform === 'win32' && fsPath.startsWith('/')) {
                                    fsPath = fsPath.substring(1);
                                }

                                const relative = path.relative(wsPath, fsPath);
                                const isArtifact = fsPath.includes('.gemini') && fsPath.includes('antigravity') && fsPath.includes('brain');
                                if (!isArtifact && (relative.startsWith('..') || path.isAbsolute(relative))) {
                                    continue;
                                }
                                if (!fs.existsSync(fsPath)) {
                                    continue;
                                }
                            }

                            let displayName = fileUrl;
                            if (isArtifactMatch) {
                                displayName = artifactDisplayName;
                            } else if (displayName.startsWith('file:///')) {
                                const parts = displayName.split('/');
                                displayName = parts[parts.length - 1];
                            }
                            
                            const hashId = Math.random().toString(36).substring(2, 10);
                            fileOpenCache.set(hashId, fileUrl);

                            let customId = `file_open:cache:${hashId}`;
                            if (isArtifactMatch && activeConversationId && displayName) {
                                const artId = `file_open:art:${activeConversationId}:${displayName}`;
                                if (artId.length < 100) {
                                    customId = artId;
                                }
                            } else if (wsPath) {
                                let fsPath = fileUrl.replace(/^file:\/\/\//, '');
                                if (path.sep === '/' && !fsPath.startsWith('/')) {
                                    fsPath = '/' + fsPath;
                                } else if (process.platform === 'win32' && fsPath.startsWith('/')) {
                                    fsPath = fsPath.substring(1);
                                }
                                const resolvedFsPath = path.resolve(fsPath);
                                const relative = path.relative(wsPath, resolvedFsPath);
                                if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                                    const relSlash = relative.replace(/\\/g, '/');
                                    const relId = `file_open:rel:${relSlash}`;
                                    if (relId.length < 100) {
                                        customId = relId;
                                    }
                                }
                            }
                            
                            row.addComponents(
                                new ButtonBuilder()
                                    .setCustomId(customId)
                                    .setLabel(isArtifactMatch ? `Review ${displayName.substring(0, 15)}` : `Open ${displayName.substring(0, 20)}`)
                                    .setStyle(isArtifactMatch ? ButtonStyle.Success : ButtonStyle.Primary)
                            );
                        }
                        if (row.components.length > 0) {
                            components.push(row);
                        }
                    }

                    if (fileChanges && fileChanges.length > 0) {
                        // The extracted text is the toolbar title, e.g. "1 File With Changes"
                        const widgetTitle = fileChanges[fileChanges.length - 1] || 'Files With Changes';
                        const fileChangesRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(buildFileChangeCustomId('reject', cdp.getCurrentWorkspaceName() || 'unknown', message.channelId))
                                .setLabel(`Reject all (${widgetTitle})`)
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId(buildFileChangeCustomId('accept', cdp.getCurrentWorkspaceName() || 'unknown', message.channelId))
                                .setLabel('Accept all')
                                .setStyle(ButtonStyle.Success)
                        );
                        components.push(fileChangesRow);
                    }

                    const classified = monitor.getLastClassified();
                    if (options?.extractionMode === 'structured' && classified && outputFormat !== 'plain') {
                        const messageOptions = renderDiscordResponse(classified, {
                            projectName: cdp.getCurrentWorkspaceName() || 'unknown',
                            channelId: message.channelId
                        });
                        for (const msg of liveResponseMessages) {
                            if (msg) await msg.delete().catch(() => {});
                        }
                        liveResponseMessages.length = 0;
                        
                        if (components.length > 0) {
                            if (!messageOptions.components) messageOptions.components = [];
                            messageOptions.components = [...(messageOptions.components || []), ...components];
                        }

                        if (messageOptions.embeds && messageOptions.embeds.length > 0) {
                            const lastEmbed = messageOptions.embeds[messageOptions.embeds.length - 1];
                            if (lastEmbed && typeof (lastEmbed as any).setFooter === 'function') {
                                (lastEmbed as any).setFooter({ text: t(`⏱️ Time: ${elapsed}s | Complete`) });
                            }
                        }
                        
                        if (channel) {
                            await channel.send(messageOptions).catch((error: unknown) => {
                                logDeliveryError('renderDiscordResponse/send', error);
                            });
                        }
                    } else if (finalOutputText && finalOutputText.trim().length > 0) {
                        await upsertLiveResponseEmbeds(
                            `${PHASE_ICONS.complete} Final Output`,
                            finalOutputText,
                            PHASE_COLORS.complete,
                            t(`⏱️ Time: ${elapsed}s | Complete`),
                            {
                                source: 'complete',
                                expectedVersion: responseVersion,
                                components: components.length > 0 ? components : undefined,
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
                                components: components.length > 0 ? components : undefined,
                            },
                        );
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
                    const timeoutMinutes = Math.round((options?.responseTimeoutMs ?? 900000) / 60000);
                    const payload = separated.output && separated.output.trim().length > 0
                        ? t(`${separated.output}\n\n[Monitor Ended] Timeout after ${timeoutMinutes} minutes of inactivity.`)
                        : `Monitor ended after ${timeoutMinutes} minutes of inactivity. No text was retrieved.`;

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

        onApprovalRef = async () => {
            if (isFinalized) return;
            const textToUse = lastProgressText || monitor.getLastText() || '';
            const separated = splitOutputAndLogs(textToUse);
            const outputText = separated.output || textToUse;
            if (outputText && outputText.trim().length > 0) {
                liveResponseUpdateVersion += 1;
                const responseVersion = liveResponseUpdateVersion;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                await upsertLiveResponseEmbeds(
                    t('Response'),
                    outputText,
                    PHASE_COLORS.thinking,
                    t(`⏱️ Time: ${elapsed}s | Awaiting Approval`),
                    {
                        source: 'approval-pause',
                        expectedVersion: responseVersion,
                        skipWhenFinalized: true,
                    }
                ).catch(() => {});
            }
        };
        cdp.on('approval_required', onApprovalRef);

        if (options?.onMonitorCreated) {
            options.onMonitorCreated({
                stop: async () => {
                    isFinalized = true;
                    await monitor.stop();
                }
            });
        }

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
    const artifactThreadRepo = new ArtifactThreadRepository(db);
    const scheduleRepo = new ScheduleRepository(db);
    const scheduleService = new ScheduleService(scheduleRepo);
    const workspaceQueue = new WorkspaceQueue();
    const artifactService = new ArtifactService();
    const workspaceService = new WorkspaceService(config.workspaceBaseDir);
    const channelManager = new ChannelManager();
    const heartbeatService = new HeartbeatService();

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
    bridge.chatSessionRepo = chatSessionRepo;
    bridge.artifactService = artifactService;

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
        async ({ channelId, userId }) => {
            const accountName = resolveScopedAccountName({
                channelId,
                userId,
                sessionAccountName: chatSessionRepo.findByChannelId(channelId)?.activeAccountName ?? null,
                parentChannelId: null,
                selectedAccountByChannel: bridge.selectedAccountByChannel,
                channelPrefRepo,
                accountPrefRepo,
                accounts: config.antigravityAccounts,
            });
            const status = await startAntigravity(accountPorts[accountName] ?? 9222);
            if (status === 'started') {
                const cdp = new CdpService({ portsToScan: [accountPorts[accountName] ?? 9222] });
                try {
                    await cdp.connect();
                    await cdp.openChatPanel();
                } catch (e) {
                    // ignore
                } finally {
                    await cdp.disconnect().catch(() => {});
                }
            }
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
        config.responseTimeoutMs,
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

        heartbeatService.init(readyClient, bridge);
        heartbeatService.start();

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

            // Prefer the guild's general text channel, then fall back to the first sendable text channel.
            const guild = readyClient.guilds.cache.first();
            if (guild) {
                const sendableTextChannels = guild.channels.cache.filter(
                    (ch) =>
                        ch.isTextBased()
                        && !ch.isVoiceBased()
                        && ch.permissionsFor(readyClient.user)?.has('SendMessages'),
                );
                const channel = sendableTextChannels.find((ch) => isPreferredDiscordStartupChannel(ch.name))
                    ?? sendableTextChannels.first();
                if (channel && channel.isTextBased()) {
                    await channel.send({ embeds: [dashboardEmbed] });
                    logger.info('Startup dashboard embed sent.');
                }
            }
        } catch (error) {
            logger.warn('Failed to send startup dashboard embed:', error);
        }

        // Restore scheduled tasks
        const scheduleJobCallback = async (schedule: ScheduleRecord) => {
            logger.info(`[Schedule] Trigger callback running for task ${schedule.id}. Workspace: ${schedule.workspacePath}, promptLength: ${schedule.prompt.length}`);
            try {
                let channelId = schedule.channelId;

                const isWindows = process.platform === 'win32';
                const bindings = workspaceBindingRepo.findAll().filter(b => {
                    const absPath = workspaceService.getWorkspacePath(b.workspacePath);
                    return isWindows
                        ? absPath.toLowerCase() === schedule.workspacePath.toLowerCase()
                        : absPath === schedule.workspacePath;
                });

                if (!channelId || !bindings.some(b => b.channelId === channelId)) {
                    channelId = bindings[0]?.channelId;
                }

                if (!channelId) {
                    logger.warn(`[Schedule] No channel bound to workspace ${schedule.workspacePath}. Skipping task ${schedule.id}.`);
                    return;
                }

                const channel = await readyClient.channels.fetch(channelId).catch(() => null);
                if (channel && channel.isTextBased() && 'send' in channel) {
                    logger.info(`[Schedule] Sending trigger notification to channel ${channelId} for task ${schedule.id}`);
                    const message = await channel.send({
                        content: '⏰ **Scheduled Task Triggered**',
                        allowedMentions: { parse: [] }
                    });
                    
                    const projectLabel = bridge.pool.extractProjectName(schedule.workspacePath);
                    workspaceQueue.incrementDepth(schedule.workspacePath);

                    await workspaceQueue.enqueue(schedule.workspacePath, async () => {
                        try {
                            logger.info(`[Schedule] Dispatching prompt to promptDispatcher for task ${schedule.id}`);
                            const preferredAccount = bridge.pool.getPreferredAccountForWorkspace(schedule.workspacePath) 
                                || (config.antigravityAccounts?.[0]?.name ?? 'default');
                            
                            const cdp = await bridge.pool.getOrConnect(schedule.workspacePath, { name: preferredAccount });
                            
                            await promptDispatcher.send({
                                message: message as any,
                                prompt: schedule.prompt,
                                cdp,
                                inboundImages: [],
                                options: {
                                    chatSessionService,
                                    chatSessionRepo,
                                    channelManager,
                                    titleGenerator,
                                    userPrefRepo,
                                    artifactService,
                                    extractionMode: config.extractionMode,
                                },
                            });
                        } finally {
                            const remainingDepth = workspaceQueue.decrementDepth(schedule.workspacePath);
                            if (remainingDepth > 0) {
                                logger.info(
                                    `[Queue:${projectLabel}] Task done, ${remainingDepth} remaining`,
                                );
                            }
                        }
                    });
                } else {
                    logger.warn(`[Schedule] Channel ${channelId} not found or not text-based for task ${schedule.id}.`);
                }
            } catch (error) {
                logger.error(`[Schedule] Failed to execute task ${schedule.id}:`, error);
            }
        };

        const restoredCount = scheduleService.restoreAll(scheduleJobCallback);
        logger.info(`[Schedule] Restored ${restoredCount} scheduled tasks.`);
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
        promptDispatcher,
        sendModeUI,
        sendModelsUI,
        sendAutoAcceptUI,
        getCurrentCdp,
        parseApprovalCustomId,
        parseErrorPopupCustomId,
        parsePlanningCustomId,
        parseFileChangeCustomId,
        parseRunCommandCustomId,
        joinHandler,
        userPrefRepo,
        accountPrefRepo,
        channelPrefRepo,
        chatSessionRepo,
        chatSessionService,
        artifactThreadRepo,
        artifactService,
        channelManager,
        titleGenerator,
        antigravityAccounts: config.antigravityAccounts,
        heartbeatService,
        scheduleService,
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
            chatSessionRepoArg,
            scheduleServiceArg,
        ) => handleSlashInteraction(
            interaction,
            handler,
            bridgeArg,
            wsHandlerArg,
            chatHandlerArg,
            cleanupHandlerArg,
            chatSessionService,
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
            chatSessionRepoArg,
            artifactService,
            scheduleServiceArg,
            heartbeatService,
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
                    ensureQuestionDetector(bridge, cdp, projectName, selectedAccount);
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
                        artifactService,
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
        artifactService,
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
        heartbeatService,
        workspaceQueue,
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
                responseTimeoutMs: config.responseTimeoutMs,
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
            const questionSelectAction = createQuestionSelectAction({ bridge, wsHandler });
            const telegramSelectHandler = createPlatformSelectHandler({
                actions: [
                    modeSelectAction,
                    accountSelectAction,
                    questionSelectAction,
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
                        activeMonitors,
                    }, interaction);
                    return;
                }
                if (
                    interaction.customId === 'mode_select' ||
                    interaction.customId === 'account_select' ||
                    interaction.customId.startsWith('question_select_action')
                ) {
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
                    createApprovalButtonAction({ bridge, wsHandler }),
                    createPlanningButtonAction({ bridge, wsHandler }),
                    createErrorPopupButtonAction({ bridge, wsHandler }),
                    createRunCommandButtonAction({ bridge, wsHandler }),
                    createModelButtonAction({
                        bridge,
                        fetchQuota: () => bridge.quota.fetchQuota(),
                        modelService,
                        userPrefRepo,
                        ensureSessionActivated: async (channelId, userId, cdp) => {
                            const savedTitle = chatSessionRepo.findByChannelId(channelId)?.displayName?.trim() || '';
                            if (!savedTitle || savedTitle === t('(Untitled)')) {
                                return { ok: true };
                            }

                            const current = await chatSessionService.getCurrentSessionInfo(cdp);
                            if (current.title.trim() === savedTitle) {
                                return { ok: true };
                            }

                            logger.info(
                                `[ModelCommand] source=button channel=${channelId} user=${userId} ` +
                                `restoringSession target="${savedTitle}" current="${current.title.trim() || '(unknown)'}"`,
                            );
                            const activation = await chatSessionService.activateSessionByTitle(cdp, savedTitle, {
                                maxWaitMs: 8000,
                                retryIntervalMs: 300,
                                allowVisibilityWarmupMs: 1000,
                            });
                            if (!activation.ok) {
                                return {
                                    ok: false as const,
                                    error: `Failed to activate saved session "${savedTitle}" before model action: ${activation.error || 'unknown'}`,
                                };
                            }

                            const refresh = await chatSessionService.refreshSessionViewIfStuck(cdp, savedTitle);
                            if (!refresh.ok) {
                                logger.warn(
                                    `[ModelCommand] source=button channel=${channelId} user=${userId} ` +
                                    `sessionRefreshWarning target="${savedTitle}" error="${refresh.error || 'unknown'}"`,
                                );
                            }
                            return { ok: true as const };
                        },
                    }),
                    createAutoAcceptButtonAction({ autoAcceptService: bridge.autoAccept }),
                    createTemplateButtonAction({ bridge, templateRepo }),
                    createFileChangeButtonAction({ bridge, wsHandler }),
                    createGenericActionButtonAction({ bridge, wsHandler }),
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
                { command: 'artifacts', description: 'Browse session artifacts' },
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
 * Utility to parse a cron expression and format the next run time.
 */
function formatNextRunTime(cronExpression: string): string {
    try {
        const interval = cronParser.parse(cronExpression);
        return interval.next().toDate().toLocaleString();
    } catch (err) {
        return 'Invalid Cron';
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
    chatSessionService: ChatSessionService,
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
    artifactService?: ArtifactService,
    scheduleService?: ScheduleService,
    heartbeatService?: HeartbeatService,
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
            return null;
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
    const ensureBoundSessionActive = async (
        cdp: CdpService,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
        const savedTitle = chatSessionRepo?.findByChannelId(interaction.channelId)?.displayName?.trim() || '';
        if (!savedTitle || savedTitle === t('(Untitled)')) {
            return { ok: true };
        }

        const current = await chatSessionService.getCurrentSessionInfo(cdp);
        if (current.title.trim() === savedTitle) {
            return { ok: true };
        }

        logger.info(
            `[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
            `restoringSession target="${savedTitle}" current="${current.title.trim() || '(unknown)'}"`,
        );
        const activation = await chatSessionService.activateSessionByTitle(cdp, savedTitle, {
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

        const refresh = await chatSessionService.refreshSessionViewIfStuck(cdp, savedTitle);
        if (!refresh.ok) {
            logger.warn(
                `[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
                `sessionRefreshWarning target="${savedTitle}" error="${refresh.error || 'unknown'}"`,
            );
        }
        return { ok: true };
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
                        '`/project account [name]` — Show or change the project channel account',
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
                        '`/heartbeat [on|off|status]` — Configure periodic bot heartbeat notifications',
                        '`/schedule [add|list|remove|clear|backup|restore]` — Manage scheduled tasks',
                        '`/help` — Show this help',
                    ].join('\n')
                },
                {
                    name: '📂 Artifacts', value: [
                        '`/artifacts` — Browse and render generated artifacts from the active session',
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
            logger.info(
                `[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
                `requested=${modelName ? `"${modelName}"` : 'ui'}`,
            );
            if (!modelName) {
                const cdp = await ensureChannelCdp();
                if (!cdp) {
                    logger.warn(`[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} cdp=unavailable`);
                    await interaction.editReply({ content: 'Not connected to CDP.' });
                    break;
                }
                const sessionReady = await ensureBoundSessionActive(cdp);
                if (!sessionReady.ok) {
                    await interaction.editReply({ content: sessionReady.error });
                    break;
                }
                await sendModelsUI(interaction, {
                    getCurrentCdp: () => cdp,
                    fetchQuota: async () => bridge.quota.fetchQuota(),
                });
            } else {
                const cdp = await ensureChannelCdp();
                if (!cdp) {
                    logger.warn(`[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} target="${modelName}" cdp=unavailable`);
                    await interaction.editReply({ content: 'Not connected to CDP.' });
                    break;
                }
                const sessionReady = await ensureBoundSessionActive(cdp);
                if (!sessionReady.ok) {
                    await interaction.editReply({ content: sessionReady.error });
                    break;
                }
                const res = await cdp.setUiModel(modelName);
                logger.info(
                    `[ModelCommand] source=slash channel=${interaction.channelId} user=${interaction.user.id} ` +
                    `target="${modelName}" ok=${res.ok} applied=${res.model ? `"${res.model}"` : 'null'} ` +
                    `verified=${res.verified === true} alreadySelected=${res.alreadySelected === true} ` +
                    `error=${res.error ? `"${res.error}"` : 'null'}`,
                );
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

        case 'shutdown': {
            try {
                bridge.pool.disconnectAll();
                const ports = [...new Set(antigravityAccounts.map((account) => account.cdpPort))];
                const results = await Promise.all(ports.map((port) => stopAntigravity(port)));
                const stopped = results.some((result) => result === 'stopped');
                await interaction.editReply({
                    content: stopped
                        ? '✅ Antigravity IDE shut down. Use `/project list` to start it again.'
                        : 'ℹ️ Antigravity IDE is already stopped. Use `/project list` to start it.',
                });
            } catch (e: any) {
                await interaction.editReply({ content: `❌ Failed to shut down Antigravity IDE: ${e.message}` });
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

        case 'open': {
            const filepath = interaction.options.getString('filepath', true);
            let resolvedPath: string | null = null;
            
            // 1. Try to resolve as an artifact
            if (chatSessionRepo && artifactService) {
                const session = chatSessionRepo.findByChannelId(interaction.channelId);
                if (session && session.conversationId) {
                    const possibleArtifact = artifactService.getArtifactPath(session.conversationId, filepath);
                    if (fs.existsSync(possibleArtifact)) {
                        resolvedPath = possibleArtifact;
                    }
                }
            }
            
            // 2. Try to resolve against the workspace
            if (!resolvedPath) {
                const cdp = await ensureChannelCdp();
                if (cdp) {
                    const wsPath = cdp.getCurrentWorkspacePath();
                    if (wsPath) {
                        let rawPath = filepath;
                        if (filepath.startsWith('file:///')) {
                            rawPath = filepath.replace('file:///', '');
                            if (process.platform === 'win32' && rawPath.startsWith('/')) {
                                rawPath = rawPath.substring(1);
                            }
                        }
                        const candidatePath = path.isAbsolute(rawPath) ? rawPath : path.join(wsPath, rawPath);
                        const relative = path.relative(wsPath, candidatePath);
                        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                            if (fs.existsSync(candidatePath)) {
                                resolvedPath = candidatePath;
                            }
                        }
                    }
                }
            }

            if (!resolvedPath) {
                await interaction.editReply({
                    content: '❌ Error: Cannot resolve file path. Ensure the file exists as an artifact or within the current workspace.'
                });
                break;
            }

            try {
                execFile(getAntigravityCliPath(), [resolvedPath], (error) => {
                    if (error) {
                        logger.error(`Failed to open file via CLI: ${error.message}`);
                        interaction.editReply({ content: `❌ Error opening file via CLI.` }).catch(() => {});
                    } else {
                        interaction.editReply({ content: `✅ Opened file: **${path.basename(resolvedPath)}**` }).catch(() => {});
                    }
                });
            } catch (e: any) {
                logger.error(`Failed to open file: ${e.message}`);
                await interaction.editReply({ content: `❌ Error opening file.` });
            }
            break;
        }

        case 'artifacts': {
            await sendArtifactPickerUI(interaction, { 
                userPrefRepo, 
                chatSessionRepo, 
                artifactService 
            });
            break;
        }

        case 'heartbeat': {
            const subcommand = interaction.options.getSubcommand();
            if (!heartbeatService) {
                await interaction.editReply({ content: 'Heartbeat service not available.' });
                break;
            }

            const envOverrides: string[] = [];
            if (process.env.HEARTBEAT_ENABLED !== undefined) envOverrides.push('HEARTBEAT_ENABLED');
            if (process.env.HEARTBEAT_INTERVAL_MS !== undefined) envOverrides.push('HEARTBEAT_INTERVAL_MS');
            if (process.env.HEARTBEAT_CHANNEL_ID !== undefined) envOverrides.push('HEARTBEAT_CHANNEL_ID');

            let warningPrefix = '';
            if (envOverrides.length > 0) {
                warningPrefix = `⚠️ **Warning**: Environment override(s) active: ${envOverrides.join(', ')}. Changes saved to config.json may not take effect until overrides are removed.\n\n`;
            }

            if (subcommand === 'on') {
                const intervalStr = interaction.options.getString('interval') || '1h';
                const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
                
                if (!targetChannel || typeof (targetChannel as any).isTextBased !== 'function' || !(targetChannel as any).isTextBased()) {
                    await interaction.editReply({ content: '⚠️ Please select a valid text channel.' });
                    break;
                }

                // Check permissions
                const botUser = interaction.client.user;
                const permissions = (targetChannel as any).permissionsFor?.(botUser);
                if (!permissions || !permissions.has('SendMessages') || !permissions.has('EmbedLinks')) {
                    await interaction.editReply({ content: '⚠️ Bot does not have permission to send messages and embed links in that channel.' });
                    break;
                }

                const intervalMs = parseInterval(intervalStr);
                if (intervalMs === null || intervalMs <= 0) {
                    await interaction.editReply({ content: '⚠️ Invalid interval format. Use a value with a unit, e.g. "1d", "1h", "30m" (bare numbers are not allowed).' });
                    break;
                }

                if (intervalMs < 10000) {
                    await interaction.editReply({ content: '⚠️ Interval must be at least 10 seconds.' });
                    break;
                }

                if (intervalMs > 2147483647) {
                    await interaction.editReply({ content: '⚠️ Interval cannot be greater than 24.8 days (2147483647 ms).' });
                    break;
                }

                await heartbeatService.updateConfig(true, intervalMs, targetChannel.id);
                await interaction.editReply({ 
                    content: `${warningPrefix}💓 Heartbeat enabled! Sending updates every **${intervalStr}** to channel <#${targetChannel.id}>.` 
                });
            } else if (subcommand === 'off') {
                await heartbeatService.disable();
                await interaction.editReply({ content: `${warningPrefix}💓 Heartbeat disabled.` });
            } else if (subcommand === 'status') {
                const config = loadConfig();
                const uptimeMs = Date.now() - heartbeatService.botStartTime;
                const uptimeStr = formatDuration(uptimeMs);
                const lastActivityStr = formatRelativeTime(heartbeatService.lastActivityTimestamp);

                const activeWorkspaces = bridge.pool.getActiveWorkspaceNames();
                const activeCount = activeWorkspaces.length;
                const activeList = activeCount > 0 ? activeWorkspaces.join(', ') : 'None';

                const intervalVal = config.heartbeatIntervalMs != null ? formatDuration(config.heartbeatIntervalMs) : 'N/A';

                const statusEmbed = new EmbedBuilder()
                    .setTitle('💓 Heartbeat Status')
                    .setColor(config.heartbeatEnabled ? 0x00CC88 : 0x888888)
                    .addFields(
                        { name: 'Enabled', value: config.heartbeatEnabled ? '🟢 Yes' : '⚪ No', inline: true },
                        { name: 'Interval', value: config.heartbeatEnabled ? intervalVal : 'N/A', inline: true },
                        { name: 'Target Channel', value: config.heartbeatChannelId ? `<#${config.heartbeatChannelId}>` : 'N/A', inline: true },
                        { name: 'Active Sessions', value: `${activeCount} (${activeList})`, inline: true },
                        { name: 'Uptime', value: uptimeStr, inline: true },
                        { name: 'Last Activity', value: lastActivityStr, inline: true },
                    )
                    .setTimestamp();
                await interaction.editReply({ embeds: [statusEmbed] });
            }
            break;
        }

        case 'schedule': {
            if (!scheduleService) {
                await interaction.editReply({ content: 'Schedule service not available.' });
                break;
            }

            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'list') {
                const schedules = scheduleService.listSchedules();
                if (schedules.length === 0) {
                    await interaction.editReply({ content: 'No scheduled tasks found.' });
                    break;
                }
                
                let formatted = '';
                let truncatedCount = 0;
                for (const s of schedules) {
                    const nextRunStr = formatNextRunTime(s.cronExpression);
                    const line = `**ID:** ${s.id} | **Cron:** \`${s.cronExpression}\` | **Next:** ${nextRunStr} | **Prompt:** ${s.prompt}\n`;
                    if (formatted.length + line.length > 3900) {
                        truncatedCount = schedules.length - schedules.indexOf(s);
                        break;
                    }
                    formatted += line;
                }
                if (truncatedCount > 0) {
                    formatted += `\n*...and ${truncatedCount} more task(s) (truncated due to Discord size limit).*`;
                }

                const embed = new EmbedBuilder()
                    .setTitle('🕒 Scheduled Tasks')
                    .setDescription(formatted)
                    .setColor(0x00CC88);
                await interaction.editReply({ embeds: [embed] });
                break;
            }

            if (subcommand === 'add') {
                const cronExpr = interaction.options.getString('cron', true);
                const promptText = interaction.options.getString('prompt', true);
                const workspacePath = wsHandler.getWorkspaceForChannel(interaction.channelId);

                if (!workspacePath) {
                    await interaction.editReply({ content: '⚠️ This channel is not bound to a workspace. Please bind it first.' });
                    break;
                }

                try {
                    const jobCb = scheduleService.getJobCallback();
                    if (!jobCb) {
                        await interaction.editReply({ content: '⚠️ Schedule service is still initializing. Please try again in a few seconds.' });
                        break;
                    }
                    const record = scheduleService.addSchedule(cronExpr, promptText, workspacePath, interaction.channelId, jobCb);
                    
                    const nextRun = formatNextRunTime(cronExpr);
                    const nextRunStr = nextRun !== 'Invalid Cron' ? ` (Next run: ${nextRun})` : '';

                    await interaction.editReply({ content: `✅ Scheduled task added! (ID: ${record.id})${nextRunStr}` });
                } catch (error: any) {
                    await interaction.editReply({ content: `❌ Failed to add schedule: ${error.message}` });
                }
                break;
            }

            if (subcommand === 'remove') {
                const id = interaction.options.getInteger('id', true);
                const success = scheduleService.removeSchedule(id);
                if (success) {
                    await interaction.editReply({ content: `✅ Removed scheduled task ID: ${id}` });
                } else {
                    await interaction.editReply({ content: `⚠️ Scheduled task ID ${id} not found.` });
                }
                break;
            }

            if (subcommand === 'clear') {
                const initialSchedules = scheduleService.listSchedules();
                const count = initialSchedules.length;
                if (count === 0) {
                    await interaction.editReply({ content: '📅 No scheduled tasks found to clear.' });
                    break;
                }

                const initialIdsJson = JSON.stringify(initialSchedules.map(s => s.id).sort((a, b) => a - b));

                const confirmBtnId = `schedule_clear_confirm_${interaction.id}`;
                const cancelBtnId = `schedule_clear_cancel_${interaction.id}`;

                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(confirmBtnId)
                        .setLabel(`${t('Confirm Clear')} (${count})`)
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(cancelBtnId)
                        .setLabel(t('Cancel'))
                        .setStyle(ButtonStyle.Secondary)
                );

                const message = await interaction.editReply({
                    content: `⚠️ **Warning**: This will delete all **${count}** scheduled task(s) and reset the ID counter to 0. Are you sure you want to proceed?`,
                    components: [row]
                });

                const collector = message.createMessageComponentCollector({
                    filter: (i: any) => i.user.id === interaction.user.id && (i.customId === confirmBtnId || i.customId === cancelBtnId),
                    time: 30000,
                    max: 1
                });

                collector.on('collect', async (i: any) => {
                    if (i.customId === confirmBtnId) {
                        const currentSchedules = scheduleService.listSchedules();
                        const currentIdsJson = JSON.stringify(currentSchedules.map(s => s.id).sort((a, b) => a - b));
                        if (initialIdsJson !== currentIdsJson) {
                            await i.update({
                                content: '⚠️ **Action aborted**: The scheduled tasks list changed while waiting for confirmation. No schedules were cleared.',
                                components: []
                            });
                            return;
                        }
                        scheduleService.resetSchedules();
                        await i.update({
                            content: `✅ Successfully removed all **${count}** scheduled task(s) and reset the task ID counter to 0.`,
                            components: []
                        });
                    } else {
                        await i.update({
                            content: '❌ Action cancelled. Scheduled tasks were not cleared.',
                            components: []
                        });
                    }
                });

                collector.on('end', async (collected: any) => {
                    if (collected.size === 0) {
                        await interaction.editReply({
                            content: '⚠️ Action timed out. Scheduled tasks were not cleared.',
                            components: []
                        }).catch(() => {});
                    }
                });

                break;
            }

            if (subcommand === 'backup') {
                const json = scheduleService.backupSchedules();
                const buffer = Buffer.from(json, 'utf-8');
                await interaction.editReply({
                    content: '📋 **LazyGravity Schedules Backup**',
                    files: [{
                        attachment: buffer,
                        name: 'schedules_backup.json'
                    }]
                });
                break;
            }

            if (subcommand === 'restore') {
                const attachment = interaction.options.getAttachment('file', true);
                if (!attachment.name.endsWith('.json')) {
                    await interaction.editReply({ content: '❌ Attachment must be a `.json` file.' });
                    break;
                }

                if (attachment.size > 1024 * 1024) {
                    await interaction.editReply({ content: '❌ Attachment exceeds maximum size limit of 1MB.' });
                    break;
                }

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);

                    // Download file content using global fetch (available in Node 18+)
                    const response = await fetch(attachment.url, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                    const contentLength = response.headers.get('content-length');
                    if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
                        throw new Error('Response body exceeds maximum size limit of 1MB.');
                    }

                    const jsonText = await response.text();

                    const jobCb = scheduleService.getJobCallback();
                    if (!jobCb) {
                        await interaction.editReply({ content: '⚠️ Schedule service is still initializing. Please try again in a few seconds.' });
                        break;
                    }
                    const restoredCount = scheduleService.restoreSchedules(jsonText, jobCb);

                    await interaction.editReply({ content: `✅ Successfully restored ${restoredCount} scheduled tasks from backup!` });
                } catch (error: any) {
                    await interaction.editReply({ content: `❌ Failed to restore schedules: ${error.message}` });
                }
                break;
            }
            break;
        }

        default:
            await interaction.editReply({
                content: `Unknown command: /${commandName}`,
            });
    }
}
