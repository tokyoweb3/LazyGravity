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

/**
 * Dependencies injected into Telegram join command handlers.
 */
export interface TelegramJoinCommandDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** ChatSessionService managing active chats list. */
    readonly chatSessionService?: ChatSessionService;
    /** Database repository containing Telegram chat binds. */
    readonly telegramBindingRepo?: TelegramBindingRepository;
    /** Service mapping workspace name and directories. */
    readonly workspaceService?: WorkspaceService;
    /** Low-level platform telegram client interface wrapper. */
    readonly botApi?: any;
    /** Account preference configurations repository. */
    readonly accountPrefRepo?: AccountPreferenceRepository;
    /** Channel preference configurations repository. */
    readonly channelPrefRepo?: ChannelPreferenceRepository;
    /** Configured accounts lists database credentials. */
    readonly antigravityAccounts?: AntigravityAccountConfig[];
    /** Extraction mode config preference. */
    readonly extractionMode?: import('../utils/config').ExtractionMode;
    /** Primary active monitors from the main Telegram message handler (keyed by project name). */
    readonly activeMonitors?: Map<string, ResponseMonitor>;
}

const activeResponseMonitors = new Map<string, ResponseMonitor>();

/**
 * Resolves the account name for the interaction based on channel preferences.
 * @param deps Injected dependencies.
 * @param chatId Chat channel ID.
 * @param userId Author user ID.
 * @returns Resolved account name.
 */
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

/**
 * Command handler function for the telegram /join command.
 * @param deps Injected dependencies.
 * @param message Platform message trigger.
 */
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

/**
 * Event handler triggered when a session is selected inside Telegram dropdown UI.
 * @param deps Injected dependencies.
 * @param interaction Dropdown selection interaction.
 */
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

/**
 * Command handler function for the /mirror command to toggle mirroring.
 * @param deps Injected dependencies.
 * @param message Platform command trigger.
 */
export async function handleMirror(deps: TelegramJoinCommandDeps, message: PlatformMessage): Promise<void> {
    const binding = deps.telegramBindingRepo?.findByChatIdWithParentFallback(message.channel.id);
    if (!binding) {
        await message.reply({ text: '⚠️ No project is linked to this chat. Use /project first, or /project_reopen if this is a previously used session.' }).catch(logger.error);
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

/**
 * Route a mirrored message to the appropriate Telegram channel.
 * @param deps Injected dependencies.
 * @param cdp Active CdpService.
 * @param workspacePath Workspace root directory.
 * @param info Input metadata containing text.
 * @param channel Platform channel target.
 */
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

/**
 * Monitor and forward AI responses passively to Telegram channel.
 * @param deps Injected dependencies.
 * @param cdp Active CdpService.
 * @param workspacePath Workspace directory path.
 * @param channel Target channel.
 * @param chatTitle Current session chat title.
 */
export function startResponseMirror(
    deps: TelegramJoinCommandDeps,
    cdp: CdpService,
    workspacePath: string,
    channel: any,
    chatTitle: string
): void {
    // If the primary message handler already has an active monitor for this workspace,
    // skip the passive mirror — the primary handler delivers the response itself, and
    // running both would send the same AI response twice.
    const projectName = deps.bridge.pool.extractProjectName(workspacePath);
    if (deps.activeMonitors?.has(projectName)) {
        logger.debug(`[TelegramMirror] Skipping passive monitor — primary monitor active for ${projectName}`);
        return;
    }

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
