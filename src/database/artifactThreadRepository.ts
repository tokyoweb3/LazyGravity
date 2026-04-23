import Database from 'better-sqlite3';

/**
 * Repository for mapping (channel_id, conversation_id, filename) to Discord thread ID.
 * This allows reusing the same thread for multiple renders of the same file.
 */
export class ArtifactThreadRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    private initialize(): void {
        const tableInfo = this.db.prepare("PRAGMA table_info('artifact_threads')").all() as any[];
        
        if (tableInfo.length === 0) {
            this.db.exec(`
                CREATE TABLE artifact_threads (
                    channel_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    thread_id TEXT NOT NULL,
                    PRIMARY KEY (channel_id, conversation_id, filename)
                )
            `);
        } else {
            const hasConvId = tableInfo.some(col => col.name === 'conversation_id');
            if (!hasConvId) {
                // To safely migrate in sqlite, we recreate the table, since we need to change the primary key
                this.db.exec(`
                    CREATE TABLE artifact_threads_new (
                        channel_id TEXT NOT NULL,
                        conversation_id TEXT NOT NULL DEFAULT '',
                        filename TEXT NOT NULL,
                        thread_id TEXT NOT NULL,
                        PRIMARY KEY (channel_id, conversation_id, filename)
                    );
                    INSERT INTO artifact_threads_new (channel_id, conversation_id, filename, thread_id)
                    SELECT channel_id, '', filename, thread_id FROM artifact_threads;
                    DROP TABLE artifact_threads;
                    ALTER TABLE artifact_threads_new RENAME TO artifact_threads;
                `);
            }
        }
    }

    /**
     * Get the stored thread ID for a specific file in a channel and conversation.
     */
    public getThreadId(channelId: string, conversationId: string, filename: string): string | null {
        const row = this.db.prepare(
            'SELECT thread_id FROM artifact_threads WHERE channel_id = ? AND conversation_id = ? AND filename = ?'
        ).get(channelId, conversationId, filename) as { thread_id: string } | undefined;
        
        return row?.thread_id ?? null;
    }

    /**
     * Set the thread ID for a specific file in a channel and conversation.
     */
    public setThreadId(channelId: string, conversationId: string, filename: string, threadId: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO artifact_threads (channel_id, conversation_id, filename, thread_id)
            VALUES (?, ?, ?, ?)
        `).run(channelId, conversationId, filename, threadId);
    }

    /**
     * Remove a stored thread ID.
     */
    public deleteThreadId(channelId: string, conversationId: string, filename: string): void {
        this.db.prepare(
            'DELETE FROM artifact_threads WHERE channel_id = ? AND conversation_id = ? AND filename = ?'
        ).run(channelId, conversationId, filename);
    }
}
