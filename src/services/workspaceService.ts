import fs from 'fs';
import { resolveSafePath } from '../middleware/sanitize';

/**
 * ワークスペースのファイルシステム操作とパス検証を担うサービス。
 * WORKSPACE_BASE_DIR 配下のディレクトリを管理する。
 */
export class WorkspaceService {
    private readonly baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = baseDir;
    }

    /**
     * ベースディレクトリの存在を確認し、なければ作成する
     */
    public ensureBaseDir(): void {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * ベースディレクトリ内のサブディレクトリ一覧を返す
     */
    public scanWorkspaces(): string[] {
        this.ensureBaseDir();

        const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => entry.name)
            .sort();
    }

    /**
     * 相対パスを検証し、安全な絶対パスを返す
     * @throws パストラバーサル検出時
     */
    public validatePath(relativePath: string): string {
        return resolveSafePath(relativePath, this.baseDir);
    }

    /**
     * ベースディレクトリのパスを取得する
     */
    public getBaseDir(): string {
        return this.baseDir;
    }

    /**
     * 指定ワークスペースの絶対パスを返す
     */
    public getWorkspacePath(workspaceName: string): string {
        return this.validatePath(workspaceName);
    }

    /**
     * 指定ワークスペースが存在するか確認する
     */
    public exists(workspaceName: string): boolean {
        const fullPath = this.validatePath(workspaceName);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    }
}
