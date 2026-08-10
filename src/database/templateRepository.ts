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
 * Format structure for exported template JSON files
 */
export interface TemplateExportFormat {
    version: number;
    templates: Array<{
        name: string;
        prompt: string;
    }>;
}

/**
 * Result metrics for template import operations
 */
export interface ImportTemplatesResult {
    imported: number;
    updated: number;
    skipped: number;
    total: number;
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
     * Export all templates formatted as a JSON string
     */
    public exportTemplates(): string {
        const templates = this.findAll();
        const exportData: TemplateExportFormat = {
            version: 1,
            templates: templates.map((t) => ({
                name: t.name,
                prompt: t.prompt,
            })),
        };
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Import templates from JSON string or parsed object.
     * @param input Raw JSON string or object
     * @param mode Conflict resolution mode: 'skip' (default) or 'overwrite'
     */
    public importTemplates(
        input: string | any,
        mode: 'skip' | 'overwrite' = 'skip'
    ): ImportTemplatesResult {
        let data: any;
        if (typeof input === 'string') {
            try {
                data = JSON.parse(input);
            } catch (e: any) {
                throw new Error(`Invalid JSON format: ${e.message}`);
            }
        } else {
            data = input;
        }

        if (!data || typeof data !== 'object') {
            throw new Error('Invalid JSON content: expected an object.');
        }

        if (!Array.isArray(data.templates)) {
            throw new Error('Invalid format: missing "templates" array.');
        }

        for (let i = 0; i < data.templates.length; i++) {
            const item = data.templates[i];
            if (!item || typeof item !== 'object') {
                throw new Error(`Invalid item at index ${i}: expected object.`);
            }
            if (typeof item.name !== 'string' || !item.name.trim()) {
                throw new Error(`Invalid item at index ${i}: "name" must be a non-empty string.`);
            }
            if (typeof item.prompt !== 'string') {
                throw new Error(`Invalid item at index ${i}: "prompt" must be a string.`);
            }
        }

        let imported = 0;
        let updated = 0;
        let skipped = 0;

        const runImport = this.db.transaction(() => {
            for (const item of data.templates) {
                const name = item.name.trim();
                const prompt = item.prompt;
                const existing = this.findByName(name);

                if (existing) {
                    if (mode === 'overwrite') {
                        this.updateByName(name, { prompt });
                        updated++;
                    } else {
                        skipped++;
                    }
                } else {
                    this.create({ name, prompt });
                    imported++;
                }
            }
        });

        runImport();

        return {
            imported,
            updated,
            skipped,
            total: data.templates.length,
        };
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

