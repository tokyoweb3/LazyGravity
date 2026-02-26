import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Message,
} from 'discord.js';

import { t } from '../utils/i18n';
import { logger } from '../utils/logger';
import { disableAllButtons } from '../utils/discordButtonUtils';
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
    lastActiveChannel: Message['channel'] | null;
    /** Workspace-level approval notification destination (workspace -> channel) */
    approvalChannelByWorkspace: Map<string, Message['channel']>;
    /** Session-level approval notification destination (workspace+sessionTitle -> channel) */
    approvalChannelBySession: Map<string, Message['channel']>;
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

function buildSessionRouteKey(workspaceDirName: string, sessionTitle: string): string {
    return `${workspaceDirName}::${normalizeSessionTitle(sessionTitle)}`;
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
    workspaceDirName: string,
    channel: Message['channel'],
): void {
    bridge.approvalChannelByWorkspace.set(workspaceDirName, channel);
}

export function registerApprovalSessionChannel(
    bridge: CdpBridge,
    workspaceDirName: string,
    sessionTitle: string,
    channel: Message['channel'],
): void {
    if (!sessionTitle || sessionTitle.trim().length === 0) return;
    bridge.approvalChannelBySession.set(buildSessionRouteKey(workspaceDirName, sessionTitle), channel);
    bridge.approvalChannelByWorkspace.set(workspaceDirName, channel);
}

export function resolveApprovalChannelForCurrentChat(
    bridge: CdpBridge,
    workspaceDirName: string,
    currentChatTitle: string | null,
): Message['channel'] | null {
    // Try session-level match first (most precise routing)
    if (currentChatTitle && currentChatTitle.trim().length > 0) {
        const key = buildSessionRouteKey(workspaceDirName, currentChatTitle);
        const sessionChannel = bridge.approvalChannelBySession.get(key);
        if (sessionChannel) return sessionChannel;
    }
    // Fall back to workspace-level routing
    return bridge.approvalChannelByWorkspace.get(workspaceDirName) ?? null;
}

export function buildApprovalCustomId(
    action: 'approve' | 'always_allow' | 'deny',
    workspaceDirName: string,
    channelId?: string,
): string {
    const prefix = action === 'approve'
        ? APPROVE_ACTION_PREFIX
        : action === 'always_allow'
            ? ALWAYS_ALLOW_ACTION_PREFIX
            : DENY_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${workspaceDirName}:${channelId}`;
    }
    return `${prefix}:${workspaceDirName}`;
}

export function parseApprovalCustomId(customId: string): { action: 'approve' | 'always_allow' | 'deny'; workspaceDirName: string | null; channelId: string | null } | null {
    if (customId === APPROVE_ACTION_PREFIX) {
        return { action: 'approve', workspaceDirName: null, channelId: null };
    }
    if (customId === ALWAYS_ALLOW_ACTION_PREFIX) {
        return { action: 'always_allow', workspaceDirName: null, channelId: null };
    }
    if (customId === DENY_ACTION_PREFIX) {
        return { action: 'deny', workspaceDirName: null, channelId: null };
    }
    if (customId.startsWith(`${APPROVE_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${APPROVE_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'approve', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ALWAYS_ALLOW_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ALWAYS_ALLOW_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'always_allow', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${DENY_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${DENY_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'deny', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    return null;
}

export function buildPlanningCustomId(
    action: 'open' | 'proceed',
    workspaceDirName: string,
    channelId?: string,
): string {
    const prefix = action === 'open'
        ? PLANNING_OPEN_ACTION_PREFIX
        : PLANNING_PROCEED_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${workspaceDirName}:${channelId}`;
    }
    return `${prefix}:${workspaceDirName}`;
}

export function parsePlanningCustomId(customId: string): { action: 'open' | 'proceed'; workspaceDirName: string | null; channelId: string | null } | null {
    if (customId === PLANNING_OPEN_ACTION_PREFIX) {
        return { action: 'open', workspaceDirName: null, channelId: null };
    }
    if (customId === PLANNING_PROCEED_ACTION_PREFIX) {
        return { action: 'proceed', workspaceDirName: null, channelId: null };
    }
    if (customId.startsWith(`${PLANNING_OPEN_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${PLANNING_OPEN_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'open', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${PLANNING_PROCEED_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${PLANNING_PROCEED_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'proceed', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    return null;
}

export function buildErrorPopupCustomId(
    action: 'dismiss' | 'copy_debug' | 'retry',
    workspaceDirName: string,
    channelId?: string,
): string {
    const prefix = action === 'dismiss'
        ? ERROR_POPUP_DISMISS_ACTION_PREFIX
        : action === 'copy_debug'
            ? ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX
            : ERROR_POPUP_RETRY_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${workspaceDirName}:${channelId}`;
    }
    return `${prefix}:${workspaceDirName}`;
}

export function parseErrorPopupCustomId(customId: string): { action: 'dismiss' | 'copy_debug' | 'retry'; workspaceDirName: string | null; channelId: string | null } | null {
    if (customId === ERROR_POPUP_DISMISS_ACTION_PREFIX) {
        return { action: 'dismiss', workspaceDirName: null, channelId: null };
    }
    if (customId === ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX) {
        return { action: 'copy_debug', workspaceDirName: null, channelId: null };
    }
    if (customId === ERROR_POPUP_RETRY_ACTION_PREFIX) {
        return { action: 'retry', workspaceDirName: null, channelId: null };
    }
    if (customId.startsWith(`${ERROR_POPUP_DISMISS_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_DISMISS_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'dismiss', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'copy_debug', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    if (customId.startsWith(`${ERROR_POPUP_RETRY_ACTION_PREFIX}:`)) {
        const rest = customId.substring(`${ERROR_POPUP_RETRY_ACTION_PREFIX}:`.length);
        const [workspaceDirName, channelId] = rest.split(':');
        return { action: 'retry', workspaceDirName: workspaceDirName || null, channelId: channelId || null };
    }
    return null;
}

/** Initialize the CDP bridge (lazy connection: pool creation only) */
export function initCdpBridge(autoApproveDefault: boolean): CdpBridge {
    const pool = new CdpConnectionPool({
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
    workspaceDirName: string,
    client: Client,
): void {
    const existing = bridge.pool.getApprovalDetector(workspaceDirName);
    if (existing && existing.isActive()) return;

    // Track the most recent button message for auto-disable on resolve.
    // Only the latest message is tracked; if a new detection fires before the previous
    // is resolved, the older message reference is overwritten. This is acceptable because
    // the detector's lastDetectedKey deduplication prevents rapid successive notifications.
    let lastButtonMessage: Message | null = null;

    const detector = new ApprovalDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastButtonMessage) return;
            const msg = lastButtonMessage;
            lastButtonMessage = null;
            const originalEmbed = msg.embeds[0];
            const updatedEmbed = originalEmbed
                ? EmbedBuilder.from(originalEmbed)
                : new EmbedBuilder().setTitle(t('Approval Required'));
            updatedEmbed
                .setColor(0x95A5A6)
                .addFields({ name: t('Status'), value: t('Resolved in Antigravity'), inline: false });
            msg.edit({
                embeds: [updatedEmbed],
                components: disableAllButtons(msg.components),
            }).catch(logger.error);
        },
        onApprovalRequired: async (info: ApprovalInfo) => {
            logger.debug(`[ApprovalDetector:${workspaceDirName}] Approval button detected (allow="${info.approveText}", deny="${info.denyText}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, workspaceDirName, currentChatTitle);
            const targetChannelId = targetChannel && 'id' in targetChannel ? String((targetChannel as any).id) : '';

            if (!targetChannel || !targetChannelId || !('send' in targetChannel)) {
                logger.warn(
                    `[ApprovalDetector:${workspaceDirName}] Skipped approval notification because chat is not linked to a Discord session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            if (bridge.autoAccept.isEnabled()) {
                const accepted = await detector.alwaysAllowButton() || await detector.approveButton();

                const autoEmbed = new EmbedBuilder()
                    .setTitle(accepted ? t('Auto-approved') : t('Auto-approve failed'))
                    .setDescription(accepted ? t('An action was automatically approved.') : t('Auto-approve attempted but failed. Manual approval required.'))
                    .setColor(accepted ? 0x2ECC71 : 0xF39C12)
                    .addFields(
                        { name: t('Auto-approve mode'), value: t('ON'), inline: true },
                        { name: t('Workspace'), value: workspaceDirName, inline: true },
                        { name: t('Result'), value: accepted ? t('Executed Always Allow/Allow') : t('Manual approval required'), inline: true },
                    );
                if (info.description) {
                    autoEmbed.addFields({ name: t('Action Detail'), value: info.description.substring(0, 1024), inline: false });
                }
                if (info.approveText) {
                    autoEmbed.addFields({ name: t('Approved via'), value: info.approveText, inline: true });
                }
                autoEmbed.setTimestamp();
                await (targetChannel as any).send({ embeds: [autoEmbed] }).catch(logger.error);

                if (accepted) {
                    return;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(t('Approval Required'))
                .setDescription(info.description || t('Antigravity is requesting approval for an action'))
                .setColor(0xFFA500)
                .addFields(
                    { name: t('Allow button'), value: info.approveText, inline: true },
                    { name: t('Allow Chat button'), value: info.alwaysAllowText || t('In Dropdown'), inline: true },
                    { name: t('Deny button'), value: info.denyText || t('(None)'), inline: true },
                    { name: t('Workspace'), value: workspaceDirName, inline: true },
                )
                .setTimestamp();

            const approveBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('approve', workspaceDirName, targetChannelId))
                .setLabel(t('Allow'))
                .setStyle(ButtonStyle.Success);

            const alwaysAllowBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('always_allow', workspaceDirName, targetChannelId))
                .setLabel(t('Allow Chat'))
                .setStyle(ButtonStyle.Primary);

            const denyBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('deny', workspaceDirName, targetChannelId))
                .setLabel(t('Deny'))
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, alwaysAllowBtn, denyBtn);

            const sent = await (targetChannel as any).send({
                embeds: [embed],
                components: [row],
            }).catch((err: any) => { logger.error(err); return null; });
            if (sent) {
                lastButtonMessage = sent;
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(workspaceDirName, detector);
    logger.debug(`[ApprovalDetector:${workspaceDirName}] Started approval button detection`);
}

/**
 * Helper to start a planning detector for each workspace.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensurePlanningDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    workspaceDirName: string,
    _client: Client, // Unused, kept for signature consistency with ensureApprovalDetector
): void {
    const existing = bridge.pool.getPlanningDetector(workspaceDirName);
    if (existing && existing.isActive()) return;

    // Track the most recent planning message for auto-disable on resolve.
    // See ensureApprovalDetector comment for tracking limitation rationale.
    let lastPlanningMessage: Message | null = null;

    const detector = new PlanningDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastPlanningMessage) return;
            const msg = lastPlanningMessage;
            lastPlanningMessage = null;
            const originalEmbed = msg.embeds[0];
            const updatedEmbed = originalEmbed
                ? EmbedBuilder.from(originalEmbed)
                : new EmbedBuilder().setTitle(t('Planning Mode'));
            updatedEmbed
                .setColor(0x95A5A6)
                .addFields({ name: t('Status'), value: t('Resolved in Antigravity'), inline: false });
            msg.edit({
                embeds: [updatedEmbed],
                components: disableAllButtons(msg.components),
            }).catch(logger.error);
        },
        onPlanningRequired: async (info: PlanningInfo) => {
            logger.debug(`[PlanningDetector:${workspaceDirName}] Planning buttons detected (title="${info.planTitle}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, workspaceDirName, currentChatTitle);
            const targetChannelId = targetChannel && 'id' in targetChannel ? String((targetChannel as any).id) : '';

            if (!targetChannel || !targetChannelId || !('send' in targetChannel)) {
                logger.warn(
                    `[PlanningDetector:${workspaceDirName}] Skipped planning notification because chat is not linked to a Discord session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            const descriptionText = info.description || info.planSummary || t('A plan has been generated and is awaiting your review.');

            const embed = new EmbedBuilder()
                .setTitle(t('Planning Mode'))
                .setDescription(descriptionText)
                .setColor(0x3498DB)
                .addFields(
                    { name: t('Plan'), value: info.planTitle || t('Implementation Plan'), inline: true },
                    { name: t('Workspace'), value: workspaceDirName, inline: true },
                )
                .setTimestamp();

            if (info.planSummary && info.description) {
                embed.addFields({ name: t('Summary'), value: info.planSummary.substring(0, 1024), inline: false });
            }

            const openBtn = new ButtonBuilder()
                .setCustomId(buildPlanningCustomId('open', workspaceDirName, targetChannelId))
                .setLabel(t('Open'))
                .setStyle(ButtonStyle.Secondary);

            const proceedBtn = new ButtonBuilder()
                .setCustomId(buildPlanningCustomId('proceed', workspaceDirName, targetChannelId))
                .setLabel(t('Proceed'))
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(openBtn, proceedBtn);

            const sent = await (targetChannel as any).send({
                embeds: [embed],
                components: [row],
            }).catch((err: any) => { logger.error(err); return null; });
            if (sent) {
                lastPlanningMessage = sent;
            }
        },
    });

    detector.start();
    bridge.pool.registerPlanningDetector(workspaceDirName, detector);
    logger.debug(`[PlanningDetector:${workspaceDirName}] Started planning button detection`);
}

/**
 * Helper to start an error popup detector for each workspace.
 * Does nothing if a detector for the same workspace is already running.
 */
export function ensureErrorPopupDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    workspaceDirName: string,
    _client: Client,
): void {
    const existing = bridge.pool.getErrorPopupDetector(workspaceDirName);
    if (existing && existing.isActive()) return;

    // Track the most recent error message for auto-disable on resolve.
    // See ensureApprovalDetector comment for tracking limitation rationale.
    let lastErrorMessage: Message | null = null;

    const detector = new ErrorPopupDetector({
        cdpService: cdp,
        pollIntervalMs: 3000,
        onResolved: () => {
            if (!lastErrorMessage) return;
            const msg = lastErrorMessage;
            lastErrorMessage = null;
            const originalEmbed = msg.embeds[0];
            const updatedEmbed = originalEmbed
                ? EmbedBuilder.from(originalEmbed)
                : new EmbedBuilder().setTitle(t('Agent Error'));
            updatedEmbed
                .setColor(0x95A5A6)
                .addFields({ name: t('Status'), value: t('Resolved in Antigravity'), inline: false });
            msg.edit({
                embeds: [updatedEmbed],
                components: disableAllButtons(msg.components),
            }).catch(logger.error);
        },
        onErrorPopup: async (info: ErrorPopupInfo) => {
            logger.debug(`[ErrorPopupDetector:${workspaceDirName}] Error popup detected (title="${info.title}")`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, workspaceDirName, currentChatTitle);
            const targetChannelId = targetChannel && 'id' in targetChannel ? String((targetChannel as any).id) : '';

            if (!targetChannel || !targetChannelId || !('send' in targetChannel)) {
                logger.warn(
                    `[ErrorPopupDetector:${workspaceDirName}] Skipped error popup notification because chat is not linked to a Discord session` +
                    `${currentChatTitle ? ` (title="${currentChatTitle}")` : ''}`,
                );
                return;
            }

            const bodyText = info.body || t('An error occurred in the Antigravity agent.');

            const embed = new EmbedBuilder()
                .setTitle(info.title || t('Agent Error'))
                .setDescription(bodyText.substring(0, 4096))
                .setColor(0xE74C3C)
                .addFields(
                    { name: t('Buttons'), value: info.buttons.join(', ') || t('(None)'), inline: true },
                    { name: t('Workspace'), value: workspaceDirName, inline: true },
                )
                .setTimestamp();

            const dismissBtn = new ButtonBuilder()
                .setCustomId(buildErrorPopupCustomId('dismiss', workspaceDirName, targetChannelId))
                .setLabel(t('Dismiss'))
                .setStyle(ButtonStyle.Secondary);

            const copyDebugBtn = new ButtonBuilder()
                .setCustomId(buildErrorPopupCustomId('copy_debug', workspaceDirName, targetChannelId))
                .setLabel(t('Copy debug info'))
                .setStyle(ButtonStyle.Primary);

            const retryBtn = new ButtonBuilder()
                .setCustomId(buildErrorPopupCustomId('retry', workspaceDirName, targetChannelId))
                .setLabel(t('Retry'))
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(dismissBtn, copyDebugBtn, retryBtn);

            const sent = await (targetChannel as any).send({
                embeds: [embed],
                components: [row],
            }).catch((err: any) => { logger.error(err); return null; });
            if (sent) {
                lastErrorMessage = sent;
            }
        },
    });

    detector.start();
    bridge.pool.registerErrorPopupDetector(workspaceDirName, detector);
    logger.debug(`[ErrorPopupDetector:${workspaceDirName}] Started error popup detection`);
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
    workspaceDirName: string,
    onUserMessage: (info: UserMessageInfo) => void,
): void {
    const existing = bridge.pool.getUserMessageDetector(workspaceDirName);
    if (existing && existing.isActive()) return;

    const detector = new UserMessageDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onUserMessage,
    });

    detector.start();
    bridge.pool.registerUserMessageDetector(workspaceDirName, detector);
    logger.debug(`[UserMessageDetector:${workspaceDirName}] Started user message detection`);
}
