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
    /** Default model name (free-text, may become stale) */
    defaultModel: string | null;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
    /** Last update timestamp (ISO string) */
    updatedAt?: string;
    /** Artifact render mode (thread vs inline) */
    artifactRenderMode?: 'thread' | 'inline';
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
     * Initialize table (create if not exists) and run migrations
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
        this.migrateDefaultModel();
        this.migrateArtifactRenderMode();
    }

    /**
     * Safe migration: add default_model column if it does not exist.
     * Uses pragma when available, falls back to try/catch ALTER TABLE.
     */
    private migrateDefaultModel(): void {
        if (typeof this.db.pragma === 'function') {
            const columns = this.db.pragma('table_info(user_preferences)') as { name: string }[];
            const hasColumn = columns.some(c => c.name === 'default_model');
            if (!hasColumn) {
                this.db.exec('ALTER TABLE user_preferences ADD COLUMN default_model TEXT DEFAULT NULL');
            }
        } else {
            // Fallback for mock/alternate DB implementations without pragma
            try {
                this.db.exec('ALTER TABLE user_preferences ADD COLUMN default_model TEXT DEFAULT NULL');
            } catch {
                // Column already exists — safe to ignore
            }
        }
    }

    /**
     * Migration: add artifact_render_mode column.
     * Default is 'thread'.
     */
    private migrateArtifactRenderMode(): void {
        const columns = this.db.pragma('table_info(user_preferences)') as { name: string }[];
        if (!columns.some(c => c.name === 'artifact_render_mode')) {
            this.db.exec("ALTER TABLE user_preferences ADD COLUMN artifact_render_mode TEXT DEFAULT 'thread'");
        }
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
     * Get the default model for a user.
     * Returns null if no default is stored.
     */
    public getDefaultModel(userId: string): string | null {
        const row = this.db.prepare(
            'SELECT default_model FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { default_model: string | null } | undefined;

        return row?.default_model ?? null;
    }

    /**
     * Get the artifact render mode preference for a user.
     * Returns 'thread' as default.
     */
    public getArtifactRenderMode(userId: string): 'thread' | 'inline' {
        const row = this.db.prepare(
            'SELECT artifact_render_mode FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { artifact_render_mode: string } | undefined;

        if (!row || row.artifact_render_mode === 'thread') return 'thread';
        return 'inline';
    }

    /**
     * Set the artifact render mode preference (upsert).
     */
    public setArtifactRenderMode(userId: string, mode: 'thread' | 'inline'): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, artifact_render_mode)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET artifact_render_mode = excluded.artifact_render_mode,
                          updated_at = datetime('now')
        `).run(userId, mode);
    }

    /**
     * Set the default model for a user (upsert).
     * Pass null to clear the default.
     */
    public setDefaultModel(userId: string, modelName: string | null): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, default_model)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET default_model = excluded.default_model,
                          updated_at = datetime('now')
        `).run(userId, modelName);
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
            defaultModel: row.default_model ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            artifactRenderMode: (row.artifact_render_mode as 'thread' | 'inline') ?? 'thread',
        };
    }
}
