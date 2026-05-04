import * as path from 'path';
import { CdpBridge, ensureUserMessageDetector, getCurrentChatTitle } from '../services/cdpBridgeManager';
import { CdpService } from '../services/cdpService';
import { ResponseMonitor } from '../services/responseMonitor';
import type { ChatSessionService } from '../services/chatSessionService';
import type { PlatformMessage, PlatformSelectInteraction, MessagePayload } from '../platform/types';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import { buildSessionPickerPayload, SESSION_SELECT_ID } from '../ui/sessionPickerUi';
import { logger } from '../utils/logger';
import { escapeHtml } from '../platform/telegram/telegramFormatter';
import type { WorkspaceService } from '../services/workspaceService';
import { tryCreateTopicAndBind } from './telegramProjectCommand';
import { resolveScopedAccountName } from '../utils/accountUtils';
import type { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import type { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import { MirrorPersistenceService, MirrorState } from '../services/mirrorPersistenceService';

export interface TelegramJoinCommandDeps {
    readonly bridge: CdpBridge;
    readonly chatSessionService?: ChatSessionService;
    readonly telegramBindingRepo?: TelegramBindingRepository;
    readonly workspaceService?: WorkspaceService;
    readonly botApi?: any;
    readonly accountPrefRepo?: AccountPreferenceRepository;
    readonly channelPrefRepo?: ChannelPreferenceRepository;
    readonly antigravityAccounts?: AntigravityAccountConfig[];
    readonly extractionMode?: import('../utils/config').ExtractionMode;
}

const activeResponseMonitors = new Map<string, ResponseMonitor>();

// Centralized state for mirroring persistence
let persistenceService: MirrorPersistenceService | null = null;
const activeMirrors = new Map<string, MirrorState>();

function buildMonitorKey(channelId: string, workspacePath: string): string {
    return `${channelId}::${workspacePath}`;
}

export function initMirrorPersistence(projectRoot: string): void {
    persistenceService = new MirrorPersistenceService(projectRoot);
}

function updatePersistence(): void {
    if (persistenceService) {
        persistenceService.save(Array.from(activeMirrors.values()));
    }
}

function resolveAccount(deps: TelegramJoinCommandDeps, chatId: string, userId: string): string {
    return resolveScopedAccountName({
        channelId: chatId,
        userId,
        selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
        channelPrefRepo: deps.channelPrefRepo,
        accountPrefRepo: deps.accountPrefRepo,
        accounts: deps.antigravityAccounts,
    });
}

export async function handleJoin(deps: TelegramJoinCommandDeps, message: PlatformMessage): Promise<void> {
    const binding = deps.telegramBindingRepo?.findByChatIdWithParentFallback(message.channel.id);
    if (!binding) {
        await message.reply({ text: '⚠️ No project is linked to this chat. Use /project first, or /project_reopen if this is a previously used session.' }).catch(logger.error);
        return;
    }

    const resolvedWorkspacePath = deps.workspaceService
        ? deps.workspaceService.getWorkspacePath(binding.workspacePath)
        : binding.workspacePath;

    const account = resolveAccount(deps, message.channel.id, message.author.id);

    try {
        const cdp = await deps.bridge.pool.getOrConnect(resolvedWorkspacePath, { name: account });
        if (!deps.chatSessionService) {
            await message.reply({ text: 'Chat session service not available.' }).catch(logger.error);
            return;
        }

        const sessions = await deps.chatSessionService.listAllSessions(cdp);
        if (sessions.length === 0) {
            await message.reply({ text: 'No active sessions found in this project.' }).catch(logger.error);
            return;
        }

        const ui = buildSessionPickerPayload(sessions);
        await message.reply(ui as MessagePayload).catch(logger.error);
    } catch (e: any) {
        await message.reply({ text: `⚠️ Failed to connect to project: ${e.message}` }).catch(logger.error);
    }
}

export async function handleTelegramJoinSelect(deps: TelegramJoinCommandDeps, interaction: PlatformSelectInteraction): Promise<void> {
    const selectedTitle = interaction.values[0];
    const originalChannelId = interaction.channel.id;
    const binding = deps.telegramBindingRepo?.findByChatId(originalChannelId);

    if (!binding) {
        await interaction.update({ text: '⚠️ No project is bound to this chat.' }).catch(logger.error);
        return;
    }

    const resolvedWorkspacePath = deps.workspaceService
        ? deps.workspaceService.getWorkspacePath(binding.workspacePath)
        : binding.workspacePath;

    const account = resolveAccount(deps, interaction.channel.id, interaction.user.id);

    let cdp: CdpService;
    try {
        cdp = await deps.bridge.pool.getOrConnect(resolvedWorkspacePath, { name: account });
    } catch (e: any) {
        await interaction.update({ text: `⚠️ Failed to connect to project: ${e.message}` }).catch(logger.error);
        return;
    }

    if (!deps.chatSessionService) {
        await interaction.update({ text: 'Chat session service not available.' }).catch(logger.error);
        return;
    }

    const activateResult = await deps.chatSessionService.activateSessionByTitle(cdp, selectedTitle);
    if (!activateResult.ok) {
        await interaction.update({ text: `⚠️ Failed to join session: ${activateResult.error}` }).catch(logger.error);
        return;
    }

    let targetChannelId = originalChannelId;
    if (deps.botApi && deps.bridge && deps.telegramBindingRepo) {
        targetChannelId = await tryCreateTopicAndBind(
            deps.botApi,
            originalChannelId,
            binding.workspacePath,
            deps.telegramBindingRepo,
            deps.bridge.pool
        );
    }

    const replyMsg = targetChannelId !== originalChannelId 
        ? `✅ Joined session in new topic: <b>${escapeHtml(selectedTitle)}</b>\nUse /mirror if you want to forward PC messages here.` 
        : `✅ Joined session: <b>${escapeHtml(selectedTitle)}</b>\nUse /mirror if you want to forward PC messages here.`;

    await interaction.update({ text: replyMsg }).catch(logger.error);
}

export async function handleMirror(deps: TelegramJoinCommandDeps, message: PlatformMessage): Promise<void> {
    const binding = deps.telegramBindingRepo?.findByChatIdWithParentFallback(message.channel.id);
    if (!binding) {
        await message.reply({ text: '⚠️ No project is linked to this chat. Use /project first, or /project_reopen if this is a previously used session.' }).catch(logger.error);
        return;
    }

    const resolvedWorkspacePath = deps.workspaceService
        ? deps.workspaceService.getWorkspacePath(binding.workspacePath)
        : binding.workspacePath;

    const monitorKey = buildMonitorKey(message.channel.id, resolvedWorkspacePath);
    const mirrorEntry = activeMirrors.get(monitorKey);
    const projectName = deps.bridge.pool.extractProjectName(resolvedWorkspacePath);

    if (mirrorEntry) {
        const activeAccount = mirrorEntry.accountName ?? undefined;
        const detector = deps.bridge.pool.getUserMessageDetector(projectName, activeAccount);
        if (detector?.isActive()) {
            detector.stop();
        }
        const responseMonitor = activeResponseMonitors.get(monitorKey);
        if (responseMonitor?.isActive()) {
            await responseMonitor.stop();
        }
        if (activeResponseMonitors.get(monitorKey) === responseMonitor) {
            activeResponseMonitors.delete(monitorKey);
        }
        activeMirrors.delete(monitorKey);
        updatePersistence();

        await message.reply({ text: '📡 Mirroring OFF\nPC-to-Telegram message mirroring has been stopped.' }).catch(logger.error);
    } else {
        const account = resolveAccount(deps, message.channel.id, message.author.id);
        let cdp: CdpService;
        try {
            cdp = await deps.bridge.pool.getOrConnect(resolvedWorkspacePath, { name: account });
        } catch (e: any) {
            await message.reply({ text: `⚠️ Failed to connect to project: ${e.message}` }).catch(logger.error);
            return;
        }

        const existing = deps.bridge.pool.getUserMessageDetector(projectName, account);
        if (existing?.isActive()) {
            existing.stop();
        }

        ensureUserMessageDetector(deps.bridge, cdp, projectName, (info) => {
            routeMirroredMessage(deps, cdp, resolvedWorkspacePath, info, message.channel).catch((err) => {
                logger.error('[TelegramMirror] Error routing mirrored message:', err);
            });
        }, account);

        activeMirrors.set(monitorKey, {
            channelId: message.channel.id,
            workspacePath: resolvedWorkspacePath,
            accountName: account
        });
        updatePersistence();

        await message.reply({ text: '📡 Mirroring ON\nMessages typed in Antigravity on your PC will now appear here.' }).catch(logger.error);
    }
}

export async function routeMirroredMessage(
    deps: TelegramJoinCommandDeps,
    cdp: CdpService,
    workspacePath: string,
    info: { text: string },
    channel: any
): Promise<void> {
    // Broadcast the hash to all other detectors for this project to prevent echoes
    const projectName = deps.bridge.pool.extractProjectName(workspacePath);
    const detectors = deps.bridge.pool.getUserMessageDetectorsForProject(projectName);
    for (const d of detectors) {
        d.addEchoHash(info.text);
    }

    const chatTitle = await getCurrentChatTitle(cdp);
    
    // Capture the baseline BEFORE sending the user message notification,
    // so that the passive monitor knows which assistant messages are old.
    let baselineText: string | null = null;
    let baselineCount = 0;
    let baselineFingerprints: string[] = [];
    let baselineProcessLogKeys: string[] = [];

    try {
        const { captureResponseMonitorBaseline } = require('../services/responseMonitor');
        const baseline = await captureResponseMonitorBaseline(cdp);
        baselineText = baseline.text;
        baselineCount = baseline.count;
        baselineFingerprints = baseline.fingerprints;
        baselineProcessLogKeys = baseline.processLogKeys;
    } catch (err) {
        logger.error('[TelegramMirror] Error capturing passive baseline:', err);
    }
    
    await channel.send({
        text: `🖥️ <b>User typed in Antigravity:</b>\n<pre>${escapeHtml(info.text)}</pre>\n<i>Session: ${escapeHtml(chatTitle || 'Unknown')}</i>`
    }).catch((err: any) => logger.error('[TelegramMirror] Failed to send user message:', err));

    startResponseMirror(deps, cdp, workspacePath, channel, chatTitle || 'Unknown', baselineText, baselineCount, baselineFingerprints, baselineProcessLogKeys);
}

export function startResponseMirror(
    deps: TelegramJoinCommandDeps,
    cdp: CdpService,
    workspacePath: string,
    channel: any,
    chatTitle: string,
    baselineText?: string | null,
    baselineCount?: number,
    baselineFingerprints?: string[],
    baselineProcessLogKeys?: string[]
): void {
    const monitorKey = buildMonitorKey(channel.id, workspacePath);
    const prev = activeResponseMonitors.get(monitorKey);
    if (prev?.isActive()) {
        prev.stop().catch(() => {});
    }

    const monitor = new ResponseMonitor({
        cdpService: cdp,
        pollIntervalMs: 2000,
        maxDurationMs: 300000,
        extractionMode: deps.extractionMode,
        initialBaselineText: baselineText,
        initialBaselineCount: baselineCount,
        initialBaselineFingerprints: baselineFingerprints,
        initialSeenProcessLogKeys: baselineProcessLogKeys,
        onComplete: (finalText: string) => {
            if (activeResponseMonitors.get(monitorKey) === monitor) activeResponseMonitors.delete(monitorKey);
            if (!finalText || finalText.trim().length === 0) return;

            const maxLen = 3000;
            const text = finalText.length > maxLen
                ? finalText.slice(0, maxLen) + '\n...(truncated)'
                : finalText;

            channel.send({
                text: `🤖 <b>Antigravity Response:</b>\n${escapeHtml(text)}\n\n<i>Session: ${escapeHtml(chatTitle)}</i>`
            }).catch((err: any) => logger.error('[TelegramMirror] Failed to send AI response:', err));
        },
        onTimeout: () => {
            if (activeResponseMonitors.get(monitorKey) === monitor) activeResponseMonitors.delete(monitorKey);
        },
    });

    activeResponseMonitors.set(monitorKey, monitor);
    monitor.startPassive().catch((err) => {
        logger.error('[TelegramMirror] Failed to start response monitor:', err);
        if (activeResponseMonitors.get(monitorKey) === monitor) activeResponseMonitors.delete(monitorKey);
    });
}

/**
 * Restore active mirrors from persistent storage on startup.
 */
export async function restoreMirrors(deps: TelegramJoinCommandDeps): Promise<void> {
    if (!persistenceService) return;
    if (!deps.botApi) {
        logger.warn('[MirrorPersistence] botApi is unavailable; skipping mirror restoration.');
        return;
    }
    
    const states = persistenceService.load();
    if (states.length === 0) return;

    logger.info(`[MirrorPersistence] Restoring ${states.length} active mirrors...`);

    for (const state of states) {
        try {
            const projectName = path.basename(state.workspacePath);
            const account = state.accountName || resolveAccount(deps, state.channelId, 'system');
            
            const cdp = await deps.bridge.pool.getOrConnect(state.workspacePath, { name: account });
            const channel = { id: state.channelId, send: (m: any) => deps.botApi.sendMessage(state.channelId, m.text, { parse_mode: 'HTML' }) };

            ensureUserMessageDetector(deps.bridge, cdp, projectName, (info) => {
                routeMirroredMessage(deps, cdp, state.workspacePath, info, channel).catch((err) => {
                    logger.error('[TelegramMirror] Error routing restored mirrored message:', err);
                });
            }, account);

            const monitorKey = buildMonitorKey(state.channelId, state.workspacePath);
            activeMirrors.set(monitorKey, state);
            
            logger.debug(`[MirrorPersistence] Restored mirror for ${projectName} in channel ${state.channelId}`);
        } catch (error) {
            logger.warn(`[MirrorPersistence] Failed to restore mirror for ${state.workspacePath}:`, error);
        }
    }
}

