import { logger } from '../utils/logger';
import { CdpService, CdpServiceOptions } from './cdpService';
import { ApprovalDetector } from './approvalDetector';

/**
 * ワークスペースごとに独立した CdpService インスタンスを管理するプール。
 *
 * 各ワークスペースが独自の WebSocket / contexts / pendingCalls を持つため、
 * ワークスペースA の ResponseMonitor がポーリング中にワークスペースB へ切替えても
 * A の WebSocket が破壊されない。
 */
export class CdpConnectionPool {
    private readonly connections = new Map<string, CdpService>();
    private readonly approvalDetectors = new Map<string, ApprovalDetector>();
    private readonly connectingPromises = new Map<string, Promise<CdpService>>();
    private readonly cdpOptions: CdpServiceOptions;

    constructor(cdpOptions: CdpServiceOptions = {}) {
        this.cdpOptions = cdpOptions;
    }

    /**
     * ワークスペースパスから CdpService を取得する。
     * 未接続の場合は新規接続を行い、キャッシュする。
     * 同時接続を Promise ロックで防止する。
     *
     * @param workspacePath ワークスペースのフルパス
     * @returns 接続済みの CdpService
     */
    async getOrConnect(workspacePath: string): Promise<CdpService> {
        const dirName = this.extractDirName(workspacePath);

        // 既存接続がある場合はそのまま返す
        const existing = this.connections.get(dirName);
        if (existing && existing.isConnected()) {
            return existing;
        }

        // 既に接続中のPromiseがある場合はそれを待つ（同時接続防止）
        const pending = this.connectingPromises.get(dirName);
        if (pending) {
            return pending;
        }

        // 新規接続を開始
        const connectPromise = this.createAndConnect(workspacePath, dirName);
        this.connectingPromises.set(dirName, connectPromise);

        try {
            const cdp = await connectPromise;
            return cdp;
        } finally {
            this.connectingPromises.delete(dirName);
        }
    }

    /**
     * 接続済みの CdpService を取得する（読み取り専用）。
     * 未接続の場合は null を返す。
     */
    getConnected(workspaceDirName: string): CdpService | null {
        const cdp = this.connections.get(workspaceDirName);
        if (cdp && cdp.isConnected()) {
            return cdp;
        }
        return null;
    }

    /**
     * 指定ワークスペースの接続を切断する。
     */
    disconnectWorkspace(workspaceDirName: string): void {
        const cdp = this.connections.get(workspaceDirName);
        if (cdp) {
            cdp.disconnect().catch((err) => {
                logger.error(`[CdpConnectionPool] ${workspaceDirName} の切断中にエラー:`, err);
            });
            this.connections.delete(workspaceDirName);
        }

        const detector = this.approvalDetectors.get(workspaceDirName);
        if (detector) {
            detector.stop();
            this.approvalDetectors.delete(workspaceDirName);
        }
    }

    /**
     * 全てのワークスペース接続を切断する。
     */
    disconnectAll(): void {
        for (const dirName of [...this.connections.keys()]) {
            this.disconnectWorkspace(dirName);
        }
    }

    /**
     * ワークスペースに承認検出器を登録する。
     */
    registerApprovalDetector(workspaceDirName: string, detector: ApprovalDetector): void {
        // 既存の検出器を停止
        const existing = this.approvalDetectors.get(workspaceDirName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.approvalDetectors.set(workspaceDirName, detector);
    }

    /**
     * ワークスペースの承認検出器を取得する。
     */
    getApprovalDetector(workspaceDirName: string): ApprovalDetector | undefined {
        return this.approvalDetectors.get(workspaceDirName);
    }

    /**
     * アクティブな接続のワークスペース名一覧を返す。
     */
    getActiveWorkspaceNames(): string[] {
        const active: string[] = [];
        for (const [name, cdp] of this.connections) {
            if (cdp.isConnected()) {
                active.push(name);
            }
        }
        return active;
    }

    /**
     * ワークスペースパスからディレクトリ名を抽出する。
     */
    extractDirName(workspacePath: string): string {
        return workspacePath.split('/').filter(Boolean).pop() || workspacePath;
    }

    /**
     * 新しい CdpService を作成し、ワークスペースに接続する。
     */
    private async createAndConnect(workspacePath: string, dirName: string): Promise<CdpService> {
        // 古い接続があれば切断
        const old = this.connections.get(dirName);
        if (old) {
            await old.disconnect().catch(() => {});
            this.connections.delete(dirName);
        }

        const cdp = new CdpService(this.cdpOptions);

        // 切断時に自動クリーンアップ
        cdp.on('disconnected', () => {
            logger.error(`[CdpConnectionPool] ワークスペース "${dirName}" が切断されました`);
            // 再接続が失敗した場合にのみ Map から削除する
            // （CdpService 内部で再接続を試みるため、ここでは削除しない）
        });

        cdp.on('reconnectFailed', () => {
            logger.error(`[CdpConnectionPool] ワークスペース "${dirName}" の再接続が失敗しました。プールから削除します`);
            this.connections.delete(dirName);
            const detector = this.approvalDetectors.get(dirName);
            if (detector) {
                detector.stop();
                this.approvalDetectors.delete(dirName);
            }
        });

        // ワークスペースに接続
        await cdp.discoverAndConnectForWorkspace(workspacePath);
        this.connections.set(dirName, cdp);

        return cdp;
    }
}
