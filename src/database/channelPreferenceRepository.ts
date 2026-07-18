import Database from 'better-sqlite3';

/**
 * Repository for managing channel-specific account preference mappings.
 * Maps a Discord/Telegram channel ID to a configured account name.
 */
export class ChannelPreferenceRepository {
    /**
     * Initializes the channel preferences repository and ensures the database table exists.
     * @param db The database connection instance.
     */
    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_preferences (
                channel_id TEXT PRIMARY KEY,
                account_name TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Retrieves the saved account name for a specific channel.
     * @param channelId The ID of the channel.
     * @returns The associated account name, or null if none is set.
     */
    getAccountName(channelId: string): string | null {
        const row = this.db.prepare(
            'SELECT account_name FROM channel_preferences WHERE channel_id = ?',
        ).get(channelId) as { account_name: string | null } | undefined;
        return row?.account_name ?? null;
    }

    /**
     * Sets or updates the account name associated with a channel.
     * @param channelId The ID of the channel.
     * @param accountName The account name to associate with the channel.
     */
    setAccountName(channelId: string, accountName: string): void {
        this.db.prepare(`
            INSERT INTO channel_preferences (channel_id, account_name)
            VALUES (?, ?)
            ON CONFLICT(channel_id)
            DO UPDATE SET account_name = excluded.account_name, updated_at = datetime('now')
        `).run(channelId, accountName);
    }
}

