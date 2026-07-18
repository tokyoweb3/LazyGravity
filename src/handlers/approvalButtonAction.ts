/**
 * Platform-agnostic approval button action.
 *
 * Handles Allow / Always Allow / Deny button presses from both Discord
 * and Telegram using the ButtonAction interface.
 */

import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { parseApprovalCustomId } from '../services/cdpBridgeManager';
import { resolveProjectName } from '../utils/projectResolver';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';

/**
 * Dependencies injected into approval button action creator.
 */
export interface ApprovalButtonActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Workspace command handler instance. */
    readonly wsHandler: WorkspaceCommandHandler;
}

/**
 * Factory creating ButtonAction for handling platform approvals.
 * @param deps Injected dependencies.
 * @returns ButtonAction implementation.
 */
export function createApprovalButtonAction(
    deps: ApprovalButtonActionDeps,
): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseApprovalCustomId(customId);
            if (!parsed) return null;
            return {
                action: parsed.action,
                projectName: parsed.projectName ?? '',
                channelId: parsed.channelId ?? '',
            };
        },

        async execute(
            interaction: PlatformButtonInteraction,
            params: Record<string, string>,
        ): Promise<void> {
            const { action, channelId } = params;

            // Acknowledge immediately so Telegram doesn't time out
            await interaction.deferUpdate().catch(() => {});

            // Channel scope check (skip if no channelId was encoded)
            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This approval action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, params.projectName);
            logger.debug(`[ApprovalAction] action=${action} project=${projectName ?? 'null'} channel=${interaction.channel.id}`);

            const detector = projectName
                ? deps.bridge.pool.getApprovalDetector(projectName)
                : undefined;

            if (!detector) {
                logger.warn(`[ApprovalAction] No detector for project=${projectName}`);
                await interaction
                    .reply({ text: 'Approval detector not found.' })
                    .catch(() => {});
                return;
            }

            const lastInfo = detector.getLastDetectedInfo();
            logger.debug(`[ApprovalAction] lastDetectedInfo: ${lastInfo ? JSON.stringify(lastInfo) : 'null'}`);

            let success = false;
            let actionLabel = '';
            try {
                if (action === 'approve') {
                    success = await detector.approveButton();
                    actionLabel = 'Allow';
                } else if (action === 'always_allow') {
                    success = await detector.alwaysAllowButton();
                    actionLabel = 'Allow Chat';
                } else {
                    success = await detector.denyButton();
                    actionLabel = 'Deny';
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`[ApprovalAction] CDP click failed: ${msg}`);
                await interaction
                    .reply({ text: `Approval failed: ${msg}` })
                    .catch(() => {});
                return;
            }

            logger.debug(`[ApprovalAction] ${actionLabel} result: ${success}`);

            if (success) {
                // Remove buttons by editing the original message.
                // If update() fails, fall back to editReply(), then followUp().
                const updatePayload = { text: `✅ ${actionLabel} completed`, components: [] as any[] };
                try {
                    await interaction.update(updatePayload);
                } catch (updateErr) {
                    logger.warn('[ApprovalAction] update failed, trying editReply:', updateErr);
                    try {
                        await interaction.editReply(updatePayload);
                    } catch (editErr) {
                        logger.warn('[ApprovalAction] editReply failed, sending followUp:', editErr);
                        await interaction.followUp({ text: `✅ ${actionLabel} completed` }).catch(() => {});
                    }
                }
            } else {
                await interaction
                    .reply({ text: 'Approval button not found.' })
                    .catch(() => {});
            }
        },
    };
}
