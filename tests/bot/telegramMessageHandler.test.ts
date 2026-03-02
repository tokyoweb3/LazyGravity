import { createTelegramMessageHandler } from '../../src/bot/telegramMessageHandler';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

jest.mock('../../src/services/cdpBridgeManager', () => ({
    registerApprovalWorkspaceChannel: jest.fn(),
    ensureApprovalDetector: jest.fn(),
    ensureErrorPopupDetector: jest.fn(),
    ensurePlanningDetector: jest.fn(),
}));

jest.mock('../../src/services/responseMonitor', () => ({
    ResponseMonitor: jest.fn().mockImplementation((opts) => ({
        start: jest.fn().mockImplementation(async () => {
            if (opts.onComplete) await opts.onComplete('Response text');
        }),
    })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockChannel(id = 'chat-123') {
    return {
        id,
        platform: 'telegram' as const,
        send: jest.fn().mockResolvedValue({
            id: '1',
            platform: 'telegram' as const,
            channelId: id,
            edit: jest.fn(),
            delete: jest.fn(),
        }),
    };
}

function createMockMessage(overrides: Record<string, unknown> = {}) {
    const channel = createMockChannel();
    return {
        message: {
            id: 'msg-1',
            platform: 'telegram' as const,
            content: 'hello',
            author: {
                id: 'user-1',
                platform: 'telegram' as const,
                username: 'test',
                isBot: false,
            },
            channel,
            attachments: [],
            createdAt: new Date(),
            react: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({
                id: '2',
                platform: 'telegram' as const,
                channelId: 'chat-123',
                edit: jest.fn(),
                delete: jest.fn(),
            }),
            ...overrides,
        },
        channel,
    };
}

function createMockCdp() {
    return {
        injectMessage: jest.fn().mockResolvedValue({ ok: true }),
    };
}

function createMockPool(cdp = createMockCdp()) {
    return {
        getOrConnect: jest.fn().mockResolvedValue(cdp),
        extractProjectName: jest.fn().mockReturnValue('test-project'),
    };
}

function createBridge(pool = createMockPool()) {
    return {
        pool,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        autoAccept: { isEnabled: () => false },
    } as any;
}

function createTelegramBindingRepo(binding?: { chatId: string; workspacePath: string }) {
    return {
        findByChatId: jest.fn().mockReturnValue(binding),
    } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTelegramMessageHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns a function', () => {
        const handler = createTelegramMessageHandler({
            bridge: createBridge(),
            telegramBindingRepo: createTelegramBindingRepo(),
        });
        expect(typeof handler).toBe('function');
    });

    it('does nothing for empty (whitespace-only) messages', async () => {
        const { message } = createMockMessage({ content: '   ' });
        const telegramBindingRepo = createTelegramBindingRepo();

        const handler = createTelegramMessageHandler({
            bridge: createBridge(),
            telegramBindingRepo,
        });

        await handler(message as any);

        expect(telegramBindingRepo.findByChatId).not.toHaveBeenCalled();
        expect(message.reply).not.toHaveBeenCalled();
    });

    it('sends error reply if no workspace binding found for chat', async () => {
        const { message } = createMockMessage();
        const telegramBindingRepo = createTelegramBindingRepo(undefined);

        const handler = createTelegramMessageHandler({
            bridge: createBridge(),
            telegramBindingRepo,
        });

        await handler(message as any);

        expect(telegramBindingRepo.findByChatId).toHaveBeenCalledWith('chat-123');
        expect(message.reply).toHaveBeenCalledWith({
            text: 'No project is linked to this chat. Use /project to bind a workspace.',
        });
    });

    it('connects to CDP and sends prompt', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage({ content: 'test prompt' });

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(pool.getOrConnect).toHaveBeenCalledWith('/workspace/a');
        expect(mockCdp.injectMessage).toHaveBeenCalledWith('test prompt');
    });

    it('calls message.react() after successful CDP connection', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(message.react).toHaveBeenCalledWith('\u{1F440}');
    });

    it('handles CDP connection errors gracefully', async () => {
        const pool = createMockPool();
        pool.getOrConnect.mockRejectedValue(new Error('Connection refused'));
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(message.reply).toHaveBeenCalledWith({
            text: 'Failed to connect to workspace: Connection refused',
        });
        expect(message.react).not.toHaveBeenCalled();
    });

    it('sends error reply when injectMessage fails', async () => {
        const mockCdp = createMockCdp();
        mockCdp.injectMessage.mockResolvedValue({ ok: false, error: 'Inject failed' });
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(message.reply).toHaveBeenCalledWith({
            text: 'Failed to send message: Inject failed',
        });
    });

    it('registers approval workspace channel and starts detectors', async () => {
        const {
            registerApprovalWorkspaceChannel,
            ensureApprovalDetector,
            ensureErrorPopupDetector,
            ensurePlanningDetector,
        } = jest.requireMock('../../src/services/cdpBridgeManager');

        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(registerApprovalWorkspaceChannel).toHaveBeenCalledWith(
            bridge,
            'test-project',
            message.channel,
        );
        expect(ensureApprovalDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project');
        expect(ensureErrorPopupDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project');
        expect(ensurePlanningDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project');
    });

    it('sets lastActiveWorkspace and lastActiveChannel on bridge', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(bridge.lastActiveWorkspace).toBe('test-project');
        expect(bridge.lastActiveChannel).toBe(message.channel);
    });

    it('sends response text via channel.send after ResponseMonitor completes', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message, channel } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(channel.send).toHaveBeenCalledWith({ text: 'Response text' });
    });

    it('sends "(Empty response from Antigravity)" when response is empty', async () => {
        const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');
        ResponseMonitor.mockImplementationOnce((opts: any) => ({
            start: jest.fn().mockImplementation(async () => {
                if (opts.onComplete) await opts.onComplete('');
            }),
        }));

        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message, channel } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        expect(channel.send).toHaveBeenCalledWith({
            text: '(Empty response from Antigravity)',
        });
    });

    it('handles sendTextChunked for long messages (splits at 4096 chars)', async () => {
        // Build a response that exceeds 4096 characters
        const longText = 'A'.repeat(5000);

        const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');
        ResponseMonitor.mockImplementationOnce((opts: any) => ({
            start: jest.fn().mockImplementation(async () => {
                if (opts.onComplete) await opts.onComplete(longText);
            }),
        }));

        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message, channel } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        // 5000 chars -> 2 chunks: 4096 + 904
        expect(channel.send).toHaveBeenCalledTimes(2);
        expect(channel.send).toHaveBeenNthCalledWith(1, { text: 'A'.repeat(4096) });
        expect(channel.send).toHaveBeenNthCalledWith(2, { text: 'A'.repeat(904) });
    });

    it('queues messages for same workspace (serial execution)', async () => {
        const executionOrder: number[] = [];
        const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');

        let callCount = 0;
        ResponseMonitor.mockImplementation((opts: any) => ({
            start: jest.fn().mockImplementation(async () => {
                callCount++;
                const current = callCount;
                // Simulate first message taking longer
                if (current === 1) {
                    await new Promise((r) => setTimeout(r, 30));
                }
                executionOrder.push(current);
                if (opts.onComplete) await opts.onComplete(`Response ${current}`);
            }),
        }));

        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });

        const { message: msg1 } = createMockMessage({ content: 'first' });
        const { message: msg2 } = createMockMessage({ content: 'second' });

        // Fire both without awaiting — they should serialize
        const p1 = handler(msg1 as any);
        const p2 = handler(msg2 as any);
        await Promise.all([p1, p2]);

        // Due to queue serialization, 1 always completes before 2
        expect(executionOrder).toEqual([1, 2]);
    });

    it('does not block subsequent messages when a task fails', async () => {
        const mockCdp = createMockCdp();
        // First call fails, second succeeds
        const pool = createMockPool(mockCdp);
        pool.getOrConnect
            .mockRejectedValueOnce(new Error('first failure'))
            .mockResolvedValueOnce(mockCdp);

        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });

        const { message: msg1 } = createMockMessage({ content: 'first' });
        const { message: msg2 } = createMockMessage({ content: 'second' });

        await handler(msg1 as any);
        await handler(msg2 as any);

        // Second message should still be processed
        expect(mockCdp.injectMessage).toHaveBeenCalledWith('second');
    });

    it('does not crash when react() rejects', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();
        message.react.mockRejectedValue(new Error('react failed'));

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });

        // Should not throw
        await expect(handler(message as any)).resolves.toBeUndefined();
    });
});
