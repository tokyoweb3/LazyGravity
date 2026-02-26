import { JoinDetachCommandHandler } from '../../src/commands/joinDetachCommandHandler';
import { ChatSessionService, SessionListItem } from '../../src/services/chatSessionService';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChannelManager } from '../../src/services/channelManager';
import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';
import Database from 'better-sqlite3';

describe('JoinDetachCommandHandler', () => {
    let handler: JoinDetachCommandHandler;
    let mockService: jest.Mocked<ChatSessionService>;
    let mockPool: jest.Mocked<CdpConnectionPool>;
    let db: Database.Database;
    let chatSessionRepo: ChatSessionRepository;
    let bindingRepo: WorkspaceBindingRepository;
    let channelManager: ChannelManager;

    const makeMockInteraction = (overrides: Record<string, any> = {}) => ({
        guild: { id: 'guild-1' },
        channel: { type: 0, parentId: 'cat-1', id: 'ch-1' },
        channelId: 'ch-1',
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
            extractDirName: jest.fn((path: string) => path.split('/').filter(Boolean).pop() || path),
        } as any;

        db = new Database(':memory:');
        chatSessionRepo = new ChatSessionRepository(db);
        bindingRepo = new WorkspaceBindingRepository(db);
        channelManager = new ChannelManager();

        handler = new JoinDetachCommandHandler(
            mockService,
            chatSessionRepo,
            bindingRepo,
            channelManager,
            mockPool,
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
                values: ['My Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

            // Should NOT activate session or create channel
            expect(mockService.activateSessionByTitle).not.toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith(
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
                values: ['Brand New Session'],
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            const bridge = { pool: mockPool } as any;

            await handler.handleJoinSelect(interaction as any, bridge);

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
        });

        it('shows error when session activation fails', async () => {
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-project', guildId: 'guild-1' });
            const mockCdp = { isConnected: () => true } as any;
            mockPool.getOrConnect.mockResolvedValue(mockCdp);
            mockService.activateSessionByTitle.mockResolvedValue({ ok: false, error: 'Title not found' });

            const interaction = {
                guild: mockGuild,
                channelId: 'ch-1',
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

    describe('handleDetach()', () => {
        it('shows detach confirmation embed', async () => {
            const interaction = makeMockInteraction();

            await handler.handleDetach(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Detach'),
                            }),
                        }),
                    ]),
                }),
            );
        });
    });
});
