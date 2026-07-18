import Database from 'better-sqlite3';

/**
 * Repository for managing user account preference mappings.
 * Maps user IDs to their selected account names.
 */
export class AccountPreferenceRepository {
    /**
     * Initializes the account preferences repository and ensures the database table exists.
     * @param db The database connection instance.
     */
    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS account_preferences (
                user_id TEXT PRIMARY KEY,
                account_name TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Retrieves the saved account name for a specific user.
     * @param userId The ID of the user.
     * @returns The associated account name, or null if none is set.
     */
    getAccountName(userId: string): string | null {
        const row = this.db.prepare(
            'SELECT account_name FROM account_preferences WHERE user_id = ?',
        ).get(userId) as { account_name: string } | undefined;
        return row?.account_name ?? null;
    }

    /**
     * Sets or updates the account name associated with a user.
     * @param userId The ID of the user.
     * @param accountName The account name to associate with the user.
     */
    setAccountName(userId: string, accountName: string): void {
        this.db.prepare(`
            INSERT INTO account_preferences (user_id, account_name)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET account_name = excluded.account_name, updated_at = datetime('now')
        `).run(userId, accountName);
    }
}

