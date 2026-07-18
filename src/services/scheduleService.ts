import * as cron from 'node-cron';
import { ScheduleRepository, ScheduleRecord, CreateScheduleInput } from '../database/scheduleRepository';
import { logger } from '../utils/logger';

/**
 * Callback type for job execution.
 * Receives schedule record info and executes the actual task.
 */
export type JobCallback = (schedule: ScheduleRecord) => void;

/**
 * Service class for managing scheduled jobs.
 *
 * - On bot startup, loads schedules from SQLite and re-registers them with node-cron
 * - Handles adding, removing, and listing schedules
 * - Provides bulk stop of all schedules (e.g. on shutdown)
 */
export class ScheduleService {
    private repo: ScheduleRepository;
    /** Map managing active cron tasks (schedule ID -> ScheduledTask) */
    private activeTasks: Map<number, cron.ScheduledTask> = new Map();
    private jobCallback?: JobCallback;

    constructor(repo: ScheduleRepository) {
        this.repo = repo;
    }

    /**
     * Get the stored job callback.
     */
    public getJobCallback(): JobCallback | undefined {
        return this.jobCallback;
    }

    /**
     * Called on bot startup. Loads all enabled schedules from DB and registers/resumes them with node-cron.
     *
     * @param jobCallback - Callback invoked when each job executes
     * @returns Number of restored schedules
     */
    public restoreAll(jobCallback: JobCallback): number {
        this.jobCallback = jobCallback;
        const enabledSchedules = this.repo.findEnabled();

        for (const schedule of enabledSchedules) {
            this.registerCronTask(schedule, jobCallback);
        }

        return enabledSchedules.length;
    }

    /**
     * Add a new schedule.
     * Processes in order: cron expression validation -> DB save -> node-cron registration.
     *
     * @param cronExpression - Cron expression
     * @param prompt - Prompt to execute
     * @param workspacePath - Target workspace path
     * @param jobCallback - Callback for job execution
     * @returns Created schedule record
     * @throws On invalid cron expression
     */
    public addSchedule(
        cronExpression: string,
        prompt: string,
        workspacePath: string,
        channelIdOrCallback: string | JobCallback,
        jobCallback?: JobCallback
    ): ScheduleRecord {
        let finalChannelId = '';
        let finalJobCallback: JobCallback | undefined;

        if (typeof channelIdOrCallback === 'function') {
            finalJobCallback = channelIdOrCallback;
        } else {
            finalChannelId = channelIdOrCallback;
            finalJobCallback = jobCallback;
        }

        if (!finalJobCallback) {
            throw new Error('Job callback is not initialized.');
        }

        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            throw new Error(`Invalid cron expression: ${cronExpression}`);
        }

        // Save to DB
        const recordInput: CreateScheduleInput = {
            cronExpression,
            prompt,
            workspacePath,
            enabled: true,
        };
        if (finalChannelId) {
            recordInput.channelId = finalChannelId;
        }
        const record = this.repo.create(recordInput);

        // Register with node-cron
        this.registerCronTask(record, finalJobCallback);

        return record;
    }

    /**
     * Remove a schedule.
     * Stops the running cron job and deletes it from the DB.
     *
     * @param scheduleId - ID of the schedule to remove
     * @returns Whether the removal was successful
     */
    public removeSchedule(scheduleId: number): boolean {
        // Stop the running cron job
        const task = this.activeTasks.get(scheduleId);
        if (task) {
            task.stop();
            this.activeTasks.delete(scheduleId);
        }

        // Delete from DB
        return this.repo.delete(scheduleId);
    }

    /**
     * Stop all running cron jobs (called on bot shutdown)
     */
    public stopAll(): void {
        for (const [id, task] of this.activeTasks) {
            task.stop();
        }
        this.activeTasks.clear();
    }

    /**
     * Remove all scheduled tasks.
     * Stops all active cron tasks in memory, empties the database table,
     * and resets the autoincrement ID back to 0.
     */
    public resetSchedules(): void {
        this.repo.reset();
        this.stopAll();
    }

    /**
     * Export all schedules as a JSON string
     */
    public backupSchedules(): string {
        const list = this.listSchedules();
        // Export only portable fields (exclude autoincrement ID and timestamps)
        const portable = list.map(s => ({
            cronExpression: s.cronExpression,
            prompt: s.prompt,
            workspacePath: s.workspacePath,
            channelId: s.channelId,
            enabled: s.enabled
        }));
        return JSON.stringify(portable, null, 2);
    }

    public restoreSchedules(jsonContent: string, jobCallback: JobCallback): number {
        if (!jobCallback) {
            throw new Error('Job callback is not initialized.');
        }

        let parsed: any;
        try {
            parsed = JSON.parse(jsonContent);
        } catch (err) {
            throw new Error('Invalid backup format: root must be an array of schedule objects.');
        }

        if (!Array.isArray(parsed)) {
            throw new Error('Invalid backup format: root must be an array of schedule objects.');
        }

        // Validate items
        const validated: Array<{ cronExpression: string; prompt: string; workspacePath: string; channelId?: string; enabled: boolean }> = [];
        for (const item of parsed) {
            if (!item || typeof item !== 'object') {
                throw new Error('Invalid backup format: each schedule must contain cronExpression, prompt, and workspacePath.');
            }
            if (typeof item.cronExpression !== 'string' || typeof item.prompt !== 'string' || typeof item.workspacePath !== 'string') {
                throw new Error('Invalid backup format: each schedule must contain cronExpression, prompt, and workspacePath.');
            }
            if (!cron.validate(item.cronExpression)) {
                throw new Error(`Invalid cron expression in backup: "${item.cronExpression}"`);
            }
            validated.push({
                cronExpression: item.cronExpression,
                prompt: item.prompt,
                workspacePath: item.workspacePath,
                channelId: typeof item.channelId === 'string' ? item.channelId : undefined,
                enabled: typeof item.enabled === 'boolean' ? item.enabled : true
            });
        }

        // Write to DB first (atomic transaction)
        const restoredRecords = this.repo.bulkRestore(validated);

        // Stop memory crons now that DB write succeeded
        this.stopAll();

        // Resume crons in memory
        for (const record of restoredRecords) {
            if (record.enabled) {
                this.registerCronTask(record, jobCallback);
            }
        }

        return restoredRecords.length;
    }

    /**
     * Get a list of all schedules
     */
    public listSchedules(): ScheduleRecord[] {
        return this.repo.findAll();
    }

    /**
     * Internal method to register a task with node-cron
     */
    private registerCronTask(schedule: ScheduleRecord, jobCallback: JobCallback): void {
        logger.info(`[Schedule] Registering cron task ID ${schedule.id} with expression "${schedule.cronExpression}"`);
        const task = cron.schedule(
            schedule.cronExpression,
            () => {
                logger.info(`[Schedule] Cron trigger fired for task ID ${schedule.id}`);
                jobCallback(schedule);
            }
        );

        this.activeTasks.set(schedule.id, task);
    }
}
