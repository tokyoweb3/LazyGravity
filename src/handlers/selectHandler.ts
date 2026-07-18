/**
 * Platform-agnostic select menu interaction handler.
 *
 * Uses a registry pattern similar to buttonHandler: each select type
 * registers a match+execute pair.
 */

import type { PlatformSelectInteraction } from '../platform/types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

/**
 * Single select action definition logic interface.
 */
export interface SelectAction {
    /** Match a select menu customId. Return true if this handler should process it. */
    match: (customId: string) => boolean;
    /** Execute the action with selected values. */
    execute: (
        interaction: PlatformSelectInteraction,
        values: readonly string[],
    ) => Promise<void | boolean>;
}

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into select handler factory.
 */
export interface SelectHandlerDeps {
    /** Registered select menu action handlers. */
    actions: readonly SelectAction[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a platform-agnostic select menu handler.
 * Returns an async function that processes PlatformSelectInteraction events.
 * @param deps Injected dependencies.
 * @returns Handler function.
 */
export function createPlatformSelectHandler(deps: SelectHandlerDeps) {
    return async (interaction: PlatformSelectInteraction): Promise<void> => {
        for (const action of deps.actions) {
            try {
                if (!action.match(interaction.customId)) continue;

                await action.execute(interaction, interaction.values);
                return;
            } catch (err: unknown) {
                const errorMessage =
                    err instanceof Error ? err.message : String(err);
                logger.error(
                    '[SelectHandler] Action error:',
                    errorMessage,
                );
                await interaction
                    .reply({
                        text: 'An error occurred while processing the selection.',
                        ephemeral: true,
                    })
                    .catch(() => {});
                return;
            }
        }

        logger.warn(
            `[SelectHandler] No handler for customId: ${interaction.customId}`,
        );
    };
}
