import Database from 'better-sqlite3';

/**
 * Schedule record type definition
 */
export interface ScheduleRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Cron expression (e.g. "0 9 * * *") */
    cronExpression: string;
    /** Prompt to execute */
    prompt: string;
    /** Target workspace path */
    workspacePath: string;
    /** Enabled/disabled */
    enabled: boolean;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
}

/**
 * Input type for schedule creation
 */
export interface CreateScheduleInput {
    cronExpression: string;
    prompt: string;
    workspacePath: string;
    enabled: boolean;
}

/**
 * Input type for schedule update (partial update)
 */
export interface UpdateScheduleInput {
    cronExpression?: string;
    prompt?: string;
    workspacePath?: string;
    enabled?: boolean;
}

/**
 * Repository class for SQLite persistence of scheduled jobs.
 * Handles saving, retrieving, updating, and deleting cron expressions and prompts.
 */
export class ScheduleRepository {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * Initialize table (create if not exists)
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cron_expression TEXT NOT NULL,
                prompt TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Create a new schedule
     */
    public create(input: CreateScheduleInput): ScheduleRecord {
        const stmt = this.db.prepare(`
            INSERT INTO schedules (cron_expression, prompt, workspace_path, enabled)
            VALUES (?, ?, ?, ?)
        `);

        const result = stmt.run(
            input.cronExpression,
            input.prompt,
            input.workspacePath,
            input.enabled ? 1 : 0
        );

        return {
            id: result.lastInsertRowid as number,
            cronExpression: input.cronExpression,
            prompt: input.prompt,
            workspacePath: input.workspacePath,
            enabled: input.enabled,
        };
    }

    /**
     * Get all schedules
     */
    public findAll(): ScheduleRecord[] {
        const rows = this.db.prepare('SELECT * FROM schedules ORDER BY id ASC').all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Get a schedule by ID
     */
    public findById(id: number): ScheduleRecord | undefined {
        const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Get only enabled schedules (for re-registration on bot startup)
     */
    public findEnabled(): ScheduleRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM schedules WHERE enabled = 1 ORDER BY id ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Delete a schedule
     */
    public delete(id: number): boolean {
        const result = this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /**
     * Partially update a schedule
     */
    public update(id: number, input: UpdateScheduleInput): boolean {
        const sets: string[] = [];
        const values: any[] = [];

        if (input.cronExpression !== undefined) {
            sets.push('cron_expression = ?');
            values.push(input.cronExpression);
        }
        if (input.prompt !== undefined) {
            sets.push('prompt = ?');
            values.push(input.prompt);
        }
        if (input.workspacePath !== undefined) {
            sets.push('workspace_path = ?');
            values.push(input.workspacePath);
        }
        if (input.enabled !== undefined) {
            sets.push('enabled = ?');
            values.push(input.enabled ? 1 : 0);
        }

        if (sets.length === 0) return false;

        values.push(id);
        const sql = `UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`;
        const result = this.db.prepare(sql).run(...values);
        return result.changes > 0;
    }

    /**
     * Map a DB row to ScheduleRecord
     */
    private mapRow(row: any): ScheduleRecord {
        return {
            id: row.id,
            cronExpression: row.cron_expression,
            prompt: row.prompt,
            workspacePath: row.workspace_path,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
        };
    }
}
