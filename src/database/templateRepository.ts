import Database from 'better-sqlite3';

/**
 * Template record type definition
 */
export interface TemplateRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Template name (unique) */
    name: string;
    /** Prompt to execute */
    prompt: string;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
}

/**
 * Input type for template creation
 */
export interface CreateTemplateInput {
    name: string;
    prompt: string;
}

/**
 * Input type for template update (partial update)
 */
export interface UpdateTemplateInput {
    prompt?: string;
}

/**
 * Repository class for SQLite persistence of frequently used prompt templates.
 * Handles template creation, retrieval, updating, and deletion.
 */
export class TemplateRepository {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * Initialize table (create if not exists)
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                prompt TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Create a new template
     */
    public create(input: CreateTemplateInput): TemplateRecord {
        const stmt = this.db.prepare(`
            INSERT INTO templates (name, prompt)
            VALUES (?, ?)
        `);

        const result = stmt.run(input.name, input.prompt);

        return {
            id: result.lastInsertRowid as number,
            name: input.name,
            prompt: input.prompt,
        };
    }

    /**
     * Get all templates
     */
    public findAll(): TemplateRecord[] {
        const rows = this.db.prepare('SELECT * FROM templates ORDER BY id ASC').all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * Find by ID
     */
    public findById(id: number): TemplateRecord | undefined {
        const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Find by template name
     */
    public findByName(name: string): TemplateRecord | undefined {
        const row = this.db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Delete by template name
     */
    public deleteByName(name: string): boolean {
        const result = this.db.prepare('DELETE FROM templates WHERE name = ?').run(name);
        return result.changes > 0;
    }

    /**
     * Partially update by template name
     */
    public updateByName(name: string, input: UpdateTemplateInput): boolean {
        const sets: string[] = [];
        const values: any[] = [];

        if (input.prompt !== undefined) {
            sets.push('prompt = ?');
            values.push(input.prompt);
        }

        if (sets.length === 0) return false;

        values.push(name);
        const sql = `UPDATE templates SET ${sets.join(', ')} WHERE name = ?`;
        const result = this.db.prepare(sql).run(...values);
        return result.changes > 0;
    }

    /**
     * Map a DB row to TemplateRecord
     */
    private mapRow(row: any): TemplateRecord {
        return {
            id: row.id,
            name: row.name,
            prompt: row.prompt,
            createdAt: row.created_at,
        };
    }
}
