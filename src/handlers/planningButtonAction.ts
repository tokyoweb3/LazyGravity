/**
 * Platform-agnostic planning button action.
 *
 * Handles Open / Proceed button presses for the planning mode dialog
 * from both Discord and Telegram using the ButtonAction interface.
 */

import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { parsePlanningCustomId } from '../services/cdpBridgeManager';
import { logger } from '../utils/logger';

export interface PlanningButtonActionDeps {
    readonly bridge: CdpBridge;
}

const MAX_PLAN_CONTENT = 4096;

export function createPlanningButtonAction(
    deps: PlanningButtonActionDeps,
): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parsePlanningCustomId(customId);
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

            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This planning action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = params.projectName || deps.bridge.lastActiveWorkspace;
            const detector = projectName
                ? deps.bridge.pool.getPlanningDetector(projectName)
                : undefined;

            if (!detector) {
                await interaction
                    .reply({ text: 'Planning detector not found.' })
                    .catch(() => {});
                return;
            }

            if (action === 'open') {
                await interaction.deferUpdate().catch(() => {});

                const clicked = await detector.clickOpenButton();
                if (!clicked) {
                    await interaction
                        .reply({ text: 'Open button not found.' })
                        .catch(() => {});
                    return;
                }

                // Wait for DOM to update after Open click
                await new Promise((resolve) => setTimeout(resolve, 500));

                // Extract plan content with retry
                let planContent: string | null = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    planContent = await detector.extractPlanContent();
                    if (planContent) break;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }

                await interaction
                    .update({
                        text: '📋 Plan opened',
                        components: [],
                    })
                    .catch((err) => {
                        logger.warn('[PlanningAction] update failed:', err);
                    });

                if (planContent) {
                    const truncated = planContent.length > MAX_PLAN_CONTENT
                        ? planContent.substring(0, MAX_PLAN_CONTENT - 15) + '\n\n(truncated)'
                        : planContent;
                    await interaction
                        .followUp({ text: truncated })
                        .catch((err) => {
                            logger.warn('[PlanningAction] followUp failed:', err);
                        });
                } else {
                    await interaction
                        .followUp({ text: 'Could not extract plan content from the editor.' })
                        .catch(() => {});
                }
            } else {
                // Proceed action
                const clicked = await detector.clickProceedButton();

                if (clicked) {
                    await interaction
                        .update({
                            text: '▶️ Proceed started',
                            components: [],
                        })
                        .catch((err) => {
                            logger.warn('[PlanningAction] update failed:', err);
                        });
                } else {
                    await interaction
                        .reply({ text: 'Proceed button not found.' })
                        .catch(() => {});
                }
            }
        },
    };
}
