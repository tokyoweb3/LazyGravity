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
import { resolveProjectName } from '../utils/projectResolver';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';

export interface PlanningButtonActionDeps {
    readonly bridge: CdpBridge;
    readonly wsHandler: WorkspaceCommandHandler;
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

            // Acknowledge immediately so Telegram doesn't time out
            await interaction.deferUpdate().catch(() => {});

            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This planning action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, params.projectName);
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

                let clicked = false;
                const info = detector.getLastDetectedInfo();
                if (info?.hasOpenButton) {
                    const isReview = info.openText?.toLowerCase().includes('review');
                    if (!isReview) {
                        try {
                            clicked = await detector.clickOpenButton();
                            if (clicked) {
                                await new Promise((resolve) => setTimeout(resolve, 500));
                            }
                        } catch (e: any) {
                            logger.error('[PlanningAction] clickOpenButton failed:', e);
                        }
                    }
                }

                // Extract plan content with retry
                let planContent: string | null = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    planContent = await detector.extractPlanContent();
                    if (planContent) break;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }

                if (!planContent && !clicked) {
                    await interaction
                        .reply({ text: 'Plan content could not be extracted from the IDE.' })
                        .catch(() => {});
                    return;
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
                    let truncated = planContent.length > MAX_PLAN_CONTENT
                        ? planContent.substring(0, MAX_PLAN_CONTENT - 15) + '\n\n(truncated)'
                        : planContent;

                    if (info?.openText?.toLowerCase().includes('review')) {
                        truncated += '\n\n💡 *To request changes to this plan, simply reply in this channel.*';
                    }

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
            } else if (action === 'reject') {
                // Reject action
                await interaction.reply({ text: 'Rejection of the plan is not allowed.' }).catch(() => {});
                return;
            } else {
                // Proceed action
                await interaction.deferUpdate().catch(() => {});

                let clicked = false;
                try {
                    clicked = await detector.clickProceedButton();
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error(`[PlanningAction] CDP click failed: ${msg}`);
                    await interaction.reply({ text: `Proceed failed: ${msg}` }).catch(() => {});
                    return;
                }

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
