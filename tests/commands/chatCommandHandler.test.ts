import { ChatCommandHandler } from '../../src/commands/chatCommandHandler';
import { ChatSessionService } from '../../src/services/chatSessionService';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChannelManager } from '../../src/services/channelManager';
import Database from 'better-sqlite3';

describe('ChatCommandHandler', () => {
    let handler: ChatCommandHandler;
    let mockService: jest.Mocked<ChatSessionService>;
    let db: Database.Database;
    let chatSessionRepo: ChatSessionRepository;
    let bindingRepo: WorkspaceBindingRepository;
    let channelManager: ChannelManager;

    beforeEach(() => {
        mockService = {
            startNewChat: jest.fn(),
            getCurrentSessionInfo: jest.fn(),
        } as any;

        db = new Database(':memory:');
        chatSessionRepo = new ChatSessionRepository(db);
        bindingRepo = new WorkspaceBindingRepository(db);
        channelManager = new ChannelManager();

        handler = new ChatCommandHandler(mockService, chatSessionRepo, bindingRepo, channelManager);
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
                    content: expect.stringContaining('サーバー内でのみ'),
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
                    content: expect.stringContaining('ワークスペースカテゴリ配下'),
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
                    content: expect.stringContaining('ワークスペースカテゴリ配下'),
                })
            );
        });

        it('新規チャット開始に成功した場合、セッションチャンネルを作成すること', async () => {
            // 既存セッションをセットアップ
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            bindingRepo.upsert({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });

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

            expect(mockService.startNewChat).toHaveBeenCalled();
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'session-2', parent: 'cat-1' })
            );
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('新しいセッション'),
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

            mockService.startNewChat.mockResolvedValue({ ok: false, error: 'ボタンが見つかりません' });

            const interaction = {
                guild: { id: 'guild-1' },
                channel: { type: 0, parentId: 'cat-1' },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleNew(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('ボタンが見つかりません'),
                })
            );
        });
    });

    describe('handleStatus()', () => {
        it('セッション管理外のチャンネルではAntigravity情報を表示すること', async () => {
            mockService.getCurrentSessionInfo.mockResolvedValue({
                title: 'テストチャット',
                hasActiveChat: true,
            });

            const interaction = {
                channelId: 'unmanaged-ch',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleStatus(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('チャットセッション情報'),
                                description: expect.stringContaining('セッション管理外'),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('管理されたセッションの場合、詳細情報を表示すること', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'my-proj',
                sessionNumber: 1, guildId: 'guild-1',
            });

            const interaction = {
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleStatus(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('チャットセッション情報'),
                            }),
                        }),
                    ]),
                })
            );
        });
    });

    describe('handleList()', () => {
        it('カテゴリ配下でないチャンネルで実行した場合エラーを返すこと', async () => {
            const interaction = {
                channel: { parentId: null },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleList(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('ワークスペースカテゴリ配下'),
                })
            );
        });

        it('セッションがない場合、空メッセージを表示すること', async () => {
            const interaction = {
                channel: { parentId: 'cat-1' },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleList(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('セッションが登録されていません'),
                })
            );
        });

        it('セッション一覧をEmbed表示すること', async () => {
            chatSessionRepo.create({
                channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj',
                sessionNumber: 1, guildId: 'guild-1',
            });
            chatSessionRepo.create({
                channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'proj',
                sessionNumber: 2, guildId: 'guild-1',
            });

            const interaction = {
                channel: { parentId: 'cat-1' },
                channelId: 'ch-1',
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleList(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('セッション一覧'),
                            }),
                        }),
                    ]),
                })
            );
        });
    });
});
