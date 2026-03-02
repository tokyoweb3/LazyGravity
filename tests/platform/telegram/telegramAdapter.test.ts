import { TelegramAdapter } from '../../../src/platform/telegram/telegramAdapter';
import type { PlatformAdapterEvents } from '../../../src/platform/adapter';
import type { TelegramBotLike } from '../../../src/platform/telegram/wrappers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RegisteredHandler {
    event: string;
    handler: (...args: any[]) => any;
}

function createMockBot(): TelegramBotLike & {
    handlers: RegisteredHandler[];
    emit(event: string, ctx: any): Promise<void>;
} {
    const handlers: RegisteredHandler[] = [];

    const bot = {
        handlers,
        start: jest.fn(),
        stop: jest.fn(),
        on: jest.fn((event: string, handler: (...args: any[]) => any) => {
            handlers.push({ event, handler });
        }),
        api: {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessageText: jest.fn().mockResolvedValue({ message_id: 1 }),
            deleteMessage: jest.fn().mockResolvedValue(true),
            getChat: jest.fn().mockResolvedValue({
                id: 100,
                title: 'Test Chat',
                type: 'group',
            }),
        },
        async emit(event: string, ctx: any): Promise<void> {
            for (const h of handlers) {
                if (h.event === event) {
                    await h.handler(ctx);
                }
            }
        },
    };

    return bot;
}

function createMockEvents(): PlatformAdapterEvents & {
    onReady: jest.Mock;
    onMessage: jest.Mock;
    onButtonInteraction: jest.Mock;
    onSelectInteraction: jest.Mock;
    onError: jest.Mock;
} {
    return {
        onReady: jest.fn(),
        onMessage: jest.fn().mockResolvedValue(undefined),
        onButtonInteraction: jest.fn().mockResolvedValue(undefined),
        onSelectInteraction: jest.fn().mockResolvedValue(undefined),
        onError: jest.fn(),
    };
}

// ---------------------------------------------------------------------------
// TelegramAdapter
// ---------------------------------------------------------------------------

describe('TelegramAdapter', () => {
    describe('constructor', () => {
        it('sets platform to telegram', () => {
            const bot = createMockBot();
            const adapter = new TelegramAdapter(bot, 'bot_123');
            expect(adapter.platform).toBe('telegram');
        });
    });

    describe('getBotUserId', () => {
        it('returns the bot user ID passed in constructor', () => {
            const bot = createMockBot();
            const adapter = new TelegramAdapter(bot, 'bot_456');
            expect(adapter.getBotUserId()).toBe('bot_456');
        });
    });

    describe('start', () => {
        it('calls bot.start() and fires onReady', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);

            expect(bot.start).toHaveBeenCalledTimes(1);
            expect(events.onReady).toHaveBeenCalledTimes(1);
        });

        it('registers message:text and callback_query:data handlers', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);

            const registeredEvents = bot.handlers.map((h) => h.event);
            expect(registeredEvents).toContain('message:text');
            expect(registeredEvents).toContain('callback_query:data');
        });

        it('throws if started twice', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);
            await expect(adapter.start(events)).rejects.toThrow(
                'TelegramAdapter is already started',
            );
        });
    });

    describe('stop', () => {
        it('calls bot.stop()', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);
            await adapter.stop();

            expect(bot.stop).toHaveBeenCalledTimes(1);
        });

        it('is safe to call stop without start', async () => {
            const bot = createMockBot();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await expect(adapter.stop()).resolves.toBeUndefined();
            expect(bot.stop).not.toHaveBeenCalled();
        });

        it('allows restarting after stop', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);
            await adapter.stop();
            await adapter.start(events);

            expect(bot.start).toHaveBeenCalledTimes(2);
        });
    });

    describe('getChannel', () => {
        it('returns a PlatformChannel with name from chat data', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);
            const channel = await adapter.getChannel('100');

            expect(channel).not.toBeNull();
            expect(channel!.id).toBe('100');
            expect(channel!.platform).toBe('telegram');
            expect(channel!.name).toBe('Test Chat');
        });

        it('returns null when getChat fails', async () => {
            const bot = createMockBot();
            bot.api.getChat = jest.fn().mockRejectedValue(new Error('Not found'));
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);
            const channel = await adapter.getChannel('999');

            expect(channel).toBeNull();
        });
    });

    describe('event handling - message:text', () => {
        it('calls onMessage with a PlatformMessage', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);

            await bot.emit('message:text', {
                message: {
                    message_id: 10,
                    from: {
                        id: 42,
                        first_name: 'Alice',
                        is_bot: false,
                    },
                    chat: { id: 1, title: 'Group', type: 'group' },
                    text: 'Hello bot',
                    date: 1700000000,
                },
            });

            expect(events.onMessage).toHaveBeenCalledTimes(1);
            const msg = events.onMessage.mock.calls[0][0];
            expect(msg.id).toBe('10');
            expect(msg.platform).toBe('telegram');
            expect(msg.content).toBe('Hello bot');
            expect(msg.author.id).toBe('42');
        });

        it('does not call onMessage when handler is not set', async () => {
            const bot = createMockBot();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start({ onReady: jest.fn() });

            // Should not throw
            await bot.emit('message:text', {
                message: {
                    message_id: 10,
                    from: { id: 1, first_name: 'X', is_bot: false },
                    chat: { id: 1, type: 'private' },
                    text: 'Hi',
                    date: 1700000000,
                },
            });
        });

        it('calls onError when message handler throws', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            events.onMessage.mockRejectedValue(new Error('Handler failure'));
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);

            await bot.emit('message:text', {
                message: {
                    message_id: 10,
                    from: { id: 1, first_name: 'X', is_bot: false },
                    chat: { id: 1, type: 'private' },
                    text: 'fail',
                    date: 1700000000,
                },
            });

            expect(events.onError).toHaveBeenCalledTimes(1);
            expect(events.onError.mock.calls[0][0].message).toBe('Handler failure');
        });
    });

    describe('event handling - callback_query:data', () => {
        it('calls onButtonInteraction for simple button data', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            // Remove select handler so button handler is used
            const eventsWithoutSelect = { ...events, onSelectInteraction: undefined };
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(eventsWithoutSelect);

            await bot.emit('callback_query:data', {
                callbackQuery: {
                    id: 'cb_1',
                    from: { id: 42, first_name: 'Bob', is_bot: false },
                    message: {
                        message_id: 50,
                        chat: { id: 1, type: 'group' },
                        date: 1700000000,
                    },
                    data: 'btn_click',
                },
            });

            expect(events.onButtonInteraction).toHaveBeenCalledTimes(1);
            const interaction = events.onButtonInteraction.mock.calls[0][0];
            expect(interaction.customId).toBe('btn_click');
            expect(interaction.user.id).toBe('42');
        });

        it('routes select menu callback (customId:value format) to onSelectInteraction', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(events);

            await bot.emit('callback_query:data', {
                callbackQuery: {
                    id: 'cb_2',
                    from: { id: 42, first_name: 'Bob', is_bot: false },
                    message: {
                        message_id: 50,
                        chat: { id: 1, type: 'group' },
                        date: 1700000000,
                    },
                    data: 'menu_id:selected_value',
                },
            });

            expect(events.onSelectInteraction).toHaveBeenCalledTimes(1);
            const interaction = events.onSelectInteraction!.mock.calls[0][0];
            expect(interaction.customId).toBe('menu_id');
            expect(interaction.values).toEqual(['selected_value']);
        });

        it('calls onError when callback handler throws', async () => {
            const bot = createMockBot();
            const events = createMockEvents();
            events.onButtonInteraction.mockRejectedValue(new Error('Button error'));
            const eventsWithoutSelect = { ...events, onSelectInteraction: undefined };
            const adapter = new TelegramAdapter(bot, 'bot_1');

            await adapter.start(eventsWithoutSelect);

            await bot.emit('callback_query:data', {
                callbackQuery: {
                    id: 'cb_3',
                    from: { id: 1, first_name: 'X', is_bot: false },
                    message: {
                        message_id: 50,
                        chat: { id: 1, type: 'private' },
                        date: 1700000000,
                    },
                    data: 'fail_btn',
                },
            });

            expect(events.onError).toHaveBeenCalledTimes(1);
        });
    });
});
