import Database from 'better-sqlite3';

/**
 * テンプレートレコードの型定義
 */
export interface TemplateRecord {
    /** 一意のID（自動採番） */
    id: number;
    /** テンプレート名（一意） */
    name: string;
    /** 実行するプロンプト */
    prompt: string;
    /** 作成日時（ISO文字列） */
    createdAt?: string;
}

/**
 * テンプレート作成時の入力型
 */
export interface CreateTemplateInput {
    name: string;
    prompt: string;
}

/**
 * テンプレート更新時の入力型（部分更新）
 */
export interface UpdateTemplateInput {
    prompt?: string;
}

/**
 * よく使うプロンプトテンプレートのSQLite永続化を担うリポジトリクラス。
 * テンプレートの保存・取得・更新・削除を行う。
 */
export class TemplateRepository {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * テーブルを初期化する（存在しなければ作成）
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
     * 新しいテンプレートを作成する
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
     * すべてのテンプレートを取得する
     */
    public findAll(): TemplateRecord[] {
        const rows = this.db.prepare('SELECT * FROM templates ORDER BY id ASC').all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * テンプレート名で検索する
     */
    public findByName(name: string): TemplateRecord | undefined {
        const row = this.db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * テンプレート名で削除する
     */
    public deleteByName(name: string): boolean {
        const result = this.db.prepare('DELETE FROM templates WHERE name = ?').run(name);
        return result.changes > 0;
    }

    /**
     * テンプレート名で部分更新する
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
     * DBの行をTemplateRecordにマッピングする
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
