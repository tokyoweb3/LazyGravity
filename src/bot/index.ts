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

// CDP連携サービス
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
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
} from '../services/cdpBridgeManager';
import { buildModeModelLines, splitForEmbedDescription } from '../utils/streamMessageFormatter';
import { formatForDiscord, sanitizeActivityLines, splitOutputAndLogs } from '../utils/discordFormatter';
import {
    buildPromptWithAttachmentUrls,
    cleanupInboundImageAttachments,
    downloadInboundImageAttachments,
    InboundImageAttachment,
    isImageAttachment,
    toDiscordAttachment,
} from '../utils/imageHandler';
import { sendModeUI } from '../ui/modeUi';
import { sendModelsUI } from '../ui/modelsUi';
import { sendTemplateUI } from '../ui/templateUi';
import { handleScreenshot } from '../ui/screenshotUi';
import { createInteractionCreateHandler } from '../events/interactionCreateHandler';
import { createMessageCreateHandler } from '../events/messageCreateHandler';

// =============================================================================
// Embed カラーパレット（フェーズごとの色分け）
// =============================================================================
const PHASE_COLORS = {
    sending: 0x5865F2,     // ブルー
    thinking: 0x9B59B6,    // パープル
    generating: 0xF39C12,  // ゴールド
    complete: 0x2ECC71,    // グリーン
    timeout: 0xE74C3C,     // レッド
    error: 0xC0392B,       // ダークレッド
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
 * Discordのメッセージ（プロンプト）をAntigravityに送信し、応答を待ってDiscordに返す
 *
 * メッセージ戦略:
 *   - 編集ではなく工程ごとに新規メッセージを送信して履歴を残す
 *   - 計画/分析/実行確認/実装内容の流れをログとして可視化する
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
    // コマンド受付のリアクションを追加
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
        const imageIntentPattern = /(image|images|png|jpg|jpeg|gif|webp|illustration|diagram|render|画像|イメージ|図|描いて|生成して)/i;
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
                    const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran|処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中)/i;
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
            `${PHASE_ICONS.error} 接続エラー`,
            'Antigravityに接続されていません。\n`open -a Antigravity --args --remote-debugging-port=9223` で起動後、メッセージを送信すると自動接続されます。',
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
        `${PHASE_ICONS.sending} [${modeName} - ${currentModel}${localMode === 'plan' ? ' (Thinking)' : ''}] 伝達中...`,
        buildModeModelLines(modeName, fastModel, planModel).join('\n'),
        PHASE_COLORS.sending,
    );

    let isFinalized = false;
    let lastProgressText = '';
    let lastActivityLogText = '';
    const LIVE_RESPONSE_MAX_LEN = 3800;
    const LIVE_ACTIVITY_MAX_LEN = 3800;
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
        return splitForEmbedDescription(formatForDiscord(normalized), LIVE_ACTIVITY_MAX_LEN);
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

        // 以前よりページ数が減った場合は余剰メッセージを削除
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
                `${PHASE_ICONS.error} メッセージ注入失敗`,
                `メッセージの送信に失敗しました: ${injectResult.error}`,
                PHASE_COLORS.error,
            );
            await clearWatchingReaction();
            await message.react('❌').catch(() => { });
            return;
        }

        const startTime = Date.now();
        await upsertLiveActivityEmbeds(
            `${PHASE_ICONS.thinking} 生成プロセスログ`,
            '',
            PHASE_COLORS.thinking,
            t('⏱️ Elapsed: 0s | Process log'),
            { source: 'initial' },
        );
        await upsertLiveResponseEmbeds(
            `${PHASE_ICONS.generating} 生成中アウトプット`,
            '',
            PHASE_COLORS.generating,
            t('⏱️ Elapsed: 0s | Waiting to start'),
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
                    lastActivityLogText = logText;
                }
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                liveActivityUpdateVersion += 1;
                const activityVersion = liveActivityUpdateVersion;
                upsertLiveActivityEmbeds(
                    `${PHASE_ICONS.thinking} 生成プロセスログ`,
                    logText || lastActivityLogText || ACTIVITY_PLACEHOLDER,
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
                const separated = splitOutputAndLogs(text);
                const sanitizedLogs = sanitizeActivityLines(separated.logs || '');
                if (separated.output && separated.output.trim().length > 0) {
                    lastProgressText = separated.output;
                }
                if (sanitizedLogs && sanitizedLogs.trim().length > 0) {
                    lastActivityLogText = sanitizedLogs;
                }
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                liveResponseUpdateVersion += 1;
                const responseVersion = liveResponseUpdateVersion;
                upsertLiveResponseEmbeds(
                    `${PHASE_ICONS.generating} 生成中アウトプット`,
                    separated.output || lastProgressText || '',
                    PHASE_COLORS.generating,
                    t(`⏱️ Elapsed: ${elapsed}s | Generating`),
                    {
                        source: 'progress',
                        expectedVersion: responseVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });

                liveActivityUpdateVersion += 1;
                const activityVersion = liveActivityUpdateVersion;
                upsertLiveActivityEmbeds(
                    `${PHASE_ICONS.thinking} 生成プロセスログ`,
                    sanitizedLogs || lastActivityLogText || ACTIVITY_PLACEHOLDER,
                    PHASE_COLORS.thinking,
                    t(`⏱️ Elapsed: ${elapsed}s | Process log`),
                    {
                        source: 'progress',
                        expectedVersion: activityVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });
            },

            onComplete: async (finalText) => {
                isFinalized = true;

                try {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
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
                    const finalLogText = lastActivityLogText || '';
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
                        `${PHASE_ICONS.thinking} プロセスログ`,
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
                            `${PHASE_ICONS.complete} 最終アウトプット`,
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
                            `${PHASE_ICONS.complete} 完了`,
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
                                const newName = options.titleGenerator.sanitizeForChannelName(sessionInfo.title);
                                const session = options.chatSessionRepo.findByChannelId(message.channelId);
                                if (session && session.displayName !== sessionInfo.title) {
                                    const formattedName = `${session.sessionNumber}-${newName}`;
                                    await options.channelManager.renameChannel(message.guild, message.channelId, formattedName);
                                    options.chatSessionRepo.updateDisplayName(message.channelId, sessionInfo.title);
                                }
                            }
                        } catch (e) {
                            logger.error('[Rename] Antigravityからのタイトル取得とリネームに失敗:', e);
                        }
                    }

                    if (monitor.getPhase() === 'quotaReached' || monitor.getQuotaDetected()) {
                        await sendEmbed(
                            '⚠️ モデルクォータ上限到達',
                            'モデルのクォータ上限に達しました。しばらく待つか、`/model` で別のモデルに切り替えてください。',
                            0xFF6B6B,
                            undefined,
                            'Quota Reached — モデル変更を推奨',
                        );
                        await clearWatchingReaction();
                        await message.react('⚠️').catch(() => { });
                        return;
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
                    const sanitizedTimeoutLogs = lastActivityLogText || '';
                    const payload = separated.output && separated.output.trim().length > 0
                        ? t(`${separated.output}\n\n[Monitor Ended] Timeout after 5 minutes.`)
                        : '5分経過により監視を終了しました。テキストは取得できませんでした。';

                    liveResponseUpdateVersion += 1;
                    const responseVersion = liveResponseUpdateVersion;
                    await upsertLiveResponseEmbeds(
                        `${PHASE_ICONS.timeout} タイムアウト`,
                        payload,
                        PHASE_COLORS.timeout,
                        `⏱️ 所要時間: ${elapsed}秒 | タイムアウト`,
                        {
                            source: 'timeout',
                            expectedVersion: responseVersion,
                        },
                    );

                    liveActivityUpdateVersion += 1;
                    const activityVersion = liveActivityUpdateVersion;
                    await upsertLiveActivityEmbeds(
                        `${PHASE_ICONS.thinking} プロセスログ`,
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
            `${PHASE_ICONS.error} エラー`,
            t(`Error occurred during processing: ${e.message}`),
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
    }
}

// =============================================================================
// Bot メインエントリー
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

    // Antigravityが起動していなければCDPポート付きで自動起動
    await ensureAntigravityRunning();

    // CDPブリッジの初期化（遅延接続: プール作成のみ）
    const bridge = initCdpBridge(config.autoApproveFileEdits);

    // CDP依存サービスの初期化（コンストラクタCDP依存を除去済み）
    const chatSessionService = new ChatSessionService();
    const titleGenerator = new TitleGeneratorService();
    const promptDispatcher = new PromptDispatcher({
        bridge,
        modeService,
        modelService,
        sendPromptImpl: sendPromptToAntigravity,
    });

    // コマンドハンドラーの初期化
    const wsHandler = new WorkspaceCommandHandler(workspaceBindingRepo, chatSessionRepo, workspaceService, channelManager);
    const chatHandler = new ChatCommandHandler(chatSessionService, chatSessionRepo, workspaceBindingRepo, channelManager, workspaceService, bridge.pool);
    const cleanupHandler = new CleanupCommandHandler(chatSessionRepo, workspaceBindingRepo);

    const slashCommandHandler = new SlashCommandHandler(modeService, modelService, templateRepo);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once(Events.ClientReady, async (readyClient) => {
        logger.info(`Ready! Logged in as ${readyClient.user.tag}`);

        try {
            await registerSlashCommands(config.discordToken, config.clientId, config.guildId);
        } catch (error) {
            logger.warn('スラッシュコマンドの登録に失敗しましたが、テキストコマンドは引き続き利用可能です。');
        }
    });

    // 【Discord Interactions API】スラッシュコマンドインタラクション処理
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
        getCurrentCdp,
        parseApprovalCustomId,
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
                    content: 'テンプレートが見つかりません。削除された可能性があります。',
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
                    ensureApprovalDetector(bridge, cdp, dirName, client);
                } catch (e: any) {
                    await interaction.followUp({
                        content: `ワークスペース接続に失敗しました: ${e.message}`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
            } else {
                cdp = getCurrentCdp(bridge);
            }

            if (!cdp) {
                await interaction.followUp({
                    content: 'CDPに未接続です。先にプロジェクトに接続してください。',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const followUp = await interaction.followUp({
                content: `テンプレート **${template.name}** を実行中...`,
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

    // 【テキストメッセージ処理】
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
 * 初回メッセージ送信時にチャンネル名を自動リネームする
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
        logger.error('[AutoRename] リネーム失敗:', err);
    }
}

/**
 * Discord Interactions API のスラッシュコマンドを処理する
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
                .setTitle('📖 LazyGravity コマンド一覧')
                .setColor(0x5865F2)
                .setDescription('Antigravity を Discord から操作するためのコマンドです。')
                .addFields(
                    {
                        name: '💬 チャット', value: [
                            '`/new` — 新しいチャットセッションを開始',
                            '`/chat` — 現在のセッション情報 + 一覧を表示',
                        ].join('\n')
                    },
                    {
                        name: '⏹️ 制御', value: [
                            '`/stop` — 動作中のLLM生成を中断',
                            '`/screenshot` — Antigravityの画面をキャプチャ',
                        ].join('\n')
                    },
                    {
                        name: '⚙️ 設定', value: [
                            '`/mode` — 実行モードを表示・変更',
                            '`/model [name]` — LLMモデルを表示・変更',
                        ].join('\n')
                    },
                    {
                        name: '📁 プロジェクト', value: [
                            '`/project` — プロジェクト一覧を表示',
                            '`/project create <name>` — 新規プロジェクトを作成',
                        ].join('\n')
                    },
                    {
                        name: '📝 テンプレート', value: [
                            '`/template list` — テンプレート一覧をボタン表示（クリックで即実行）',
                            '`/template add <name> <prompt>` — テンプレートを登録',
                            '`/template delete <name>` — テンプレートを削除',
                        ].join('\n')
                    },
                    {
                        name: '🔧 システム', value: [
                            '`/status` — Bot全体のステータスを表示',
                            '`/autoaccept [on|off|status]` — 承認の自動許可モードを切替',
                            '`/cleanup [days]` — 未使用チャンネル/カテゴリのクリーンアップ',
                            '`/help` — このヘルプを表示',
                        ].join('\n')
                    },
                )
                .setFooter({ text: 'テキストメッセージはそのままAntigravityに送信されます' })
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
                    await interaction.editReply({ content: 'CDPに未接続です。' });
                    break;
                }
                const res = await cdp.setUiModel(modelName);
                if (res.ok) {
                    await interaction.editReply({ content: `モデルを **${res.model}** に変更しました。` });
                } else {
                    await interaction.editReply({ content: res.error || 'モデルの変更に失敗しました。' });
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
                return cdp ? 'CDP接続中' : '未接続';
            })();
            const currentMode = modeService.getCurrentMode();

            const embed = new EmbedBuilder()
                .setTitle('🔧 Bot ステータス')
                .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                .addFields(
                    { name: 'CDP接続', value: activeNames.length > 0 ? `🟢 ${activeNames.length} プロジェクト接続中` : '⚪ 未接続', inline: true },
                    { name: 'モード', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                    { name: '自動承認', value: autoAcceptService.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                )
                .setTimestamp();

            if (activeNames.length > 0) {
                const lines = activeNames.map((name) => {
                    const cdp = bridge.pool.getConnected(name);
                    const contexts = cdp ? cdp.getContexts().length : 0;
                    const detectorActive = bridge.pool.getApprovalDetector(name)?.isActive() ? ' [検出中]' : '';
                    return `• **${name}** — コンテキスト: ${contexts}${detectorActive}`;
                });
                embed.setDescription(`**接続中のプロジェクト:**\n${lines.join('\n')}`);
            } else {
                embed.setDescription('メッセージを送信すると自動的にプロジェクトに接続します。');
            }

            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'autoaccept': {
            const requestedMode = interaction.options.getString('mode') ?? 'status';
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
                await interaction.editReply({ content: '⚠️ CDPに未接続です。先にプロジェクトに接続してください。' });
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
                    const embed = new EmbedBuilder()
                        .setTitle('⏹️ 生成を中断しました')
                        .setDescription('AIの回答生成を安全に停止しました。')
                        .setColor(0xE74C3C)
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ 停止できませんでした')
                        .setDescription(value?.error || 'ストップボタンが見つかりません。LLMが動作中でない可能性があります。')
                        .setColor(0xF39C12)
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                }
            } catch (e: any) {
                await interaction.editReply({ content: `❌ 停止処理中にエラーが発生しました: ${e.message}` });
            }
            break;
        }

        case 'project': {
            const wsSub = interaction.options.getSubcommand(false);
            if (wsSub === 'create') {
                if (!interaction.guild) {
                    await interaction.editReply({ content: 'サーバー内でのみ使用できます。' });
                    break;
                }
                await wsHandler.handleCreate(interaction, interaction.guild);
            } else {
                // /project list or /project (デフォルト)
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

        default:
            await interaction.editReply({
                content: `未知のコマンドです: /${commandName}`,
            });
    }
}
