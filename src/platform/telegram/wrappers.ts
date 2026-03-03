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
    PlatformAttachment,
    PlatformButtonInteraction,
    MessagePayload,
    FileAttachment,
    ComponentRow,
    ButtonDef,
    SelectMenuDef,
} from '../types';
import { richContentToHtml, markdownToTelegramHtml } from './telegramFormatter';

// ---------------------------------------------------------------------------
// grammy-compatible interfaces (no grammy import needed)
// ---------------------------------------------------------------------------

export interface TelegramBotLike {
    /** Bot token — needed to construct file download URLs. */
    token?: string;
    start(): void | Promise<void>;
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
        sendPhoto?(chatId: number | string, photo: any, options?: any): Promise<any>;
        sendDocument?(chatId: number | string, document: any, options?: any): Promise<any>;
        getFile?(file_id: string): Promise<{ file_id: string; file_path?: string }>;
    };
    /**
     * Convert a Buffer to a platform-specific input file object.
     * For grammY this wraps Buffer in InputFile; set this when creating the bot.
     * If not provided, raw Buffer is passed through (works for test mocks).
     */
    toInputFile?: (data: Buffer, filename?: string) => unknown;
}

export interface TelegramFrom {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    is_bot: boolean;
}

export interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

export interface TelegramMessageLike {
    message_id: number;
    from?: TelegramFrom;
    chat: { id: number; title?: string; type: string };
    text?: string;
    /** Photo messages store user text in caption, not text. */
    caption?: string;
    /** Array of photo sizes; last element is the largest. */
    photo?: TelegramPhotoSize[];
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
        let buttons: InlineButton[] = [];
        for (const comp of row.components) {
            if (comp.type === 'button') {
                // Telegram inline keyboards do not support disabled buttons;
                // skip them so resolved overlays don't re-show clickable buttons.
                if (comp.disabled) continue;
                buttons = [...buttons, buttonDefToInline(comp)];
            } else if (comp.type === 'selectMenu') {
                // A select menu becomes multiple rows (one per option)
                const menuRows = selectMenuToInlineRows(comp);
                // Flush any accumulated buttons first
                if (buttons.length > 0) {
                    keyboard.push([...buttons]);
                    buttons = [];
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

/**
 * Try to send a file attachment via Telegram photo/document API.
 * Returns the sent message, or null if file sending is not available.
 *
 * @param toInputFile - Optional converter that wraps Buffer for the Telegram API.
 *   grammY requires Buffer wrapped in InputFile; pass `bot.toInputFile` here.
 */
async function trySendFile(
    api: TelegramBotLike['api'],
    chatId: number | string,
    file: FileAttachment,
    caption: string | undefined,
    extraOptions?: Record<string, unknown>,
    toInputFile?: TelegramBotLike['toInputFile'],
): Promise<any | null> {
    const isImage = file.contentType?.startsWith('image/') || file.name.match(/\.(png|jpe?g|gif|webp)$/i);
    // grammY requires Buffer wrapped in InputFile; use toInputFile if available.
    const inputFile = toInputFile ? toInputFile(file.data, file.name) : file.data;

    if (isImage && api.sendPhoto) {
        return api.sendPhoto(chatId, inputFile, {
            caption,
            parse_mode: caption ? 'HTML' : undefined,
            ...extraOptions,
        });
    }

    if (api.sendDocument) {
        return api.sendDocument(chatId, inputFile, {
            caption,
            parse_mode: caption ? 'HTML' : undefined,
            ...extraOptions,
        });
    }

    return null;
}

/** Wrap a Telegram chat as a PlatformChannel. */
export function wrapTelegramChannel(
    api: TelegramBotLike['api'],
    chatId: number | string,
    toInputFile?: TelegramBotLike['toInputFile'],
): PlatformChannel {
    const chatIdStr = String(chatId);

    return {
        id: chatIdStr,
        platform: 'telegram',
        name: undefined,
        async send(payload: MessagePayload): Promise<PlatformSentMessage> {
            // Handle file attachments (e.g., screenshots)
            if (payload.files && payload.files.length > 0) {
                const file = payload.files[0];
                const opts = payload.text || payload.richContent
                    ? toTelegramPayload({ text: payload.text, richContent: payload.richContent })
                    : null;
                const caption = opts?.text;

                const sent = await trySendFile(api, chatId, file, caption, undefined, toInputFile);
                if (sent) {
                    return wrapTelegramSentMessage(sent, api, chatId);
                }
                // Fallback to text-only if file sending not supported
            }

            const opts = toTelegramPayload(payload);
            const { text, ...rest } = opts;
            const sent = await api.sendMessage(chatId, text, rest);
            return wrapTelegramSentMessage(sent, api, chatId);
        },
    };
}

/**
 * Build PlatformAttachment[] from a Telegram photo message.
 * Uses the largest photo size (last in the array) and constructs
 * the download URL from the bot token and file_id.
 */
function buildPhotoAttachments(
    photo: TelegramPhotoSize[],
    botToken?: string,
): PlatformAttachment[] {
    if (photo.length === 0) return [];

    // Telegram sends multiple sizes; last is the largest
    const largest = photo[photo.length - 1];

    // URL is constructed later during download via getFile API.
    // Store file_id as the URL so the download utility can resolve it.
    const url = botToken
        ? `telegram-file://${largest.file_id}`
        : `telegram-file://${largest.file_id}`;

    return [{
        name: `photo-${largest.file_unique_id}.jpg`,
        contentType: 'image/jpeg',
        url,
        size: largest.file_size ?? 0,
    }];
}

/** Wrap a Telegram message as a PlatformMessage. */
export function wrapTelegramMessage(
    msg: TelegramMessageLike,
    api: TelegramBotLike['api'],
    toInputFile?: TelegramBotLike['toInputFile'],
    botToken?: string,
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

    const channel = wrapTelegramChannel(api, msg.chat.id, toInputFile);

    // Photo messages: use caption as content, build attachments from photo array
    const content = msg.text ?? msg.caption ?? '';
    const attachments: readonly PlatformAttachment[] = msg.photo
        ? buildPhotoAttachments(msg.photo, botToken)
        : [];

    return {
        id: String(msg.message_id),
        platform: 'telegram',
        content,
        author,
        channel,
        attachments,
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
            // Handle file attachments (e.g., screenshots)
            if (payload.files && payload.files.length > 0) {
                const file = payload.files[0];
                const opts = payload.text || payload.richContent
                    ? toTelegramPayload({ text: payload.text, richContent: payload.richContent })
                    : null;
                const caption = opts?.text;

                const sent = await trySendFile(
                    api,
                    msg.chat.id,
                    file,
                    caption,
                    { reply_to_message_id: msg.message_id },
                    toInputFile,
                );
                if (sent) {
                    return wrapTelegramSentMessage(sent, api, msg.chat.id);
                }
                // Fallback to text-only if file sending not supported
            }

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
