/**
 * Platform-agnostic SelectAction for mode_select interactions.
 *
 * When a user selects a mode from the inline dropdown, this action:
 *   1. Updates the ModeService
 *   2. Syncs the mode change to Antigravity via CDP
 *   3. Refreshes the mode selection UI
 */

import type { PlatformSelectInteraction } from '../platform/types';
import type { SelectAction } from './selectHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import type { ModeService } from '../services/modeService';
import { MODE_DISPLAY_NAMES } from '../services/modeService';
import { buildModePayload } from '../ui/modeUi';
import { logger } from '../utils/logger';

/**
 * Dependencies injected into mode selection select action creator.
 */
export interface ModeSelectActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Mode configuration state manager. */
    readonly modeService: ModeService;
}

/**
 * Factory creating SelectAction for mode selection menu updates.
 * @param deps Injected dependencies.
 * @returns SelectAction implementation.
 */
export function createModeSelectAction(deps: ModeSelectActionDeps): SelectAction {
    return {
        match(customId: string): boolean {
            return customId === 'mode_select';
        },

        async execute(
            interaction: PlatformSelectInteraction,
            values: readonly string[],
        ): Promise<void> {
            const selectedMode = values[0];
            if (!selectedMode) return;

            // Validate mode name before any side effects
            const normalized = selectedMode.trim().toLowerCase();
            if (!['fast', 'plan'].includes(normalized)) {
                await interaction.followUp({ text: `Invalid mode: ${selectedMode}` }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();

            // CDP-first: try to sync to Antigravity immediately
            const cdp = getCurrentCdp(deps.bridge);
            const displayName = MODE_DISPLAY_NAMES[selectedMode] || selectedMode;

            if (cdp) {
                const res = await cdp.setUiMode(selectedMode);
                if (!res.ok) {
                    logger.warn(`[ModeSelect] UI mode switch failed: ${res.error}`);
                    await interaction.followUp({
                        text: `Failed to switch mode in Antigravity: ${res.error}`,
                    }).catch(() => {});
                    return;
                }
                // CDP sync succeeded — update local cache as synced
                deps.modeService.setMode(selectedMode, true);

                const payload = buildModePayload(deps.modeService.getCurrentMode());
                await interaction.update(payload);
                await interaction.followUp({
                    text: `Mode changed to ${displayName}.`,
                }).catch(() => {});
            } else {
                // No CDP — set locally as pending
                deps.modeService.setMode(selectedMode, false);

                const payload = buildModePayload(deps.modeService.getCurrentMode(), true);
                await interaction.update(payload);
                await interaction.followUp({
                    text: `Mode set to ${displayName}. Will sync when connected to Antigravity.`,
                }).catch(() => {});
            }
        },
    };
}
