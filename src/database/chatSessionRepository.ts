import Database from 'better-sqlite3';

/**
 * Chat session record type definition
 */
export interface ChatSessionRecord {
    id: number;
    channelId: string;
    categoryId: string;
    workspacePath: string;
    sessionNumber: number;
    displayName: string | null;
    isRenamed: boolean;
    guildId: string;
    createdAt?: string;
}

/**
 * Input type for session creation
 */
export interface CreateChatSessionInput {
    channelId: string;
    categoryId: string;
    workspacePath: string;
    sessionNumber: number;
    guildId: string;
}

/**
 * Repository for persisting Discord channel to chat session mapping in SQLite.
 * One session per channel (UNIQUE constraint).
 */
export class ChatSessionRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL UNIQUE,
                category_id TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                session_number INTEGER NOT NULL,
                display_name TEXT,
                is_renamed INTEGER NOT NULL DEFAULT 0,
                guild_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    public create(input: CreateChatSessionInput): ChatSessionRecord {
        const stmt = this.db.prepare(`
            INSERT INTO chat_sessions (channel_id, category_id, workspace_path, session_number, guild_id)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            input.channelId,
            input.categoryId,
            input.workspacePath,
            input.sessionNumber,
            input.guildId,
        );

        return {
            id: result.lastInsertRowid as number,
            channelId: input.channelId,
            categoryId: input.categoryId,
            workspacePath: input.workspacePath,
            sessionNumber: input.sessionNumber,
            displayName: null,
            isRenamed: false,
            guildId: input.guildId,
        };
    }

    public findByChannelId(channelId: string): ChatSessionRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM chat_sessions WHERE channel_id = ?'
        ).get(channelId) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public findByCategoryId(categoryId: string): ChatSessionRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM chat_sessions WHERE category_id = ? ORDER BY session_number ASC'
        ).all(categoryId) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Get the next session number within a category (MAX + 1, or 1 if none)
     */
    public getNextSessionNumber(categoryId: string): number {
        const row = this.db.prepare(
            'SELECT MAX(session_number) as max_num FROM chat_sessions WHERE category_id = ?'
        ).get(categoryId) as any;

        return (row?.max_num ?? 0) + 1;
    }

    /**
     * Update session display name and set is_renamed to true
     */
    public updateDisplayName(channelId: string, displayName: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET display_name = ?, is_renamed = 1 WHERE channel_id = ?'
        ).run(displayName, channelId);
        return result.changes > 0;
    }

    public deleteByChannelId(channelId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM chat_sessions WHERE channel_id = ?'
        ).run(channelId);
        return result.changes > 0;
    }

    private mapRow(row: any): ChatSessionRecord {
        return {
            id: row.id,
            channelId: row.channel_id,
            categoryId: row.category_id,
            workspacePath: row.workspace_path,
            sessionNumber: row.session_number,
            displayName: row.display_name,
            isRenamed: row.is_renamed === 1,
            guildId: row.guild_id,
            createdAt: row.created_at,
        };
    }
}
