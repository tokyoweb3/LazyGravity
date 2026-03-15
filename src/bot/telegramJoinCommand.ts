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
import { resolveValidAccountName } from '../utils/accountUtils';
import type { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import type { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import type { AntigravityAccountConfig } from '../utils/configLoader';

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

function resolveAccount(deps: TelegramJoinCommandDeps, chatId: string, userId: string): string {
    return resolveValidAccountName(
        deps.bridge.selectedAccountByChannel?.get(chatId)
            ?? deps.channelPrefRepo?.getAccountName(chatId)
            ?? deps.accountPrefRepo?.getAccountName(userId)
            ?? 'default',
        deps.antigravityAccounts,
    );
}

export async function handleJoin(deps: TelegramJoinCommandDeps, message: PlatformMessage): Promise<void> {
    const binding = deps.telegramBindingRepo?.findByChatId(message.channel.id);
    if (!binding) {
        await message.reply({ text: '⚠️ No project is linked to this chat. Use /project first.' }).catch(logger.error);
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
    const binding = deps.telegramBindingRepo?.findByChatId(message.channel.id);
    if (!binding) {
        await message.reply({ text: '⚠️ No project is linked to this chat. Use /project first.' }).catch(logger.error);
        return;
    }

    const resolvedWorkspacePath = deps.workspaceService
        ? deps.workspaceService.getWorkspacePath(binding.workspacePath)
        : binding.workspacePath;

    const projectName = deps.bridge.pool.extractProjectName(resolvedWorkspacePath);
    const account = resolveAccount(deps, message.channel.id, message.author.id);
    const detector = deps.bridge.pool.getUserMessageDetector(projectName, account);

    if (detector?.isActive()) {
        detector.stop();
        const responseMonitor = activeResponseMonitors.get(resolvedWorkspacePath);
        if (responseMonitor?.isActive()) {
            await responseMonitor.stop();
            activeResponseMonitors.delete(resolvedWorkspacePath);
        }

        await message.reply({ text: '📡 Mirroring OFF\nPC-to-Telegram message mirroring has been stopped.' }).catch(logger.error);
    } else {
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

        await message.reply({ text: '📡 Mirroring ON\nMessages typed in Antigravity on your PC will now appear here.' }).catch(logger.error);
    }
}

async function routeMirroredMessage(
    deps: TelegramJoinCommandDeps,
    cdp: CdpService,
    workspacePath: string,
    info: { text: string },
    channel: any
): Promise<void> {
    const chatTitle = await getCurrentChatTitle(cdp);
    
    await channel.send({
        text: `🖥️ <b>User typed in Antigravity:</b>\n<pre>${escapeHtml(info.text)}</pre>\n<i>Session: ${escapeHtml(chatTitle || 'Unknown')}</i>`
    }).catch((err: any) => logger.error('[TelegramMirror] Failed to send user message:', err));

    startResponseMirror(deps, cdp, workspacePath, channel, chatTitle || 'Unknown');
}

function startResponseMirror(
    deps: TelegramJoinCommandDeps,
    cdp: CdpService,
    workspacePath: string,
    channel: any,
    chatTitle: string
): void {
    const prev = activeResponseMonitors.get(workspacePath);
    if (prev?.isActive()) {
        prev.stop().catch(() => {});
    }

    const monitor = new ResponseMonitor({
        cdpService: cdp,
        pollIntervalMs: 2000,
        maxDurationMs: 300000,
        extractionMode: deps.extractionMode,
        onComplete: (finalText: string) => {
            activeResponseMonitors.delete(workspacePath);
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
            activeResponseMonitors.delete(workspacePath);
        },
    });

    activeResponseMonitors.set(workspacePath, monitor);
    monitor.startPassive().catch((err) => {
        logger.error('[TelegramMirror] Failed to start response monitor:', err);
        activeResponseMonitors.delete(workspacePath);
    });
}
