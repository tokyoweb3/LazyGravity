import { ChatCommandHandler } from '../../src/commands/chatCommandHandler';
import { ChatSessionService } from '../../src/services/chatSessionService';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChannelManager } from '../../src/services/channelManager';
import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';
import { WorkspaceService } from '../../src/services/workspaceService';
import Database from 'better-sqlite3';

describe('ChatCommandHandler', () => {
    let handler: ChatCommandHandler;
    let mockService: jest.Mocked<ChatSessionService>;
    let mockPool: jest.Mocked<CdpConnectionPool>;
    let db: Database.Database;
    let chatSessionRepo: ChatSessionRepository;
    let bindingRepo: WorkspaceBindingRepository;
    let channelManager: ChannelManager;
    let mockWorkspaceService: jest.Mocked<WorkspaceService>;
    let resolveAccountForChannel: jest.Mock;

    beforeEach(() => {
        mockService = {
            startNewChat: jest.fn().mockResolvedValue({ ok: true }),
            renameCurrentChatInUI: jest.fn().mockResolvedValue({ ok: true }),
            getCurrentSessionInfo: jest.fn(),
        } as any;

        mockPool = {
            getOrConnect: jest.fn(),
            getConnected: jest.fn(),
            getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
            getApprovalDetector: jest.fn(),
            extractProjectName: jest.fn((path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path),
        } as any;

        db = new Database(':memory:');
        chatSessionRepo = new ChatSessionRepository(db);
        bindingRepo = new WorkspaceBindingRepository(db);
        channelManager = new ChannelManager();
        mockWorkspaceService = {
            getWorkspacePath: jest.fn((name: string) => `/tmp/workspaces/${name}`),
            getBaseDir: jest.fn().mockReturnValue('/tmp/workspaces'),
            scanWorkspaces: jest.fn().mockReturnValue([]),
            validatePath: jest.fn((name: string) => `/tmp/workspaces/${name}`),
            ensureBaseDir: jest.fn(),
            exists: jest.fn().mockReturnValue(true),
        } as any;

        resolveAccountForChannel = jest.fn().mockReturnValue('work4');
        handler = new ChatCommandHandler(
            mockService,
            chatSessionRepo,
            bindingRepo,
            channelManager,
            mockWorkspaceService,
            mockPool,
            resolveAccountForChannel,
        );
    });

    afterEach(() => {
        db.close();
    });

    describe('handleNew()', () => {
        it('returns an error when executed outside a server', async () => {
            const interaction = {
                guild: null,
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('can only be used in a server'),
                })
            );
        });

        it('returns an error when executed in a channel that is not under a category', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: null },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('project category channel'),
                })
            );
        });

        it('returns an error when executed in an unbound channel', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'unbound-ch',
                user: { id: 'user-1' },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('project category channel'),
                })
            );
        });

        it('creates a session channel when a new chat is started successfully', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                getPrimaryContextId: jest.fn().mockReturnValue(1),
                call: jest.fn(),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            };
            mockPool.getOrConnect.mockResolvedValue(mockCdp as any);
            mockService.startNewChat.mockResolvedValue({ ok: true });

            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: { get: jest.fn().mockReturnValue(undefined) },
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-2', name: 'session-2' }),
                },
            };

            const interaction = {
                guild: mockGuild,
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockReturnValue(null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/tmp/workspaces/my-proj', { name: 'work4' });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'session-2', parent: 'cat-1' })
            );
            expect(chatSessionRepo.findByChannelId('new-ch-2')?.activeAccountName).toBe('work4');
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Started a new session'),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('returns an error message when starting a new chat in Antigravity fails', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'proj', guildId: 'guild-1' });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            };
            mockPool.getOrConnect.mockResolvedValue(mockCdp as any);
            mockService.startNewChat.mockResolvedValue({ ok: false, error: 'ボタンが見つかりません' });

            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: { get: jest.fn().mockReturnValue(undefined) },
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-2', name: 'session-2' }),
                },
            };

            const interaction = {
                guild: mockGuild,
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockReturnValue(null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            // Session channel is still created even if startNewChat fails
            expect(mockGuild.channels.create).toHaveBeenCalled();
        });

        it('renames the session channel when a name option is provided and successful', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                getPrimaryContextId: jest.fn().mockReturnValue(1),
                call: jest.fn(),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            };
            mockPool.getOrConnect.mockResolvedValue(mockCdp as any);
            mockService.startNewChat.mockResolvedValue({ ok: true });
            mockService.renameCurrentChatInUI.mockResolvedValue({ ok: true });

            const mockChannelSetName = jest.fn().mockResolvedValue(undefined);
            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: { get: jest.fn().mockReturnValue(undefined) },
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-2', name: 'session-2', setName: mockChannelSetName }),
                },
            };

            const interaction = {
                guild: mockGuild,
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockImplementation((opt) => opt === 'name' ? 'custom-name' : null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(mockService.renameCurrentChatInUI).toHaveBeenCalledWith(mockCdp, 'custom-name');
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: '2-custom-name', parent: 'cat-1' })
            );
        });

        it('does not crash if renaming the session channel fails', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                getPrimaryContextId: jest.fn().mockReturnValue(1),
                call: jest.fn(),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            };
            mockPool.getOrConnect.mockResolvedValue(mockCdp as any);
            mockService.startNewChat.mockResolvedValue({ ok: true });
            mockService.renameCurrentChatInUI.mockResolvedValue({ ok: false, error: 'UI failure' });

            const mockChannelSetName = jest.fn().mockRejectedValue(new Error('Discord API failure'));
            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: { get: jest.fn().mockReturnValue(undefined) },
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-2', name: 'session-2', setName: mockChannelSetName }),
                },
            };

            const interaction = {
                guild: mockGuild,
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockImplementation((opt) => opt === 'name' ? 'custom-name' : null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            // Should still complete without throwing an unhandled rejection
            expect(mockService.renameCurrentChatInUI).toHaveBeenCalledWith(mockCdp, 'custom-name');
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: '2-custom-name', parent: 'cat-1' })
            );
        });

        it('returns an error when the pool is not initialized', async () => {
            const handlerNoPool = new ChatCommandHandler(
                mockService,
                chatSessionRepo,
                bindingRepo,
                channelManager,
                mockWorkspaceService,
            );

            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj',
                sessionNumber: 1, guildId: 'guild-1',
            });

            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockReturnValue(null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handlerNoPool.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('CDP pool is not initialized'),
                })
            );
        });

        it('creates a new session from the saved session context even when the channel parent is missing', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1',
                categoryId: 'cat-1',
                workspacePath: 'my-proj',
                sessionNumber: 1,
                activeAccountName: 'work4',
                guildId: 'guild-1',
            });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            };
            mockPool.getOrConnect.mockResolvedValue(mockCdp as any);

            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: { get: jest.fn().mockReturnValue(undefined) },
                    create: jest.fn().mockResolvedValue({ id: 'new-ch-2', name: 'session-2' }),
                },
            };

            const interaction = {
                guild: mockGuild,
                channel: { type: 0, parentId: null },
                channelId: 'ch-1',
                user: { id: 'user-1' },
                options: { getString: jest.fn().mockReturnValue(null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/tmp/workspaces/my-proj', { name: 'work4' });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'session-2', parent: 'cat-1' })
            );
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.any(Array),
                })
            );
        });
    });

    describe('handleChat() — status + list integration', () => {
        it('displays "Non-session channel" error for channels with no bound category', async () => {
            const interaction = {
                channelId: 'unmanaged-ch',
                client: { channels: { fetch: jest.fn().mockResolvedValue(null) } },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleChat(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Chat Session Info'),
                                description: expect.stringContaining('Non-session channel'),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('displays "No active session" error for unbound project channels', async () => {
            bindingRepo.create({ channelId: 'bound-cat-1', workspacePath: 'some-path', guildId: 'guild-1' });

            const interaction = {
                channelId: 'unbound-project-ch',
                client: { channels: { fetch: jest.fn().mockResolvedValue({ parentId: 'bound-cat-1' }) } },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleChat(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Chat Session Info'),
                                description: expect.stringContaining('No active session'),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('displays detailed info and session list for a managed session', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            chatSessionRepo.create({
                channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 2, guildId: 'guild-1',
            });

            const interaction = {
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleChat(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Chat Session Info'),
                                // description should contain the session list
                                description: expect.stringContaining('Sessions:'),
                            }),
                        }),
                    ]),
                })
            );
        });
    });
});
