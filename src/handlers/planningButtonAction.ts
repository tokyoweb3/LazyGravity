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
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { getAntigravityCliPath } from '../utils/pathUtils';

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

            if (channelId && channelId !== interaction.channel.id) {
                await interaction.deferUpdate().catch(() => {});
                await interaction
                    .followUp({ text: 'This planning action is linked to a different session channel.', ephemeral: true })
                    .catch(() => {});
                return;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, params.projectName);
            const detector = projectName
                ? deps.bridge.pool.getPlanningDetector(projectName)
                : undefined;

            if (!detector) {
                await interaction.deferUpdate().catch(() => {});
                await interaction
                    .followUp({ text: 'Planning detector not found.', ephemeral: true })
                    .catch(() => {});
                return;
            }

            if (action === 'open') {
                const info = detector.getLastDetectedInfo();
                const isReview = info?.openText?.toLowerCase().includes('review');

                if (isReview && 'showModal' in interaction) {
                    try {
                        await interaction.showModal({
                            title: 'Submit Comment',
                            customId: `plan_comment_${projectName || ''}_${channelId}`,
                            components: [{
                                components: [{
                                    type: 'textInput',
                                    customId: 'comment',
                                    label: 'Add a message...',
                                    style: 'paragraph',
                                    required: false
                                }]
                            }]
                        });
                    } catch (err) {
                        logger.error('[PlanningAction] showModal failed:', err);
                    }
                    return;
                }

                // Acknowledge if we didn't show a modal
                await interaction.deferUpdate().catch(() => {});

                let clicked = false;
                if (info?.hasOpenButton && !isReview) {
                    try {
                        clicked = await detector.clickOpenButton();
                        if (clicked) {
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        }
                    } catch (e: any) {
                        logger.error('[PlanningAction] clickOpenButton failed:', e);
                    }
                }

                // Since we only come here if it's NOT a review (or modal failed),
                // we can just extract plan content and followUp
                let planContent: string | null = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    planContent = await detector.extractPlanContent();
                    if (planContent) break;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }

                if (!planContent && !clicked) {
                    // Fallback to reading implementation_plan.md from the workspace
                    const workspaceId = deps.wsHandler.getWorkspaceForChannel(interaction.channel.id);
                    if (workspaceId) {
                        const planFile = path.join(workspaceId, 'implementation_plan.md');
                        if (fs.existsSync(planFile)) {
                            try {
                                planContent = fs.readFileSync(planFile, 'utf8');
                                // Proactively open the file in the IDE
                                execFile(getAntigravityCliPath(), [planFile], (err) => {
                                    if (err) logger.error(`[PlanningAction] Failed to open plan via CLI: ${err.message}`);
                                });
                            } catch (err: any) {
                                logger.error(`[PlanningAction] Failed to read plan file: ${err.message}`);
                            }
                        }
                    }
                }

                if (!planContent && !clicked) {
                    await interaction
                        .followUp({ text: 'Plan content could not be extracted from the IDE or workspace.' })
                        .catch(() => {});
                    return;
                }

                await interaction
                    .editReply({
                        text: '📋 Plan opened',
                        components: [],
                    })
                    .catch((err) => {
                        logger.warn('[PlanningAction] editReply failed:', err);
                    });

                if (planContent) {
                    let truncated = planContent.length > MAX_PLAN_CONTENT
                        ? planContent.substring(0, MAX_PLAN_CONTENT - 15) + '\n\n(truncated)'
                        : planContent;

                    await interaction
                        .followUp({ text: truncated })
                        .catch((err) => {
                            logger.warn('[PlanningAction] followUp failed:', err);
                        });
                } else {
                    await interaction
                        .followUp({ text: 'Plan opened in IDE, but content could not be extracted.' })
                        .catch((err) => {
                            logger.warn('[PlanningAction] followUp failed:', err);
                        });
                }
            } else if (action === 'reject') {
                await interaction.deferUpdate().catch(() => {});
                // Reject action
                await interaction.followUp({ text: 'Rejection of the plan is not allowed.', ephemeral: true }).catch(() => {});
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
                        .editReply({
                            text: '▶️ Proceed started.\n\n⏳ IDE is working on the response...',
                            components: [],
                        })
                        .catch((err) => {
                            logger.warn('[PlanningAction] editReply failed:', err);
                        });
                } else {
                    await interaction
                        .followUp({ text: 'Proceed button not found.', ephemeral: true })
                        .catch(() => {});
                }
            }
        },
    };
}
