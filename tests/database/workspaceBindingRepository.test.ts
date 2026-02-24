import Database from 'better-sqlite3';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';

describe('WorkspaceBindingRepository', () => {
    let db: Database.Database;
    let repo: WorkspaceBindingRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        repo = new WorkspaceBindingRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the workspace_bindings table on initialization', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_bindings'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - binding creation', () => {
        it('saves channel ID and workspace path, and returns the ID', () => {
            const result = repo.create({
                channelId: '123456',
                workspacePath: 'my-project',
                guildId: 'guild-1',
            });
            expect(result.id).toBeDefined();
            expect(result.channelId).toBe('123456');
            expect(result.workspacePath).toBe('my-project');
            expect(result.guildId).toBe('guild-1');
        });

        it('throws an error on duplicate creation with the same channel ID', () => {
            repo.create({ channelId: '123456', workspacePath: 'proj-a', guildId: 'guild-1' });
            expect(() => {
                repo.create({ channelId: '123456', workspacePath: 'proj-b', guildId: 'guild-1' });
            }).toThrow();
        });
    });

    describe('findByChannelId - search by channel ID', () => {
        it('retrieves an existing binding', () => {
            repo.create({ channelId: '123456', workspacePath: 'my-project', guildId: 'guild-1' });
            const found = repo.findByChannelId('123456');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('my-project');
        });

        it('returns undefined for a non-existent channel ID', () => {
            const found = repo.findByChannelId('nonexistent');
            expect(found).toBeUndefined();
        });
    });

    describe('findByGuildId - search by guild ID', () => {
        it('retrieves all bindings for the same guild', () => {
            repo.create({ channelId: '111', workspacePath: 'proj-a', guildId: 'guild-1' });
            repo.create({ channelId: '222', workspacePath: 'proj-b', guildId: 'guild-1' });
            repo.create({ channelId: '333', workspacePath: 'proj-c', guildId: 'guild-2' });

            const results = repo.findByGuildId('guild-1');
            expect(results).toHaveLength(2);
            expect(results[0].workspacePath).toBe('proj-a');
            expect(results[1].workspacePath).toBe('proj-b');
        });

        it('returns an empty array when there are no bindings', () => {
            const results = repo.findByGuildId('nonexistent');
            expect(results).toEqual([]);
        });
    });

    describe('findAll - retrieve all bindings', () => {
        it('retrieves all bindings', () => {
            repo.create({ channelId: '111', workspacePath: 'proj-a', guildId: 'guild-1' });
            repo.create({ channelId: '222', workspacePath: 'proj-b', guildId: 'guild-2' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });

        it('returns an empty array when there are no bindings', () => {
            expect(repo.findAll()).toEqual([]);
        });
    });

    describe('deleteByChannelId - delete binding', () => {
        it('deletes the binding for the specified channel ID', () => {
            repo.create({ channelId: '123456', workspacePath: 'my-project', guildId: 'guild-1' });
            const deleted = repo.deleteByChannelId('123456');
            expect(deleted).toBe(true);
            expect(repo.findByChannelId('123456')).toBeUndefined();
        });

        it('returns false when deleting a non-existent channel ID', () => {
            const deleted = repo.deleteByChannelId('nonexistent');
            expect(deleted).toBe(false);
        });
    });

    describe('upsert - create or update binding', () => {
        it('creates a new binding when it does not exist', () => {
            const result = repo.upsert({
                channelId: '123456',
                workspacePath: 'proj-a',
                guildId: 'guild-1',
            });
            expect(result.channelId).toBe('123456');
            expect(result.workspacePath).toBe('proj-a');
        });

        it('updates the workspace path when the binding already exists', () => {
            repo.create({ channelId: '123456', workspacePath: 'proj-a', guildId: 'guild-1' });
            const result = repo.upsert({
                channelId: '123456',
                workspacePath: 'proj-b',
                guildId: 'guild-1',
            });
            expect(result.workspacePath).toBe('proj-b');
            expect(repo.findAll()).toHaveLength(1);
        });
    });
});
