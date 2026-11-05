import Database from 'better-sqlite3';
import { TelegramBindingRepository } from '../../src/database/telegramBindingRepository';

describe('TelegramBindingRepository', () => {
    let db: Database.Database;
    let repo: TelegramBindingRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        repo = new TelegramBindingRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the telegram_bindings table on initialization', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bindings'"
            ).all();
            expect(tables).toHaveLength(1);
        });

        it('migrates an existing workspace-only table without losing bindings', () => {
            const legacy = new Database(':memory:');
            try {
                legacy.exec(`CREATE TABLE telegram_bindings (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT UNIQUE NOT NULL, workspace_path TEXT NOT NULL, created_at TEXT);
                    INSERT INTO telegram_bindings (chat_id, workspace_path) VALUES ('chat', 'project');`);
                const migrated = new TelegramBindingRepository(legacy);
                expect(migrated.findByChatId('chat')).toMatchObject({ workspacePath: 'project', sessionTitle: null, accountName: null });
                migrated.setSession('chat', 'project', 'Conversation A', 'personal');
                expect(new TelegramBindingRepository(legacy).findByChatId('chat')).toMatchObject({
                    sessionTitle: 'Conversation A', accountName: 'personal',
                });
            } finally { legacy.close(); }
        });
    });

    describe('create - binding creation', () => {
        it('saves chat ID and workspace path, and returns the ID', () => {
            const result = repo.create({
                chatId: '100200300',
                workspacePath: 'my-project',
            });
            expect(result.id).toBeDefined();
            expect(result.chatId).toBe('100200300');
            expect(result.workspacePath).toBe('my-project');
        });

        it('throws an error on duplicate creation with the same chat ID', () => {
            repo.create({ chatId: '100200300', workspacePath: 'proj-a' });
            expect(() => {
                repo.create({ chatId: '100200300', workspacePath: 'proj-b' });
            }).toThrow();
        });
    });

    describe('findByChatId - search by chat ID', () => {
        it('retrieves an existing binding', () => {
            repo.create({ chatId: '100200300', workspacePath: 'my-project' });
            const found = repo.findByChatId('100200300');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('my-project');
        });

        it('returns undefined for a non-existent chat ID', () => {
            const found = repo.findByChatId('nonexistent');
            expect(found).toBeUndefined();
        });

        it('includes createdAt timestamp', () => {
            repo.create({ chatId: '100200300', workspacePath: 'proj' });
            const found = repo.findByChatId('100200300');
            expect(found?.createdAt).toBeDefined();
            expect(typeof found?.createdAt).toBe('string');
        });

        it('falls back from a topic chat id to the base chat binding', () => {
            repo.create({ chatId: '100200300', workspacePath: 'my-project' });
            const found = repo.findByChatIdWithParentFallback('100200300_77');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('my-project');
        });
    });

    describe('findByWorkspacePath - search by workspace path', () => {
        it('retrieves all bindings for the same workspace', () => {
            repo.create({ chatId: '111', workspacePath: 'proj-a' });
            repo.create({ chatId: '222', workspacePath: 'proj-a' });
            repo.create({ chatId: '333', workspacePath: 'proj-b' });

            const results = repo.findByWorkspacePath('proj-a');
            expect(results).toHaveLength(2);
            expect(results[0].chatId).toBe('111');
            expect(results[1].chatId).toBe('222');
        });

        it('returns an empty array when there are no bindings', () => {
            const results = repo.findByWorkspacePath('nonexistent');
            expect(results).toEqual([]);
        });
    });

    describe('findAll - retrieve all bindings', () => {
        it('retrieves all bindings', () => {
            repo.create({ chatId: '111', workspacePath: 'proj-a' });
            repo.create({ chatId: '222', workspacePath: 'proj-b' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });

        it('returns an empty array when there are no bindings', () => {
            expect(repo.findAll()).toEqual([]);
        });
    });

    describe('deleteByChatId - delete binding', () => {
        it('deletes the binding for the specified chat ID', () => {
            repo.create({ chatId: '100200300', workspacePath: 'my-project' });
            const deleted = repo.deleteByChatId('100200300');
            expect(deleted).toBe(true);
            expect(repo.findByChatId('100200300')).toBeUndefined();
        });

        it('returns false when deleting a non-existent chat ID', () => {
            const deleted = repo.deleteByChatId('nonexistent');
            expect(deleted).toBe(false);
        });
    });

    describe('upsert - create or update binding', () => {
        it('preserves conversation metadata for the same workspace and clears it on rebind', () => {
            repo.setSession('chat', 'project-a', 'Conversation A', 'personal');
            expect(repo.upsert({ chatId: 'chat', workspacePath: 'project-a' })).toMatchObject({
                sessionTitle: 'Conversation A', accountName: 'personal',
            });
            expect(repo.upsert({ chatId: 'chat', workspacePath: 'project-b' })).toMatchObject({ sessionTitle: null, accountName: null });
        });

        it('distinguishes explicitly new conversations from unknown legacy bindings', () => {
            repo.setSession('chat', 'project', '', 'default');
            expect(repo.findByChatId('chat')).toMatchObject({ sessionTitle: '', accountName: 'default' });
        });
        it('creates a new binding when it does not exist', () => {
            const result = repo.upsert({
                chatId: '100200300',
                workspacePath: 'proj-a',
            });
            expect(result.chatId).toBe('100200300');
            expect(result.workspacePath).toBe('proj-a');
        });

        it('updates the workspace path when the binding already exists', () => {
            repo.create({ chatId: '100200300', workspacePath: 'proj-a' });
            const result = repo.upsert({
                chatId: '100200300',
                workspacePath: 'proj-b',
            });
            expect(result.workspacePath).toBe('proj-b');
            expect(repo.findAll()).toHaveLength(1);
        });
    });
});
