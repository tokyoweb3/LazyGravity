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
import { logger } from '../utils/logger';

export interface ApprovalButtonActionDeps {
    readonly bridge: CdpBridge;
}

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

            // Channel scope check (skip if no channelId was encoded)
            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This approval action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = params.projectName || deps.bridge.lastActiveWorkspace;
            const detector = projectName
                ? deps.bridge.pool.getApprovalDetector(projectName)
                : undefined;

            if (!detector) {
                await interaction
                    .reply({ text: 'Approval detector not found.' })
                    .catch(() => {});
                return;
            }

            let success = false;
            let actionLabel = '';
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

            if (success) {
                await interaction
                    .update({
                        text: `✅ ${actionLabel} completed`,
                        components: [],
                    })
                    .catch((err) => {
                        logger.warn('[ApprovalAction] update failed:', err);
                    });
            } else {
                await interaction
                    .reply({ text: 'Approval button not found.' })
                    .catch(() => {});
            }
        },
    };
}
