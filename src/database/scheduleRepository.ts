import Database from 'better-sqlite3';

/**
 * スケジュールレコードの型定義
 */
export interface ScheduleRecord {
    /** 一意のID（自動採番） */
    id: number;
    /** Cron式（例: "0 9 * * *"） */
    cronExpression: string;
    /** 実行するプロンプト */
    prompt: string;
    /** 対象ワークスペースのパス */
    workspacePath: string;
    /** 有効/無効 */
    enabled: boolean;
    /** 作成日時（ISO文字列） */
    createdAt?: string;
}

/**
 * スケジュール作成時の入力型
 */
export interface CreateScheduleInput {
    cronExpression: string;
    prompt: string;
    workspacePath: string;
    enabled: boolean;
}

/**
 * スケジュール更新時の入力型（部分更新）
 */
export interface UpdateScheduleInput {
    cronExpression?: string;
    prompt?: string;
    workspacePath?: string;
    enabled?: boolean;
}

/**
 * 定期実行ジョブのSQLite永続化を担うリポジトリクラス。
 * Cron式とプロンプトの保存・取得・更新・削除を行う。
 */
export class ScheduleRepository {
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
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cron_expression TEXT NOT NULL,
                prompt TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * 新しいスケジュールを作成する
     */
    public create(input: CreateScheduleInput): ScheduleRecord {
        const stmt = this.db.prepare(`
            INSERT INTO schedules (cron_expression, prompt, workspace_path, enabled)
            VALUES (?, ?, ?, ?)
        `);

        const result = stmt.run(
            input.cronExpression,
            input.prompt,
            input.workspacePath,
            input.enabled ? 1 : 0
        );

        return {
            id: result.lastInsertRowid as number,
            cronExpression: input.cronExpression,
            prompt: input.prompt,
            workspacePath: input.workspacePath,
            enabled: input.enabled,
        };
    }

    /**
     * すべてのスケジュールを取得する
     */
    public findAll(): ScheduleRecord[] {
        const rows = this.db.prepare('SELECT * FROM schedules ORDER BY id ASC').all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * IDでスケジュールを取得する
     */
    public findById(id: number): ScheduleRecord | undefined {
        const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * 有効なスケジュールのみ取得する（Bot起動時の再登録用）
     */
    public findEnabled(): ScheduleRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM schedules WHERE enabled = 1 ORDER BY id ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * スケジュールを削除する
     */
    public delete(id: number): boolean {
        const result = this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /**
     * スケジュールを部分更新する
     */
    public update(id: number, input: UpdateScheduleInput): boolean {
        const sets: string[] = [];
        const values: any[] = [];

        if (input.cronExpression !== undefined) {
            sets.push('cron_expression = ?');
            values.push(input.cronExpression);
        }
        if (input.prompt !== undefined) {
            sets.push('prompt = ?');
            values.push(input.prompt);
        }
        if (input.workspacePath !== undefined) {
            sets.push('workspace_path = ?');
            values.push(input.workspacePath);
        }
        if (input.enabled !== undefined) {
            sets.push('enabled = ?');
            values.push(input.enabled ? 1 : 0);
        }

        if (sets.length === 0) return false;

        values.push(id);
        const sql = `UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`;
        const result = this.db.prepare(sql).run(...values);
        return result.changes > 0;
    }

    /**
     * DBの行をScheduleRecordにマッピングする
     */
    private mapRow(row: any): ScheduleRecord {
        return {
            id: row.id,
            cronExpression: row.cron_expression,
            prompt: row.prompt,
            workspacePath: row.workspace_path,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
        };
    }
}
