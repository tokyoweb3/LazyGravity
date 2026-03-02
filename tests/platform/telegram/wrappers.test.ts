import {
    wrapTelegramUser,
    toTelegramPayload,
    wrapTelegramChannel,
    wrapTelegramMessage,
    wrapTelegramCallbackQuery,
    wrapTelegramSentMessage,
} from '../../../src/platform/telegram/wrappers';
import type {
    TelegramBotLike,
    TelegramFrom,
    TelegramMessageLike,
    TelegramCallbackQueryLike,
} from '../../../src/platform/telegram/wrappers';
import type { MessagePayload, RichContent } from '../../../src/platform/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockApi(): TelegramBotLike['api'] {
    return {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 999 }),
        editMessageText: jest.fn().mockResolvedValue({ message_id: 999 }),
        deleteMessage: jest.fn().mockResolvedValue(true),
        getChat: jest.fn().mockResolvedValue({ id: 1, title: 'Test Chat' }),
    };
}

function createTelegramFrom(overrides?: Partial<TelegramFrom>): TelegramFrom {
    return {
        id: 42,
        first_name: 'Alice',
        is_bot: false,
        ...overrides,
    };
}

function createTelegramMessage(
    overrides?: Partial<TelegramMessageLike>,
): TelegramMessageLike {
    return {
        message_id: 100,
        from: createTelegramFrom(),
        chat: { id: 1, title: 'Test Chat', type: 'group' },
        text: 'Hello',
        date: Math.floor(Date.now() / 1000),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// wrapTelegramUser
// ---------------------------------------------------------------------------

describe('wrapTelegramUser', () => {
    it('wraps a Telegram user with first name only', () => {
        const from = createTelegramFrom({ username: 'alice_w' });
        const user = wrapTelegramUser(from);

        expect(user.id).toBe('42');
        expect(user.platform).toBe('telegram');
        expect(user.username).toBe('alice_w');
        expect(user.displayName).toBe('Alice');
        expect(user.isBot).toBe(false);
    });

    it('concatenates first and last name in displayName', () => {
        const from = createTelegramFrom({
            first_name: 'Bob',
            last_name: 'Smith',
        });
        const user = wrapTelegramUser(from);
        expect(user.displayName).toBe('Bob Smith');
    });

    it('falls back to numeric ID when username is missing', () => {
        const from = createTelegramFrom({ username: undefined });
        const user = wrapTelegramUser(from);
        expect(user.username).toBe('42');
    });

    it('reflects isBot correctly', () => {
        const from = createTelegramFrom({ is_bot: true });
        const user = wrapTelegramUser(from);
        expect(user.isBot).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// toTelegramPayload
// ---------------------------------------------------------------------------

describe('toTelegramPayload', () => {
    it('converts plain text payload', () => {
        const payload: MessagePayload = { text: 'Hello world' };
        const result = toTelegramPayload(payload);

        expect(result.text).toBe('Hello world');
        expect(result.parse_mode).toBe('HTML');
        expect(result.reply_markup).toBeUndefined();
    });

    it('converts RichContent to HTML', () => {
        const rc: RichContent = { title: 'Status', description: 'All **good**' };
        const payload: MessagePayload = { richContent: rc };
        const result = toTelegramPayload(payload);

        expect(result.text).toContain('<b>Status</b>');
        expect(result.text).toContain('All <b>good</b>');
    });

    it('combines text and richContent', () => {
        const payload: MessagePayload = {
            text: 'Header',
            richContent: { title: 'Detail' },
        };
        const result = toTelegramPayload(payload);

        expect(result.text).toContain('Header');
        expect(result.text).toContain('<b>Detail</b>');
    });

    it('falls back to space when both text and richContent are empty', () => {
        const payload: MessagePayload = {};
        const result = toTelegramPayload(payload);
        expect(result.text).toBe(' ');
    });

    it('converts buttons to inline keyboard', () => {
        const payload: MessagePayload = {
            text: 'Choose:',
            components: [
                {
                    components: [
                        {
                            type: 'button' as const,
                            customId: 'btn_a',
                            label: 'Option A',
                            style: 'primary' as const,
                        },
                        {
                            type: 'button' as const,
                            customId: 'btn_b',
                            label: 'Option B',
                            style: 'secondary' as const,
                        },
                    ],
                },
            ],
        };
        const result = toTelegramPayload(payload);

        expect(result.reply_markup).toBeDefined();
        expect(result.reply_markup!.inline_keyboard).toHaveLength(1);
        expect(result.reply_markup!.inline_keyboard[0]).toHaveLength(2);
        expect(result.reply_markup!.inline_keyboard[0][0]).toEqual({
            text: 'Option A',
            callback_data: 'btn_a',
        });
    });

    it('converts select menu to vertical button list', () => {
        const payload: MessagePayload = {
            text: 'Pick:',
            components: [
                {
                    components: [
                        {
                            type: 'selectMenu' as const,
                            customId: 'menu_1',
                            placeholder: 'Select...',
                            options: [
                                { label: 'First', value: 'v1' },
                                { label: 'Second', value: 'v2' },
                            ],
                        },
                    ],
                },
            ],
        };
        const result = toTelegramPayload(payload);

        expect(result.reply_markup).toBeDefined();
        // Each option becomes its own row
        expect(result.reply_markup!.inline_keyboard).toHaveLength(2);
        expect(result.reply_markup!.inline_keyboard[0][0]).toEqual({
            text: 'First',
            callback_data: 'menu_1:v1',
        });
        expect(result.reply_markup!.inline_keyboard[1][0]).toEqual({
            text: 'Second',
            callback_data: 'menu_1:v2',
        });
    });

    it('handles mixed buttons and select menus in one row', () => {
        const payload: MessagePayload = {
            text: 'Mixed:',
            components: [
                {
                    components: [
                        {
                            type: 'button' as const,
                            customId: 'btn_x',
                            label: 'X',
                            style: 'primary' as const,
                        },
                        {
                            type: 'selectMenu' as const,
                            customId: 'sel',
                            options: [
                                { label: 'A', value: 'a' },
                            ],
                        },
                    ],
                },
            ],
        };
        const result = toTelegramPayload(payload);

        expect(result.reply_markup).toBeDefined();
        // Button row + select menu row
        expect(result.reply_markup!.inline_keyboard).toHaveLength(2);
        expect(result.reply_markup!.inline_keyboard[0][0].text).toBe('X');
        expect(result.reply_markup!.inline_keyboard[1][0].text).toBe('A');
    });

    it('does not add reply_markup when components are empty', () => {
        const payload: MessagePayload = { text: 'Hi', components: [] };
        const result = toTelegramPayload(payload);
        expect(result.reply_markup).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// wrapTelegramChannel
// ---------------------------------------------------------------------------

describe('wrapTelegramChannel', () => {
    it('creates a channel with correct id and platform', () => {
        const api = createMockApi();
        const channel = wrapTelegramChannel(api, 123);

        expect(channel.id).toBe('123');
        expect(channel.platform).toBe('telegram');
    });

    it('send() calls api.sendMessage and returns a PlatformSentMessage', async () => {
        const api = createMockApi();
        const channel = wrapTelegramChannel(api, 456);

        const sent = await channel.send({ text: 'Hello' });

        expect(api.sendMessage).toHaveBeenCalledWith(
            456,
            'Hello',
            expect.objectContaining({ parse_mode: 'HTML' }),
        );
        expect(sent.id).toBe('999');
        expect(sent.platform).toBe('telegram');
        expect(sent.channelId).toBe('456');
    });
});

// ---------------------------------------------------------------------------
// wrapTelegramMessage
// ---------------------------------------------------------------------------

describe('wrapTelegramMessage', () => {
    it('wraps message with correct properties', () => {
        const api = createMockApi();
        const msg = createTelegramMessage();
        const wrapped = wrapTelegramMessage(msg, api);

        expect(wrapped.id).toBe('100');
        expect(wrapped.platform).toBe('telegram');
        expect(wrapped.content).toBe('Hello');
        expect(wrapped.author.id).toBe('42');
        expect(wrapped.channel.id).toBe('1');
        expect(wrapped.attachments).toEqual([]);
    });

    it('handles missing from field', () => {
        const api = createMockApi();
        const msg = createTelegramMessage({ from: undefined });
        const wrapped = wrapTelegramMessage(msg, api);

        expect(wrapped.author.id).toBe('0');
        expect(wrapped.author.username).toBe('unknown');
    });

    it('converts unix timestamp to Date', () => {
        const api = createMockApi();
        const msg = createTelegramMessage({ date: 1700000000 });
        const wrapped = wrapTelegramMessage(msg, api);

        expect(wrapped.createdAt.getTime()).toBe(1700000000000);
    });

    it('reply() calls sendMessage with reply_to_message_id', async () => {
        const api = createMockApi();
        const msg = createTelegramMessage();
        const wrapped = wrapTelegramMessage(msg, api);

        await wrapped.reply({ text: 'Reply text' });

        expect(api.sendMessage).toHaveBeenCalledWith(
            1,
            'Reply text',
            expect.objectContaining({
                parse_mode: 'HTML',
                reply_to_message_id: 100,
            }),
        );
    });

    it('react() does not throw', async () => {
        const api = createMockApi();
        const msg = createTelegramMessage();
        const wrapped = wrapTelegramMessage(msg, api);

        await expect(wrapped.react('thumbsup')).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// wrapTelegramCallbackQuery
// ---------------------------------------------------------------------------

describe('wrapTelegramCallbackQuery', () => {
    it('wraps a callback query with correct properties', () => {
        const api = createMockApi();
        const query: TelegramCallbackQueryLike = {
            id: 'cb_1',
            from: createTelegramFrom(),
            message: createTelegramMessage(),
            data: 'btn_action',
        };
        const interaction = wrapTelegramCallbackQuery(query, api);

        expect(interaction.id).toBe('cb_1');
        expect(interaction.platform).toBe('telegram');
        expect(interaction.customId).toBe('btn_action');
        expect(interaction.user.id).toBe('42');
        expect(interaction.messageId).toBe('100');
    });

    it('handles missing message gracefully', () => {
        const api = createMockApi();
        const query: TelegramCallbackQueryLike = {
            id: 'cb_2',
            from: createTelegramFrom(),
            data: 'action',
        };
        const interaction = wrapTelegramCallbackQuery(query, api);

        expect(interaction.messageId).toBe('0');
        expect(interaction.channel.id).toBe('0');
    });

    it('update() calls editMessageText', async () => {
        const api = createMockApi();
        const query: TelegramCallbackQueryLike = {
            id: 'cb_3',
            from: createTelegramFrom(),
            message: createTelegramMessage(),
            data: 'edit_action',
        };
        const interaction = wrapTelegramCallbackQuery(query, api);

        await interaction.update({ text: 'Updated' });

        expect(api.editMessageText).toHaveBeenCalledWith(
            1,
            100,
            'Updated',
            expect.objectContaining({ parse_mode: 'HTML' }),
        );
    });

    it('followUp() calls sendMessage and returns PlatformSentMessage', async () => {
        const api = createMockApi();
        const query: TelegramCallbackQueryLike = {
            id: 'cb_4',
            from: createTelegramFrom(),
            message: createTelegramMessage(),
            data: 'follow',
        };
        const interaction = wrapTelegramCallbackQuery(query, api);

        const sent = await interaction.followUp({ text: 'Follow-up' });

        expect(api.sendMessage).toHaveBeenCalled();
        expect(sent.id).toBe('999');
        expect(sent.platform).toBe('telegram');
    });
});

// ---------------------------------------------------------------------------
// wrapTelegramSentMessage
// ---------------------------------------------------------------------------

describe('wrapTelegramSentMessage', () => {
    it('wraps sent message with correct properties', () => {
        const api = createMockApi();
        const sent = wrapTelegramSentMessage(
            { message_id: 200 },
            api,
            555,
        );

        expect(sent.id).toBe('200');
        expect(sent.platform).toBe('telegram');
        expect(sent.channelId).toBe('555');
    });

    it('edit() calls editMessageText', async () => {
        const api = createMockApi();
        const sent = wrapTelegramSentMessage({ message_id: 200 }, api, 555);

        await sent.edit({ text: 'Edited text' });

        expect(api.editMessageText).toHaveBeenCalledWith(
            555,
            200,
            'Edited text',
            expect.objectContaining({ parse_mode: 'HTML' }),
        );
    });

    it('delete() calls deleteMessage', async () => {
        const api = createMockApi();
        const sent = wrapTelegramSentMessage({ message_id: 200 }, api, 555);

        await sent.delete();

        expect(api.deleteMessage).toHaveBeenCalledWith(555, 200);
    });
});
