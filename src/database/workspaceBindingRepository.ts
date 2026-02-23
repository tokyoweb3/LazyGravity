import Database from 'better-sqlite3';

/**
 * ワークスペースバインディングのレコード型定義
 */
export interface WorkspaceBindingRecord {
    /** 一意のID（自動採番） */
    id: number;
    /** DiscordチャンネルID（一意） */
    channelId: string;
    /** ワークスペースの相対パス */
    workspacePath: string;
    /** DiscordギルドID */
    guildId: string;
    /** 作成日時（ISO文字列） */
    createdAt?: string;
}

/**
 * バインディング作成時の入力型
 */
export interface CreateWorkspaceBindingInput {
    channelId: string;
    workspacePath: string;
    guildId: string;
}

/**
 * DiscordチャンネルとワークスペースディレクトリのバインディングをSQLiteで永続化するリポジトリ。
 * 1チャンネルにつき1ワークスペースのみバインド可能（UNIQUE制約）。
 */
export class WorkspaceBindingRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * テーブルを初期化する（存在しなければ作成）
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workspace_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL UNIQUE,
                workspace_path TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * 新しいバインディングを作成する
     */
    public create(input: CreateWorkspaceBindingInput): WorkspaceBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO workspace_bindings (channel_id, workspace_path, guild_id)
            VALUES (?, ?, ?)
        `);

        const result = stmt.run(input.channelId, input.workspacePath, input.guildId);

        return {
            id: result.lastInsertRowid as number,
            channelId: input.channelId,
            workspacePath: input.workspacePath,
            guildId: input.guildId,
        };
    }

    /**
     * チャンネルIDでバインディングを検索する
     */
    public findByChannelId(channelId: string): WorkspaceBindingRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE channel_id = ?'
        ).get(channelId) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * ワークスペースパスとギルドIDでバインディングを検索する
     * 同一ワークスペースの重複作成防止に使用
     */
    public findByWorkspacePathAndGuildId(workspacePath: string, guildId: string): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE workspace_path = ? AND guild_id = ? ORDER BY id ASC'
        ).all(workspacePath, guildId) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * ギルドIDで全バインディングを検索する
     */
    public findByGuildId(guildId: string): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings WHERE guild_id = ? ORDER BY id ASC'
        ).all(guildId) as any[];
        return rows.map(this.mapRow);
    }

    /**
     * すべてのバインディングを取得する
     */
    public findAll(): WorkspaceBindingRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM workspace_bindings ORDER BY id ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    /**
     * チャンネルIDでバインディングを削除する
     */
    public deleteByChannelId(channelId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM workspace_bindings WHERE channel_id = ?'
        ).run(channelId);
        return result.changes > 0;
    }

    /**
     * チャンネルのバインディングを作成または更新する（upsert）
     */
    public upsert(input: CreateWorkspaceBindingInput): WorkspaceBindingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO workspace_bindings (channel_id, workspace_path, guild_id)
            VALUES (?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
                workspace_path = excluded.workspace_path,
                guild_id = excluded.guild_id
        `);

        stmt.run(input.channelId, input.workspacePath, input.guildId);

        return this.findByChannelId(input.channelId)!;
    }

    /**
     * DBの行をWorkspaceBindingRecordにマッピングする
     */
    private mapRow(row: any): WorkspaceBindingRecord {
        return {
            id: row.id,
            channelId: row.channel_id,
            workspacePath: row.workspace_path,
            guildId: row.guild_id,
            createdAt: row.created_at,
        };
    }
}
