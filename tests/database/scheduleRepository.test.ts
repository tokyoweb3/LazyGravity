import Database from 'better-sqlite3';
import { ScheduleRepository, ScheduleRecord } from '../../src/database/scheduleRepository';

/**
 * Step 9-1: 定期実行ジョブの永続化テスト
 *
 * テスト対象:
 * - SQLiteに「Cron式」と「プロンプト」を保存できるか
 * - 保存したスケジュールを全件取得できるか
 * - 個別のスケジュールをIDで取得できるか
 * - スケジュールを削除できるか
 * - テーブルが自動的に作成されるか
 */
describe('ScheduleRepository', () => {
    let db: Database.Database;
    let repo: ScheduleRepository;

    beforeEach(() => {
        // インメモリDBを使用（テスト毎にクリーンな状態）
        db = new Database(':memory:');
        repo = new ScheduleRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('テーブル初期化', () => {
        it('初期化時にschedulesテーブルが作成されること', () => {
            // テーブルの存在を確認
            const tableInfo = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'"
            ).get() as any;
            expect(tableInfo).toBeDefined();
            expect(tableInfo.name).toBe('schedules');
        });
    });

    describe('create - スケジュールの保存', () => {
        it('Cron式とプロンプトを保存し、IDを返すこと', () => {
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

        it('複数のスケジュールを保存できること', () => {
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

    describe('findAll - 全スケジュールの取得', () => {
        it('保存された全スケジュールを取得できること', () => {
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

        it('スケジュールが無い場合は空配列を返すこと', () => {
            const all = repo.findAll();
            expect(all).toEqual([]);
        });
    });

    describe('findById - IDによるスケジュール取得', () => {
        it('指定したIDのスケジュールを取得できること', () => {
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

        it('存在しないIDの場合はundefinedを返すこと', () => {
            const found = repo.findById(9999);
            expect(found).toBeUndefined();
        });
    });

    describe('findEnabled - 有効なスケジュールのみ取得', () => {
        it('enabled=true のスケジュールのみ取得できること', () => {
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

    describe('delete - スケジュールの削除', () => {
        it('指定したIDのスケジュールを削除できること', () => {
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

        it('存在しないIDの削除はfalseを返すこと', () => {
            const deleted = repo.delete(9999);
            expect(deleted).toBe(false);
        });
    });

    describe('update - スケジュールの更新', () => {
        it('有効/無効の切り替えができること', () => {
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

        it('Cron式の更新ができること', () => {
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
