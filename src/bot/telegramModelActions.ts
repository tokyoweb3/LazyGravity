import type { ModelButtonActionDeps } from '../handlers/modelButtonAction';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { ChatSessionService } from '../services/chatSessionService';
import type { WorkspaceService } from '../services/workspaceService';
import type { AccountPreferenceLookup, ChannelPreferenceLookup, AccountConfigLike } from '../utils/accountUtils';
import { resolveScopedAccountName } from '../utils/accountUtils';
import { logger } from '../utils/logger';
import { ensureQuestionDetector, getCurrentChatTitle, registerApprovalSessionChannel, registerApprovalWorkspaceChannel } from '../services/cdpBridgeManager';

/** Services needed to resolve a Telegram model action independently of the globally active workspace. */
export interface TelegramModelRoutingDeps extends Omit<ModelButtonActionDeps, 'resolveCdp' | 'ensureSessionActivated'> {
    /** Telegram workspace binding, including forum-topic parent fallback. */
    readonly telegramBindingRepo: Pick<TelegramBindingRepository, 'findByChatIdWithParentFallback' | 'findByChatId'>;
    /** Resolve bound project names to absolute workspace paths. */
    readonly workspaceService: Pick<WorkspaceService, 'getWorkspacePath'>;
    /** Activate and verify a saved conversation before model operations. */
    readonly chatSessionService: Pick<ChatSessionService, 'getCurrentSessionInfo' | 'activateSessionByTitle' | 'refreshSessionViewIfStuck'>;
    readonly accountPrefRepo?: AccountPreferenceLookup;
    readonly channelPrefRepo?: ChannelPreferenceLookup;
    readonly antigravityAccounts?: AccountConfigLike[];
}

/** Model routing also exposes the account resolver to Telegram question controls. */
export interface TelegramModelActionDeps extends ModelButtonActionDeps {
    resolveAccountName(channelId: string, userId: string): string;
    /** Restore the topic before question controls can click a matching prompt in the IDE. */
    prepareQuestionSession(channelId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Build shared routing for Telegram model menus and legacy buttons.
 * An unbound chat cannot use the last globally active workspace as a fallback.
 */
export function createTelegramModelActionDeps(deps: TelegramModelRoutingDeps): TelegramModelActionDeps {
    /** Honor explicit chat account changes, otherwise retain the persisted conversation's owner. */
    const resolveAccountName = (channelId: string, userId: string): string => resolveScopedAccountName({
        channelId, userId,
        sessionAccountName: deps.bridge.selectedAccountByChannel?.get(channelId)
            ?? deps.channelPrefRepo?.getAccountName(channelId)
            ?? deps.telegramBindingRepo.findByChatId(channelId)?.accountName,
        selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
        accountPrefRepo: deps.accountPrefRepo, channelPrefRepo: deps.channelPrefRepo,
        accounts: deps.antigravityAccounts,
    });
    const actions: TelegramModelActionDeps = {
        bridge: deps.bridge,
        fetchQuota: deps.fetchQuota,
        modelService: deps.modelService,
        userPrefRepo: deps.userPrefRepo,
        resolveAccountName,
        /** Use the same connection and conversation guards for question answers and skips. */
        prepareQuestionSession: async (channelId, userId) => {
            const cdp = await actions.resolveCdp!(channelId, userId);
            return cdp ? actions.ensureSessionActivated!(channelId, userId, cdp)
                : { ok: false, error: 'Not connected to Antigravity. Run /model after reconnecting.' };
        },
        /** Reconnect the menu's bound workspace using its scoped account preference. */
        resolveCdp: async (channelId, userId) => {
            const binding = deps.telegramBindingRepo.findByChatIdWithParentFallback(channelId);
            if (!binding) return null;
            const account = resolveAccountName(channelId, userId);
            deps.bridge.selectedAccountByChannel?.set(channelId, account);
            const workspacePath = deps.workspaceService.getWorkspacePath(binding.workspacePath);
            try {
                return await deps.bridge.pool.getOrConnect(workspacePath, { name: account });
            } catch (error) {
                logger.warn(`[ModelCommand] Could not connect Telegram chat ${channelId}:`, error);
                return null;
            }
        },
        /** Restore the chat's saved conversation before reading or changing its model. */
        ensureSessionActivated: async (channelId, userId, cdp) => {
            const binding = deps.telegramBindingRepo.findByChatId(channelId);
            if (binding?.sessionTitle == null || !binding.accountName) {
                return { ok: false, error: 'No conversation is linked to this chat. Use /join or /new first.' };
            }
            if (binding.accountName !== resolveAccountName(channelId, userId)) {
                return { ok: false, error: 'This conversation belongs to another account. Use /join or /new after switching accounts.' };
            }
            const savedTitle = binding.sessionTitle.trim();
            const current = await deps.chatSessionService.getCurrentSessionInfo(cdp);
            if (savedTitle === '') {
                return !current.hasActiveChat ? { ok: true }
                    : { ok: false, error: 'The new conversation is no longer active. Use /join or /new to select a conversation.' };
            }
            if (current.hasActiveChat && current.title.trim() === savedTitle) return { ok: true };

            logger.info(`[ModelCommand] source=telegram channel=${channelId} user=${userId} restoringSession target="${savedTitle}"`);
            const activation = await deps.chatSessionService.activateSessionByTitle(cdp, savedTitle, {
                maxWaitMs: 8000, retryIntervalMs: 300, allowVisibilityWarmupMs: 1000,
            });
            if (!activation.ok) {
                return { ok: false, error: `Failed to activate saved session "${savedTitle}" before model action: ${activation.error || 'unknown'}` };
            }
            const refresh = await deps.chatSessionService.refreshSessionViewIfStuck(cdp, savedTitle);
            if (!refresh.ok) logger.warn(`[ModelCommand] source=telegram sessionRefreshWarning target="${savedTitle}" error="${refresh.error || 'unknown'}"`);
            return { ok: true };
        },
        /** Reissue pending question controls with live Telegram tokens after the conversation is restored. */
        onSessionReady: async (channel, userId, cdp) => {
            const binding = deps.telegramBindingRepo.findByChatIdWithParentFallback(channel.id);
            if (!binding) return;
            const account = resolveAccountName(channel.id, userId);
            const project = deps.bridge.pool.extractProjectName(deps.workspaceService.getWorkspacePath(binding.workspacePath));
            registerApprovalWorkspaceChannel(deps.bridge, project, channel);
            const title = await getCurrentChatTitle(cdp);
            if (title) registerApprovalSessionChannel(deps.bridge, project, title, channel);
            const wasActive = deps.bridge.pool.getQuestionDetector(project, account)?.isActive;
            ensureQuestionDetector(deps.bridge, cdp, project, account);
            const detector = deps.bridge.pool.getQuestionDetector(project, account);
            if (wasActive) await detector?.republish();
            else await detector?.refresh();
        },
    };
    return actions;
}
