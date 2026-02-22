import Database from 'better-sqlite3';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';

describe('ChatSessionRepository', () => {
    let db: Database.Database;
    let repo: ChatSessionRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        repo = new ChatSessionRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('テーブル初期化', () => {
        it('初期化時にchat_sessionsテーブルが作成されること', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - セッションの作成', () => {
        it('セッションを作成しIDを返すこと', () => {
            const result = repo.create({
                channelId: 'ch-1',
                categoryId: 'cat-1',
                workspacePath: 'my-project',
                sessionNumber: 1,
                guildId: 'guild-1',
            });
            expect(result.id).toBeDefined();
            expect(result.channelId).toBe('ch-1');
            expect(result.categoryId).toBe('cat-1');
            expect(result.workspacePath).toBe('my-project');
            expect(result.sessionNumber).toBe(1);
            expect(result.displayName).toBeNull();
            expect(result.isRenamed).toBe(false);
            expect(result.guildId).toBe('guild-1');
        });

        it('同じチャンネルIDで重複作成はエラーになること', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            expect(() => {
                repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 2, guildId: 'guild-1' });
            }).toThrow();
        });
    });

    describe('findByChannelId', () => {
        it('存在するセッションを取得できること', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            const found = repo.findByChannelId('ch-1');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('proj');
            expect(found?.isRenamed).toBe(false);
        });

        it('存在しないチャンネルIDの場合はundefinedを返すこと', () => {
            expect(repo.findByChannelId('nonexistent')).toBeUndefined();
        });
    });

    describe('findByCategoryId', () => {
        it('同一カテゴリのセッションをセッション番号順で取得できること', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 2, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-3', categoryId: 'cat-2', workspacePath: 'other', sessionNumber: 1, guildId: 'guild-1' });

            const results = repo.findByCategoryId('cat-1');
            expect(results).toHaveLength(2);
            expect(results[0].sessionNumber).toBe(1);
            expect(results[1].sessionNumber).toBe(2);
        });

        it('セッションが無い場合は空配列を返すこと', () => {
            expect(repo.findByCategoryId('nonexistent')).toEqual([]);
        });
    });

    describe('getNextSessionNumber', () => {
        it('セッションが無い場合は1を返すこと', () => {
            expect(repo.getNextSessionNumber('cat-1')).toBe(1);
        });

        it('既存セッションがある場合はMAX+1を返すこと', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 3, guildId: 'guild-1' });
            expect(repo.getNextSessionNumber('cat-1')).toBe(4);
        });

        it('異なるカテゴリのセッションは影響しないこと', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 5, guildId: 'guild-1' });
            expect(repo.getNextSessionNumber('cat-2')).toBe(1);
        });
    });

    describe('updateDisplayName', () => {
        it('表示名を更新しis_renamedをtrueにすること', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });

            const updated = repo.updateDisplayName('ch-1', 'React認証バグ修正');
            expect(updated).toBe(true);

            const found = repo.findByChannelId('ch-1');
            expect(found?.displayName).toBe('React認証バグ修正');
            expect(found?.isRenamed).toBe(true);
        });

        it('存在しないチャンネルIDの場合はfalseを返すこと', () => {
            expect(repo.updateDisplayName('nonexistent', 'title')).toBe(false);
        });
    });

    describe('deleteByChannelId', () => {
        it('セッションを削除できること', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            expect(repo.deleteByChannelId('ch-1')).toBe(true);
            expect(repo.findByChannelId('ch-1')).toBeUndefined();
        });

        it('存在しないチャンネルIDの削除はfalseを返すこと', () => {
            expect(repo.deleteByChannelId('nonexistent')).toBe(false);
        });
    });
});
