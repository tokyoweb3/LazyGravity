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

    beforeEach(() => {
        mockService = {
            startNewChat: jest.fn(),
            getCurrentSessionInfo: jest.fn(),
        } as any;

        mockPool = {
            getOrConnect: jest.fn(),
            getConnected: jest.fn(),
            getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
            getApprovalDetector: jest.fn(),
            extractDirName: jest.fn((path: string) => path.split('/').filter(Boolean).pop() || path),
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

        handler = new ChatCommandHandler(mockService, chatSessionRepo, bindingRepo, channelManager, mockWorkspaceService, mockPool);
    });

    afterEach(() => {
        db.close();
    });

    describe('handleNew()', () => {
        it('サーバー外で実行した場合エラーを返すこと', async () => {
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

        it('カテゴリ配下でないチャンネルで実行した場合エラーを返すこと', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: null },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('project category channel'),
                })
            );
        });

        it('バインドされていないチャンネルで実行した場合エラーを返すこと', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'unbound-ch',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('project category channel'),
                })
            );
        });

        it('新規チャット開始に成功した場合、セッションチャンネルを作成すること', async () => {
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
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(mockPool.getOrConnect).toHaveBeenCalledWith('/tmp/workspaces/my-proj');
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'session-2', parent: 'cat-1' })
            );
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

        it('Antigravityでの新規チャット開始に失敗した場合エラーメッセージを返すこと', async () => {
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
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            // startNewChat失敗でもセッションチャンネルは作成される
            expect(mockGuild.channels.create).toHaveBeenCalled();
        });

        it('プール未設定の場合エラーを返すこと', async () => {
            const handlerNoPool = new ChatCommandHandler(mockService, chatSessionRepo, bindingRepo, channelManager, mockWorkspaceService);

            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj',
                sessionNumber: 1, guildId: 'guild-1',
            });

            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handlerNoPool.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('CDP pool is not initialized'),
                })
            );
        });
    });

    describe('handleChat() — status + list 統合', () => {
        it('セッション管理外のチャンネルではCDP未接続メッセージを表示すること', async () => {
            const interaction = {
                channelId: 'unmanaged-ch',
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

        it('管理されたセッションの場合、詳細情報とセッション一覧を表示すること', async () => {
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
                                // descriptionにセッション一覧が含まれること
                                description: expect.stringContaining('Sessions:'),
                            }),
                        }),
                    ]),
                })
            );
        });
    });
});
