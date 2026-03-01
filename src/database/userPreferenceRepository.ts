import Database from 'better-sqlite3';

/**
 * Output format preference type
 */
export type OutputFormat = 'embed' | 'plain';

/**
 * User preference record type definition
 */
export interface UserPreferenceRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Discord user ID (unique) */
    userId: string;
    /** Output format preference */
    outputFormat: OutputFormat;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
    /** Last update timestamp (ISO string) */
    updatedAt?: string;
}

/**
 * Repository class for SQLite persistence of per-user preferences.
 * Currently stores output format preference (embed vs plain text).
 */
export class UserPreferenceRepository {
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
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL UNIQUE,
                output_format TEXT NOT NULL DEFAULT 'embed',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Get the output format preference for a user.
     * Returns 'embed' as default if no preference is stored.
     */
    public getOutputFormat(userId: string): OutputFormat {
        const row = this.db.prepare(
            'SELECT output_format FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { output_format: string } | undefined;

        if (!row) return 'embed';
        return row.output_format === 'plain' ? 'plain' : 'embed';
    }

    /**
     * Set the output format preference for a user (upsert).
     */
    public setOutputFormat(userId: string, format: OutputFormat): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, output_format)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET output_format = excluded.output_format,
                          updated_at = datetime('now')
        `).run(userId, format);
    }

    /**
     * Get full preference record for a user
     */
    public findByUserId(userId: string): UserPreferenceRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM user_preferences WHERE user_id = ?'
        ).get(userId) as any;

        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Map a DB row to UserPreferenceRecord
     */
    private mapRow(row: any): UserPreferenceRecord {
        return {
            id: row.id,
            userId: row.user_id,
            outputFormat: row.output_format as OutputFormat,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
