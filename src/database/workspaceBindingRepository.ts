import Database from 'better-sqlite3';

/**
 * Workspace binding record type definition
 */
export interface WorkspaceBindingRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Discord channel ID (unique) */
    channelId: string;
    /** Workspace relative path */
    workspacePath: string;
    /** Discord guild ID */
    guildId: string;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
}

/**
 * Input type for binding creation
 */
export interface CreateWorkspaceBindingInput {
    channelId: string;
    workspacePath: string;
    guildId: string;
}

/**
 * Repository for persisting Discord channel to workspace directory bindings in SQLite.
 * Only one workspace can be bound per channel (UNIQUE constraint).
 */
export class WorkspaceBindingRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * Initialize table (create if not exists)
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workspace_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL UNIQUE,
                workspace_path TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Create a new binding
     */
    public create(input: CreateWorkspaceBindingInput): WorkspaceBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO workspace_bindings (channel_id, workspace_path, guild_id)
            VALUES (?, ?, ?)
        `);

        const result = stmt.run(input.channelId, input.workspacePath, input.guildId);

        return {
            id: result.lastInsertRowid as number,
            channelId: input.channelId,
            workspacePath: input.workspacePath,
            guildId: input.guildId,
        };
    }

    /**
     * Find binding by channel ID
     */
    public findByChannelId(channelId: string): WorkspaceBindingRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE channel_id = ?'
        ).get(channelId) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Find bindings by workspace path and guild ID
     * Used to prevent duplicate workspace creation
     */
    public findByWorkspacePathAndGuildId(workspacePath: string, guildId: string): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE workspace_path = ? AND guild_id = ? ORDER BY id ASC'
        ).all(workspacePath, guildId) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Find all bindings by guild ID
     */
    public findByGuildId(guildId: string): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE guild_id = ? ORDER BY id ASC'
        ).all(guildId) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Get all bindings
     */
    public findAll(): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings ORDER BY id ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Delete binding by channel ID
     */
    public deleteByChannelId(channelId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM workspace_bindings WHERE channel_id = ?'
        ).run(channelId);
        return result.changes > 0;
    }

    /**
     * Create or update a channel binding (upsert)
     */
    public upsert(input: CreateWorkspaceBindingInput): WorkspaceBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO workspace_bindings (channel_id, workspace_path, guild_id)
            VALUES (?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
                workspace_path = excluded.workspace_path,
                guild_id = excluded.guild_id
        `);

        stmt.run(input.channelId, input.workspacePath, input.guildId);

        return this.findByChannelId(input.channelId)!;
    }

    /**
     * Map a DB row to WorkspaceBindingRecord
     */
    private mapRow(row: any): WorkspaceBindingRecord {
        return {
            id: row.id,
            channelId: row.channel_id,
            workspacePath: row.workspace_path,
            guildId: row.guild_id,
            createdAt: row.created_at,
        };
    }
}
