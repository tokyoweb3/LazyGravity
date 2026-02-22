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

    describe('テーブル初期化', () => {
        it('初期化時にworkspace_bindingsテーブルが作成されること', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_bindings'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - バインディングの作成', () => {
        it('チャンネルIDとワークスペースパスを保存し、IDを返すこと', () => {
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

        it('同じチャンネルIDで重複作成はエラーになること', () => {
            repo.create({ channelId: '123456', workspacePath: 'proj-a', guildId: 'guild-1' });
            expect(() => {
                repo.create({ channelId: '123456', workspacePath: 'proj-b', guildId: 'guild-1' });
            }).toThrow();
        });
    });

    describe('findByChannelId - チャンネルIDで検索', () => {
        it('存在するバインディングを取得できること', () => {
            repo.create({ channelId: '123456', workspacePath: 'my-project', guildId: 'guild-1' });
            const found = repo.findByChannelId('123456');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('my-project');
        });

        it('存在しないチャンネルIDの場合はundefinedを返すこと', () => {
            const found = repo.findByChannelId('nonexistent');
            expect(found).toBeUndefined();
        });
    });

    describe('findByGuildId - ギルドIDで検索', () => {
        it('同一ギルドのバインディングを全て取得できること', () => {
            repo.create({ channelId: '111', workspacePath: 'proj-a', guildId: 'guild-1' });
            repo.create({ channelId: '222', workspacePath: 'proj-b', guildId: 'guild-1' });
            repo.create({ channelId: '333', workspacePath: 'proj-c', guildId: 'guild-2' });

            const results = repo.findByGuildId('guild-1');
            expect(results).toHaveLength(2);
            expect(results[0].workspacePath).toBe('proj-a');
            expect(results[1].workspacePath).toBe('proj-b');
        });

        it('バインディングが無い場合は空配列を返すこと', () => {
            const results = repo.findByGuildId('nonexistent');
            expect(results).toEqual([]);
        });
    });

    describe('findAll - 全バインディングの取得', () => {
        it('全バインディングを取得できること', () => {
            repo.create({ channelId: '111', workspacePath: 'proj-a', guildId: 'guild-1' });
            repo.create({ channelId: '222', workspacePath: 'proj-b', guildId: 'guild-2' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });

        it('バインディングが無い場合は空配列を返すこと', () => {
            expect(repo.findAll()).toEqual([]);
        });
    });

    describe('deleteByChannelId - バインディングの削除', () => {
        it('指定チャンネルIDのバインディングを削除できること', () => {
            repo.create({ channelId: '123456', workspacePath: 'my-project', guildId: 'guild-1' });
            const deleted = repo.deleteByChannelId('123456');
            expect(deleted).toBe(true);
            expect(repo.findByChannelId('123456')).toBeUndefined();
        });

        it('存在しないチャンネルIDの削除はfalseを返すこと', () => {
            const deleted = repo.deleteByChannelId('nonexistent');
            expect(deleted).toBe(false);
        });
    });

    describe('upsert - バインディングの作成または更新', () => {
        it('新規の場合は作成されること', () => {
            const result = repo.upsert({
                channelId: '123456',
                workspacePath: 'proj-a',
                guildId: 'guild-1',
            });
            expect(result.channelId).toBe('123456');
            expect(result.workspacePath).toBe('proj-a');
        });

        it('既存の場合はワークスペースパスが更新されること', () => {
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
