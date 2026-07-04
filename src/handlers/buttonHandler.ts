/**
 * Platform-agnostic button interaction handler.
 *
 * Uses a registry pattern: each button type registers a match+execute pair.
 * The first matching action wins (order matters).
 */

import type { PlatformButtonInteraction } from '../platform/types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

export interface ButtonAction {
    /** Parse a customId and return extracted parameters, or null if not matching. */
    match: (customId: string) => Record<string, string> | null;
    /** Execute the action. */
    execute: (
        interaction: PlatformButtonInteraction,
        params: Record<string, string>,
    ) => Promise<void | boolean>;
}

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface ButtonHandlerDeps {
    /** Registered button action handlers. */
    actions: readonly ButtonAction[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a platform-agnostic button interaction handler.
 * Returns an async function that processes PlatformButtonInteraction events.
 */
export function createPlatformButtonHandler(deps: ButtonHandlerDeps) {
    return async (interaction: PlatformButtonInteraction): Promise<void> => {
        for (const action of deps.actions) {
            let params: Record<string, string> | null;
            try {
                params = action.match(interaction.customId);
            } catch (err: unknown) {
                const errorMessage =
                    err instanceof Error ? err.message : String(err);
                logger.error(
                    '[ButtonHandler] Match error:',
                    errorMessage,
                );
                await interaction
                    .reply({
                        text: 'An error occurred while processing the button action.',
                        ephemeral: true,
                    })
                    .catch(() => {});
                return;
            }
            if (params !== null) {
                try {
                    await action.execute(interaction, params);
                } catch (err: unknown) {
                    const errorMessage =
                        err instanceof Error ? err.message : String(err);
                    logger.error(
                        '[ButtonHandler] Action error:',
                        errorMessage,
                    );
                    await interaction
                        .reply({
                            text: 'An error occurred while processing the button action.',
                            ephemeral: true,
                        })
                        .catch(() => {});
                }
                return;
            }
        }

        logger.warn(
            `[ButtonHandler] No handler for customId: ${interaction.customId}`,
        );
    };
}
