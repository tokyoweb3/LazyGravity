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

import type { PlatformMessage, PlatformChannel } from '../platform/types';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import { CdpBridge, registerApprovalWorkspaceChannel, ensureApprovalDetector, ensureErrorPopupDetector, ensurePlanningDetector } from '../services/cdpBridgeManager';
import { CdpService } from '../services/cdpService';
import { ResponseMonitor } from '../services/responseMonitor';
import { logger } from '../utils/logger';

export interface TelegramMessageHandlerDeps {
    readonly bridge: CdpBridge;
    readonly telegramBindingRepo: TelegramBindingRepository;
}

/**
 * Create a handler for Telegram messages.
 * Returns an async function that processes a single PlatformMessage.
 */
export function createTelegramMessageHandler(deps: TelegramMessageHandlerDeps) {
    // Per-workspace prompt queue to serialize messages
    const workspaceQueues = new Map<string, Promise<void>>();

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
        const chatId = message.channel.id;
        const promptText = message.content.trim();

        if (!promptText) return;

        // Resolve workspace binding for this Telegram chat
        const binding = deps.telegramBindingRepo.findByChatId(chatId);
        if (!binding) {
            await message.reply({
                text: 'No project is linked to this chat. Use /project to bind a workspace.',
            }).catch(logger.error);
            return;
        }

        const workspacePath = binding.workspacePath;

        await enqueueForWorkspace(workspacePath, async () => {
            let cdp: CdpService;
            try {
                cdp = await deps.bridge.pool.getOrConnect(workspacePath);
            } catch (e: any) {
                await message.reply({
                    text: `Failed to connect to workspace: ${e.message}`,
                }).catch(logger.error);
                return;
            }

            const projectName = deps.bridge.pool.extractProjectName(workspacePath);
            deps.bridge.lastActiveWorkspace = projectName;
            deps.bridge.lastActiveChannel = message.channel;
            registerApprovalWorkspaceChannel(deps.bridge, projectName, message.channel);

            // Start detectors (platform-agnostic now)
            ensureApprovalDetector(deps.bridge, cdp, projectName);
            ensureErrorPopupDetector(deps.bridge, cdp, projectName);
            ensurePlanningDetector(deps.bridge, cdp, projectName);

            // Acknowledge receipt
            await message.react('\u{1F440}').catch(() => {});

            // Inject prompt into Antigravity
            const injectResult = await cdp.injectMessage(promptText);
            if (!injectResult.ok) {
                await message.reply({
                    text: `Failed to send message: ${injectResult.error}`,
                }).catch(logger.error);
                return;
            }

            // Monitor the response
            const channel = message.channel;
            await new Promise<void>((resolve) => {
                const TIMEOUT_MS = 300_000;
                const safetyTimer = setTimeout(() => {
                    logger.warn(`[TelegramHandler:${projectName}] Safety timeout — releasing queue after 300s`);
                    resolve();
                }, TIMEOUT_MS);

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(safetyTimer);
                    resolve();
                };

                const monitor = new ResponseMonitor({
                    cdpService: cdp,
                    pollIntervalMs: 2000,
                    maxDurationMs: TIMEOUT_MS,
                    stopGoneConfirmCount: 3,
                    onComplete: async (finalText) => {
                        try {
                            if (finalText && finalText.trim().length > 0) {
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
