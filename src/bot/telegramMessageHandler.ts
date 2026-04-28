/**
 * Minimal Telegram message handler.
 *
 * Handles incoming PlatformMessage from Telegram:
 *   1. Resolves workspace from TelegramBindingRepository
 *   2. Connects to CDP
 *   3. Injects the prompt into Antigravity
 *   4. Monitors the response via ResponseMonitor
 *   5. Relays the response text back via PlatformChannel.send()
 */

import type { PlatformMessage, PlatformChannel, PlatformSentMessage } from '../platform/types';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { WorkspaceService } from '../services/workspaceService';
import { CdpBridge, registerApprovalWorkspaceChannel, ensureApprovalDetector, ensureErrorPopupDetector, ensurePlanningDetector, ensureRunCommandDetector, ensureUserMessageDetector } from '../services/cdpBridgeManager';
import { CdpService } from '../services/cdpService';
import { ResponseMonitor, captureResponseMonitorBaseline } from '../services/responseMonitor';
import { ProcessLogBuffer } from '../utils/processLogBuffer';
import { splitOutputAndLogs } from '../utils/discordFormatter';
import { parseTelegramProjectCommand, handleTelegramProjectCommand } from './telegramProjectCommand';
import { parseTelegramCommand, handleTelegramCommand } from './telegramCommands';
import { escapeHtml } from '../platform/telegram/telegramFormatter';
import type { ModeService } from '../services/modeService';
import type { ModelService } from '../services/modelService';
import { applyDefaultModel } from '../services/defaultModelApplicator';
import { logger } from '../utils/logger';
import { downloadTelegramPhotos } from '../utils/telegramImageHandler';
import { cleanupInboundImageAttachments } from '../utils/imageHandler';
import type { InboundImageAttachment } from '../utils/imageHandler';
import type { ExtractionMode } from '../utils/config';
import type { ChatSessionService } from '../services/chatSessionService';
import type { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import type { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import { routeMirroredMessage } from './telegramJoinCommand';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import { resolveScopedAccountName } from '../utils/accountUtils';

export interface TelegramMessageHandlerDeps {
    readonly bridge: CdpBridge;
    readonly telegramBindingRepo: TelegramBindingRepository;
    readonly workspaceService?: WorkspaceService;
    readonly modeService?: ModeService;
    readonly modelService?: ModelService;
    readonly extractionMode?: ExtractionMode;
    readonly templateRepo?: import('../database/templateRepository').TemplateRepository;
    readonly fetchQuota?: () => Promise<any[]>;
    /** Shared map of active ResponseMonitors keyed by project name.
     *  Used by /stop to halt monitoring and prevent stale re-sends. */
    readonly activeMonitors?: Map<string, ResponseMonitor>;
    /** Bot token for downloading Telegram file attachments. */
    readonly botToken?: string;
    /** Bot API object for getFile calls. */
    readonly botApi?: import('../platform/telegram/wrappers').TelegramBotLike['api'];
    readonly chatSessionService?: ChatSessionService;
    /** Response monitor inactivity timeout in ms. Defaults to ResponseMonitor default (900000). */
    readonly responseTimeoutMs?: number;
    readonly accountPrefRepo?: AccountPreferenceRepository;
    readonly channelPrefRepo?: ChannelPreferenceRepository;
    readonly antigravityAccounts?: AntigravityAccountConfig[];
}

/**
 * Create a handler for Telegram messages.
 * Returns an async function that processes a single PlatformMessage.
 */
export function createTelegramMessageHandler(deps: TelegramMessageHandlerDeps) {
    // Per-workspace prompt queue to serialize messages
    const workspaceQueues = new Map<string, Promise<void>>();

    function resolveAccount(chatId: string, userId: string): string {
        return resolveScopedAccountName({
            channelId: chatId,
            userId,
            selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
            channelPrefRepo: deps.channelPrefRepo,
            accountPrefRepo: deps.accountPrefRepo,
            accounts: deps.antigravityAccounts,
        });
    }

    function enqueueForWorkspace(
        workspacePath: string,
        task: () => Promise<void>,
    ): Promise<void> {
        const current = (workspaceQueues.get(workspacePath) ?? Promise.resolve()).catch(() => {});
        const next = current.then(async () => {
            try {
                await task();
            } catch (err: any) {
                logger.error('[TelegramQueue] task error:', err?.message || err);
            }
        });
        workspaceQueues.set(workspacePath, next);
        return next;
    }

    return async (message: PlatformMessage): Promise<void> => {
        const handlerEntryTime = Date.now();
        const chatId = message.channel.id;
        const hasImageAttachments = message.attachments.length > 0
            && message.attachments.some((att) => (att.contentType || '').startsWith('image/'));
        const promptText = message.content.trim();

        // Allow through if there's text OR image attachments
        if (!promptText && !hasImageAttachments) return;

        logger.debug(`[TelegramHandler] handler entered (chat=${chatId}, msgTime=${message.createdAt.toISOString()}, handlerDelay=${handlerEntryTime - message.createdAt.getTime()}ms)`);

        // Intercept built-in commands (/help, /status, /stop, /ping, /start)
        const cmd = parseTelegramCommand(promptText);
        if (cmd) {
            await handleTelegramCommand(
                {
                    bridge: deps.bridge,
                    modeService: deps.modeService,
                    modelService: deps.modelService,
                    telegramBindingRepo: deps.telegramBindingRepo,
                    templateRepo: deps.templateRepo,
                    workspaceService: deps.workspaceService,
                    fetchQuota: deps.fetchQuota,
                    activeMonitors: deps.activeMonitors,
                    chatSessionService: deps.chatSessionService,
                    accountPrefRepo: deps.accountPrefRepo,
                    channelPrefRepo: deps.channelPrefRepo,
                    antigravityAccounts: deps.antigravityAccounts,
                    botApi: deps.botApi,
                },
                message,
                cmd,
            );
            return;
        }

        // Intercept /project command before CDP path
        if (deps.workspaceService) {
            const parsed = parseTelegramProjectCommand(promptText);
            if (parsed) {
                await handleTelegramProjectCommand(
                    { workspaceService: deps.workspaceService, telegramBindingRepo: deps.telegramBindingRepo },
                    message,
                    parsed,
                );
                return;
            }
        }

        // Resolve workspace binding for this Telegram chat
        const binding = deps.telegramBindingRepo.findByChatIdWithParentFallback(chatId);
        if (!binding) {
            await message.reply({
                text: 'No project is linked to this chat. Use /project to bind a workspace, or /project_reopen if this is a previously used session.',
            }).catch(logger.error);
            return;
        }

        // Resolve relative workspace name to absolute path (mirrors Discord handler behavior).
        // Without this, CDP receives a bare name like "DemoLG" and Antigravity
        // falls back to its default scratch directory.
        const workspacePath = deps.workspaceService
            ? deps.workspaceService.getWorkspacePath(binding.workspacePath)
            : binding.workspacePath;

        await enqueueForWorkspace(workspacePath, async () => {
            const selectedAccount = resolveAccount(chatId, message.author.id);
            deps.bridge.selectedAccountByChannel?.set(chatId, selectedAccount);

            const cdpStartTime = Date.now();
            logger.debug(`[TelegramHandler] getOrConnect start (elapsed=${cdpStartTime - handlerEntryTime}ms)`);
            let cdp: CdpService;
            try {
                cdp = await deps.bridge.pool.getOrConnect(workspacePath, { name: selectedAccount });
            } catch (e: any) {
                await message.reply({
                    text: `Failed to connect to workspace: ${e.message}`,
                }).catch(logger.error);
                return;
            }
            logger.debug(`[TelegramHandler] getOrConnect done (took=${Date.now() - cdpStartTime}ms)`);

            const projectName = deps.bridge.pool.extractProjectName(workspacePath);
            deps.bridge.lastActiveWorkspace = projectName;
            deps.bridge.lastActiveChannel = message.channel;
            registerApprovalWorkspaceChannel(deps.bridge, projectName, message.channel);

            // Always push ModeService's mode to Antigravity on CDP connect.
            // ModeService is the source of truth (what the user sees in /mode UI).
            // Without this, Antigravity could be in a different mode (e.g. Planning)
            // while the user believes they're in Fast mode.
            if (deps.modeService) {
                const currentMode = deps.modeService.getCurrentMode();
                const syncRes = await cdp.setUiMode(currentMode);
                if (syncRes.ok) {
                    deps.modeService.markSynced();
                    logger.debug(`[TelegramHandler] Mode pushed to Antigravity: ${currentMode}`);
                } else {
                    logger.warn(`[TelegramHandler] Mode push failed: ${syncRes.error}`);
                }
            }

            // Apply default model preference on CDP connect
            if (deps.modelService) {
                const modelResult = await applyDefaultModel(cdp, deps.modelService);
                if (modelResult.stale && modelResult.staleMessage) {
                    await message.reply({ text: modelResult.staleMessage }).catch(logger.error);
                }
            }

            // Start detectors (platform-agnostic now)
            ensureApprovalDetector(deps.bridge, cdp, projectName, selectedAccount);
            ensureErrorPopupDetector(deps.bridge, cdp, projectName, selectedAccount);
            ensurePlanningDetector(deps.bridge, cdp, projectName, selectedAccount);
            ensureRunCommandDetector(deps.bridge, cdp, projectName, selectedAccount);

            // Auto-enable PC-to-Telegram mirroring if not already active for this session
            ensureUserMessageDetector(deps.bridge, cdp, projectName, (info) => {
                routeMirroredMessage(deps as any, cdp, workspacePath, info, message.channel).catch((err) => {
                    logger.error('[TelegramMirror] Error routing mirrored message:', err);
                });
            }, selectedAccount);

            // Acknowledge receipt
            await message.react('\u{1F440}').catch(() => {});

            // Download image attachments if present
            let inboundImages: InboundImageAttachment[] = [];
            if (hasImageAttachments && deps.botToken && deps.botApi) {
                try {
                    inboundImages = await downloadTelegramPhotos(
                        message.attachments,
                        deps.botToken,
                        deps.botApi,
                    );
                } catch (err: any) {
                    logger.warn('[TelegramHandler] Image download failed:', err?.message || err);
                }

                if (hasImageAttachments && inboundImages.length === 0) {
                    await message.reply({
                        text: 'Failed to retrieve attached images. Please wait and try again.',
                    }).catch(logger.error);
                    return;
                }
            }

            // Determine the prompt text — use default for image-only messages
            const effectivePrompt = promptText || 'Please review the attached images and respond accordingly.';
            const baseline = await captureResponseMonitorBaseline(cdp);

            // Add to echo hashes to prevent mirroring this message back to Telegram
            const detector = deps.bridge.pool.getUserMessageDetector(projectName, selectedAccount);
            if (detector) {
                detector.addEchoHash(effectivePrompt);
            }

            // Inject prompt (with or without images) into Antigravity
            logger.prompt(effectivePrompt);
            let injectResult;
            try {
                if (inboundImages.length > 0) {
                    injectResult = await cdp.injectMessageWithImageFiles(
                        effectivePrompt,
                        inboundImages.map((img) => img.localPath),
                    );

                    if (!injectResult.ok) {
                        // Fallback: send text-only with image reference
                        logger.warn('[TelegramHandler] Image injection failed, falling back to text-only');
                        injectResult = await cdp.injectMessage(effectivePrompt);
                    }
                } else {
                    injectResult = await cdp.injectMessage(effectivePrompt);
                }
            } finally {
                // Cleanup temp files regardless of outcome
                if (inboundImages.length > 0) {
                    await cleanupInboundImageAttachments(inboundImages).catch(() => {});
                }
            }

            if (!injectResult.ok) {
                await message.reply({
                    text: `Failed to send message: ${injectResult.error}`,
                }).catch(logger.error);
                return;
            }

            // Monitor the response
            const channel = message.channel;
            const startTime = Date.now();
            const processLogBuffer = new ProcessLogBuffer({ maxChars: 3500, maxEntries: 120, maxEntryLength: 220 });
            let lastActivityLogText = '';
            let statusMsg: PlatformSentMessage | null = null;
            let lastSentProgressText = '';
            let lastProgressSentTime = 0;

            // Send initial status message
            statusMsg = await channel.send({ text: 'Processing...' }).catch(() => null);

            await new Promise<void>((resolve) => {
                const TIMEOUT_MS = deps.responseTimeoutMs ?? 900_000;

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(safetyTimer);
                    deps.activeMonitors?.delete(projectName);
                    resolve();
                };

                const monitor = new ResponseMonitor({
                    cdpService: cdp,
                    pollIntervalMs: 2000,
                    maxDurationMs: TIMEOUT_MS,
                    stopGoneConfirmCount: 3,
                    extractionMode: deps.extractionMode,
                    initialBaselineText: baseline.text,
                    initialSeenProcessLogKeys: baseline.processLogKeys,

                    onProcessLog: (logText) => {
                        if (logText && logText.trim().length > 0) {
                            lastActivityLogText = processLogBuffer.append(logText);
                        }
                        if (statusMsg && lastActivityLogText && !lastSentProgressText) {
                            const elapsed = Math.round((Date.now() - startTime) / 1000);
                            statusMsg.edit({
                                text: `${escapeHtml(lastActivityLogText)}\n\n⏱️ ${elapsed}s`,
                            }).catch(() => { statusMsg = null; });
                        }
                    },

                    onProgress: (text) => {
                        if (!text || text === lastSentProgressText) return;
                        const now = Date.now();
                        const isSignificant = text.length > lastSentProgressText.length + 150;
                        const isTimedOut = now - lastProgressSentTime > 7000;

                        if (isSignificant || isTimedOut) {
                            lastSentProgressText = text;
                            lastProgressSentTime = now;
                            const display = text.length > 3500 ? text.slice(-3500) : text;
                            const caption = `🤖 <b>Antigravity Response (Live):</b>\n${escapeHtml(display)}`;
                            if (statusMsg) {
                                statusMsg.edit({ text: caption }).catch(() => { statusMsg = null; });
                            }
                        }
                    },

                    onComplete: async (finalText) => {
                        try {
                            const elapsed = Math.round((Date.now() - startTime) / 1000);

                            // Console log output (mirroring Discord handler pattern)
                            const finalLogText = lastActivityLogText || processLogBuffer.snapshot();
                            if (finalLogText && finalLogText.trim().length > 0) {
                                logger.divider('Process Log');
                                console.info(finalLogText);
                            }

                            const separated = splitOutputAndLogs(finalText || '');
                            const finalOutputText = separated.output || finalText || '';
                            if (finalOutputText && finalOutputText.trim().length > 0) {
                                logger.divider(`Output (${finalOutputText.length} chars)`);
                                console.info(finalOutputText);
                            }
                            logger.divider();

                            // Update status message with final activity log
                            if (statusMsg && finalLogText && finalLogText.trim().length > 0) {
                                await statusMsg.edit({
                                    text: `${escapeHtml(finalLogText)}\n\n✅ Done in ${elapsed}s`,
                                }).catch(() => {});
                            } else if (statusMsg) {
                                await statusMsg.delete().catch(() => {});
                            }

                            // Send the final response
                            if (finalOutputText && finalOutputText.trim().length > 0) {
                                await sendTextChunked(channel, finalOutputText);
                            } else if (finalText && finalText.trim().length > 0) {
                                await sendTextChunked(channel, finalText);
                            } else {
                                await channel.send({ text: '(Empty response from Antigravity)' }).catch(logger.error);
                            }
                        } finally {
                            settle();
                        }
                    },
                    onTimeout: async (lastText) => {
                        try {
                            // Update status message on timeout
                            if (statusMsg) {
                                const elapsed = Math.round((Date.now() - startTime) / 1000);
                                await statusMsg.edit({
                                    text: `⏰ Timed out after ${elapsed}s`,
                                }).catch(() => {});
                            }

                            if (lastText && lastText.trim().length > 0) {
                                await sendTextChunked(channel, `(Timeout) ${lastText}`);
                            } else {
                                await channel.send({ text: 'Response timed out.' }).catch(logger.error);
                            }
                        } finally {
                            settle();
                        }
                    },
                });

                const safetyTimer = setTimeout(() => {
                    logger.warn(`[TelegramHandler:${projectName}] Safety timeout — releasing queue after 300s`);
                    monitor.stop().catch(() => {});
                    settle();
                }, TIMEOUT_MS);

                // Register the monitor so /stop can access and stop it
                deps.activeMonitors?.set(projectName, monitor);

                monitor.start().catch((err: any) => {
                    logger.error(`[TelegramHandler:${projectName}] monitor.start() failed:`, err?.message || err);
                    settle();
                });
            });
        });
    };
}

/** Split long text into Telegram-safe chunks (max 4096 chars). */
async function sendTextChunked(
    channel: PlatformChannel,
    text: string,
): Promise<void> {
    const MAX_LENGTH = 4096;
    let remaining = text;
    while (remaining.length > 0) {
        const chunk = remaining.slice(0, MAX_LENGTH);
        remaining = remaining.slice(MAX_LENGTH);
        await channel.send({ text: chunk }).catch(logger.error);
    }
}
