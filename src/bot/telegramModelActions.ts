import type { ModelButtonActionDeps } from '../handlers/modelButtonAction';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { ChatSessionRepository } from '../database/chatSessionRepository';
import type { ChatSessionService } from '../services/chatSessionService';
import type { WorkspaceService } from '../services/workspaceService';
import type { AccountPreferenceLookup, ChannelPreferenceLookup, AccountConfigLike } from '../utils/accountUtils';
import { resolveScopedAccountName } from '../utils/accountUtils';
import { t } from '../utils/i18n';
import { logger } from '../utils/logger';

/** Services needed to resolve a Telegram model action independently of the globally active workspace. */
export interface TelegramModelRoutingDeps extends Omit<ModelButtonActionDeps, 'resolveCdp' | 'ensureSessionActivated'> {
    /** Telegram workspace binding, including forum-topic parent fallback. */
    readonly telegramBindingRepo: Pick<TelegramBindingRepository, 'findByChatIdWithParentFallback'>;
    /** Resolve bound project names to absolute workspace paths. */
    readonly workspaceService: Pick<WorkspaceService, 'getWorkspacePath'>;
    /** Saved conversation and account for the menu's chat. */
    readonly chatSessionRepo: Pick<ChatSessionRepository, 'findByChannelId'>;
    /** Activate and verify a saved conversation before model operations. */
    readonly chatSessionService: Pick<ChatSessionService, 'getCurrentSessionInfo' | 'activateSessionByTitle' | 'refreshSessionViewIfStuck'>;
    readonly accountPrefRepo?: AccountPreferenceLookup;
    readonly channelPrefRepo?: ChannelPreferenceLookup;
    readonly antigravityAccounts?: AccountConfigLike[];
}

/**
 * Build shared routing for Telegram model menus and legacy buttons.
 * An unbound chat cannot use the last globally active workspace as a fallback.
 */
export function createTelegramModelActionDeps(deps: TelegramModelRoutingDeps): ModelButtonActionDeps {
    return {
        bridge: deps.bridge,
        fetchQuota: deps.fetchQuota,
        modelService: deps.modelService,
        userPrefRepo: deps.userPrefRepo,
        /** Reconnect the menu's bound workspace using its scoped account preference. */
        resolveCdp: async (channelId, userId) => {
            const binding = deps.telegramBindingRepo.findByChatIdWithParentFallback(channelId);
            if (!binding) return null;
            const session = deps.chatSessionRepo.findByChannelId(channelId);
            const account = resolveScopedAccountName({
                channelId, userId, sessionAccountName: session?.activeAccountName,
                selectedAccountByChannel: deps.bridge.selectedAccountByChannel,
                accountPrefRepo: deps.accountPrefRepo, channelPrefRepo: deps.channelPrefRepo,
                accounts: deps.antigravityAccounts,
            });
            deps.bridge.selectedAccountByChannel?.set(channelId, account);
            const workspacePath = deps.workspaceService.getWorkspacePath(binding.workspacePath);
            return deps.bridge.pool.getOrConnect(workspacePath, { name: account });
        },
        /** Restore the chat's saved conversation before reading or changing its model. */
        ensureSessionActivated: async (channelId, userId, cdp) => {
            const savedTitle = deps.chatSessionRepo.findByChannelId(channelId)?.displayName?.trim() || '';
            if (!savedTitle || savedTitle === t('(Untitled)')) return { ok: true };
            const current = await deps.chatSessionService.getCurrentSessionInfo(cdp);
            if (current.title.trim() === savedTitle) return { ok: true };

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
    };
}
