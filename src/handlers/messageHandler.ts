/**
 * Platform-agnostic message handler.
 *
 * Extracts core message-handling logic from Discord-specific event handlers
 * into a platform-independent factory that works with any PlatformMessage.
 */

import type { PlatformMessage } from '../platform/types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface MessageHandlerDeps {
    /** Get workspace path for a channel. */
    getWorkspaceForChannel: (channelId: string) => string | undefined;
    /** Send prompt to Antigravity. */
    sendPrompt: (
        message: PlatformMessage,
        workspacePath: string,
        promptText: string,
    ) => Promise<void>;
    /** Handle a legacy text command (e.g. "autoaccept", "screenshot"). */
    handleTextCommand?: (
        message: PlatformMessage,
        commandName: string,
        args: readonly string[],
    ) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a platform-agnostic message handler.
 * Returns an async function that processes PlatformMessage events.
 */
export function createPlatformMessageHandler(deps: MessageHandlerDeps) {
    return async (message: PlatformMessage): Promise<void> => {
        // Skip bot messages
        if (message.author.isBot) return;

        const content = message.content.trim();
        if (!content && message.attachments.length === 0) return;

        // Check for text commands (prefixed with !)
        if (content.startsWith('!')) {
            const parts = content.slice(1).split(/\s+/);
            const commandName = parts[0]?.toLowerCase();
            const args = parts.slice(1);
            if (commandName && deps.handleTextCommand) {
                try {
                    const handled = await deps.handleTextCommand(
                        message,
                        commandName,
                        args,
                    );
                    if (handled) return;
                } catch (err: unknown) {
                    const errorMessage =
                        err instanceof Error ? err.message : String(err);
                    logger.error(
                        '[MessageHandler] Text command error:',
                        errorMessage,
                    );
                    await message
                        .reply({
                            text: 'An error occurred while processing the command.',
                        })
                        .catch(() => {});
                    return;
                }
            }
        }

        // Route to workspace
        const workspacePath = deps.getWorkspaceForChannel(message.channel.id);
        if (!workspacePath) {
            await message.reply({
                text: 'No project is configured for this channel. Use `/project` to bind one, or `/project reopen` if this is a previously used session.',
            });
            return;
        }

        const promptText =
            content ||
            'Please review the attached images and respond accordingly.';

        try {
            await deps.sendPrompt(message, workspacePath, promptText);
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            logger.error(
                '[MessageHandler] Failed to send prompt:',
                errorMessage,
            );
            await message
                .reply({ text: 'An error occurred while processing your message.' })
                .catch(() => {});
        }
    };
}
