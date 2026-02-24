import * as cron from 'node-cron';
import { ScheduleRepository, ScheduleRecord } from '../database/scheduleRepository';

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

    constructor(repo: ScheduleRepository) {
        this.repo = repo;
    }

    /**
     * Called on bot startup. Loads all enabled schedules from DB and registers/resumes them with node-cron.
     *
     * @param jobCallback - Callback invoked when each job executes
     * @returns Number of restored schedules
     */
    public restoreAll(jobCallback: JobCallback): number {
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
        jobCallback: JobCallback
    ): ScheduleRecord {
        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            throw new Error(`Invalid cron expression: ${cronExpression}`);
        }

        // Save to DB
        const record = this.repo.create({
            cronExpression,
            prompt,
            workspacePath,
            enabled: true,
        });

        // Register with node-cron
        this.registerCronTask(record, jobCallback);

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
     * Get a list of all schedules
     */
    public listSchedules(): ScheduleRecord[] {
        return this.repo.findAll();
    }

    /**
     * Internal method to register a task with node-cron
     */
    private registerCronTask(schedule: ScheduleRecord, jobCallback: JobCallback): void {
        const task = cron.schedule(
            schedule.cronExpression,
            () => {
                jobCallback(schedule);
            }
        );

        this.activeTasks.set(schedule.id, task);
    }
}
