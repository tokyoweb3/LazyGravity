/**
 * Telegram platform adapter.
 *
 * Implements the PlatformAdapter interface using a TelegramBotLike instance.
 * This adapter translates Telegram events to the platform-agnostic event model
 * so the bot core can operate without platform-specific knowledge.
 */

import type { PlatformAdapter, PlatformAdapterEvents } from '../adapter';
import type { PlatformChannel } from '../types';
import type {
    TelegramBotLike,
    TelegramMessageLike,
    TelegramCallbackQueryLike,
} from './wrappers';
import {
    SELECT_CALLBACK_SEP,
    wrapTelegramChannel,
    wrapTelegramMessage,
    wrapTelegramCallbackQuery,
} from './wrappers';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// TelegramAdapter
// ---------------------------------------------------------------------------

export class TelegramAdapter implements PlatformAdapter {
    readonly platform = 'telegram' as const;

    private readonly bot: TelegramBotLike;
    private readonly botUserId: string;
    private events: PlatformAdapterEvents | null = null;
    private started = false;
    private handlersRegistered = false;

    constructor(bot: TelegramBotLike, botUserId: string) {
        this.bot = bot;
        this.botUserId = botUserId;
    }

    /**
     * Start the adapter.
     *
     * Registers Telegram event handlers that translate incoming events to the
     * platform-agnostic event callbacks, then starts the bot polling loop.
     */
    async start(events: PlatformAdapterEvents): Promise<void> {
        if (this.started) {
            throw new Error('TelegramAdapter is already started');
        }

        this.events = events;
        if (!this.handlersRegistered) {
            this.registerHandlers();
            this.handlersRegistered = true;
        }
        this.bot.start();
        this.started = true;

        if (this.events.onReady) {
            this.events.onReady();
        }
    }

    /**
     * Stop the adapter (disconnect, cleanup).
     */
    async stop(): Promise<void> {
        if (!this.started) return;
        this.bot.stop();
        this.started = false;
        this.events = null;
    }

    /**
     * Retrieve a channel (chat) by its platform-native ID.
     * Returns a PlatformChannel backed by the bot API.
     */
    async getChannel(chatId: string): Promise<PlatformChannel | null> {
        try {
            const chat = await this.bot.api.getChat(chatId);
            if (!chat) return null;

            const channel = wrapTelegramChannel(this.bot.api, chatId);
            // Enrich with name from the fetched chat data
            return {
                ...channel,
                name: chat.title ?? chat.first_name ?? undefined,
            };
        } catch {
            return null;
        }
    }

    /**
     * Return the bot's own user ID.
     */
    getBotUserId(): string {
        return this.botUserId;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private registerHandlers(): void {
        // Text messages
        this.bot.on('message:text', async (ctx: any) => {
            if (!this.events?.onMessage) return;

            try {
                const msg: TelegramMessageLike = ctx.message ?? ctx.msg;
                if (!msg) return;

                const msgDate = msg.date ? new Date(msg.date * 1000) : null;
                const delayMs = msgDate ? Date.now() - msgDate.getTime() : null;
                logger.debug(
                    `[TelegramAdapter] message:text received (chat=${msg.chat.id}, delay=${delayMs !== null ? `${delayMs}ms` : 'unknown'})`,
                );

                const platformMessage = wrapTelegramMessage(msg, this.bot.api);
                await this.events.onMessage(platformMessage);
            } catch (error) {
                this.emitError(error);
            }
        });

        // Callback queries (button presses and select menu selections)
        this.bot.on('callback_query:data', async (ctx: any) => {
            if (!this.events?.onButtonInteraction && !this.events?.onSelectInteraction) return;

            try {
                const query: TelegramCallbackQueryLike = ctx.callbackQuery;
                if (!query) return;

                const interaction = wrapTelegramCallbackQuery(query, this.bot.api);

                // Select menu callbacks use \x1F (Unit Separator) between
                // customId and value. Regular button customIds never contain
                // \x1F, so this cleanly distinguishes the two.
                const sepIdx = (query.data ?? '').indexOf(SELECT_CALLBACK_SEP);
                if (sepIdx > 0 && this.events.onSelectInteraction) {
                    const selectCustomId = (query.data ?? '').slice(0, sepIdx);
                    const selectedValue = (query.data ?? '').slice(sepIdx + 1);

                    await this.events.onSelectInteraction({
                        id: query.id,
                        platform: 'telegram',
                        customId: selectCustomId,
                        user: interaction.user,
                        channel: interaction.channel,
                        values: [selectedValue],
                        messageId: interaction.messageId,
                        deferUpdate: interaction.deferUpdate,
                        reply: interaction.reply,
                        update: interaction.update,
                        editReply: interaction.editReply,
                        followUp: interaction.followUp,
                    });
                    return;
                }

                if (this.events.onButtonInteraction) {
                    await this.events.onButtonInteraction(interaction);
                }
            } catch (error) {
                this.emitError(error);
            }
        });
    }

    private emitError(error: unknown): void {
        if (!this.events?.onError) return;

        if (error instanceof Error) {
            this.events.onError(error);
        } else {
            this.events.onError(new Error(String(error)));
        }
    }
}
