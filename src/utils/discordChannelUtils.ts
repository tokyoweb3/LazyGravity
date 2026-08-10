import type { Message, MessageCreateOptions, MessagePayload } from 'discord.js';

/**
 * Interface representing any channel or target object that supports sending messages.
 */
export interface SendableChannel {
    /**
     * Send a message to the target channel.
     * @param options Text string, MessagePayload, or MessageCreateOptions payload.
     * @returns Created Message instance.
     */
    send(options: string | MessagePayload | MessageCreateOptions): Promise<Message>;
}

/**
 * Type guard verifying if a channel object supports sending messages.
 * @param channel Target channel object to inspect.
 * @returns True if channel contains a send method.
 */
export function isSendableChannel(channel: unknown): channel is SendableChannel {
    return (
        typeof channel === 'object' &&
        channel !== null &&
        'send' in channel &&
        typeof (channel as { send?: unknown }).send === 'function'
    );
}
