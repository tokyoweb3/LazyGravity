/**
 * Platform-agnostic ButtonAction for auto-accept toggle interactions.
 *
 * Handles:
 *   autoaccept_btn_on      — Enable auto-accept
 *   autoaccept_btn_off     — Disable auto-accept
 *   autoaccept_btn_refresh — Refresh the auto-accept UI
 */

import type { ButtonAction } from './buttonHandler';
import type { AutoAcceptService } from '../services/autoAcceptService';
import {
    AUTOACCEPT_BTN_ON,
    AUTOACCEPT_BTN_OFF,
    AUTOACCEPT_BTN_REFRESH,
    buildAutoAcceptPayload,
} from '../ui/autoAcceptUi';

/**
 * Dependencies injected into auto-accept button action creator.
 */
export interface AutoAcceptButtonActionDeps {
    /** AutoAcceptService managing current configuration state. */
    readonly autoAcceptService: AutoAcceptService;
}

/**
 * Factory creating ButtonAction for auto-accept config toggling button clicks.
 * @param deps Injected dependencies.
 * @returns ButtonAction implementation.
 */
export function createAutoAcceptButtonAction(deps: AutoAcceptButtonActionDeps): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            if (customId === AUTOACCEPT_BTN_ON) return { action: 'on' };
            if (customId === AUTOACCEPT_BTN_OFF) return { action: 'off' };
            if (customId === AUTOACCEPT_BTN_REFRESH) return { action: 'refresh' };
            return null;
        },

        async execute(interaction, params): Promise<void> {
            await interaction.deferUpdate();

            if (params.action === 'on' || params.action === 'off') {
                const result = deps.autoAcceptService.handle(params.action);

                // Only update UI if the state actually changed to avoid
                // Telegram "message is not modified" error.
                if (result.changed) {
                    const payload = buildAutoAcceptPayload(deps.autoAcceptService.isEnabled());
                    await interaction.update(payload);
                }

                await interaction.followUp({ text: result.message }).catch(() => {});
            } else {
                // refresh — always update to show latest state
                const payload = buildAutoAcceptPayload(deps.autoAcceptService.isEnabled());
                await interaction.update(payload);
            }
        },
    };
}
