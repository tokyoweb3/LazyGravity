import { JoinCommandHandler } from '../../src/commands/joinCommandHandler';
import { ChatSessionService, SessionListItem } from '../../src/services/chatSessionService';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChannelManager } from '../../src/services/channelManager';
import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';
import { WorkspaceService } from '../../src/services/workspaceService';
import Database from 'better-sqlite3';
import { ensureUserMessageDetector } from '../../src/services/cdpBridgeManager';

// Mock ensureUserMessageDetector and getCurrentChatTitle to prevent real polling in tests
jest.mock('../../src/services/cdpBridgeManager', () => ({
    ...jest.requireActual('../../src/services/cdpBridgeManager'),
    ensureUserMessageDetector: jest.fn(),
    getCurrentChatTitle: jest.fn().mockResolvedValue(null),
}));

// Mock ResponseMonitor to prevent real polling in tests
jest.mock('../../src/services/responseMonitor', () => ({
    ResponseMonitor: jest.fn().mockImplementation(() => ({
        startPassive: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        isActive: jest.fn().mockReturnValue(false),
    })),
}));

describe('JoinCommandHandler', () => {
    let handler: JoinCommandHandler;
    let mockService: jest.Mocked<ChatSessionService>;
    let mockPool: jest.Mocked<CdpConnectionPool>;
    let mockWorkspaceService: jest.Mocked<WorkspaceService>;
    let mockClient: any;
    let db: Database.Database;
    let chatSessionRepo: ChatSessionRepository;
    let bindingRepo: WorkspaceBindingRepository;
    let channelManager: ChannelManager;
    let resolveAccountForChannel: jest.Mock;

    const makeMockInteraction = (overrides: Record<string, any> = {}) => ({
        guild: { id: 'guild-1' },
        channel: { type: 0, parentId: 'cat-1', id: 'ch-1' },
        channelId: 'ch-1',
        user: { id: 'user-1' },
        editReply: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    });

    beforeEach(() => {
        mockService = {
            startNewChat: jest.fn(),
            getCurrentSessionInfo: jest.fn(),
            activateSessionByTitle: jest.fn(),
            listAllSessions: jest.fn(),
        } as any;

        mockPool = {
            getOrConnect: jest.fn(),
            getConnected: jest.fn(),
            getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
            getApprovalDetector: jest.fn(),
            getUserMessageDetector: jest.fn(),
            registerUserMessageDetector: jest.fn(),
            extractProjectName: jest.fn((path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path),
        } as any;

        mockWorkspaceService = {
            getWorkspacePath: jest.fn((name: string) => `/workspace/base/${name}`),
            getBaseDir: jest.fn().mockReturnValue('/workspace/base'),
            exists: jest.fn().mockReturnValue(true),
            validatePath: jest.fn((name: string) => `/workspace/base/${name}`),
            scanWorkspaces: jest.fn().mockReturnValue([]),
            ensureBaseDir: jest.fn(),
        } as any;

        mockClient = {
            channels: {
                cache: { get: jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue(undefined) }) },
            },
        };

        db = new Database(':memory:');
        chatSessionRepo = new ChatSessionRepository(db);
        bindingRepo = new WorkspaceBindingRepository(db);
        channelManager = new ChannelManager();
        resolveAccountForChannel = jest.fn().mockReturnValue('work4');

        handler = new JoinCommandHandler(
            mockService,
            chatSessionRepo,
            bindingRepo,
            channelManager,
            mockPool,
            mockWorkspaceService,
            mockClient,
            undefined,
            resolveAccountForChannel,
        );
    });

    afterEach(() => {
        db.close();
    });

    describe('handleJoin()', () => {
        it('returns error when no workspace is bound to channel', async () => {
            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool, lastActiveWorkspace: null } as any;

            await handler.handleJoin(interaction as any, bridge);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('project'),
                }),
            );
        });

        it('returns error when CDP connection fails', async () => {
            // Bind a workspace to this channel
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            mockPool.getOrConnect.mockRejectedValue(new Error('WebSocket connection refused'));

            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool, lastActiveWorkspace: null } as any;

            await handler.handleJoin(interaction as any, bridge);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('Failed to connect'),
                }),
            );
        });

        it('shows session picker when sessions are found', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);

            const sessions: SessionListItem[] = [
                { title: 'Fix bug', isActive: true },
                { title: 'Add feature', isActive: false },
            ];
            mockService.listAllSessions.mockResolvedValue(sessions);

            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool, lastActiveWorkspace: null } as any;

            await handler.handleJoin(interaction as any, bridge);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/workspace/base/my-project', { name: 'work4' });

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.any(Array),
                    components: expect.any(Array),
                }),
            );
        });

        it('returns message when no sessions found', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.listAllSessions.mockResolvedValue([]);

            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool, lastActiveWorkspace: null } as any;

            await handler.handleJoin(interaction as any, bridge);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                description: expect.stringContaining('No sessions'),
                            }),
                        }),
                    ]),
                }),
            );
        });
    });

    describe('handleJoinSelect()', () => {
        const mockGuild = {
            id: 'guild-1',
            channels: {
                cache: { find: jest.fn() },
                fetch: jest.fn().mockResolvedValue({ find: jest.fn() }),
                create: jest.fn().mockResolvedValue({ id: 'new-ch-99' }),
            },
        };

        it('redirects to existing channel when session already has a channel', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            // Create an existing session with the same displayName
            chatSessionRepo.create({
                channelId: 'ch-existing',
                categoryId: 'cat-1',
                workspacePath: 'my-project',
                sessionNumber: 1,
                guildId: 'guild-1',
            });
            chatSessionRepo.updateDisplayName('ch-existing', 'My Session');

            const interaction = {
                guild: mockGuild,
                channelId: 'ch-1',
                user: { id: 'user-1' },
                values: ['My Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            // Ensure fetch returns a channel so the existing flow works
            const interactionWithFetch = {
                ...interaction,
                guild: {
                    ...mockGuild,
                    channels: {
                        ...mockGuild.channels,
                        fetch: jest.fn().mockResolvedValue({ id: 'ch-existing', name: 'My Session' }),
                    },
                },
            };

            await handler.handleJoinSelect(interactionWithFetch as any, bridge);

            // Should NOT activate session or create channel
            expect(mockService.activateSessionByTitle).not.toHaveBeenCalled();
            expect(interactionWithFetch.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                description: expect.stringContaining('ch-existing'),
                            }),
                        }),
                    ]),
                }),
            );
        });

        it('cleans up stale channel and creates new one when session channel was deleted', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            chatSessionRepo.create({
                channelId: 'deleted-ch',
                categoryId: 'cat-1',
                workspacePath: 'my-project',
                sessionNumber: 1,
                guildId: 'guild-1',
            });
            chatSessionRepo.updateDisplayName('deleted-ch', 'Lost Session');

            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.activateSessionByTitle.mockResolvedValue({ ok: true });

            // Mock guild where fetch REJECTS (channel deleted) and then creates a new one
            const guildWithCreate = {
                ...mockGuild,
                channels: {
                    ...mockGuild.channels,
                    fetch: jest.fn().mockImplementation((id) => {
                        if (id === 'deleted-ch') return Promise.reject(new Error('Unknown Channel'));
                        return Promise.resolve({ find: jest.fn() });
                    }),
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-43' }),
                },
            };

            const interaction = {
                guild: guildWithCreate,
                channelId: 'ch-1',
                user: { id: 'user-1' },
                values: ['Lost Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

            // Stale binding/session should be cleaned up
            expect(bindingRepo.findByChannelId('deleted-ch')).toBeUndefined();
            expect(chatSessionRepo.findByChannelId('deleted-ch')).toBeUndefined();

            // New channel/session should be created
            expect(mockService.activateSessionByTitle).toHaveBeenCalledWith(mockCdp, 'Lost Session');
            expect(guildWithCreate.channels.create).toHaveBeenCalled();
            expect(bindingRepo.findByChannelId('new-ch-43')?.workspacePath).toBe('my-project');
            expect(chatSessionRepo.findByChannelId('new-ch-43')?.displayName).toBe('Lost Session');
            expect(chatSessionRepo.findByChannelId('new-ch-43')?.activeAccountName).toBe('work4');
        });

        it('creates new channel and binds session when no channel exists', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.activateSessionByTitle.mockResolvedValue({ ok: true });

            // Mock guild channel creation
            const guildWithCreate = {
                ...mockGuild,
                channels: {
                    ...mockGuild.channels,
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-42' }),
                },
            };

            const interaction = {
                guild: guildWithCreate,
                channelId: 'ch-1',
                user: { id: 'user-1' },
                values: ['Brand New Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/workspace/base/my-project', { name: 'work4' });
            expect(mockService.activateSessionByTitle).toHaveBeenCalledWith(mockCdp, 'Brand New Session');
            // Verify channel was created
            expect(guildWithCreate.channels.create).toHaveBeenCalled();
            // Verify binding was created
            const binding = bindingRepo.findByChannelId('new-ch-42');
            expect(binding?.workspacePath).toBe('my-project');
            // Verify session was created with displayName
            const session = chatSessionRepo.findByChannelId('new-ch-42');
            expect(session?.displayName).toBe('Brand New Session');
            expect(session?.isRenamed).toBe(true);
            expect(session?.activeAccountName).toBe('work4');
        });

        it('stops existing detector before starting mirroring (force re-prime)', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.activateSessionByTitle.mockResolvedValue({ ok: true });

            // Set up an active detector that should be stopped
            const mockDetector = { isActive: jest.fn().mockReturnValue(true), stop: jest.fn() };
            mockPool.getUserMessageDetector.mockReturnValue(mockDetector as any);

            const guildWithCreate = {
                ...mockGuild,
                channels: {
                    ...mockGuild.channels,
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-55' }),
                },
            };

            const interaction = {
                guild: guildWithCreate,
                channelId: 'ch-1',
                user: { id: 'user-1' },
                values: ['Session After Switch'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

            // Verify existing detector was stopped before ensureUserMessageDetector
            expect(mockDetector.stop).toHaveBeenCalled();
        });

        it('shows error when session activation fails', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.activateSessionByTitle.mockResolvedValue({ ok: false, error: 'Title not found' });

            const interaction = {
                guild: mockGuild,
                channelId: 'ch-1',
                user: { id: 'user-1' },
                values: ['Missing Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('Title not found'),
                }),
            );
        });
    });

    describe('handleMirror()', () => {
        it('turns mirroring OFF when detector is active', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockDetector = { isActive: jest.fn().mockReturnValue(true), stop: jest.fn() };
            mockPool.getUserMessageDetector.mockReturnValue(mockDetector as any);

            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool } as any;

            await handler.handleMirror(interaction as any, bridge);

            expect(mockPool.getUserMessageDetector).toHaveBeenCalledWith('my-project', 'work4');
            expect(mockDetector.stop).toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('OFF'),
                            }),
                        }),
                    ]),
                }),
            );
        });

        it('turns mirroring ON when no detector is active', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            mockPool.getUserMessageDetector.mockReturnValue(undefined);
            const mockCdp = { isConnected: () => true, getPrimaryContextId: () => 42 } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);

            const interaction = makeMockInteraction();
            const bridge = { pool: mockPool } as any;

            await handler.handleMirror(interaction as any, bridge);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/workspace/base/my-project', { name: 'work4' });
            expect(ensureUserMessageDetector).toHaveBeenCalledWith(
                bridge,
                mockCdp,
                'my-project',
                expect.any(Function),
                'work4',
            );
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('ON'),
                            }),
                        }),
                    ]),
                }),
            );
        });
    });
});
