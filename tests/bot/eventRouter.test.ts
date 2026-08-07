import { EventRouter } from '../../src/bot/eventRouter';
import type { EventRouterConfig, EventHandlers } from '../../src/bot/eventRouter';
import type { PlatformAdapter, PlatformAdapterEvents } from '../../src/platform/adapter';
import type {
    PlatformMessage,
    PlatformButtonInteraction,
    PlatformSelectInteraction,
    PlatformCommandInteraction,
    PlatformType,
    PlatformUser,
    PlatformChannel,
} from '../../src/platform/types';

// Suppress logger output during tests
jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        phase: jest.fn(),
        done: jest.fn(),
        divider: jest.fn(),
    },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAdapter(platform: PlatformType): PlatformAdapter & {
    startMock: jest.Mock;
    stopMock: jest.Mock;
    capturedEvents: PlatformAdapterEvents | null;
} {
    let capturedEvents: PlatformAdapterEvents | null = null;
    const startMock = jest.fn(async (events: PlatformAdapterEvents) => {
        capturedEvents = events;
    });
    const stopMock = jest.fn(async () => {});

    return {
        platform,
        start: startMock,
        stop: stopMock,
        getChannel: jest.fn(async () => null),
        getBotUserId: jest.fn(() => 'bot-id'),
        startMock,
        stopMock,
        get capturedEvents() {
            return capturedEvents;
        },
    };
}

function createMockUser(overrides: Partial<PlatformUser> = {}): PlatformUser {
    return {
        id: 'user-1',
        platform: 'discord',
        username: 'testuser',
        isBot: false,
        ...overrides,
    };
}

function createMockChannel(overrides: Partial<PlatformChannel> = {}): PlatformChannel {
    return {
        id: 'channel-1',
        platform: 'discord',
        send: jest.fn(),
        ...overrides,
    };
}

function createMockMessage(overrides: Partial<PlatformMessage> = {}): PlatformMessage {
    return {
        id: 'msg-1',
        platform: 'discord',
        content: 'hello',
        author: createMockUser(),
        channel: createMockChannel(),
        attachments: [],
        createdAt: new Date(),
        react: jest.fn(),
        reply: jest.fn(),
        ...overrides,
    };
}

function createMockButtonInteraction(
    overrides: Partial<PlatformButtonInteraction> = {},
): PlatformButtonInteraction {
    return {
        id: 'btn-1',
        platform: 'discord',
        customId: 'test-btn',
        user: createMockUser(),
        channel: createMockChannel(),
        messageId: 'msg-1',
        deferUpdate: jest.fn(),
        reply: jest.fn(),
        update: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
        showModal: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function createMockSelectInteraction(
    overrides: Partial<PlatformSelectInteraction> = {},
): PlatformSelectInteraction {
    return {
        id: 'sel-1',
        platform: 'discord',
        customId: 'test-sel',
        user: createMockUser(),
        channel: createMockChannel(),
        values: ['option-1'],
        messageId: 'msg-1',
        deferUpdate: jest.fn(),
        reply: jest.fn(),
        update: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
        ...overrides,
    };
}

function createMockCommandInteraction(
    overrides: Partial<PlatformCommandInteraction> = {},
): PlatformCommandInteraction {
    return {
        id: 'cmd-1',
        platform: 'discord',
        commandName: 'test-cmd',
        user: createMockUser(),
        channel: createMockChannel(),
        options: new Map(),
        deferReply: jest.fn(),
        reply: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
        ...overrides,
    };
}

function createDefaultConfig(): EventRouterConfig {
    return {
        allowedUsers: new Map<PlatformType, Set<string>>([
            ['discord', new Set(['user-1', 'user-2'])],
            ['telegram', new Set(['tg-user-1'])],
        ]),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventRouter', () => {
    describe('isAuthorized', () => {
        it('returns true for allowed users', () => {
            const router = new EventRouter(createDefaultConfig(), {});
            expect(router.isAuthorized('discord', 'user-1')).toBe(true);
            expect(router.isAuthorized('discord', 'user-2')).toBe(true);
            expect(router.isAuthorized('telegram', 'tg-user-1')).toBe(true);
        });

        it('returns false for users not in the allow list', () => {
            const router = new EventRouter(createDefaultConfig(), {});
            expect(router.isAuthorized('discord', 'unknown-user')).toBe(false);
        });

        it('returns false when platform has no allow list', () => {
            const config: EventRouterConfig = {
                allowedUsers: new Map<PlatformType, Set<string>>([
                    ['discord', new Set(['user-1'])],
                ]),
            };
            const router = new EventRouter(config, {});
            // telegram has no entry
            expect(router.isAuthorized('telegram', 'tg-user-1')).toBe(false);
        });
    });

    describe('event filtering', () => {
        it('filters out bot messages (onMessage not called)', async () => {
            const onMessage = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onMessage });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const botMessage = createMockMessage({
                author: createMockUser({ isBot: true, id: 'user-1' }),
            });
            await adapter.capturedEvents!.onMessage!(botMessage);

            expect(onMessage).not.toHaveBeenCalled();
        });

        it('filters out unauthorized users from onMessage', async () => {
            const onMessage = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onMessage });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const msg = createMockMessage({
                author: createMockUser({ id: 'unauthorized-user' }),
            });
            await adapter.capturedEvents!.onMessage!(msg);

            expect(onMessage).not.toHaveBeenCalled();
        });

        it('filters out unauthorized users from onButtonInteraction', async () => {
            const onButtonInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onButtonInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockButtonInteraction({
                user: createMockUser({ id: 'unauthorized-user' }),
            });
            await adapter.capturedEvents!.onButtonInteraction!(interaction);

            expect(onButtonInteraction).not.toHaveBeenCalled();
        });

        it('filters out unauthorized users from onSelectInteraction', async () => {
            const onSelectInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onSelectInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockSelectInteraction({
                user: createMockUser({ id: 'unauthorized-user' }),
            });
            await adapter.capturedEvents!.onSelectInteraction!(interaction);

            expect(onSelectInteraction).not.toHaveBeenCalled();
        });

        it('filters out unauthorized users from onCommandInteraction', async () => {
            const onCommandInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onCommandInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockCommandInteraction({
                user: createMockUser({ id: 'unauthorized-user' }),
            });
            await adapter.capturedEvents!.onCommandInteraction!(interaction);

            expect(onCommandInteraction).not.toHaveBeenCalled();
        });
    });

    describe('event dispatching', () => {
        it('dispatches authorized message to onMessage handler', async () => {
            const onMessage = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onMessage });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const msg = createMockMessage();
            await adapter.capturedEvents!.onMessage!(msg);

            expect(onMessage).toHaveBeenCalledWith(msg);
        });

        it('dispatches authorized button interaction to onButtonInteraction handler', async () => {
            const onButtonInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onButtonInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockButtonInteraction();
            await adapter.capturedEvents!.onButtonInteraction!(interaction);

            expect(onButtonInteraction).toHaveBeenCalledWith(interaction);
        });

        it('dispatches authorized select interaction to onSelectInteraction handler', async () => {
            const onSelectInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onSelectInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockSelectInteraction();
            await adapter.capturedEvents!.onSelectInteraction!(interaction);

            expect(onSelectInteraction).toHaveBeenCalledWith(interaction);
        });

        it('dispatches authorized command interaction to onCommandInteraction handler', async () => {
            const onCommandInteraction = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onCommandInteraction });
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const interaction = createMockCommandInteraction();
            await adapter.capturedEvents!.onCommandInteraction!(interaction);

            expect(onCommandInteraction).toHaveBeenCalledWith(interaction);
        });

        it('does not throw when handler is undefined for an event', async () => {
            const router = new EventRouter(createDefaultConfig(), {});
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            // Should not throw even with no handlers registered
            await expect(
                adapter.capturedEvents!.onMessage!(createMockMessage()),
            ).resolves.toBeUndefined();
        });
    });

    describe('multiple adapters', () => {
        it('can register and start multiple adapters', async () => {
            const router = new EventRouter(createDefaultConfig(), {});
            const discordAdapter = createMockAdapter('discord');
            const telegramAdapter = createMockAdapter('telegram');

            router.registerAdapter(discordAdapter);
            router.registerAdapter(telegramAdapter);
            await router.startAll();

            expect(discordAdapter.startMock).toHaveBeenCalledTimes(1);
            expect(telegramAdapter.startMock).toHaveBeenCalledTimes(1);
        });

        it('events from different adapters are routed independently', async () => {
            const onMessage = jest.fn();
            const router = new EventRouter(createDefaultConfig(), { onMessage });
            const discordAdapter = createMockAdapter('discord');
            const telegramAdapter = createMockAdapter('telegram');

            router.registerAdapter(discordAdapter);
            router.registerAdapter(telegramAdapter);
            await router.startAll();

            const discordMsg = createMockMessage({
                platform: 'discord',
                author: createMockUser({ id: 'user-1', platform: 'discord' }),
            });
            const telegramMsg = createMockMessage({
                platform: 'telegram',
                author: createMockUser({ id: 'tg-user-1', platform: 'telegram' }),
            });

            await discordAdapter.capturedEvents!.onMessage!(discordMsg);
            await telegramAdapter.capturedEvents!.onMessage!(telegramMsg);

            expect(onMessage).toHaveBeenCalledTimes(2);
            expect(onMessage).toHaveBeenCalledWith(discordMsg);
            expect(onMessage).toHaveBeenCalledWith(telegramMsg);
        });
    });

    describe('startAll and stopAll', () => {
        it('startAll calls start on all adapters', async () => {
            const router = new EventRouter(createDefaultConfig(), {});
            const a1 = createMockAdapter('discord');
            const a2 = createMockAdapter('telegram');

            router.registerAdapter(a1);
            router.registerAdapter(a2);
            await router.startAll();

            expect(a1.startMock).toHaveBeenCalledTimes(1);
            expect(a2.startMock).toHaveBeenCalledTimes(1);
        });

        it('stopAll calls stop on all adapters', async () => {
            const router = new EventRouter(createDefaultConfig(), {});
            const a1 = createMockAdapter('discord');
            const a2 = createMockAdapter('telegram');

            router.registerAdapter(a1);
            router.registerAdapter(a2);
            await router.startAll();
            await router.stopAll();

            expect(a1.stopMock).toHaveBeenCalledTimes(1);
            expect(a2.stopMock).toHaveBeenCalledTimes(1);
        });

        it('startAll passes PlatformAdapterEvents to each adapter', async () => {
            const router = new EventRouter(createDefaultConfig(), {});
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const events = adapter.startMock.mock.calls[0][0] as PlatformAdapterEvents;
            expect(events.onReady).toBeDefined();
            expect(events.onMessage).toBeDefined();
            expect(events.onButtonInteraction).toBeDefined();
            expect(events.onSelectInteraction).toBeDefined();
            expect(events.onCommandInteraction).toBeDefined();
            expect(events.onError).toBeDefined();
        });
    });

    describe('onReady and onError', () => {
        it('onReady logs when adapter is ready', async () => {
            const { logger } = jest.requireMock('../../src/utils/logger');
            const router = new EventRouter(createDefaultConfig(), {});
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            adapter.capturedEvents!.onReady!();
            expect(logger.info).toHaveBeenCalledWith('[EventRouter] discord adapter ready');
        });

        it('onError logs adapter errors', async () => {
            const { logger } = jest.requireMock('../../src/utils/logger');
            const router = new EventRouter(createDefaultConfig(), {});
            const adapter = createMockAdapter('discord');
            router.registerAdapter(adapter);
            await router.startAll();

            const error = new Error('connection lost');
            adapter.capturedEvents!.onError!(error);
            expect(logger.error).toHaveBeenCalledWith(
                '[EventRouter] discord error:',
                error,
            );
        });
    });
});
