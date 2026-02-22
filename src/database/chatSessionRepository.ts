import Database from 'better-sqlite3';

/**
 * チャットセッションのレコード型定義
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
 * セッション作成時の入力型
 */
export interface CreateChatSessionInput {
    channelId: string;
    categoryId: string;
    workspacePath: string;
    sessionNumber: number;
    guildId: string;
}

/**
 * Discordチャンネルとチャットセッションの対応をSQLiteで永続化するリポジトリ。
 * 1チャンネルにつき1セッション（UNIQUE制約）。
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
     * カテゴリ内の次のセッション番号を取得する（MAX + 1、なければ 1）
     */
    public getNextSessionNumber(categoryId: string): number {
        const row = this.db.prepare(
            'SELECT MAX(session_number) as max_num FROM chat_sessions WHERE category_id = ?'
        ).get(categoryId) as any;

        return (row?.max_num ?? 0) + 1;
    }

    /**
     * セッションの表示名を更新し、is_renamed を true にする
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
