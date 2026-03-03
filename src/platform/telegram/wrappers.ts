/**
 * Telegram wrapper functions.
 *
 * Convert Telegram-specific objects to the platform-agnostic types defined
 * in ../types.ts. Uses `TelegramBotLike` interface instead of importing
 * grammy directly, so the code compiles without grammy installed.
 */

import type {
    PlatformUser,
    PlatformChannel,
    PlatformMessage,
    PlatformSentMessage,
    PlatformButtonInteraction,
    MessagePayload,
    ComponentRow,
    ButtonDef,
    SelectMenuDef,
} from '../types';
import { richContentToHtml, markdownToTelegramHtml } from './telegramFormatter';

// ---------------------------------------------------------------------------
// grammy-compatible interfaces (no grammy import needed)
// ---------------------------------------------------------------------------

export interface TelegramBotLike {
    start(): void;
    stop(): void;
    on(event: string, handler: (...args: any[]) => any): void;
    api: {
        sendMessage(chatId: number | string, text: string, options?: any): Promise<any>;
        editMessageText(chatId: number | string, messageId: number, text: string, options?: any): Promise<any>;
        deleteMessage(chatId: number | string, messageId: number): Promise<any>;
        getChat(chatId: number | string): Promise<any>;
        answerCallbackQuery(callbackQueryId: string, options?: any): Promise<any>;
        setMessageReaction?(chatId: number | string, messageId: number, reaction: readonly any[], options?: any): Promise<any>;
        setMyCommands?(commands: readonly { command: string; description: string }[]): Promise<any>;
    };
}

export interface TelegramFrom {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    is_bot: boolean;
}

export interface TelegramMessageLike {
    message_id: number;
    from?: TelegramFrom;
    chat: { id: number; title?: string; type: string };
    text?: string;
    date: number;
}

export interface TelegramCallbackQueryLike {
    id: string;
    from: TelegramFrom;
    message?: TelegramMessageLike;
    data?: string;
}

export interface TelegramSendOptions {
    text: string;
    parse_mode: 'HTML';
    reply_markup?: {
        inline_keyboard: ReadonlyArray<
            ReadonlyArray<{ text: string; callback_data: string }>
        >;
    };
}

// ---------------------------------------------------------------------------
// Inline keyboard builders
// ---------------------------------------------------------------------------

type InlineButton = { text: string; callback_data: string };

function buttonDefToInline(btn: ButtonDef): InlineButton {
    return { text: btn.label, callback_data: btn.customId };
}

/**
 * Separator for select menu callback_data: customId + SEP + value.
 * Uses ASCII Unit Separator (0x1F) to avoid collisions with button
 * customIds that legitimately contain colons (e.g. "approve_action:proj:ch").
 */
export const SELECT_CALLBACK_SEP = '\x1f';

function selectMenuToInlineRows(menu: SelectMenuDef): ReadonlyArray<ReadonlyArray<InlineButton>> {
    return menu.options.map((opt) => [
        { text: opt.label, callback_data: `${menu.customId}${SELECT_CALLBACK_SEP}${opt.value}` },
    ]);
}

function componentRowsToInlineKeyboard(
    rows: readonly ComponentRow[],
): ReadonlyArray<ReadonlyArray<InlineButton>> {
    const keyboard: Array<ReadonlyArray<InlineButton>> = [];

    for (const row of rows) {
        const buttons: InlineButton[] = [];
        for (const comp of row.components) {
            if (comp.type === 'button') {
                buttons.push(buttonDefToInline(comp));
            } else if (comp.type === 'selectMenu') {
                // A select menu becomes multiple rows (one per option)
                const menuRows = selectMenuToInlineRows(comp);
                // Flush any accumulated buttons first
                if (buttons.length > 0) {
                    keyboard.push([...buttons]);
                    buttons.length = 0;
                }
                for (const menuRow of menuRows) {
                    keyboard.push(menuRow);
                }
            }
        }
        if (buttons.length > 0) {
            keyboard.push(buttons);
        }
    }

    return keyboard;
}

// ---------------------------------------------------------------------------
// toTelegramPayload
// ---------------------------------------------------------------------------

/**
 * Convert a platform-agnostic MessagePayload to Telegram send options.
 *
 * - RichContent is rendered to HTML via richContentToHtml
 * - ComponentRow[] become inline_keyboard
 * - text + richContent are combined into one HTML message
 */
export function toTelegramPayload(payload: MessagePayload): TelegramSendOptions {
    const parts: string[] = [];

    if (payload.text) {
        parts.push(markdownToTelegramHtml(payload.text));
    }

    if (payload.richContent) {
        parts.push(richContentToHtml(payload.richContent));
    }

    const text = parts.join('\n\n') || ' ';

    const options: TelegramSendOptions = {
        text,
        parse_mode: 'HTML',
    };

    if (payload.components !== undefined) {
        if (payload.components.length > 0) {
            const keyboard = componentRowsToInlineKeyboard(payload.components);
            if (keyboard.length > 0) {
                return {
                    ...options,
                    reply_markup: { inline_keyboard: keyboard },
                };
            }
        }
        // Explicitly empty components array => remove existing keyboard
        return {
            ...options,
            reply_markup: { inline_keyboard: [] },
        };
    }

    return options;
}

// ---------------------------------------------------------------------------
// Entity wrappers
// ---------------------------------------------------------------------------

/** Wrap a Telegram user object to a PlatformUser. */
export function wrapTelegramUser(from: TelegramFrom): PlatformUser {
    const displayParts = [from.first_name];
    if (from.last_name) {
        displayParts.push(from.last_name);
    }

    return {
        id: String(from.id),
        platform: 'telegram',
        username: from.username ?? String(from.id),
        displayName: displayParts.join(' '),
        isBot: from.is_bot,
    };
}

/** Wrap a Telegram chat as a PlatformChannel. */
export function wrapTelegramChannel(
    api: TelegramBotLike['api'],
    chatId: number | string,
): PlatformChannel {
    const chatIdStr = String(chatId);

    return {
        id: chatIdStr,
        platform: 'telegram',
        name: undefined,
        async send(payload: MessagePayload): Promise<PlatformSentMessage> {
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            const sent = await api.sendMessage(chatId, text, rest);
            return wrapTelegramSentMessage(sent, api, chatId);
        },
    };
}

/** Wrap a Telegram message as a PlatformMessage. */
export function wrapTelegramMessage(
    msg: TelegramMessageLike,
    api: TelegramBotLike['api'],
): PlatformMessage {
    const author = msg.from
        ? wrapTelegramUser(msg.from)
        : {
              id: '0',
              platform: 'telegram' as const,
              username: 'unknown',
              displayName: 'Unknown',
              isBot: false,
          };

    const channel = wrapTelegramChannel(api, msg.chat.id);

    return {
        id: String(msg.message_id),
        platform: 'telegram',
        content: msg.text ?? '',
        author,
        channel,
        attachments: [],
        createdAt: new Date(msg.date * 1000),
        async react(emoji: string): Promise<void> {
            // Telegram Bot API 7.0+ setMessageReaction — limited to 79 emoji.
            // Silently ignore failures (unsupported emoji, old API, etc.).
            if (api.setMessageReaction) {
                await api.setMessageReaction(
                    msg.chat.id,
                    msg.message_id,
                    [{ type: 'emoji', emoji }],
                ).catch(() => {});
            }
        },
        async reply(payload: MessagePayload): Promise<PlatformSentMessage> {
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            const sent = await api.sendMessage(msg.chat.id, text, {
                ...rest,
                reply_to_message_id: msg.message_id,
            });
            return wrapTelegramSentMessage(sent, api, msg.chat.id);
        },
    };
}

/**
 * Validate that a chatId is usable for sending messages.
 * Throws a descriptive error if the chatId is synthetic (0).
 */
function assertValidChatId(chatId: number | string): void {
    if (chatId === 0 || chatId === '0') {
        throw new Error(
            'Cannot send message: callback query has no associated chat (chatId is 0). ' +
            'Use answerCallbackQuery instead.',
        );
    }
}

/** Wrap a Telegram callback query as a PlatformButtonInteraction. */
export function wrapTelegramCallbackQuery(
    query: TelegramCallbackQueryLike,
    api: TelegramBotLike['api'],
): PlatformButtonInteraction {
    const user = wrapTelegramUser(query.from);
    const chatId = query.message?.chat.id ?? 0;
    const channel = wrapTelegramChannel(api, chatId);
    const messageId = query.message ? String(query.message.message_id) : '0';
    const callbackQueryId = query.id;

    return {
        id: query.id,
        platform: 'telegram',
        customId: query.data ?? '',
        user,
        channel,
        messageId,
        async deferUpdate(): Promise<void> {
            // Acknowledge the callback query to dismiss the loading indicator
            await api.answerCallbackQuery(callbackQueryId);
        },
        async reply(payload: MessagePayload): Promise<void> {
            assertValidChatId(chatId);
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            await api.sendMessage(chatId, text, rest);
        },
        async update(payload: MessagePayload): Promise<void> {
            if (!query.message) return;
            assertValidChatId(chatId);
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            await api.editMessageText(chatId, query.message.message_id, text, rest);
        },
        async editReply(payload: MessagePayload): Promise<void> {
            if (!query.message) return;
            assertValidChatId(chatId);
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            await api.editMessageText(chatId, query.message.message_id, text, rest);
        },
        async followUp(payload: MessagePayload): Promise<PlatformSentMessage> {
            assertValidChatId(chatId);
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            const sent = await api.sendMessage(chatId, text, rest);
            return wrapTelegramSentMessage(sent, api, chatId);
        },
    };
}

// ---------------------------------------------------------------------------
// Sent message wrapper
// ---------------------------------------------------------------------------

/** Wrap a Telegram API send result as a PlatformSentMessage. */
export function wrapTelegramSentMessage(
    msg: any,
    api: TelegramBotLike['api'],
    chatId: number | string,
): PlatformSentMessage {
    const msgId = String(msg.message_id ?? msg.id ?? '0');

    return {
        id: msgId,
        platform: 'telegram',
        channelId: String(chatId),
        async edit(payload: MessagePayload): Promise<PlatformSentMessage> {
            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            const edited = await api.editMessageText(chatId, Number(msgId), text, rest);
            return wrapTelegramSentMessage(edited, api, chatId);
        },
        async delete(): Promise<void> {
            await api.deleteMessage(chatId, Number(msgId));
        },
    };
}
