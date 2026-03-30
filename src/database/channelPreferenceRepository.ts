import Database from 'better-sqlite3';

export class ChannelPreferenceRepository {
    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_preferences (
                channel_id TEXT PRIMARY KEY,
                account_name TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    getAccountName(channelId: string): string | null {
        const row = this.db.prepare(
            'SELECT account_name FROM channel_preferences WHERE channel_id = ?',
        ).get(channelId) as { account_name: string | null } | undefined;
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
}
