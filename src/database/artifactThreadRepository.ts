import Database from 'better-sqlite3';

/**
 * Repository for mapping (channel_id, filename) to Discord thread ID.
 * This allows reusing the same thread for multiple renders of the same file.
 */
export class ArtifactThreadRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS artifact_threads (
                channel_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                PRIMARY KEY (channel_id, filename)
            )
        `);
    }

    /**
     * Get the stored thread ID for a specific file in a channel.
     */
    public getThreadId(channelId: string, filename: string): string | null {
        const row = this.db.prepare(
            'SELECT thread_id FROM artifact_threads WHERE channel_id = ? AND filename = ?'
        ).get(channelId, filename) as { thread_id: string } | undefined;
        
        return row?.thread_id ?? null;
    }

    /**
     * Set the thread ID for a specific file in a channel.
     */
    public setThreadId(channelId: string, filename: string, threadId: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO artifact_threads (channel_id, filename, thread_id)
            VALUES (?, ?, ?)
        `).run(channelId, filename, threadId);
    }

    /**
     * Remove a stored thread ID.
     */
    public deleteThreadId(channelId: string, filename: string): void {
        this.db.prepare(
            'DELETE FROM artifact_threads WHERE channel_id = ? AND filename = ?'
        ).run(channelId, filename);
    }
}
