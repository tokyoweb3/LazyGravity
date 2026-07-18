/**
 * Platform-agnostic slash command handler.
 *
 * Maintains a lookup map from command name to CommandDef for O(1) dispatch.
 */

import type { PlatformCommandInteraction } from '../platform/types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

/**
 * Interface definition for slash commands.
 */
export interface CommandDef {
    /** Command name (e.g. "mode", "project", "model"). */
    readonly name: string;
    /**
     * Executes the command logic.
     * @param interaction Trigger command interaction.
     */
    execute: (interaction: PlatformCommandInteraction) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into command handler factory.
 */
export interface CommandHandlerDeps {
    /** Registered command definitions. */
    commands: readonly CommandDef[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a platform-agnostic slash command handler.
 * Returns an async function that processes PlatformCommandInteraction events.
 * @param deps Injected dependencies.
 * @returns Command handler dispatch function.
 */
export function createPlatformCommandHandler(deps: CommandHandlerDeps) {
    const commandMap = new Map<string, CommandDef>();
    for (const cmd of deps.commands) {
        commandMap.set(cmd.name, cmd);
    }

    return async (interaction: PlatformCommandInteraction): Promise<void> => {
        const cmd = commandMap.get(interaction.commandName);
        if (!cmd) {
            logger.warn(
                `[CommandHandler] Unknown command: ${interaction.commandName}`,
            );
            await interaction.editReply({
                text: `Unknown command: ${interaction.commandName}`,
            }).catch(() => {});
            return;
        }

        try {
            await cmd.execute(interaction);
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            logger.error(
                `[CommandHandler] Command "${interaction.commandName}" error:`,
                errorMessage,
            );
            await interaction
                .editReply({
                    text: 'An error occurred while processing the command.',
                })
                .catch(() => {});
        }
    };
}
