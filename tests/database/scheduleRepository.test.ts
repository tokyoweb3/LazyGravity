import Database from 'better-sqlite3';
import { ScheduleRepository, ScheduleRecord } from '../../src/database/scheduleRepository';

/**
 * Step 9-1: Scheduled job persistence tests
 *
 * Test targets:
 * - Can cron expressions and prompts be saved to SQLite?
 * - Can all saved schedules be retrieved?
 * - Can individual schedules be retrieved by ID?
 * - Can schedules be deleted?
 * - Is the table created automatically?
 */
describe('ScheduleRepository', () => {
    let db: Database.Database;
    let repo: ScheduleRepository;

    beforeEach(() => {
        // Use in-memory DB (clean state per test)
        db = new Database(':memory:');
        repo = new ScheduleRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the schedules table on initialization', () => {
            // Verify table existence
            const tableInfo = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'"
            ).get() as any;
            expect(tableInfo).toBeDefined();
            expect(tableInfo.name).toBe('schedules');
        });
    });

    describe('create - save schedule', () => {
        it('saves the cron expression and prompt, and returns the ID', () => {
            const record = repo.create({
                cronExpression: '0 9 * * *',
                prompt: 'テストプロンプト: ビルドを実行',
                workspacePath: '/home/user/project',
                enabled: true,
            });

            expect(record.id).toBeDefined();
            expect(typeof record.id).toBe('number');
            expect(record.cronExpression).toBe('0 9 * * *');
            expect(record.prompt).toBe('テストプロンプト: ビルドを実行');
            expect(record.workspacePath).toBe('/home/user/project');
            expect(record.enabled).toBe(true);
        });

        it('can save multiple schedules', () => {
            repo.create({
                cronExpression: '0 9 * * *',
                prompt: '朝のビルド',
                workspacePath: '/project1',
                enabled: true,
            });
            repo.create({
                cronExpression: '0 18 * * *',
                prompt: '夕方のテスト',
                workspacePath: '/project2',
                enabled: true,
            });

            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });
    });

    describe('findAll - retrieve all schedules', () => {
        it('retrieves all saved schedules', () => {
            repo.create({
                cronExpression: '*/5 * * * *',
                prompt: '5分毎のヘルスチェック',
                workspacePath: '/service',
                enabled: true,
            });
            repo.create({
                cronExpression: '0 0 * * 0',
                prompt: '毎週日曜の定期メンテナンス',
                workspacePath: '/maintenance',
                enabled: false,
            });

            const all = repo.findAll();
            expect(all).toHaveLength(2);
            expect(all[0].prompt).toBe('5分毎のヘルスチェック');
            expect(all[1].prompt).toBe('毎週日曜の定期メンテナンス');
            expect(all[1].enabled).toBe(false);
        });

        it('returns an empty array when there are no schedules', () => {
            const all = repo.findAll();
            expect(all).toEqual([]);
        });
    });

    describe('findById - retrieve schedule by ID', () => {
        it('retrieves the schedule with the specified ID', () => {
            const created = repo.create({
                cronExpression: '30 12 * * *',
                prompt: 'お昼のリマインダー',
                workspacePath: '/reminder',
                enabled: true,
            });

            const found = repo.findById(created.id);
            expect(found).toBeDefined();
            expect(found!.cronExpression).toBe('30 12 * * *');
            expect(found!.prompt).toBe('お昼のリマインダー');
        });

        it('returns undefined for a non-existent ID', () => {
            const found = repo.findById(9999);
            expect(found).toBeUndefined();
        });
    });

    describe('findEnabled - retrieve only enabled schedules', () => {
        it('retrieves only schedules with enabled=true', () => {
            repo.create({
                cronExpression: '0 9 * * *',
                prompt: '有効なジョブ',
                workspacePath: '/active',
                enabled: true,
            });
            repo.create({
                cronExpression: '0 18 * * *',
                prompt: '無効なジョブ',
                workspacePath: '/inactive',
                enabled: false,
            });

            const enabled = repo.findEnabled();
            expect(enabled).toHaveLength(1);
            expect(enabled[0].prompt).toBe('有効なジョブ');
        });
    });

    describe('delete - delete schedule', () => {
        it('deletes the schedule with the specified ID', () => {
            const created = repo.create({
                cronExpression: '0 0 * * *',
                prompt: '削除対象',
                workspacePath: '/delete-me',
                enabled: true,
            });

            const deleted = repo.delete(created.id);
            expect(deleted).toBe(true);

            const found = repo.findById(created.id);
            expect(found).toBeUndefined();
        });

        it('returns false when deleting a non-existent ID', () => {
            const deleted = repo.delete(9999);
            expect(deleted).toBe(false);
        });
    });

    describe('update - update schedule', () => {
        it('can toggle enabled/disabled state', () => {
            const created = repo.create({
                cronExpression: '0 9 * * *',
                prompt: '更新対象',
                workspacePath: '/update-me',
                enabled: true,
            });

            const updated = repo.update(created.id, { enabled: false });
            expect(updated).toBe(true);

            const found = repo.findById(created.id);
            expect(found!.enabled).toBe(false);
        });

        it('can update the cron expression', () => {
            const created = repo.create({
                cronExpression: '0 9 * * *',
                prompt: 'テスト',
                workspacePath: '/test',
                enabled: true,
            });

            const updated = repo.update(created.id, { cronExpression: '0 12 * * *' });
            expect(updated).toBe(true);

            const found = repo.findById(created.id);
            expect(found!.cronExpression).toBe('0 12 * * *');
        });
    });
});
