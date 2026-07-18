/**
 * Discord adapter implementing the PlatformAdapter interface.
 *
 * Bridges discord.js Client events into platform-agnostic callbacks,
 * allowing the bot core to operate independently of Discord specifics.
 */

import { Client, Events } from 'discord.js';
import type { PlatformAdapter, PlatformAdapterEvents } from '../adapter';
import type { PlatformChannel } from '../types';
import {
    wrapDiscordMessage,
    wrapDiscordChannel,
    wrapDiscordButton,
    wrapDiscordSelect,
    wrapDiscordCommand,
} from './wrappers';

import type {
    TextChannel,
    Interaction,
    ButtonInteraction,
    StringSelectMenuInteraction,
    ChatInputCommandInteraction,
} from 'discord.js';

/**
 * Discord platform adapter implementation.
 */
export class DiscordAdapter implements PlatformAdapter {
    readonly platform = 'discord' as const;
    private readonly client: Client;
    private botUserId: string = '';

    /**
     * @param client Raw discord.js Client instance.
     */
    constructor(client: Client) {
        this.client = client;
    }

    /**
     * Start listening for Discord events and forward them
     * through the platform-agnostic event callbacks.
     */
    async start(events: PlatformAdapterEvents): Promise<void> {
        // Ready event: capture bot user ID and notify
        this.client.once(Events.ClientReady, (readyClient) => {
            this.botUserId = readyClient.user.id;
            events.onReady?.();
        });

        // Message create
        if (events.onMessage) {
            const onMessage = events.onMessage;
            this.client.on(Events.MessageCreate, async (message) => {
                try {
                    const wrapped = wrapDiscordMessage(message);
                    await onMessage(wrapped);
                } catch (error) {
                    events.onError?.(
                        error instanceof Error ? error : new Error(String(error)),
                    );
                }
            });
        }

        // Interaction create (buttons, selects, commands)
        if (events.onButtonInteraction || events.onSelectInteraction || events.onCommandInteraction) {
            this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
                try {
                    if (interaction.isButton() && events.onButtonInteraction) {
                        const wrapped = wrapDiscordButton(interaction as ButtonInteraction);
                        await events.onButtonInteraction(wrapped);
                    } else if (interaction.isStringSelectMenu() && events.onSelectInteraction) {
                        const wrapped = wrapDiscordSelect(interaction as StringSelectMenuInteraction);
                        await events.onSelectInteraction(wrapped);
                    } else if (interaction.isChatInputCommand() && events.onCommandInteraction) {
                        const wrapped = wrapDiscordCommand(interaction as ChatInputCommandInteraction);
                        await events.onCommandInteraction(wrapped);
                    }
                } catch (error) {
                    events.onError?.(
                        error instanceof Error ? error : new Error(String(error)),
                    );
                }
            });
        }

        // Client error forwarding
        this.client.on(Events.Error, (error) => {
            events.onError?.(error);
        });
    }

    /** Stop the adapter by destroying the discord.js Client. */
    async stop(): Promise<void> {
        this.client.destroy();
    }

    /**
     * Retrieve a channel by its Discord snowflake ID.
     * Returns null if the channel is not found, not fetchable, or not text-based.
     */
    async getChannel(channelId: string): Promise<PlatformChannel | null> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) return null;
            if (!channel.isTextBased()) return null;
            return wrapDiscordChannel(channel as TextChannel);
        } catch {
            return null;
        }
    }

    /** Return the bot's own user ID. Empty string before start() completes. */
    getBotUserId(): string {
        return this.botUserId;
    }

    /** Access the raw discord.js Client for platform-specific features. */
    getRawClient(): Client {
        return this.client;
    }
}
