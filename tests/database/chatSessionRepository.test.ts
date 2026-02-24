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

    describe('table initialization', () => {
        it('creates the chat_sessions table on initialization', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - session creation', () => {
        it('creates a session and returns the ID', () => {
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

        it('throws an error on duplicate creation with the same channel ID', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            expect(() => {
                repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 2, guildId: 'guild-1' });
            }).toThrow();
        });
    });

    describe('findByChannelId', () => {
        it('retrieves an existing session', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            const found = repo.findByChannelId('ch-1');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('proj');
            expect(found?.isRenamed).toBe(false);
        });

        it('returns undefined for a non-existent channel ID', () => {
            expect(repo.findByChannelId('nonexistent')).toBeUndefined();
        });
    });

    describe('findByCategoryId', () => {
        it('retrieves sessions in the same category sorted by session number', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 2, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-3', categoryId: 'cat-2', workspacePath: 'other', sessionNumber: 1, guildId: 'guild-1' });

            const results = repo.findByCategoryId('cat-1');
            expect(results).toHaveLength(2);
            expect(results[0].sessionNumber).toBe(1);
            expect(results[1].sessionNumber).toBe(2);
        });

        it('returns an empty array when there are no sessions', () => {
            expect(repo.findByCategoryId('nonexistent')).toEqual([]);
        });
    });

    describe('getNextSessionNumber', () => {
        it('returns 1 when there are no sessions', () => {
            expect(repo.getNextSessionNumber('cat-1')).toBe(1);
        });

        it('returns MAX+1 when existing sessions exist', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            repo.create({ channelId: 'ch-2', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 3, guildId: 'guild-1' });
            expect(repo.getNextSessionNumber('cat-1')).toBe(4);
        });

        it('sessions in different categories do not affect each other', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 5, guildId: 'guild-1' });
            expect(repo.getNextSessionNumber('cat-2')).toBe(1);
        });
    });

    describe('updateDisplayName', () => {
        it('updates the display name and sets is_renamed to true', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });

            const updated = repo.updateDisplayName('ch-1', 'React認証バグ修正');
            expect(updated).toBe(true);

            const found = repo.findByChannelId('ch-1');
            expect(found?.displayName).toBe('React認証バグ修正');
            expect(found?.isRenamed).toBe(true);
        });

        it('returns false for a non-existent channel ID', () => {
            expect(repo.updateDisplayName('nonexistent', 'title')).toBe(false);
        });
    });

    describe('deleteByChannelId', () => {
        it('deletes a session', () => {
            repo.create({ channelId: 'ch-1', categoryId: 'cat-1', workspacePath: 'proj', sessionNumber: 1, guildId: 'guild-1' });
            expect(repo.deleteByChannelId('ch-1')).toBe(true);
            expect(repo.findByChannelId('ch-1')).toBeUndefined();
        });

        it('returns false when deleting a non-existent channel ID', () => {
            expect(repo.deleteByChannelId('nonexistent')).toBe(false);
        });
    });
});
