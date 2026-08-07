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
    /** Target channel ID */
    channelId?: string;
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
    channelId?: string;
    enabled: boolean;
}

/**
 * Input type for schedule update (partial update)
 */
export interface UpdateScheduleInput {
    cronExpression?: string;
    prompt?: string;
    workspacePath?: string;
    channelId?: string;
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

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cron_expression TEXT NOT NULL,
                prompt TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                channel_id TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        // Perform schema migration if channel_id doesn't exist (fallback for old databases)
        const tableInfo = this.db.pragma("table_info(schedules)") as any[];
        const hasChannelId = tableInfo.some((col: any) => col.name === 'channel_id');
        if (!hasChannelId) {
            this.db.exec('ALTER TABLE schedules ADD COLUMN channel_id TEXT');
        }
    }

    /**
     * Create a new schedule
     */
    public create(input: CreateScheduleInput): ScheduleRecord {
        const stmt = this.db.prepare(`
            INSERT INTO schedules (cron_expression, prompt, workspace_path, channel_id, enabled)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            input.cronExpression,
            input.prompt,
            input.workspacePath,
            input.channelId || '',
            input.enabled ? 1 : 0
        );

        return {
            id: result.lastInsertRowid as number,
            cronExpression: input.cronExpression,
            prompt: input.prompt,
            workspacePath: input.workspacePath,
            channelId: input.channelId,
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
     * Clear all schedules and reset the autoincrement ID back to 0
     */
    public reset(): void {
        this.db.transaction(() => {
            this.db.exec('DELETE FROM schedules');
            this.db.exec("DELETE FROM sqlite_sequence WHERE name = 'schedules'");
        })();
    }

    /**
     * Bulk restore schedules. Clears the table and inserts all provided records.
     */
    public bulkRestore(records: CreateScheduleInput[]): ScheduleRecord[] {
        const result: ScheduleRecord[] = [];
        this.db.transaction(() => {
            this.reset();
            const stmt = this.db.prepare(`
                INSERT INTO schedules (cron_expression, prompt, workspace_path, channel_id, enabled)
                VALUES (?, ?, ?, ?, ?)
            `);
            for (const record of records) {
                const insertResult = stmt.run(
                    record.cronExpression,
                    record.prompt,
                    record.workspacePath,
                    record.channelId || '',
                    record.enabled ? 1 : 0
                );
                result.push({
                    id: insertResult.lastInsertRowid as number,
                    cronExpression: record.cronExpression,
                    prompt: record.prompt,
                    workspacePath: record.workspacePath,
                    channelId: record.channelId,
                    enabled: record.enabled,
                });
            }
        })();
        return result;
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
        if (input.channelId !== undefined) {
            sets.push('channel_id = ?');
            values.push(input.channelId);
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
            channelId: row.channel_id || undefined,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
        };
    }
}
