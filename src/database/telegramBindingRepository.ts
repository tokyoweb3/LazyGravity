import Database from 'better-sqlite3';

/**
 * Telegram binding record type definition
 */
export interface TelegramBindingRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Telegram chat ID (unique) */
    chatId: string;
    /** Workspace relative path */
    workspacePath: string;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
}

/**
 * Input type for binding creation
 */
export interface CreateTelegramBindingInput {
    chatId: string;
    workspacePath: string;
}

/**
 * Repository for persisting Telegram chat to workspace directory bindings in SQLite.
 * Only one workspace can be bound per chat (UNIQUE constraint).
 */
export class TelegramBindingRepository {
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
            CREATE TABLE IF NOT EXISTS telegram_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL UNIQUE,
                workspace_path TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Create a new binding
     */
    public create(input: CreateTelegramBindingInput): TelegramBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO telegram_bindings (chat_id, workspace_path)
            VALUES (?, ?)
        `);

        const result = stmt.run(input.chatId, input.workspacePath);

        return {
            id: result.lastInsertRowid as number,
            chatId: input.chatId,
            workspacePath: input.workspacePath,
        };
    }

    /**
     * Find binding by chat ID
     */
    public findByChatId(chatId: string): TelegramBindingRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM telegram_bindings WHERE chat_id = ?'
        ).get(chatId) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Find bindings by workspace path
     */
    public findByWorkspacePath(workspacePath: string): TelegramBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM telegram_bindings WHERE workspace_path = ? ORDER BY id ASC'
        ).all(workspacePath) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Get all bindings
     */
    public findAll(): TelegramBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM telegram_bindings ORDER BY id ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Delete binding by chat ID
     */
    public deleteByChatId(chatId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM telegram_bindings WHERE chat_id = ?'
        ).run(chatId);
        return result.changes > 0;
    }

    /**
     * Create or update a chat binding (upsert)
     */
    public upsert(input: CreateTelegramBindingInput): TelegramBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO telegram_bindings (chat_id, workspace_path)
            VALUES (?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                workspace_path = excluded.workspace_path
        `);

        stmt.run(input.chatId, input.workspacePath);

        return this.findByChatId(input.chatId)!;
    }

    /**
     * Map a DB row to TelegramBindingRecord
     */
    private mapRow(row: any): TelegramBindingRecord {
        return {
            id: row.id,
            chatId: row.chat_id,
            workspacePath: row.workspace_path,
            createdAt: row.created_at,
        };
    }
}
