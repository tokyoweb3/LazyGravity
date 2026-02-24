import { ScheduleService } from '../../src/services/scheduleService';
import { ScheduleRepository, ScheduleRecord } from '../../src/database/scheduleRepository';
import * as cron from 'node-cron';

// Mock node-cron
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
    validate: jest.fn(),
}));

/**
 * Step 9-2: Schedule service tests
 *
 * Test targets:
 * - Can schedules be loaded from SQLite and registered/resumed in node-cron on bot startup?
 * - Can schedules be added, stopped, and deleted?
 * - Is error handling performed for invalid cron expressions?
 */
describe('ScheduleService', () => {
    let scheduleService: ScheduleService;
    let mockRepo: jest.Mocked<ScheduleRepository>;
    let mockCronSchedule: jest.Mock;
    let mockCronValidate: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock repository
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

    describe('restoreAll - schedule restoration on bot startup', () => {
        it('registers all enabled schedules with node-cron', () => {
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

            // Callback function (process executed as a job)
            const jobCallback = jest.fn();

            // Mock node-cron (returns ScheduledTask objects)
            const mockTask = { stop: jest.fn(), start: jest.fn() };
            mockCronSchedule.mockReturnValue(mockTask);

            const restoredCount = scheduleService.restoreAll(jobCallback);

            // Only enabled schedules are retrieved
            expect(mockRepo.findEnabled).toHaveBeenCalledTimes(1);
            // node-cron.schedule is called twice
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

        it('returns 0 when there are no enabled schedules', () => {
            mockRepo.findEnabled.mockReturnValue([]);
            const jobCallback = jest.fn();

            const restoredCount = scheduleService.restoreAll(jobCallback);

            expect(restoredCount).toBe(0);
            expect(mockCronSchedule).not.toHaveBeenCalled();
        });
    });

    describe('addSchedule - add new schedule', () => {
        it('passes validation, saves to DB, and registers with cron', () => {
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

            // Cron expression validation
            expect(mockCronValidate).toHaveBeenCalledWith('*/10 * * * *');
            // Saved to DB
            expect(mockRepo.create).toHaveBeenCalledWith({
                cronExpression: '*/10 * * * *',
                prompt: '10分毎のチェック',
                workspacePath: '/service',
                enabled: true,
            });
            // Registered with node-cron
            expect(mockCronSchedule).toHaveBeenCalledTimes(1);
            expect(result).toEqual(created);
        });

        it('throws an error for an invalid cron expression', () => {
            mockCronValidate.mockReturnValue(false);

            const jobCallback = jest.fn();

            expect(() => {
                scheduleService.addSchedule(
                    'invalid-cron',
                    'テスト',
                    '/test',
                    jobCallback
                );
            }).toThrow('Invalid cron expression: invalid-cron');

            expect(mockRepo.create).not.toHaveBeenCalled();
            expect(mockCronSchedule).not.toHaveBeenCalled();
        });
    });

    describe('removeSchedule - delete schedule', () => {
        it('stops the running cron job and deletes from DB', () => {
            // Register a schedule first
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

            // Delete
            mockRepo.delete.mockReturnValue(true);
            const deleted = scheduleService.removeSchedule(5);

            expect(deleted).toBe(true);
            // Cron job is stopped
            expect(mockTask.stop).toHaveBeenCalled();
            // Deleted from DB
            expect(mockRepo.delete).toHaveBeenCalledWith(5);
        });

        it('returns false for a non-existent schedule ID', () => {
            mockRepo.delete.mockReturnValue(false);
            const deleted = scheduleService.removeSchedule(999);

            expect(deleted).toBe(false);
        });
    });

    describe('stopAll - stop all schedules', () => {
        it('stops all running cron jobs', () => {
            // Register two schedules
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

    describe('listSchedules - retrieve schedule list', () => {
        it('retrieves all schedules from DB', () => {
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
