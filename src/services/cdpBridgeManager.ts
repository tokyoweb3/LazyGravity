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
import { ApprovalDetector, ApprovalInfo } from './approvalDetector';
import { AutoAcceptService } from './autoAcceptService';
import { CdpConnectionPool } from './cdpConnectionPool';
import { CdpService } from './cdpService';
import { QuotaService } from './quotaService';

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

async function getCurrentChatTitle(cdp: CdpService): Promise<string | null> {
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
    if (!currentChatTitle || currentChatTitle.trim().length === 0) {
        return null;
    }
    const key = buildSessionRouteKey(workspaceDirName, currentChatTitle);
    return bridge.approvalChannelBySession.get(key) ?? null;
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

/** Initialize the CDP bridge (lazy connection: pool creation only) */
export function initCdpBridge(autoApproveDefault: boolean): CdpBridge {
    const pool = new CdpConnectionPool({
        cdpCallTimeout: 15000,
        maxReconnectAttempts: 5,
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

    const detector = new ApprovalDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onApprovalRequired: async (info: ApprovalInfo) => {
            logger.info(`[ApprovalDetector:${workspaceDirName}] Approval button detected (allow="${info.approveText}", deny="${info.denyText}")`);

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
                    .setDescription(info.description || t('Antigravity is requesting approval for an action'))
                    .setColor(accepted ? 0x2ECC71 : 0xF39C12)
                    .addFields(
                        { name: t('Auto-approve mode'), value: t('ON'), inline: true },
                        { name: t('Workspace'), value: workspaceDirName, inline: true },
                        { name: t('Result'), value: accepted ? t('Executed Always Allow/Allow') : t('Manual approval required'), inline: true },
                    )
                    .setTimestamp();
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

            (targetChannel as any).send({
                embeds: [embed],
                components: [row],
            }).catch(logger.error);
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(workspaceDirName, detector);
    logger.info(`[ApprovalDetector:${workspaceDirName}] Started approval button detection`);
}
