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
}

const APPROVE_ACTION_PREFIX = 'approve_action';
const ALWAYS_ALLOW_ACTION_PREFIX = 'always_allow_action';
const DENY_ACTION_PREFIX = 'deny_action';

export function buildApprovalCustomId(action: 'approve' | 'always_allow' | 'deny', workspaceDirName: string): string {
    const prefix = action === 'approve'
        ? APPROVE_ACTION_PREFIX
        : action === 'always_allow'
            ? ALWAYS_ALLOW_ACTION_PREFIX
            : DENY_ACTION_PREFIX;
    return `${prefix}:${workspaceDirName}`;
}

export function parseApprovalCustomId(customId: string): { action: 'approve' | 'always_allow' | 'deny'; workspaceDirName: string | null } | null {
    if (customId === APPROVE_ACTION_PREFIX) {
        return { action: 'approve', workspaceDirName: null };
    }
    if (customId === ALWAYS_ALLOW_ACTION_PREFIX) {
        return { action: 'always_allow', workspaceDirName: null };
    }
    if (customId === DENY_ACTION_PREFIX) {
        return { action: 'deny', workspaceDirName: null };
    }
    if (customId.startsWith(`${APPROVE_ACTION_PREFIX}:`)) {
        return { action: 'approve', workspaceDirName: customId.substring(`${APPROVE_ACTION_PREFIX}:`.length) || null };
    }
    if (customId.startsWith(`${ALWAYS_ALLOW_ACTION_PREFIX}:`)) {
        return { action: 'always_allow', workspaceDirName: customId.substring(`${ALWAYS_ALLOW_ACTION_PREFIX}:`.length) || null };
    }
    if (customId.startsWith(`${DENY_ACTION_PREFIX}:`)) {
        return { action: 'deny', workspaceDirName: customId.substring(`${DENY_ACTION_PREFIX}:`.length) || null };
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

            if (bridge.autoAccept.isEnabled()) {
                const accepted = await detector.alwaysAllowButton() || await detector.approveButton();

                const targetChannel = bridge.lastActiveChannel;
                if (targetChannel && 'send' in targetChannel) {
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
                }

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
                .setCustomId(buildApprovalCustomId('approve', workspaceDirName))
                .setLabel(t('Allow'))
                .setStyle(ButtonStyle.Success);

            const alwaysAllowBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('always_allow', workspaceDirName))
                .setLabel(t('Allow Chat'))
                .setStyle(ButtonStyle.Primary);

            const denyBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('deny', workspaceDirName))
                .setLabel(t('Deny'))
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, alwaysAllowBtn, denyBtn);

            const targetChannel = bridge.lastActiveChannel;
            if (targetChannel && 'send' in targetChannel) {
                (targetChannel as any).send({
                    embeds: [embed],
                    components: [row],
                }).catch(logger.error);
            } else {
                logger.warn(`[ApprovalDetector:${workspaceDirName}] Skipped approval notification because target channel is not determined`);
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(workspaceDirName, detector);
    logger.info(`[ApprovalDetector:${workspaceDirName}] Started approval button detection`);
}
