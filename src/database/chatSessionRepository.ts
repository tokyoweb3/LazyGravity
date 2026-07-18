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
    conversationId: string | null;
    activeAccountName: string | null;
    originAccountName: string | null;
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
    activeAccountName?: string | null;
    guildId: string;
}

/**
 * Repository for persisting Discord channel to chat session mapping in SQLite.
 * One session per channel (UNIQUE constraint).
 */
export class ChatSessionRepository {
    private readonly db: Database.Database;

    /**
     * Initializes the repository and triggers schema updates.
     * @param db SQLite database connection.
     */
    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * Creates the table schema and updates it for newer migrations/columns.
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL UNIQUE,
                category_id TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                session_number INTEGER NOT NULL,
                conversation_id TEXT,
                active_account_name TEXT,
                origin_account_name TEXT,
                display_name TEXT,
                is_renamed INTEGER NOT NULL DEFAULT 0,
                guild_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        const columns = this.db.prepare('PRAGMA table_info(chat_sessions)').all() as Array<{ name: string }>;
        const hasActiveAccountName = columns.some((column) => column.name === 'active_account_name');
        const hasConversationId = columns.some((column) => column.name === 'conversation_id');
        if (!hasConversationId) {
            this.db.exec('ALTER TABLE chat_sessions ADD COLUMN conversation_id TEXT');
        }
        if (!hasActiveAccountName) {
            this.db.exec('ALTER TABLE chat_sessions ADD COLUMN active_account_name TEXT');
        }
        const hasOriginAccountName = columns.some((column) => column.name === 'origin_account_name');
        if (!hasOriginAccountName) {
            this.db.exec('ALTER TABLE chat_sessions ADD COLUMN origin_account_name TEXT');
        }

        const hasLegacyAccountName = columns.some((column) => column.name === 'account_name');
        if (hasLegacyAccountName) {
            this.db.exec(`
                UPDATE chat_sessions
                SET origin_account_name = account_name
                WHERE origin_account_name IS NULL AND account_name IS NOT NULL
            `);
            this.db.exec(`
                UPDATE chat_sessions
                SET active_account_name = COALESCE(active_account_name, origin_account_name, account_name)
                WHERE active_account_name IS NULL
            `);
        } else {
            this.db.exec(`
                UPDATE chat_sessions
                SET active_account_name = origin_account_name
                WHERE active_account_name IS NULL AND origin_account_name IS NOT NULL
            `);
        }
    }

    /**
     * Persists a new chat session database entry.
     * @param input Data required to register the chat session.
     * @returns The fully constructed ChatSessionRecord.
     */
    public create(input: CreateChatSessionInput): ChatSessionRecord {
        const activeAccountName = input.activeAccountName ?? null;
        const stmt = this.db.prepare(`
            INSERT INTO chat_sessions (channel_id, category_id, workspace_path, session_number, active_account_name, origin_account_name, guild_id)
            VALUES (?, ?, ?, ?, ?, NULL, ?)
        `);

        const result = stmt.run(
            input.channelId,
            input.categoryId,
            input.workspacePath,
            input.sessionNumber,
            activeAccountName,
            input.guildId,
        );

        return {
            id: result.lastInsertRowid as number,
            channelId: input.channelId,
            categoryId: input.categoryId,
            workspacePath: input.workspacePath,
            sessionNumber: input.sessionNumber,
            conversationId: null,
            activeAccountName,
            originAccountName: null,
            displayName: null,
            isRenamed: false,
            guildId: input.guildId,
        };
    }

    /**
     * Finds a chat session by its Discord channel ID.
     * @param channelId The channel ID to search by.
     * @returns The ChatSessionRecord if found, otherwise undefined.
     */
    public findByChannelId(channelId: string): ChatSessionRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM chat_sessions WHERE channel_id = ?'
        ).get(channelId) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Retrieves all chat sessions associated with a specific channel category.
     * @param categoryId The category ID to query by.
     * @returns Array of matching ChatSessionRecord, ordered by session number.
     */
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

    /**
     * Updates the active account name linked with a chat session.
     * @param channelId The target channel ID.
     * @param accountName The new active account name.
     * @returns True if updated successfully, false otherwise.
     */
    public setActiveAccountName(channelId: string, accountName: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET active_account_name = ? WHERE channel_id = ?'
        ).run(accountName, channelId);
        return result.changes > 0;
    }

    /**
     * Updates the original account name linked with a chat session.
     * @param channelId The target channel ID.
     * @param accountName The origin account name.
     * @returns True if updated successfully, false otherwise.
     */
    public setOriginAccountName(channelId: string, accountName: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET origin_account_name = ? WHERE channel_id = ?'
        ).run(accountName, channelId);
        return result.changes > 0;
    }

    /**
     * Associates a specific conversation ID with a chat session.
     * @param channelId The target channel ID.
     * @param conversationId The IDE conversation ID.
     * @returns True if updated successfully, false otherwise.
     */
    public setConversationId(channelId: string, conversationId: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET conversation_id = ? WHERE channel_id = ?'
        ).run(conversationId, channelId);
        return result.changes > 0;
    }

    /**
     * Initializes the conversation ID if it is currently unset (null).
     * @param channelId The target channel ID.
     * @param conversationId The initial conversation ID.
     * @returns True if updated successfully, false otherwise.
     */
    public initializeConversationId(channelId: string, conversationId: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET conversation_id = ? WHERE channel_id = ? AND conversation_id IS NULL'
        ).run(conversationId, channelId);
        return result.changes > 0;
    }

    /**
     * Initializes the original account name if it is currently unset (null).
     * @param channelId The target channel ID.
     * @param accountName The default origin account name.
     * @returns True if updated successfully, false otherwise.
     */
    public initializeOriginAccountName(channelId: string, accountName: string): boolean {
        const result = this.db.prepare(
            'UPDATE chat_sessions SET origin_account_name = ? WHERE channel_id = ? AND origin_account_name IS NULL'
        ).run(accountName, channelId);
        return result.changes > 0;
    }

    /**
     * Find a session by display name within a workspace.
     * Returns the first match (most recent).
     */
    public findByDisplayName(workspacePath: string, displayName: string): ChatSessionRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM chat_sessions WHERE workspace_path = ? AND display_name = ? ORDER BY id DESC LIMIT 1'
        ).get(workspacePath, displayName) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Removes a chat session from database storage.
     * @param channelId The target channel ID.
     * @returns True if deleted successfully, false otherwise.
     */
    public deleteByChannelId(channelId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM chat_sessions WHERE channel_id = ?'
        ).run(channelId);
        return result.changes > 0;
    }

    /**
     * Maps database row columns to a structured ChatSessionRecord object.
     * @param row Database row object.
     * @returns Fully parsed ChatSessionRecord.
     */
    private mapRow(row: any): ChatSessionRecord {
        return {
            id: row.id,
            channelId: row.channel_id,
            categoryId: row.category_id,
            workspacePath: row.workspace_path,
            sessionNumber: row.session_number,
            conversationId: row.conversation_id ?? null,
            activeAccountName: row.active_account_name ?? row.account_name ?? null,
            originAccountName: row.origin_account_name ?? null,
            displayName: row.display_name,
            isRenamed: row.is_renamed === 1,
            guildId: row.guild_id,
            createdAt: row.created_at,
        };
    }
}

