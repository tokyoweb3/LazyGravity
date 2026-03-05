import Database from 'better-sqlite3';

export class AccountPreferenceRepository {
    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS account_preferences (
                user_id TEXT PRIMARY KEY,
                account_name TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    getAccountName(userId: string): string | null {
        const row = this.db.prepare('SELECT account_name FROM account_preferences WHERE user_id = ?').get(userId) as { account_name: string } | undefined;
        return row?.account_name ?? null;
    }

    setAccountName(userId: string, accountName: string): void {
        this.db.prepare(`
            INSERT INTO account_preferences (user_id, account_name)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET account_name = excluded.account_name, updated_at = datetime('now')
        `).run(userId, accountName);
    }
}
