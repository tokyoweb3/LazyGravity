import { ChannelManager } from '../../src/services/channelManager';
import { ChannelType, Guild, CategoryChannel, TextChannel, Collection } from 'discord.js';

/**
 * Step 8: チャンネル/カテゴリ自動生成ロジックのテスト
 *
 * テスト対象:
 * - 相対パスからDiscordカテゴリ・チャンネルが無ければ作成する
 * - 既存のカテゴリ・チャンネルがあればそのIDを返す
 * - カテゴリ名のサニタイズ（Discord制約への準拠）
 */

// discord.js のオブジェクトをモック化するヘルパー関数
function createMockGuild(existingChannels: Array<{ id: string; name: string; type: ChannelType; parentId?: string | null }>): Guild {
    const channelCollection = new Collection<string, any>();

    for (const ch of existingChannels) {
        channelCollection.set(ch.id, {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parentId ?? null,
            // カテゴリの場合は children プロパティを持つ
            ...(ch.type === ChannelType.GuildCategory ? {
                children: {
                    cache: new Collection<string, any>()
                }
            } : {}),
        });
    }

    const mockGuild = {
        channels: {
            cache: channelCollection,
            create: jest.fn(),
        },
    } as unknown as Guild;

    return mockGuild;
}

describe('ChannelManager', () => {
    let channelManager: ChannelManager;

    beforeEach(() => {
        jest.clearAllMocks();
        channelManager = new ChannelManager();
    });

    describe('ensureChannel - カテゴリが存在しない場合', () => {
        it('新しいカテゴリとテキストチャンネルを作成し、チャンネルIDを返すこと', async () => {
            // 空のギルド（チャンネルなし）
            const mockGuild = createMockGuild([]);

            // カテゴリ作成のモック
            const mockCategory = {
                id: 'cat-new-1',
                name: '🗂️-frontend',
                type: ChannelType.GuildCategory,
            };
            // テキストチャンネル作成のモック
            const mockTextChannel = {
                id: 'ch-new-1',
                name: 'general',
                type: ChannelType.GuildText,
                parentId: 'cat-new-1',
            };

            (mockGuild.channels.create as jest.Mock)
                .mockResolvedValueOnce(mockCategory)   // 1回目: カテゴリ作成
                .mockResolvedValueOnce(mockTextChannel); // 2回目: チャンネル作成

            const result = await channelManager.ensureChannel(mockGuild, 'frontend');

            // カテゴリが作成されること
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '🗂️-frontend',
                    type: ChannelType.GuildCategory,
                })
            );
            // テキストチャンネルがカテゴリ配下に作成されること
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'general',
                    type: ChannelType.GuildText,
                    parent: 'cat-new-1',
                })
            );
            // 戻り値のチャンネルIDが正しいこと
            expect(result).toEqual({
                categoryId: 'cat-new-1',
                channelId: 'ch-new-1',
                created: true,
            });
        });
    });

    describe('ensureChannel - カテゴリが既に存在する場合', () => {
        it('既存のカテゴリ配下にテキストチャンネルがある場合、そのIDを返すこと', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing', name: '🗂️-frontend', type: ChannelType.GuildCategory },
                { id: 'ch-existing', name: 'general', type: ChannelType.GuildText, parentId: 'cat-existing' },
            ]);

            const result = await channelManager.ensureChannel(mockGuild, 'frontend');

            // 既存のIDが返ること
            expect(result).toEqual({
                categoryId: 'cat-existing',
                channelId: 'ch-existing',
                created: false,
            });
            // 新規作成API が呼ばれないこと
            expect(mockGuild.channels.create).not.toHaveBeenCalled();
        });

        it('既存のカテゴリはあるがテキストチャンネルが無い場合、チャンネルのみ作成すること', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing-2', name: '🗂️-backend', type: ChannelType.GuildCategory },
            ]);

            const mockTextChannel = {
                id: 'ch-new-backend',
                name: 'general',
                type: ChannelType.GuildText,
                parentId: 'cat-existing-2',
            };

            (mockGuild.channels.create as jest.Mock)
                .mockResolvedValueOnce(mockTextChannel);

            const result = await channelManager.ensureChannel(mockGuild, 'backend');

            // カテゴリ作成は呼ばれない（テキストチャンネルのみ作成）
            expect(mockGuild.channels.create).toHaveBeenCalledTimes(1);
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'general',
                    type: ChannelType.GuildText,
                    parent: 'cat-existing-2',
                })
            );
            expect(result).toEqual({
                categoryId: 'cat-existing-2',
                channelId: 'ch-new-backend',
                created: true,
            });
        });
    });

    describe('sanitizeCategoryName - カテゴリ名のサニタイズ', () => {
        it('スラッシュをハイフンに変換すること', () => {
            expect(channelManager.sanitizeCategoryName('frontend/src')).toBe('frontend-src');
        });

        it('大文字は小文字に変換すること', () => {
            expect(channelManager.sanitizeCategoryName('MyProject')).toBe('myproject');
        });

        it('末尾のスラッシュを除去すること', () => {
            expect(channelManager.sanitizeCategoryName('frontend/')).toBe('frontend');
        });

        it('連続するハイフンを1つにまとめること', () => {
            expect(channelManager.sanitizeCategoryName('my--project')).toBe('my-project');
        });

        it('Discord チャンネル名で使えない文字を除去すること', () => {
            expect(channelManager.sanitizeCategoryName('my project@v2!')).toBe('my-project-v2');
        });

        it('100文字を超える場合は切り詰めること', () => {
            const longName = 'a'.repeat(150);
            expect(channelManager.sanitizeCategoryName(longName).length).toBeLessThanOrEqual(100);
        });
    });

    describe('ensureCategory', () => {
        it('カテゴリが存在しない場合、新規作成すること', async () => {
            const mockGuild = createMockGuild([]);
            const mockCategory = { id: 'cat-new', name: '🗂️-myproject' };
            (mockGuild.channels.create as jest.Mock).mockResolvedValueOnce(mockCategory);

            const result = await channelManager.ensureCategory(mockGuild, 'myproject');

            expect(result).toEqual({ categoryId: 'cat-new', created: true });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '🗂️-myproject',
                    type: ChannelType.GuildCategory,
                })
            );
        });

        it('カテゴリが既に存在する場合、既存のIDを返すこと', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing', name: '🗂️-myproject', type: ChannelType.GuildCategory },
            ]);

            const result = await channelManager.ensureCategory(mockGuild, 'myproject');

            expect(result).toEqual({ categoryId: 'cat-existing', created: false });
            expect(mockGuild.channels.create).not.toHaveBeenCalled();
        });
    });

    describe('createSessionChannel', () => {
        it('カテゴリ配下にセッションチャンネルを作成すること', async () => {
            const mockGuild = createMockGuild([]);
            const mockChannel = { id: 'ch-session-1', name: 'session-1' };
            (mockGuild.channels.create as jest.Mock).mockResolvedValueOnce(mockChannel);

            const result = await channelManager.createSessionChannel(mockGuild, 'cat-1', 'session-1');

            expect(result).toEqual({ channelId: 'ch-session-1' });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'session-1',
                    type: ChannelType.GuildText,
                    parent: 'cat-1',
                })
            );
        });
    });

    describe('renameChannel', () => {
        it('チャンネル名をリネームすること', async () => {
            const mockSetName = jest.fn().mockResolvedValue(undefined);
            const channelCollection = new Collection<string, any>();
            channelCollection.set('ch-1', { id: 'ch-1', setName: mockSetName });

            const mockGuild = { channels: { cache: channelCollection } } as unknown as Guild;

            await channelManager.renameChannel(mockGuild, 'ch-1', '1-react-auth-bug');

            expect(mockSetName).toHaveBeenCalledWith('1-react-auth-bug');
        });

        it('チャンネルが見つからない場合エラーをスローすること', async () => {
            const mockGuild = createMockGuild([]);

            await expect(
                channelManager.renameChannel(mockGuild, 'nonexistent', 'new-name')
            ).rejects.toThrow('チャンネル nonexistent が見つかりません');
        });
    });

    describe('sanitizeChannelName', () => {
        it('sanitizeCategoryNameと同じ結果を返すこと', () => {
            expect(channelManager.sanitizeChannelName('Hello World')).toBe(
                channelManager.sanitizeCategoryName('Hello World')
            );
        });
    });

    describe('ensureChannel - エラーハンドリング', () => {
        it('Discord API がエラーを返した場合、エラーを伝播すること', async () => {
            const mockGuild = createMockGuild([]);

            (mockGuild.channels.create as jest.Mock)
                .mockRejectedValueOnce(new Error('Discord APIエラー: 権限不足'));

            await expect(
                channelManager.ensureChannel(mockGuild, 'frontend')
            ).rejects.toThrow('Discord APIエラー: 権限不足');
        });

        it('空文字列のワークスペースパスが渡された場合、エラーをスローすること', async () => {
            const mockGuild = createMockGuild([]);

            await expect(
                channelManager.ensureChannel(mockGuild, '')
            ).rejects.toThrow('ワークスペースパスが指定されていません');
        });
    });
});
