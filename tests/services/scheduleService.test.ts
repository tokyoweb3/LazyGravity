import { ScheduleService } from '../../src/services/scheduleService';
import { ScheduleRepository, ScheduleRecord } from '../../src/database/scheduleRepository';
import * as cron from 'node-cron';

// node-cronをモック化
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
    validate: jest.fn(),
}));

/**
 * Step 9-2: スケジュールサービスのテスト
 *
 * テスト対象:
 * - Bot起動時にSQLiteのスケジュールを読み込み、node-cronに登録・再開できるか
 * - スケジュールの追加・停止・削除ができるか
 * - 不正なCron式の場合にエラーハンドリングされるか
 */
describe('ScheduleService', () => {
    let scheduleService: ScheduleService;
    let mockRepo: jest.Mocked<ScheduleRepository>;
    let mockCronSchedule: jest.Mock;
    let mockCronValidate: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        // リポジトリのモック
        mockRepo = {
            create: jest.fn(),
            findAll: jest.fn(),
            findById: jest.fn(),
            findEnabled: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
        } as unknown as jest.Mocked<ScheduleRepository>;

        mockCronSchedule = cron.schedule as jest.Mock;
        mockCronValidate = cron.validate as jest.Mock;

        scheduleService = new ScheduleService(mockRepo);
    });

    describe('restoreAll - Bot起動時のスケジュール復元', () => {
        it('有効なスケジュールを全てnode-cronに登録すること', () => {
            const schedules: ScheduleRecord[] = [
                {
                    id: 1,
                    cronExpression: '0 9 * * *',
                    prompt: '朝のビルド',
                    workspacePath: '/project1',
                    enabled: true,
                },
                {
                    id: 2,
                    cronExpression: '0 18 * * *',
                    prompt: '夕方のテスト',
                    workspacePath: '/project2',
                    enabled: true,
                },
            ];

            mockRepo.findEnabled.mockReturnValue(schedules);

            // コールバック関数（ジョブとして実行される処理）
            const jobCallback = jest.fn();

            // node-cronのモック（ScheduledTaskオブジェクトを返す）
            const mockTask = { stop: jest.fn(), start: jest.fn() };
            mockCronSchedule.mockReturnValue(mockTask);

            const restoredCount = scheduleService.restoreAll(jobCallback);

            // 有効なスケジュールのみ取得される
            expect(mockRepo.findEnabled).toHaveBeenCalledTimes(1);
            // node-cron.schedule が2回呼ばれる
            expect(mockCronSchedule).toHaveBeenCalledTimes(2);
            expect(mockCronSchedule).toHaveBeenCalledWith(
                '0 9 * * *',
                expect.any(Function)
            );
            expect(mockCronSchedule).toHaveBeenCalledWith(
                '0 18 * * *',
                expect.any(Function)
            );
            expect(restoredCount).toBe(2);
        });

        it('有効なスケジュールが無い場合は0を返すこと', () => {
            mockRepo.findEnabled.mockReturnValue([]);
            const jobCallback = jest.fn();

            const restoredCount = scheduleService.restoreAll(jobCallback);

            expect(restoredCount).toBe(0);
            expect(mockCronSchedule).not.toHaveBeenCalled();
        });
    });

    describe('addSchedule - 新規スケジュールの追加', () => {
        it('バリデーションを通過し、DBに保存してcronに登録すること', () => {
            mockCronValidate.mockReturnValue(true);
            const mockTask = { stop: jest.fn(), start: jest.fn() };
            mockCronSchedule.mockReturnValue(mockTask);

            const created: ScheduleRecord = {
                id: 1,
                cronExpression: '*/10 * * * *',
                prompt: '10分毎のチェック',
                workspacePath: '/service',
                enabled: true,
            };
            mockRepo.create.mockReturnValue(created);

            const jobCallback = jest.fn();
            const result = scheduleService.addSchedule(
                '*/10 * * * *',
                '10分毎のチェック',
                '/service',
                jobCallback
            );

            // Cron式のバリデーション
            expect(mockCronValidate).toHaveBeenCalledWith('*/10 * * * *');
            // DBに保存される
            expect(mockRepo.create).toHaveBeenCalledWith({
                cronExpression: '*/10 * * * *',
                prompt: '10分毎のチェック',
                workspacePath: '/service',
                enabled: true,
            });
            // node-cronに登録される
            expect(mockCronSchedule).toHaveBeenCalledTimes(1);
            expect(result).toEqual(created);
        });

        it('不正なCron式の場合にエラーをスローすること', () => {
            mockCronValidate.mockReturnValue(false);

            const jobCallback = jest.fn();

            expect(() => {
                scheduleService.addSchedule(
                    'invalid-cron',
                    'テスト',
                    '/test',
                    jobCallback
                );
            }).toThrow('不正なCron式です: invalid-cron');

            expect(mockRepo.create).not.toHaveBeenCalled();
            expect(mockCronSchedule).not.toHaveBeenCalled();
        });
    });

    describe('removeSchedule - スケジュールの削除', () => {
        it('実行中のcronジョブを停止し、DBから削除すること', () => {
            // 先にスケジュールを登録しておく
            mockCronValidate.mockReturnValue(true);
            const mockTask = { stop: jest.fn(), start: jest.fn() };
            mockCronSchedule.mockReturnValue(mockTask);
            mockRepo.create.mockReturnValue({
                id: 5,
                cronExpression: '0 6 * * *',
                prompt: '朝のジョブ',
                workspacePath: '/morning',
                enabled: true,
            });

            const jobCallback = jest.fn();
            scheduleService.addSchedule('0 6 * * *', '朝のジョブ', '/morning', jobCallback);

            // 削除
            mockRepo.delete.mockReturnValue(true);
            const deleted = scheduleService.removeSchedule(5);

            expect(deleted).toBe(true);
            // cronジョブが停止される
            expect(mockTask.stop).toHaveBeenCalled();
            // DBから削除される
            expect(mockRepo.delete).toHaveBeenCalledWith(5);
        });

        it('存在しないスケジュールIDの場合はfalseを返すこと', () => {
            mockRepo.delete.mockReturnValue(false);
            const deleted = scheduleService.removeSchedule(999);

            expect(deleted).toBe(false);
        });
    });

    describe('stopAll - 全スケジュールの停止', () => {
        it('全ての実行中cronジョブを停止すること', () => {
            // 2つのスケジュールを登録
            mockCronValidate.mockReturnValue(true);
            const mockTask1 = { stop: jest.fn(), start: jest.fn() };
            const mockTask2 = { stop: jest.fn(), start: jest.fn() };
            mockCronSchedule
                .mockReturnValueOnce(mockTask1)
                .mockReturnValueOnce(mockTask2);

            mockRepo.create
                .mockReturnValueOnce({
                    id: 1, cronExpression: '0 9 * * *', prompt: 'テスト1',
                    workspacePath: '/p1', enabled: true,
                })
                .mockReturnValueOnce({
                    id: 2, cronExpression: '0 18 * * *', prompt: 'テスト2',
                    workspacePath: '/p2', enabled: true,
                });

            const jobCallback = jest.fn();
            scheduleService.addSchedule('0 9 * * *', 'テスト1', '/p1', jobCallback);
            scheduleService.addSchedule('0 18 * * *', 'テスト2', '/p2', jobCallback);

            scheduleService.stopAll();

            expect(mockTask1.stop).toHaveBeenCalled();
            expect(mockTask2.stop).toHaveBeenCalled();
        });
    });

    describe('listSchedules - スケジュール一覧の取得', () => {
        it('DBから全スケジュールを取得できること', () => {
            const schedules: ScheduleRecord[] = [
                { id: 1, cronExpression: '0 9 * * *', prompt: 'ジョブ1', workspacePath: '/p1', enabled: true },
                { id: 2, cronExpression: '0 18 * * *', prompt: 'ジョブ2', workspacePath: '/p2', enabled: false },
            ];
            mockRepo.findAll.mockReturnValue(schedules);

            const result = scheduleService.listSchedules();

            expect(result).toEqual(schedules);
            expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
        });
    });
});
