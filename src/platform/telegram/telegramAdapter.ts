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

/**
 * Adapter implementing multi-platform interface for Telegram.
 */
export class TelegramAdapter implements PlatformAdapter {
    /** The target messaging platform string. */
    readonly platform = 'telegram' as const;

    /** Telegram bot client wrapper. */
    private readonly bot: TelegramBotLike;
    /** The bot's own user ID. */
    private readonly botUserId: string;
    /** Registered event handlers. */
    private events: PlatformAdapterEvents | null = null;
    /** Polling loop status flag. */
    private started = false;
    /** True if telegram event list handlers are bound. */
    private handlersRegistered = false;
    /** Timestamp when the adapter started — messages older than this are discarded. */
    private startedAt: number = 0;

    /**
     * Initializes the Telegram adapter.
     * @param bot Bot library wrapper.
     * @param botUserId Bot native user ID.
     */
    constructor(bot: TelegramBotLike, botUserId: string) {
        this.bot = bot;
        this.botUserId = botUserId;
    }

    /**
     * Start the adapter.
     *
     * Registers Telegram event handlers that translate incoming events to the
     * platform-agnostic event callbacks, then starts the bot polling loop.
     * @param events Callbacks for handling received events.
     */
    async start(events: PlatformAdapterEvents): Promise<void> {
        if (this.started) {
            throw new Error('TelegramAdapter is already started');
        }

        this.events = events;
        // Round down to whole seconds to match Telegram's second-precision timestamps
        this.startedAt = Math.floor(Date.now() / 1000) * 1000;
        if (!this.handlersRegistered) {
            this.registerHandlers();
            this.handlersRegistered = true;
        }
        // bot.start() returns a Promise that resolves when polling stops.
        // We intentionally do NOT await it (would block forever).
        // Catch errors to prevent unhandled promise rejections (e.g. getMe()
        // failure inside grammY's init phase).
        const startPromise = this.bot.start();
        if (startPromise && typeof (startPromise as any).catch === 'function') {
            (startPromise as Promise<void>).catch((err: unknown) => {
                logger.error('[TelegramAdapter] Polling loop error:', err instanceof Error ? err.message : err);
                this.emitError(err);
            });
        }
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
     * @param chatId Telegram Chat ID.
     * @returns Fully mapped PlatformChannel, or null if retrieval failed.
     */
    async getChannel(chatId: string): Promise<PlatformChannel | null> {
        try {
            const chat = await this.bot.api.getChat(chatId);
            if (!chat) return null;

            const channel = wrapTelegramChannel(this.bot.api, chatId, this.bot.toInputFile);
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
     * @returns Bot user ID string.
     */
    getBotUserId(): string {
        return this.botUserId;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Shared handler for both text and photo messages.
     * Wraps the Telegram message and fires onMessage.
     * @param eventName Identifier event name for logging.
     * @param ctx Event update context.
     */
    private handleIncomingMessage(eventName: string, ctx: any): void {
        if (!this.events?.onMessage) return;

        try {
            const msg: TelegramMessageLike = ctx.message ?? ctx.msg;
            if (!msg) return;

            const msgTimestampMs = msg.date ? msg.date * 1000 : 0;
            const delayMs = msgTimestampMs ? Date.now() - msgTimestampMs : null;
            logger.debug(
                `[TelegramAdapter] ${eventName} received (chat=${msg.chat.id}, delay=${delayMs !== null ? `${delayMs}ms` : 'unknown'})`,
            );

            // Discard messages sent before the adapter started (stale backlog)
            if (msgTimestampMs && msgTimestampMs < this.startedAt) {
                logger.info(
                    `[TelegramAdapter] Ignoring stale message (chat=${msg.chat.id}, age=${Math.round((this.startedAt - msgTimestampMs) / 1000)}s before startup)`,
                );
                return;
            }

            const platformMessage = wrapTelegramMessage(
                msg,
                this.bot.api,
                this.bot.toInputFile,
                this.bot.token,
            );
            // Fire-and-forget: do NOT await so grammY's update loop stays
            // unblocked. This allows /stop and other commands to be received
            // while a long-running response is being monitored.
            // The workspace queue in telegramMessageHandler serializes
            // actual prompt processing per workspace.
            this.events.onMessage(platformMessage).catch((error) => {
                this.emitError(error);
            });
        } catch (error) {
            this.emitError(error);
        }
    }

    /**
     * Binds internal event listeners to the Telegram Bot client.
     */
    private registerHandlers(): void {
        // Text messages
        this.bot.on('message:text', async (ctx: any) => {
            this.handleIncomingMessage('message:text', ctx);
        });

        // Photo messages
        this.bot.on('message:photo', async (ctx: any) => {
            this.handleIncomingMessage('message:photo', ctx);
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

    /**
     * Safely triggers the onError event handler callback.
     * @param error The thrown error object.
     */
    private emitError(error: unknown): void {
        if (!this.events?.onError) return;

        if (error instanceof Error) {
            this.events.onError(error);
        } else {
            this.events.onError(new Error(String(error)));
        }
    }
}
