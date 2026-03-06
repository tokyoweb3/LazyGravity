import Database from 'better-sqlite3';

export class ChannelPreferenceRepository {
    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_preferences (
                channel_id TEXT PRIMARY KEY,
                account_name TEXT,
                deep_think_count INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    getAccountName(channelId: string): string | null {
        const row = this.db.prepare('SELECT account_name FROM channel_preferences WHERE channel_id = ?').get(channelId) as { account_name: string | null } | undefined;
        return row?.account_name ?? null;
    }

    setAccountName(channelId: string, accountName: string): void {
        this.db.prepare(`
            INSERT INTO channel_preferences (channel_id, account_name)
            VALUES (?, ?)
            ON CONFLICT(channel_id)
            DO UPDATE SET account_name = excluded.account_name, updated_at = datetime('now')
        `).run(channelId, accountName);
    }

    getDeepThinkCount(channelId: string): number {
        const row = this.db.prepare('SELECT deep_think_count FROM channel_preferences WHERE channel_id = ?').get(channelId) as { deep_think_count: number } | undefined;
        return row?.deep_think_count && row.deep_think_count > 0 ? row.deep_think_count : 1;
    }

    setDeepThinkCount(channelId: string, count: number): void {
        const safeCount = Number.isInteger(count) && count > 0 ? count : 1;
        this.db.prepare(`
            INSERT INTO channel_preferences (channel_id, deep_think_count)
            VALUES (?, ?)
            ON CONFLICT(channel_id)
            DO UPDATE SET deep_think_count = excluded.deep_think_count, updated_at = datetime('now')
        `).run(channelId, safeCount);
    }
}
