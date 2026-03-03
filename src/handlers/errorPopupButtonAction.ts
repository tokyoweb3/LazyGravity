/**
 * Platform-agnostic error popup button action.
 *
 * Handles Dismiss / Copy Debug / Retry button presses for the error
 * popup dialog from both Discord and Telegram using the ButtonAction interface.
 */

import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { parseErrorPopupCustomId } from '../services/cdpBridgeManager';
import { logger } from '../utils/logger';

export interface ErrorPopupButtonActionDeps {
    readonly bridge: CdpBridge;
}

const MAX_DEBUG_CONTENT = 4096;

export function createErrorPopupButtonAction(
    deps: ErrorPopupButtonActionDeps,
): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseErrorPopupCustomId(customId);
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
                    .reply({ text: 'This error popup action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = params.projectName || deps.bridge.lastActiveWorkspace;
            const detector = projectName
                ? deps.bridge.pool.getErrorPopupDetector(projectName)
                : undefined;

            if (!detector) {
                await interaction
                    .reply({ text: 'Error popup detector not found.' })
                    .catch(() => {});
                return;
            }

            if (action === 'dismiss') {
                const clicked = await detector.clickDismissButton();
                if (clicked) {
                    await interaction
                        .update({
                            text: '🗑️ Dismissed',
                            components: [],
                        })
                        .catch((err) => {
                            logger.warn('[ErrorPopupAction] update failed:', err);
                        });
                } else {
                    await interaction
                        .reply({ text: 'Dismiss button not found.' })
                        .catch(() => {});
                }
            } else if (action === 'copy_debug') {
                await interaction.deferUpdate().catch(() => {});

                const clicked = await detector.clickCopyDebugInfoButton();
                if (!clicked) {
                    await interaction
                        .reply({ text: 'Copy debug info button not found.' })
                        .catch(() => {});
                    return;
                }

                // Wait for clipboard to be populated
                await new Promise((resolve) => setTimeout(resolve, 300));

                const clipboardContent = await detector.readClipboard();

                await interaction
                    .update({
                        text: '📋 Debug info copied',
                        components: [],
                    })
                    .catch((err) => {
                        logger.warn('[ErrorPopupAction] update failed:', err);
                    });

                if (clipboardContent) {
                    const truncated = clipboardContent.length > MAX_DEBUG_CONTENT
                        ? clipboardContent.substring(0, MAX_DEBUG_CONTENT - 15) + '\n\n(truncated)'
                        : clipboardContent;
                    await interaction
                        .followUp({ text: truncated })
                        .catch((err) => {
                            logger.warn('[ErrorPopupAction] followUp failed:', err);
                        });
                } else {
                    await interaction
                        .followUp({ text: 'Could not read debug info from clipboard.' })
                        .catch(() => {});
                }
            } else {
                // Retry action
                const clicked = await detector.clickRetryButton();
                if (clicked) {
                    await interaction
                        .update({
                            text: '🔄 Retry initiated',
                            components: [],
                        })
                        .catch((err) => {
                            logger.warn('[ErrorPopupAction] update failed:', err);
                        });
                } else {
                    await interaction
                        .reply({ text: 'Retry button not found.' })
                        .catch(() => {});
                }
            }
        },
    };
}
