import { HeartbeatService, parseInterval, formatDuration, formatRelativeTime } from '../../src/services/heartbeatService';
import { ConfigLoader } from '../../src/utils/configLoader';

jest.mock('../../src/utils/configLoader');

describe('Heartbeat Utility Functions', () => {
    describe('parseInterval', () => {
        it('parses hours correctly', () => {
            expect(parseInterval('1h')).toBe(3600000);
            expect(parseInterval('6h')).toBe(21600000);
        });

        it('parses minutes correctly', () => {
            expect(parseInterval('30m')).toBe(1800000);
            expect(parseInterval('5m')).toBe(300000);
        });

        it('parses seconds correctly', () => {
            expect(parseInterval('10s')).toBe(10000);
        });

        it('parses milliseconds correctly', () => {
            expect(parseInterval('500ms')).toBe(500);
        });

        it('parses days correctly', () => {
            expect(parseInterval('2d')).toBe(172800000);
        });

        it('returns null for pure numbers (unit required)', () => {
            expect(parseInterval('3')).toBeNull();
        });

        it('returns null for invalid format', () => {
            expect(parseInterval('abc')).toBeNull();
            expect(parseInterval('')).toBeNull();
        });
    });

    describe('formatDuration', () => {
        it('formats seconds correctly', () => {
            expect(formatDuration(5000)).toBe('5s');
        });

        it('formats minutes and seconds correctly', () => {
            expect(formatDuration(65000)).toBe('1m 5s');
        });

        it('formats hours, minutes and seconds correctly', () => {
            expect(formatDuration(3665000)).toBe('1h 1m 5s');
        });

        it('formats days, hours, minutes and seconds correctly', () => {
            expect(formatDuration(90065000)).toBe('1d 1h 1m 5s');
        });
    });

    describe('formatRelativeTime', () => {
        it('formats recent events as just now', () => {
            expect(formatRelativeTime(Date.now() - 2000)).toBe('just now');
        });

        it('formats seconds ago correctly', () => {
            expect(formatRelativeTime(Date.now() - 10000)).toBe('10s ago');
        });

        it('formats minutes ago correctly', () => {
            expect(formatRelativeTime(Date.now() - 180000)).toBe('3m ago');
        });

        it('formats hours ago correctly', () => {
            expect(formatRelativeTime(Date.now() - 7200000)).toBe('2h 0m ago');
        });
    });
});

describe('HeartbeatService', () => {
    let service: HeartbeatService;
    let mockClient: any;
    let mockBridge: any;

    beforeEach(() => {
        jest.useFakeTimers();
        service = new HeartbeatService();
        mockClient = {
            user: { id: 'bot-id', tag: 'bot#1234' },
            channels: {
                fetch: jest.fn(),
            },
        };
        mockBridge = {
            pool: {
                getActiveWorkspaceNames: jest.fn().mockReturnValue(['project-a']),
            },
        };
    });

    afterEach(() => {
        service.stop();
        jest.useRealTimers();
        jest.resetAllMocks();
    });

    it('initializes times on init()', () => {
        const now = Date.now();
        service.init(mockClient, mockBridge);
        expect(service.botStartTime).toBeGreaterThanOrEqual(now);
        expect(service.lastActivityTimestamp).toBeGreaterThanOrEqual(now);
    });

    it('updates last activity on recordActivity()', () => {
        service.init(mockClient, mockBridge);
        const originalTime = service.lastActivityTimestamp;
        
        jest.advanceTimersByTime(5000);
        service.recordActivity();
        
        expect(service.lastActivityTimestamp).toBeGreaterThan(originalTime);
    });

    it('does not start heartbeat if disabled in config', () => {
        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: false,
        });

        service.init(mockClient, mockBridge);
        service.start();

        expect(jest.getTimerCount()).toBe(0);
    });

    it('starts heartbeat if enabled in config', () => {
        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-123',
            heartbeatIntervalMs: 15000,
        });

        service.init(mockClient, mockBridge);
        const sendSpy = jest.spyOn(service, 'sendHeartbeat').mockResolvedValue(undefined);

        service.start();

        expect(sendSpy).toHaveBeenCalledTimes(1); // Immediate call
        expect(jest.getTimerCount()).toBe(1);

        jest.advanceTimersByTime(15000);
        expect(sendSpy).toHaveBeenCalledTimes(2);
    });

    it('clamps interval to 10000ms if configured interval is below 10000ms', () => {
        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-123',
            heartbeatIntervalMs: 0,
        });

        service.init(mockClient, mockBridge);
        jest.spyOn(service, 'sendHeartbeat').mockResolvedValue(undefined);

        const logSpy = jest.spyOn(require('../../src/utils/logger').logger, 'info');
        service.start();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('every 10000ms'));
    });

    it('clamps interval to 2147483647ms if configured interval is above 2147483647ms', () => {
        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-123',
            heartbeatIntervalMs: 3000000000,
        });

        service.init(mockClient, mockBridge);
        jest.spyOn(service, 'sendHeartbeat').mockResolvedValue(undefined);

        const logSpy = jest.spyOn(require('../../src/utils/logger').logger, 'info');
        service.start();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('every 2147483647ms'));
    });

    it('stops interval on stop()', () => {
        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-123',
            heartbeatIntervalMs: 15000,
        });

        service.init(mockClient, mockBridge);
        jest.spyOn(service, 'sendHeartbeat').mockResolvedValue(undefined);

        service.start();
        expect(jest.getTimerCount()).toBe(1);

        service.stop();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('disables heartbeat on disable() and deletes old message', async () => {
        const mockDelete = jest.fn().mockResolvedValue(true);
        const mockMessage = {
            id: 'msg-abc',
            author: { id: 'bot-id' },
            delete: mockDelete,
        };
        const mockChannel = {
            isTextBased: () => true,
            messages: {
                fetch: jest.fn().mockResolvedValue(mockMessage),
            },
        };
        mockClient.channels.fetch.mockResolvedValue(mockChannel);

        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-123',
            heartbeatLastMessageId: 'msg-abc',
        });

        service.init(mockClient, mockBridge);
        await service.disable();

        expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');
        expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-abc');
        expect(mockDelete).toHaveBeenCalled();

        expect(ConfigLoader.save).toHaveBeenCalledWith({
            heartbeatEnabled: false,
            heartbeatLastMessageId: undefined,
        });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('deletes old message when channel changes on updateConfig()', async () => {
        const mockDelete = jest.fn().mockResolvedValue(true);
        const mockMessage = {
            id: 'msg-abc',
            author: { id: 'bot-id' },
            delete: mockDelete,
        };
        const mockChannel = {
            isTextBased: () => true,
            messages: {
                fetch: jest.fn().mockResolvedValue(mockMessage),
            },
        };
        mockClient.channels.fetch.mockResolvedValue(mockChannel);

        (ConfigLoader.load as jest.Mock).mockReturnValue({
            heartbeatEnabled: true,
            heartbeatChannelId: 'channel-old',
            heartbeatLastMessageId: 'msg-abc',
        });

        service.init(mockClient, mockBridge);
        await service.updateConfig(true, 30000, 'channel-new');

        expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-old');
        expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-abc');
        expect(mockDelete).toHaveBeenCalled();

        expect(ConfigLoader.save).toHaveBeenCalledWith({
            heartbeatLastMessageId: undefined,
        });
        expect(ConfigLoader.save).toHaveBeenCalledWith({
            heartbeatEnabled: true,
            heartbeatIntervalMs: 30000,
            heartbeatChannelId: 'channel-new',
        });
    });

    describe('sendHeartbeat', () => {
        let mockChannel: any;
        let mockMessage: any;

        beforeEach(() => {
            mockMessage = {
                id: 'msg-abc',
                author: { id: 'bot-id' },
                edit: jest.fn().mockResolvedValue(true),
            };
            mockChannel = {
                isTextBased: jest.fn().mockReturnValue(true),
                send: jest.fn().mockResolvedValue(mockMessage),
                messages: {
                    fetch: jest.fn().mockResolvedValue(mockMessage),
                },
            };
            mockClient.channels.fetch.mockResolvedValue(mockChannel);
        });

        it('sends a new message if no lastMessageId is configured', async () => {
            (ConfigLoader.load as jest.Mock).mockReturnValue({
                heartbeatEnabled: true,
                heartbeatChannelId: 'channel-123',
            });

            service.init(mockClient, mockBridge);
            await service.sendHeartbeat();

            expect(mockChannel.send).toHaveBeenCalled();
            expect(ConfigLoader.save).toHaveBeenCalledWith({
                heartbeatLastMessageId: 'msg-abc',
            });
        });

        it('edits existing message in-place if lastMessageId is configured and message matches author', async () => {
            (ConfigLoader.load as jest.Mock).mockReturnValue({
                heartbeatEnabled: true,
                heartbeatChannelId: 'channel-123',
                heartbeatLastMessageId: 'msg-abc',
            });

            service.init(mockClient, mockBridge);
            await service.sendHeartbeat();

            expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-abc');
            expect(mockMessage.edit).toHaveBeenCalled();
            expect(mockChannel.send).not.toHaveBeenCalled();
        });

        it('sends new message if lastMessageId fails to fetch', async () => {
            (ConfigLoader.load as jest.Mock).mockReturnValue({
                heartbeatEnabled: true,
                heartbeatChannelId: 'channel-123',
                heartbeatLastMessageId: 'msg-abc',
            });
            mockChannel.messages.fetch.mockRejectedValue(new Error('not found'));

            service.init(mockClient, mockBridge);
            await service.sendHeartbeat();

            expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-abc');
            expect(mockChannel.send).toHaveBeenCalled();
            expect(ConfigLoader.save).toHaveBeenCalledWith({
                heartbeatLastMessageId: 'msg-abc',
            });
        });
        it('aborts sending and discards result if generation token changes (stale generation)', async () => {
            (ConfigLoader.load as jest.Mock).mockReturnValue({
                heartbeatEnabled: true,
                heartbeatChannelId: 'channel-123',
            });

            // Stub channels.fetch to mock a delay and check generation token
            mockClient.channels.fetch.mockImplementation(async () => {
                // Manually trigger a stop/generation increase while fetch is in-flight
                service.stop();
                return mockChannel;
            });

            service.init(mockClient, mockBridge);
            await service.sendHeartbeat();

            // Expected: should abort and NOT call channel.send or ConfigLoader.save
            expect(mockChannel.send).not.toHaveBeenCalled();
            expect(ConfigLoader.save).not.toHaveBeenCalledWith({
                heartbeatLastMessageId: expect.any(String),
            });
        });

        it('queues a follow-up send and executes it immediately when reconfigured while channels.fetch is pending', async () => {
            (ConfigLoader.load as jest.Mock).mockReturnValue({
                heartbeatEnabled: true,
                heartbeatChannelId: 'channel-123',
                heartbeatIntervalMs: 15000,
            });

            // Simulate delayed fetch
            let resolveFetch: (value: any) => void = () => {};
            const fetchPromise = new Promise((resolve) => {
                resolveFetch = resolve;
            });
            mockClient.channels.fetch.mockReturnValue(fetchPromise);

            service.init(mockClient, mockBridge);
            
            // Start the first heartbeat (this sets isSending to true and calls fetch)
            const firstSendPromise = service.sendHeartbeat();

            expect((service as any).isSending).toBe(true);

            // Reconfigure/restart while first fetch is pending
            const updatePromise = service.updateConfig(true, 15000, 'channel-123');

            // Wait a tiny bit to let promises resolve/tick
            await Promise.resolve();

            // Next send should be queued
            expect((service as any).nextSendQueued).toBe(true);

            // Now resolve the first fetch
            resolveFetch(mockChannel);

            // Let the first call finish
            await firstSendPromise;

            // Wait for updateConfig to finish
            await updatePromise;

            // By now, the first send should have aborted due to stale generation,
            // and the queued send should have started and resolved.
            // Since mockChannel is returned, the new/queued heartbeat send should have called channel.send!
            expect(mockChannel.send).toHaveBeenCalled();
            expect(ConfigLoader.save).toHaveBeenCalledWith({
                heartbeatLastMessageId: 'msg-abc',
            });
        });
    });
});
