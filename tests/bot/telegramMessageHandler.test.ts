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
        prompt: jest.fn(),
        divider: jest.fn(),
    },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    registerApprovalWorkspaceChannel: jest.fn(),
    ensureApprovalDetector: jest.fn(),
    ensureErrorPopupDetector: jest.fn(),
    ensurePlanningDetector: jest.fn(),
    ensureRunCommandDetector: jest.fn(),
    getCurrentCdp: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/responseMonitor', () => ({
    captureResponseMonitorBaseline: jest.fn().mockResolvedValue({
        text: null,
        processLogKeys: [],
    }),
    ResponseMonitor: jest.fn().mockImplementation((opts) => ({
        start: jest.fn().mockImplementation(async () => {
            if (opts.onComplete) await opts.onComplete('Response text');
        }),
    })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSentMessage(id = '1', channelId = 'chat-123') {
    return {
        id,
        platform: 'telegram' as const,
        channelId,
        edit: jest.fn().mockResolvedValue({
            id,
            platform: 'telegram' as const,
            channelId,
            edit: jest.fn(),
            delete: jest.fn(),
        }),
        delete: jest.fn().mockResolvedValue(undefined),
    };
}

function createMockChannel(id = 'chat-123') {
    const statusMsg = createMockSentMessage('status-1', id);
    return {
        id,
        platform: 'telegram' as const,
        send: jest.fn().mockResolvedValue(statusMsg),
        _statusMsg: statusMsg,
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
        getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
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

        expect(pool.getOrConnect).toHaveBeenCalledWith('/workspace/a', { name: 'default' });
        expect(mockCdp.injectMessage).toHaveBeenCalledWith('test prompt');
    });

    it('restores the saved account preference when reconnecting Telegram after restart', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        bridge.selectedAccountByChannel = new Map();
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const channelPrefRepo = { getAccountName: jest.fn().mockReturnValue('work1') } as any;
        const accountPrefRepo = { getAccountName: jest.fn().mockReturnValue('default') } as any;
        const { message } = createMockMessage({ content: 'test prompt' });

        const handler = createTelegramMessageHandler({
            bridge,
            telegramBindingRepo,
            channelPrefRepo,
            accountPrefRepo,
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        });
        await handler(message as any);

        expect(channelPrefRepo.getAccountName).toHaveBeenCalledWith('chat-123');
        expect(pool.getOrConnect).toHaveBeenCalledWith('/workspace/a', { name: 'work1' });
        expect(bridge.selectedAccountByChannel.get('chat-123')).toBe('work1');
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
            ensureRunCommandDetector,
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
        expect(ensureApprovalDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project', 'default');
        expect(ensureErrorPopupDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project', 'default');
        expect(ensurePlanningDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project', 'default');
        expect(ensureRunCommandDetector).toHaveBeenCalledWith(bridge, mockCdp, 'test-project', 'default');
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

        // First call is status message "Processing...", second is the response
        expect(channel.send).toHaveBeenCalledWith({ text: 'Processing...' });
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
        // Status message should be deleted when empty response + no logs
        expect(channel._statusMsg.delete).toHaveBeenCalled();
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

        // 1 status message + 2 response chunks (5000 chars -> 4096 + 904)
        expect(channel.send).toHaveBeenCalledTimes(3);
        expect(channel.send).toHaveBeenNthCalledWith(1, { text: 'Processing...' });
        expect(channel.send).toHaveBeenNthCalledWith(2, { text: 'A'.repeat(4096) });
        expect(channel.send).toHaveBeenNthCalledWith(3, { text: 'A'.repeat(904) });
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

    it('intercepts /project command and does not reach CDP path', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const telegramBindingRepo = createTelegramBindingRepo();
        const workspaceService = { scanWorkspaces: jest.fn().mockReturnValue(['proj-a']) } as any;
        const { message } = createMockMessage({ content: '/project' });

        const handler = createTelegramMessageHandler({
            bridge,
            telegramBindingRepo,
            workspaceService,
        });
        await handler(message as any);

        // /project should be handled by project command, NOT reach CDP
        expect(pool.getOrConnect).not.toHaveBeenCalled();
        expect(mockCdp.injectMessage).not.toHaveBeenCalled();
        // Should reply with workspace list (via project command handler)
        expect(message.reply).toHaveBeenCalled();
    });

    it('sends a "Processing..." status message before monitoring', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message, channel } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        // First call to channel.send should be the status message
        expect(channel.send).toHaveBeenNthCalledWith(1, { text: 'Processing...' });
    });

    it('edits status message with activity log from onProcessLog', async () => {
        const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');
        ResponseMonitor.mockImplementationOnce((opts: any) => ({
            start: jest.fn().mockImplementation(async () => {
                // Simulate onProcessLog being called before onComplete
                if (opts.onProcessLog) opts.onProcessLog('Reading file.ts');
                if (opts.onComplete) await opts.onComplete('Done response');
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

        // Status message should have been edited with activity log
        expect(channel._statusMsg.edit).toHaveBeenCalled();
        const editCall = channel._statusMsg.edit.mock.calls[0][0];
        expect(editCall.text).toContain('Reading file.ts');
    });

    it('calls logger.divider on completion with process log', async () => {
        const { logger: mockLogger } = jest.requireMock('../../src/utils/logger');

        const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');
        ResponseMonitor.mockImplementationOnce((opts: any) => ({
            start: jest.fn().mockImplementation(async () => {
                if (opts.onProcessLog) opts.onProcessLog('Reading file.ts');
                if (opts.onComplete) await opts.onComplete('Final output');
            }),
        }));

        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage();

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        // logger.divider should have been called for process log + output + final
        expect(mockLogger.divider).toHaveBeenCalledWith('Process Log');
        expect(mockLogger.divider).toHaveBeenCalledWith(expect.stringContaining('Output'));
    });

    it('does not intercept /project when workspaceService is not provided', async () => {
        const { message } = createMockMessage({ content: '/project' });
        const telegramBindingRepo = createTelegramBindingRepo(undefined);

        const handler = createTelegramMessageHandler({
            bridge: createBridge(),
            telegramBindingRepo,
            // workspaceService intentionally omitted
        });
        await handler(message as any);

        // Falls through to normal binding check → "No project is linked"
        expect(telegramBindingRepo.findByChatId).toHaveBeenCalled();
        expect(message.reply).toHaveBeenCalledWith({
            text: 'No project is linked to this chat. Use /project to bind a workspace.',
        });
    });

    it.each(['/help', '/status', '/stop', '/ping', '/start'])(
        'intercepts %s command and does not reach CDP path',
        async (cmd) => {
            const mockCdp = createMockCdp();
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const telegramBindingRepo = createTelegramBindingRepo({
                chatId: 'chat-123',
                workspacePath: '/workspace/a',
            });
            const { message } = createMockMessage({ content: cmd });

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
            await handler(message as any);

            // Built-in commands should NOT reach CDP
            expect(pool.getOrConnect).not.toHaveBeenCalled();
            expect(mockCdp.injectMessage).not.toHaveBeenCalled();
            // Should reply with command-specific text
            expect(message.reply).toHaveBeenCalled();
        },
    );

    describe('mode push to Antigravity on CDP connect', () => {
        it('pushes ModeService mode to Antigravity on connect', async () => {
            const mockCdp = {
                ...createMockCdp(),
                setUiMode: jest.fn().mockResolvedValue({ ok: true }),
            };
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
            const telegramBindingRepo = createTelegramBindingRepo(binding);
            const modeService = {
                getCurrentMode: jest.fn().mockReturnValue('fast'),
                markSynced: jest.fn(),
            } as any;
            const { message } = createMockMessage();

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo, modeService });
            await handler(message as any);

            expect(mockCdp.setUiMode).toHaveBeenCalledWith('fast');
            expect(modeService.markSynced).toHaveBeenCalled();
        });

        it('pushes user-selected mode (plan) to Antigravity', async () => {
            const mockCdp = {
                ...createMockCdp(),
                setUiMode: jest.fn().mockResolvedValue({ ok: true }),
            };
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
            const telegramBindingRepo = createTelegramBindingRepo(binding);
            const modeService = {
                getCurrentMode: jest.fn().mockReturnValue('plan'),
                markSynced: jest.fn(),
            } as any;
            const { message } = createMockMessage();

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo, modeService });
            await handler(message as any);

            expect(mockCdp.setUiMode).toHaveBeenCalledWith('plan');
            expect(modeService.markSynced).toHaveBeenCalled();
        });

        it('does not crash when mode push fails', async () => {
            const mockCdp = {
                ...createMockCdp(),
                setUiMode: jest.fn().mockResolvedValue({ ok: false, error: 'mode not found' }),
            };
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
            const telegramBindingRepo = createTelegramBindingRepo(binding);
            const modeService = {
                getCurrentMode: jest.fn().mockReturnValue('plan'),
                markSynced: jest.fn(),
            } as any;
            const { message } = createMockMessage();

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo, modeService });
            await expect(handler(message as any)).resolves.toBeUndefined();

            expect(mockCdp.setUiMode).toHaveBeenCalledWith('plan');
            expect(modeService.markSynced).not.toHaveBeenCalled();
        });

        it('does not attempt sync when modeService is not provided', async () => {
            const mockCdp = {
                ...createMockCdp(),
                setUiMode: jest.fn(),
            };
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
            const telegramBindingRepo = createTelegramBindingRepo(binding);
            const { message } = createMockMessage();

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
            await handler(message as any);

            expect(mockCdp.setUiMode).not.toHaveBeenCalled();
        });
    });

    describe('activeMonitors registration', () => {
        it('registers monitor in activeMonitors map during response monitoring', async () => {
            const { ResponseMonitor } = jest.requireMock('../../src/services/responseMonitor');
            ResponseMonitor.mockImplementationOnce((opts: any) => {
                const monitor = {
                    start: jest.fn().mockImplementation(async () => {
                        if (opts.onComplete) await opts.onComplete('Response');
                    }),
                };
                return monitor;
            });

            const mockCdp = createMockCdp();
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
            const telegramBindingRepo = createTelegramBindingRepo(binding);
            const activeMonitors = new Map<string, any>();
            const { message } = createMockMessage();

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo, activeMonitors });
            await handler(message as any);

            // After completion, monitor should have been removed from the map
            expect(activeMonitors.size).toBe(0);
        });

        it('passes activeMonitors to command handler for /stop access', async () => {
            const mockCdp = createMockCdp();
            const pool = createMockPool(mockCdp);
            const bridge = createBridge(pool);
            const telegramBindingRepo = createTelegramBindingRepo({
                chatId: 'chat-123',
                workspacePath: '/workspace/a',
            });
            const activeMonitors = new Map<string, any>();
            const { message } = createMockMessage({ content: '/stop' });

            const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo, activeMonitors });
            await handler(message as any);

            // /stop is intercepted as a command — CDP path not reached
            expect(pool.getOrConnect).not.toHaveBeenCalled();
        });
    });

    it('forwards unknown slash commands to Antigravity as normal messages', async () => {
        const mockCdp = createMockCdp();
        const pool = createMockPool(mockCdp);
        const bridge = createBridge(pool);
        const binding = { chatId: 'chat-123', workspacePath: '/workspace/a' };
        const telegramBindingRepo = createTelegramBindingRepo(binding);
        const { message } = createMockMessage({ content: '/unknown_command' });

        const handler = createTelegramMessageHandler({ bridge, telegramBindingRepo });
        await handler(message as any);

        // Unknown commands should be forwarded to Antigravity via CDP
        expect(pool.getOrConnect).toHaveBeenCalled();
        expect(mockCdp.injectMessage).toHaveBeenCalledWith('/unknown_command');
    });
});
