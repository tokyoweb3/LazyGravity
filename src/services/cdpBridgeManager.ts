import { t } from '../utils/i18n';
import { logger } from '../utils/logger';
import type { PlatformChannel, PlatformSentMessage, MessagePayload } from '../platform/types';
import {
    buildApprovalNotification,
    buildAutoApprovedNotification,
    buildPlanningNotification,
    buildErrorPopupNotification,
    buildResolvedOverlay,
} from './notificationSender';
import { ApprovalDetector, ApprovalInfo } from './approvalDetector';
import { AutoAcceptService } from './autoAcceptService';
import { CdpConnectionPool } from './cdpConnectionPool';
import { CdpService } from './cdpService';
import { ErrorPopupDetector, ErrorPopupInfo } from './errorPopupDetector';
import { PlanningDetector, PlanningInfo } from './planningDetector';
import { QuotaService } from './quotaService';
import { UserMessageDetector, UserMessageInfo } from './userMessageDetector';

/** CDP connection state management */
export interface CdpBridge {
    pool: CdpConnectionPool;
    quota: QuotaService;
    autoAccept: AutoAcceptService;
    /** Directory name of the workspace that last sent a message */
    lastActiveWorkspace: string | null;
    /** Channel that last sent a message (destination for approval notifications) */
    lastActiveChannel: PlatformChannel | null;
    /** Workspace-level approval notification destination (workspace -> channel) */
    approvalChannelByWorkspace: Map<string, PlatformChannel>;
    /** Session-level approval notification destination (workspace+sessionTitle -> channel) */
    approvalChannelBySession: Map<string, PlatformChannel>;
    selectedAccountByChannel?: Map<string, string>;
    deepThinkCountByChannel?: Map<string, number>;
}

const APPROVE_ACTION_PREFIX = 'approve_action';
const ALWAYS_ALLOW_ACTION_PREFIX = 'always_allow_action';
const DENY_ACTION_PREFIX = 'deny_action';
const PLANNING_OPEN_ACTION_PREFIX = 'planning_open_action';
const PLANNING_PROCEED_ACTION_PREFIX = 'planning_proceed_action';
const ERROR_POPUP_DISMISS_ACTION_PREFIX = 'error_popup_dismiss_action';
const ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX = 'error_popup_copy_debug_action';
const ERROR_POPUP_RETRY_ACTION_PREFIX = 'error_popup_retry_action';

function normalizeSessionTitle(title: string): string {
    return title.trim().toLowerCase();
}

function buildSessionRouteKey(projectName: string, sessionTitle: string): string {
    return `${projectName}::${normalizeSessionTitle(sessionTitle)}`;
}

const GET_CURRENT_CHAT_TITLE_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel');
    if (!panel) return '';
    const header = panel.querySelector('div[class*="border-b"]');
    if (!header) return '';
    const titleEl = header.querySelector('div[class*="text-ellipsis"]');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title || title === 'Agent') return '';
    return title;
})()`;

export async function getCurrentChatTitle(cdp: CdpService): Promise<string | null> {
    const contexts = cdp.getContexts();
    for (const ctx of contexts) {
        try {
            const result = await cdp.call('Runtime.evaluate', {
                expression: GET_CURRENT_CHAT_TITLE_SCRIPT,
                returnByValue: true,
                contextId: ctx.id,
            });
            const value = result?.result?.value;
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim();
            }
        } catch {
            // Continue to next context
        }
    }
    return null;
}

export function registerApprovalWorkspaceChannel(
    bridge: CdpBridge,
    projectName: string,
    channel: PlatformChannel,
): void {
    bridge.approvalChannelByWorkspace.set(projectName, channel);
}

export function registerApprovalSessionChannel(
    bridge: CdpBridge,
    projectName: string,
    sessionTitle: string,
    channel: PlatformChannel,
): void {
    if (!sessionTitle || sessionTitle.trim().length === 0) return;
    bridge.approvalChannelBySession.set(buildSessionRouteKey(projectName, sessionTitle), channel);
    bridge.approvalChannelByWorkspace.set(projectName, channel);
}

export function resolveApprovalChannelForCurrentChat(
    bridge: CdpBridge,
    projectName: string,
    currentChatTitle: string | null,
): PlatformChannel | null {
    // Try session-level match first (most precise routing)
    if (currentChatTitle && currentChatTitle.trim().length > 0) {
        const key = buildSessionRouteKey(projectName, currentChatTitle);
        const sessionChannel = bridge.approvalChannelBySession.get(key);
        if (sessionChannel) return sessionChannel;
    }
    // Fall back to workspace-level routing
    return bridge.approvalChannelByWorkspace.get(projectName) ?? null;
}

export function buildApprovalCustomId(
    action: 'approve' | 'always_allow' | 'deny',
    projectName: string,
    channelId?: string,
): string {
    const prefix = action === 'approve'
        ? APPROVE_ACTION_PREFIX
        : action === 'always_allow'
            ? ALWAYS_ALLOW_ACTION_PREFIX
            : DENY_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${projectName}:${channelId}`;
    }
    return `${prefix}:${projectName}`;
}

export function parseApprovalCustomId(customId: string): { action: 'approve' | 'always_allow' | 'deny'; projectName: string | null; channelId: string | null } | null {
    if (customId === APPROVE_ACTION_PREFIX) {
        return { action: 'approve', projectName: null, channelId: null };
    }
    if (customId === ALWAYS_ALLOW_ACTION_PREFIX) {
        return { action: 'always_allow', projectName: null, channelId: null };
    }
    if (customId === DENY_ACTION_PREFIX) {
        return { action: 'deny', projectName: null, channelId: null };
    }
    if (customId.startsWith(`${APPROVE_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${APPROVE_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'approve', projectName: projectName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ALWAYS_ALLOW_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ALWAYS_ALLOW_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'always_allow', projectName: projectName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${DENY_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${DENY_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'deny', projectName: projectName || null, channelId: channelId || null };
    }
    return null;
}

export function buildPlanningCustomId(
    action: 'open' | 'proceed',
    projectName: string,
    channelId?: string,
): string {
    const prefix = action === 'open'
        ? PLANNING_OPEN_ACTION_PREFIX
        : PLANNING_PROCEED_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${projectName}:${channelId}`;
    }
    return `${prefix}:${projectName}`;
}

export function parsePlanningCustomId(customId: string): { action: 'open' | 'proceed'; projectName: string | null; channelId: string | null } | null {
    if (customId === PLANNING_OPEN_ACTION_PREFIX) {
        return { action: 'open', projectName: null, channelId: null };
    }
    if (customId === PLANNING_PROCEED_ACTION_PREFIX) {
        return { action: 'proceed', projectName: null, channelId: null };
    }
    if (customId.startsWith(`${PLANNING_OPEN_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${PLANNING_OPEN_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'open', projectName: projectName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${PLANNING_PROCEED_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${PLANNING_PROCEED_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'proceed', projectName: projectName || null, channelId: channelId || null };
    }
    return null;
}

export function buildErrorPopupCustomId(
    action: 'dismiss' | 'copy_debug' | 'retry',
    projectName: string,
    channelId?: string,
): string {
    const prefix = action === 'dismiss'
        ? ERROR_POPUP_DISMISS_ACTION_PREFIX
        : action === 'copy_debug'
            ? ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX
            : ERROR_POPUP_RETRY_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${projectName}:${channelId}`;
    }
    return `${prefix}:${projectName}`;
}

export function parseErrorPopupCustomId(customId: string): { action: 'dismiss' | 'copy_debug' | 'retry'; projectName: string | null; channelId: string | null } | null {
    if (customId === ERROR_POPUP_DISMISS_ACTION_PREFIX) {
        return { action: 'dismiss', projectName: null, channelId: null };
    }
    if (customId === ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX) {
        return { action: 'copy_debug', projectName: null, channelId: null };
    }
    if (customId === ERROR_POPUP_RETRY_ACTION_PREFIX) {
        return { action: 'retry', projectName: null, channelId: null };
    }
    if (customId.startsWith(`${ERROR_POPUP_DISMISS_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_DISMISS_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'dismiss', projectName: projectName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'copy_debug', projectName: projectName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ERROR_POPUP_RETRY_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_RETRY_ACTION_PREFIX}:`.length);
        const [projectName, channelId] = rest.split(':');
        return { action: 'retry', projectName: projectName || null, channelId: channelId || null };
    }
    return null;
}

/** Initialize the CDP bridge (lazy connection: pool creation only) */
export function initCdpBridge(
    autoApproveDefault: boolean,
    accountPorts: Record<string, number> = {},
): CdpBridge {
    const pool = new CdpConnectionPool({
        accountPorts,
        cdpCallTimeout: 15000,
        // Keep CDP reconnection lazy: do not reopen windows in background.
        // Reconnection is triggered when the next chat/template message is sent.
        maxReconnectAttempts: 0,
        reconnectDelayMs: 3000,
    });

    const quota = new QuotaService();
    const autoAccept = new AutoAcceptService(autoApproveDefault);

    return {
        pool,
        quota,
        autoAccept,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        selectedAccountByChannel: new Map(),
        deepThinkCountByChannel: new Map(),
    };
}

/**
 * Helper to get the currently active CdpService from lastActiveWorkspace.
 * Used in contexts where the workspace path is not explicitly provided,
 * such as button interactions and model/mode switching.
 */
export function getCurrentCdp(bridge: CdpBridge): CdpService | null {
    if (!bridge.lastActiveWorkspace) return null;
    return bridge.pool.getConnected(bridge.lastActiveWorkspace);
}

/**
 * Helper to start an approval detector for each workspace.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensureApprovalDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getApprovalDetector(projectName);
    if (existing && existing.isActive()) return;

    // Track the most recent notification for auto-disable on resolve.
    // Only the latest is tracked; if a new detection fires before the previous
    // is resolved, the older reference is overwritten. This is acceptable because
    // the detector's lastDetectedKey deduplication prevents rapid successive notifications.
    let lastNotification: { sent: PlatformSentMessage; payload: MessagePayload } | null = null;

    const detector = new ApprovalDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastNotification) return;
            const { sent, payload } = lastNotification;
            lastNotification = null;
            const resolved = buildResolvedOverlay(payload, t('Resolved in Antigravity'));
            sent.edit(resolved).catch(logger.error);
        },
        onApprovalRequired: async (info: ApprovalInfo) => {
            logger.debug(`[ApprovalDetector:${projectName}] Approval button detected (allow="${info.approveText}", deny="${info.denyText}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);
            const targetChannelId = targetChannel ? targetChannel.id : '';

            if (!targetChannel || !targetChannelId) {
                logger.warn(
                    `[ApprovalDetector:${projectName}] Skipped approval notification because chat is not linked to a session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            if (bridge.autoAccept.isEnabled()) {
                const accepted = await detector.alwaysAllowButton() || await detector.approveButton();

                const autoPayload = buildAutoApprovedNotification({
                    accepted,
                    projectName,
                    description: info.description ?? undefined,
                    approveText: info.approveText ?? undefined,
                });
                await targetChannel.send(autoPayload).catch(logger.error);

                if (accepted) {
                    return;
                }
            }

            const payload = buildApprovalNotification({
                title: t('Approval Required'),
                description: info.description || t('Antigravity is requesting approval for an action'),
                projectName,
                channelId: targetChannelId,
                extraFields: [
                    { name: t('Allow button'), value: info.approveText, inline: true },
                    { name: t('Allow Chat button'), value: info.alwaysAllowText || t('In Dropdown'), inline: true },
                    { name: t('Deny button'), value: info.denyText || t('(None)'), inline: true },
                ],
            });

            const sent = await targetChannel.send(payload).catch((err: any) => {
                logger.error(err);
                return null;
            });
            if (sent) {
                lastNotification = { sent, payload };
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(projectName, detector);
    logger.debug(`[ApprovalDetector:${projectName}] Started approval button detection`);
}

/**
 * Helper to start a planning detector for each workspace.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensurePlanningDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getPlanningDetector(projectName);
    if (existing && existing.isActive()) return;

    // Track the most recent planning notification for auto-disable on resolve.
    // See ensureApprovalDetector comment for tracking limitation rationale.
    let lastNotification: { sent: PlatformSentMessage; payload: MessagePayload } | null = null;

    const detector = new PlanningDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastNotification) return;
            const { sent, payload } = lastNotification;
            lastNotification = null;
            const resolved = buildResolvedOverlay(payload, t('Resolved in Antigravity'));
            sent.edit(resolved).catch(logger.error);
        },
        onPlanningRequired: async (info: PlanningInfo) => {
            logger.debug(`[PlanningDetector:${projectName}] Planning buttons detected (title="${info.planTitle}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);
            const targetChannelId = targetChannel ? targetChannel.id : '';

            if (!targetChannel || !targetChannelId) {
                logger.warn(
                    `[PlanningDetector:${projectName}] Skipped planning notification because chat is not linked to a session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            const descriptionText = info.description || info.planSummary || t('A plan has been generated and is awaiting your review.');

            const extraFields: { name: string; value: string; inline?: boolean }[] = [
                { name: t('Plan'), value: info.planTitle || t('Implementation Plan'), inline: true },
                { name: t('Workspace'), value: projectName, inline: true },
            ];
            if (info.planSummary && info.description) {
                extraFields.push({ name: t('Summary'), value: info.planSummary.substring(0, 1024), inline: false });
            }

            const payload = buildPlanningNotification({
                title: t('Planning Mode'),
                description: descriptionText,
                projectName,
                channelId: targetChannelId,
                extraFields,
            });

            const sent = await targetChannel.send(payload).catch((err: any) => {
                logger.error(err);
                return null;
            });
            if (sent) {
                lastNotification = { sent, payload };
            }
        },
    });

    detector.start();
    bridge.pool.registerPlanningDetector(projectName, detector);
    logger.debug(`[PlanningDetector:${projectName}] Started planning button detection`);
}

/**
 * Helper to start an error popup detector for each workspace.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensureErrorPopupDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getErrorPopupDetector(projectName);
    if (existing && existing.isActive()) return;

    // Track the most recent error notification for auto-disable on resolve.
    // See ensureApprovalDetector comment for tracking limitation rationale.
    let lastNotification: { sent: PlatformSentMessage; payload: MessagePayload } | null = null;

    const detector = new ErrorPopupDetector({
        cdpService: cdp,
        pollIntervalMs: 3000,
        onResolved: () => {
            if (!lastNotification) return;
            const { sent, payload } = lastNotification;
            lastNotification = null;
            const resolved = buildResolvedOverlay(payload, t('Resolved in Antigravity'));
            sent.edit(resolved).catch(logger.error);
        },
        onErrorPopup: async (info: ErrorPopupInfo) => {
            logger.debug(`[ErrorPopupDetector:${projectName}] Error popup detected (title="${info.title}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);
            const targetChannelId = targetChannel ? targetChannel.id : '';

            if (!targetChannel || !targetChannelId) {
                logger.warn(
                    `[ErrorPopupDetector:${projectName}] Skipped error popup notification because chat is not linked to a session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            const bodyText = info.body || t('An error occurred in the Antigravity agent.');

            const payload = buildErrorPopupNotification({
                title: info.title || t('Agent Error'),
                errorMessage: bodyText.substring(0, 4096),
                projectName,
                channelId: targetChannelId,
                extraFields: [
                    { name: t('Buttons'), value: info.buttons.join(', ') || t('(None)'), inline: true },
                    { name: t('Workspace'), value: projectName, inline: true },
                ],
            });

            const sent = await targetChannel.send(payload).catch((err: any) => {
                logger.error(err);
                return null;
            });
            if (sent) {
                lastNotification = { sent, payload };
            }
        },
    });

    detector.start();
    bridge.pool.registerErrorPopupDetector(projectName, detector);
    logger.debug(`[ErrorPopupDetector:${projectName}] Started error popup detection`);
}

/**
 * Helper to start a user message detector for a workspace.
 * Detects messages typed directly in the Antigravity UI (e.g., from a PC)
 * and mirrors them to a Discord channel.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensureUserMessageDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
    onUserMessage: (info: UserMessageInfo) => void,
): void {
    const existing = bridge.pool.getUserMessageDetector(projectName);
    if (existing && existing.isActive()) return;

    const detector = new UserMessageDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onUserMessage,
    });

    detector.start();
    bridge.pool.registerUserMessageDetector(projectName, detector);
    logger.debug(`[UserMessageDetector:${projectName}] Started user message detection`);
}
