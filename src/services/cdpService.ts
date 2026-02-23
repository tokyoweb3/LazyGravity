import { EventEmitter } from 'events';
import * as http from 'http';
import WebSocket from 'ws';

export interface CdpServiceOptions {
    portsToScan?: number[];
    cdpCallTimeout?: number;
    /** 切断時の自動再接続試行回数。0は再接続しない。デフォルト: 3 */
    maxReconnectAttempts?: number;
    /** 再接続試行間のディレイ（ミリ秒）。デフォルト: 2000 */
    reconnectDelayMs?: number;
}

export interface CdpContext {
    id: number;
    name: string;
    url: string;
}

export interface InjectResult {
    ok: boolean;
    method?: string;
    contextId?: number;
    error?: string;
}

/** UI同期操作結果の型定義 (Step 9) */
export interface UiSyncResult {
    ok: boolean;
    /** 設定されたモード名（setUiMode成功時） */
    mode?: string;
    /** 設定されたモデル名（setUiModel成功時） */
    model?: string;
    error?: string;
}

/** Antigravity UIのDOMセレクター定数 */
const SELECTORS = {
    /** チャット入力ボックス: xterm を除いた textbox */
    CHAT_INPUT: 'div[role="textbox"]:not(.xterm-helper-textarea)',
    /** 送信ボタン検索対象タグ */
    SUBMIT_BUTTON_CONTAINER: 'button',
    /** 送信アイコンのSVGクラス候補 */
    SUBMIT_BUTTON_SVG_CLASSES: ['lucide-arrow-right', 'lucide-arrow-up', 'lucide-send'],
    /** メッセージ注入対象コンテキストを識別するキーワード */
    CONTEXT_URL_KEYWORD: 'cascade-panel',
};

export class CdpService extends EventEmitter {
    private ports: number[];
    private isConnectedFlag: boolean = false;
    private ws: WebSocket | null = null;
    private contexts: CdpContext[] = [];
    private pendingCalls = new Map<number, { resolve: Function, reject: Function, timeoutId: NodeJS.Timeout }>();
    private idCounter = 1;
    private cdpCallTimeout = 30000;
    private targetUrl: string | null = null;
    /** 切断時の自動再接続試行回数 */
    private maxReconnectAttempts: number;
    /** 再接続試行間のディレイ（ミリ秒） */
    private reconnectDelayMs: number;
    /** 現在の再接続試行回数 */
    private reconnectAttemptCount: number = 0;
    /** 再接続中フラグ（二重接続防止） */
    private isReconnecting: boolean = false;
    /** 現在接続中のワークスペース名 */
    private currentWorkspaceName: string | null = null;
    /** ワークスペース切替中フラグ（disconnectedイベント抑制用） */
    private isSwitchingWorkspace: boolean = false;

    constructor(options: CdpServiceOptions = {}) {
        super();
        this.ports = options.portsToScan || [9222, 9223, 9333, 9444, 9555, 9666];
        if (options.cdpCallTimeout) this.cdpCallTimeout = options.cdpCallTimeout;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    }

    private async getJson(url: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }

    async discoverTarget(): Promise<string> {
        for (const port of this.ports) {
            try {
                const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                let target = list.find(t =>
                    t.type === 'page' &&
                    t.webSocketDebuggerUrl &&
                    !t.title?.includes('Launchpad') &&
                    !t.url?.includes('workbench-jetski-agent') &&
                    (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade'))
                );

                if (!target) {
                    target = list.find(t =>
                        t.webSocketDebuggerUrl &&
                        (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade')) &&
                        !t.title?.includes('Launchpad')
                    );
                }

                if (!target) {
                    target = list.find(t =>
                        t.webSocketDebuggerUrl &&
                        (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade') || t.title?.includes('Launchpad'))
                    );
                }

                if (target && target.webSocketDebuggerUrl) {
                    this.targetUrl = target.webSocketDebuggerUrl;
                    // タイトルからワークスペース名を抽出（例: "ProjectName — Antigravity"）
                    if (target.title && !this.currentWorkspaceName) {
                        const titleParts = target.title.split(/\s[—–-]\s/);
                        if (titleParts.length > 0) {
                            this.currentWorkspaceName = titleParts[0].trim();
                        }
                    }
                    return target.webSocketDebuggerUrl;
                }
            } catch (e) {
                // Ignore port not found
            }
        }
        throw new Error('CDP target not found on any port.');
    }

    async connect(): Promise<void> {
        if (!this.targetUrl) {
            await this.discoverTarget();
        }

        if (!this.targetUrl) throw new Error('Target URL not established.');

        this.ws = new WebSocket(this.targetUrl);

        await new Promise<void>((resolve, reject) => {
            if (!this.ws) return reject(new Error('WebSocket not initialized'));
            this.ws.on('open', () => {
                this.isConnectedFlag = true;
                resolve();
            });
            this.ws.on('error', reject);
        });

        this.ws.on('message', (msg: WebSocket.Data) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id !== undefined && this.pendingCalls.has(data.id)) {
                    const { resolve, reject, timeoutId } = this.pendingCalls.get(data.id)!;
                    clearTimeout(timeoutId);
                    this.pendingCalls.delete(data.id);
                    if (data.error) reject(data.error); else resolve(data.result);
                }

                if (data.method === 'Runtime.executionContextCreated') {
                    this.contexts.push(data.params.context);
                }
                if (data.method === 'Runtime.executionContextDestroyed') {
                    const idx = this.contexts.findIndex(c => c.id === data.params.executionContextId);
                    if (idx !== -1) this.contexts.splice(idx, 1);
                }
            } catch (e) { }
        });

        this.ws.on('close', () => {
            this.isConnectedFlag = false;
            // 切断時に未解決のpendingCallsを全てrejectしてメモリリークを防ぐ
            this.clearPendingCalls(new Error('WebSocket切断'));
            this.ws = null;
            this.targetUrl = null;
            // ワークスペース切替中はdisconnectedイベントと自動再接続を抑制
            if (this.isSwitchingWorkspace) return;
            this.emit('disconnected');
            // 自動再接続を試みる（maxReconnectAttempts > 0の場合）
            if (this.maxReconnectAttempts > 0 && !this.isReconnecting) {
                this.tryReconnect();
            }
        });

        // Initialize Runtime to get execution contexts
        await this.call('Runtime.enable', {});
    }

    async call(method: string, params: any = {}): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }

        return new Promise((resolve, reject) => {
            const id = this.idCounter++;
            const timeoutId = setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error(`Timeout calling CDP method ${method}`));
                }
            }, this.cdpCallTimeout);

            this.pendingCalls.set(id, { resolve, reject, timeoutId });
            this.ws!.send(JSON.stringify({ id, method, params }));
        });
    }

    async disconnect(): Promise<void> {
        // 再接続を停止させる
        this.maxReconnectAttempts = 0;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnectedFlag = false;
        this.contexts = [];
        this.clearPendingCalls(new Error('disconnect()が呼ばれました'));
    }

    /**
     * 現在接続中のワークスペース名を返す
     */
    getCurrentWorkspaceName(): string | null {
        return this.currentWorkspaceName;
    }

    /**
     * 指定ワークスペースのworkbenchページを発見し、そのページに接続する。
     * 既に正しいページに接続中の場合は何もしない。
     *
     * @param workspacePath ワークスペースのフルパス（例: /home/user/Code/MyProject）
     * @returns 接続成功時 true
     */
    async discoverAndConnectForWorkspace(workspacePath: string): Promise<boolean> {
        const workspaceDirName = workspacePath.split('/').filter(Boolean).pop() || '';

        // 既に正しいワークスペースに接続中なら何もしない
        if (this.isConnectedFlag && this.currentWorkspaceName === workspaceDirName) {
            return true;
        }

        this.isSwitchingWorkspace = true;
        try {
            return await this._discoverAndConnectForWorkspaceImpl(workspacePath, workspaceDirName);
        } finally {
            this.isSwitchingWorkspace = false;
        }
    }

    private async _discoverAndConnectForWorkspaceImpl(
        workspacePath: string,
        workspaceDirName: string,
    ): Promise<boolean> {
        // 全ポートをスキャンしてworkbenchページを収集
        let pages: any[] = [];
        let respondingPort: number | null = null;

        for (const port of this.ports) {
            try {
                const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                // workbench を含むページがあるポートを優先
                const hasWorkbench = list.some((t: any) => t.url?.includes('workbench'));
                if (hasWorkbench) {
                    pages = list;
                    respondingPort = port;
                    break;
                }
                // workbench がなくても応答があれば控えておく
                if (pages.length === 0) {
                    pages = list;
                    respondingPort = port;
                }
            } catch {
                // このポートは応答なし、次へ
            }
        }

        if (respondingPort === null) {
            // どのポートにも接続できない場合、Antigravityを起動
            return this.launchAndConnectWorkspace(workspacePath, workspaceDirName);
        }

        // workbenchページのみをフィルタ（Launchpad, Manager, iframe, worker除外）
        const workbenchPages = pages.filter(
            (t: any) =>
                t.type === 'page' &&
                t.webSocketDebuggerUrl &&
                !t.title?.includes('Launchpad') &&
                !t.url?.includes('workbench-jetski-agent') &&
                t.url?.includes('workbench'),
        );

        console.error(`[CdpService] ワークスペース "${workspaceDirName}" を検索中 (port=${respondingPort})... workbenchページ ${workbenchPages.length} 件:`);
        for (const p of workbenchPages) {
            console.error(`  - title="${p.title}" url=${p.url}`);
        }

        // 1. タイトルマッチ（高速パス）
        const titleMatch = workbenchPages.find((t: any) => t.title?.includes(workspaceDirName));
        if (titleMatch) {
            return this.connectToPage(titleMatch, workspaceDirName);
        }

        // 2. タイトルマッチ失敗 → CDPプローブ（各ページに接続してdocument.titleを確認）
        console.error(`[CdpService] タイトルマッチ失敗。CDPプローブで検索します...`);
        const probeResult = await this.probeWorkbenchPages(workbenchPages, workspaceDirName, workspacePath);
        if (probeResult) {
            return true;
        }

        // 3. プローブでも見つからない場合、新規ウィンドウを起動
        return this.launchAndConnectWorkspace(workspacePath, workspaceDirName);
    }

    /**
     * 指定ページに接続する（既に接続中の場合はスキップ）
     */
    private async connectToPage(page: any, workspaceDirName: string): Promise<boolean> {
        // 既に同じURLに接続中なら再接続不要
        if (this.isConnectedFlag && this.targetUrl === page.webSocketDebuggerUrl) {
            this.currentWorkspaceName = workspaceDirName;
            return true;
        }

        this.disconnectQuietly();
        this.targetUrl = page.webSocketDebuggerUrl;
        await this.connect();
        this.currentWorkspaceName = workspaceDirName;
        console.error(`[CdpService] ワークスペース "${workspaceDirName}" に接続しました`);

        return true;
    }

    /**
     * 各workbenchページにCDP接続してdocument.titleを取得し、ワークスペース名を検出する。
     * /json/list のタイトルが古い・不完全な場合のフォールバック。
     *
     * タイトルが "Untitled (Workspace)" の場合は、ワークスペースのフォルダパスを
     * CDP経由で確認し、ワークスペースを特定する。
     *
     * @param workbenchPages workbenchページの一覧
     * @param workspaceDirName ワークスペースのディレクトリ名
     * @param workspacePath ワークスペースのフルパス（フォルダパスマッチング用）
     */
    private async probeWorkbenchPages(
        workbenchPages: any[],
        workspaceDirName: string,
        workspacePath?: string,
    ): Promise<boolean> {
        for (const page of workbenchPages) {
            try {
                // 一時的に接続してdocument.titleを取得
                this.disconnectQuietly();
                this.targetUrl = page.webSocketDebuggerUrl;
                await this.connect();

                const result = await this.call('Runtime.evaluate', {
                    expression: 'document.title',
                    returnByValue: true,
                });
                const liveTitle = result?.result?.value || '';
                console.error(`[CdpService] プローブ: page.id=${page.id} liveTitle="${liveTitle}"`);

                if (liveTitle.includes(workspaceDirName)) {
                    this.currentWorkspaceName = workspaceDirName;
                    console.error(`[CdpService] プローブ成功: "${workspaceDirName}" を検出しました`);
                    return true;
                }

                // タイトルが "Untitled (Workspace)" の場合、フォルダパスで確認
                if (liveTitle.includes('Untitled') && workspacePath) {
                    const folderMatch = await this.probeWorkspaceFolderPath(workspaceDirName, workspacePath);
                    if (folderMatch) {
                        return true;
                    }
                }
            } catch (e) {
                console.error(`[CdpService] プローブ失敗 (page.id=${page.id}):`, e);
            }
        }

        // プローブ完了、見つからなかった → 切断状態に戻す
        this.disconnectQuietly();
        return false;
    }

    /**
     * 現在接続中のページが指定ワークスペースのフォルダを開いているか確認する。
     * Antigravity (VS Code系) では document.querySelector('.explorer-folders-view') や
     * ウィンドウタイトル設定API等から情報を取得できる場合がある。
     * 
     * 複数の手法でフォルダパスを検出:
     * 1. VS Code APIの vscode.workspace.workspaceFolders を確認
     * 2. DOM内のフォルダパス表示を確認
     * 3. window.location.hash 等からワークスペース情報を取得
     */
    private async probeWorkspaceFolderPath(
        workspaceDirName: string,
        workspacePath: string,
    ): Promise<boolean> {
        try {
            // DOMやdocument.titleの代わりに、ページURL内のfolder parameterや
            // エクスプローラービューのフォルダ名を確認する
            const expression = `(() => {
                // 方法1: ウィンドウタイトルのdata属性を確認
                const titleEl = document.querySelector('title');
                if (titleEl && titleEl.textContent) {
                    const t = titleEl.textContent;
                    if (t !== document.title) return { found: true, source: 'title-element', value: t };
                }
                
                // 方法2: エクスプローラービューのフォルダ名を確認
                const explorerItems = document.querySelectorAll('.explorer-item-label, .monaco-icon-label .label-name');
                const folderNames = Array.from(explorerItems).map(e => (e.textContent || '').trim()).filter(Boolean);
                if (folderNames.length > 0) return { found: true, source: 'explorer', value: folderNames.join(',') };
                
                // 方法3: タブタイトルやブレッドクラムからパスを取得
                const breadcrumbs = document.querySelectorAll('.breadcrumbs-view .folder-icon, .tabs-breadcrumbs .label-name');
                const crumbs = Array.from(breadcrumbs).map(e => (e.textContent || '').trim()).filter(Boolean);
                if (crumbs.length > 0) return { found: true, source: 'breadcrumbs', value: crumbs.join(',') };
                
                // 方法4: body の data-uri 属性等を確認
                const bodyUri = document.body?.getAttribute('data-uri') || '';
                if (bodyUri) return { found: true, source: 'data-uri', value: bodyUri };
                
                return { found: false };
            })()`;

            const res = await this.call('Runtime.evaluate', {
                expression,
                returnByValue: true,
            });

            const value = res?.result?.value;
            if (value?.found && value?.value) {
                const detectedValue = value.value as string;
                console.error(`[CdpService] フォルダパスプローブ (${value.source}): "${detectedValue}"`);

                if (
                    detectedValue.includes(workspaceDirName) ||
                    detectedValue.includes(workspacePath)
                ) {
                    this.currentWorkspaceName = workspaceDirName;
                    console.error(`[CdpService] フォルダパスマッチ成功: "${workspaceDirName}"`);
                    return true;
                }
            }

            // 追加フォールバック: URL paramsを確認（VS Code系ではfolderパラメータがある場合がある）
            const urlResult = await this.call('Runtime.evaluate', {
                expression: 'window.location.href',
                returnByValue: true,
            });
            const pageUrl = urlResult?.result?.value || '';
            if (pageUrl.includes(encodeURIComponent(workspacePath)) || pageUrl.includes(workspaceDirName)) {
                this.currentWorkspaceName = workspaceDirName;
                console.error(`[CdpService] URLパラメータマッチ成功: "${workspaceDirName}"`);
                return true;
            }

        } catch (e) {
            console.error(`[CdpService] フォルダパスプローブ失敗:`, e);
        }

        return false;
    }

    /**
     * Antigravityを起動し、新しいworkbenchページが出現するまで待機して接続する。
     */
    private async launchAndConnectWorkspace(
        workspacePath: string,
        workspaceDirName: string,
    ): Promise<boolean> {
        const { exec } = await import('child_process');
        // Antigravity CLI を使用してフォルダとして開く（ワークスペースモードではなく）。
        // `open -a Antigravity` だとワークスペースとして開かれ、タイトルが
        // "Untitled (Workspace)" になることがある。
        // CLI の --new-window でフォルダとして開けば、タイトルに即座にディレクトリ名が反映される。
        const antigravityCli = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
        const command = `"${antigravityCli}" --new-window "${workspacePath}"`;
        console.error(`[CdpService] Antigravity起動: ${command}`);
        await new Promise<void>((resolve, reject) => {
            exec(command, (error) => {
                if (error) {
                    // CLIが見つからない場合は open -a にフォールバック
                    console.error(`[CdpService] CLI起動失敗、open -a にフォールバック: ${error.message}`);
                    exec(`open -a Antigravity "${workspacePath}"`, (err2) => {
                        if (err2) {
                            reject(new Error(`Antigravity起動失敗: ${err2.message}`));
                            return;
                        }
                        resolve();
                    });
                    return;
                }
                resolve();
            });
        });

        // ポーリングで新しいworkbenchページが出現するまで待機（最大30秒）
        const maxWaitMs = 30000;
        const pollIntervalMs = 1000;
        const startTime = Date.now();
        /** 起動前のworkbenchページID一覧（新規ページ検出用） */
        let knownPageIds: Set<string> = new Set();
        for (const port of this.ports) {
            try {
                const preLaunchPages = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                knownPageIds = new Set(preLaunchPages.map((p: any) => p.id).filter(Boolean));
                break;
            } catch {
                // このポートは応答なし
            }
        }

        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(r => setTimeout(r, pollIntervalMs));

            // 応答するポートを探す
            let pages: any[] = [];
            for (const port of this.ports) {
                try {
                    pages = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                    if (pages.length > 0) break;
                } catch {
                    // 次のポートへ
                }
            }

            if (pages.length === 0) continue;

            const workbenchPages = pages.filter(
                (t: any) =>
                    t.type === 'page' &&
                    t.webSocketDebuggerUrl &&
                    !t.title?.includes('Launchpad') &&
                    !t.url?.includes('workbench-jetski-agent') &&
                    t.url?.includes('workbench'),
            );

            // タイトルマッチ
            const titleMatch = workbenchPages.find((t: any) => t.title?.includes(workspaceDirName));
            if (titleMatch) {
                return this.connectToPage(titleMatch, workspaceDirName);
            }

            // CDPプローブ（タイトルが更新されていない場合、フォルダパスも確認）
            const probeResult = await this.probeWorkbenchPages(workbenchPages, workspaceDirName, workspacePath);
            if (probeResult) {
                return true;
            }

            // フォールバック: 起動後に新しく出現した "Untitled (Workspace)" ページに接続
            // タイトル更新もフォルダパスも取れない場合、新規ページであれば対象と見なす
            if (Date.now() - startTime > 10000) {
                const newUntitledPages = workbenchPages.filter(
                    (t: any) =>
                        !knownPageIds.has(t.id) &&
                        (t.title?.includes('Untitled') || t.title === ''),
                );
                if (newUntitledPages.length === 1) {
                    console.error(`[CdpService] 新規Untitledページを検出。"${workspaceDirName}" として接続します (page.id=${newUntitledPages[0].id})`);
                    return this.connectToPage(newUntitledPages[0], workspaceDirName);
                }
            }
        }

        throw new Error(
            `ワークスペース "${workspaceDirName}" のworkbenchページが${maxWaitMs / 1000}秒以内に見つかりませんでした`,
        );
    }

    /**
     * 既存接続を静かに切断する（再接続を試みない）。
     * ワークスペース切替時に使用。
     *
     * 重要: ws.close() の close イベントは非同期で発火するため、
     * リスナーを事前に全削除しないと targetUrl のリセットや
     * tryReconnect() が走り、別のworkbenchに再接続してしまう。
     */
    private disconnectQuietly(): void {
        if (this.ws) {
            // close イベントハンドラを含む全リスナーを除去し、副作用を防ぐ
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
            this.isConnectedFlag = false;
            this.contexts = [];
            this.clearPendingCalls(new Error('ワークスペース切替のため切断'));
            this.targetUrl = null;
        }
    }

    /**
     * 未解決のpendingCallsを全てrejectし、メモリリークを防ぐ。
     * (Step 12: エラーハンドリング)
     * @param error rejectに渡すエラー
     */
    private clearPendingCalls(error: Error): void {
        for (const [, { reject, timeoutId }] of this.pendingCalls.entries()) {
            clearTimeout(timeoutId);
            reject(error);
        }
        this.pendingCalls.clear();
    }

    /**
     * CDP切断後に自動再接続を試みる。
     * maxReconnectAttempts回失敗したら 'reconnectFailed' イベントを発火する。
     * (Step 12: エラーハンドリングとタイムアウト処理)
     */
    private async tryReconnect(): Promise<void> {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.reconnectAttemptCount = 0;

        while (this.reconnectAttemptCount < this.maxReconnectAttempts) {
            this.reconnectAttemptCount++;
            console.error(
                `[CdpService] 再接続試行 ${this.reconnectAttemptCount}/${this.maxReconnectAttempts}...`
            );

            // ディレイを挟む
            await new Promise(r => setTimeout(r, this.reconnectDelayMs));

            try {
                this.contexts = [];
                await this.discoverTarget();
                await this.connect();
                console.error('[CdpService] 再接続成功。');
                this.reconnectAttemptCount = 0;
                this.isReconnecting = false;
                this.emit('reconnected');
                return;
            } catch (err) {
                console.error('[CdpService] 再接続失敗:', err);
            }
        }

        this.isReconnecting = false;
        const finalError = new Error(
            `CDPへの再接続が${this.maxReconnectAttempts}回失敗しました。手動での再起動が必要です。`
        );
        console.error('[CdpService]', finalError.message);
        this.emit('reconnectFailed', finalError);
    }

    isConnected(): boolean {
        return this.isConnectedFlag;
    }

    getContexts(): CdpContext[] {
        return [...this.contexts];
    }

    getPrimaryContextId(): number | null {
        // Find cascade-panel context
        const context = this.contexts.find(c => c.url && c.url.includes('cascade-panel'));
        if (context) return context.id;

        // Fallback to Extension context or first one
        const extContext = this.contexts.find(c => c.name && c.name.includes('Extension'));
        if (extContext) return extContext.id;

        return this.contexts.length > 0 ? this.contexts[0].id : null;
    }

    /**
     * 指定テキストをAntigravityのチャット入力欄に注入し送信する。
     *
     * 戦略:
     *   1. Runtime.evaluate でエディタにフォーカス
     *   2. CDP Input.insertText でテキストを入力
     *   3. CDP Input.dispatchKeyEvent(Enter) で送信
     *
     * DOM操作ではなく CDP Input API を使用することで、
     * Cascade panel の React/フレームワークイベントハンドラに確実に到達する。
     */
    async injectMessage(text: string): Promise<InjectResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
        }

        // 1. エディタにフォーカス（任意のコンテキストで実行）
        const focusScript = `(() => {
            const editors = Array.from(document.querySelectorAll('${SELECTORS.CHAT_INPUT}'));
            const visible = editors.filter(el => el.offsetParent !== null);
            const editor = visible[visible.length - 1];
            if (!editor) return { ok: false, error: 'No editor found' };
            editor.focus();
            return { ok: true };
        })()`;

        let focused = false;
        let usedContextId: number | undefined;

        for (const ctx of this.contexts) {
            try {
                const res = await this.call('Runtime.evaluate', {
                    expression: focusScript,
                    returnByValue: true,
                    contextId: ctx.id,
                });
                if (res?.result?.value?.ok) {
                    focused = true;
                    usedContextId = ctx.id;
                    break;
                }
            } catch (_) { /* 次のコンテキストへ */ }
        }

        if (!focused) {
            return { ok: false, error: 'チャット入力欄が見つかりませんでした' };
        }

        // 2. CDP Input.insertText でテキスト入力
        await this.call('Input.insertText', { text });
        await new Promise(r => setTimeout(r, 200));

        // 3. Enter キーで送信
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
        });
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
        });

        return { ok: true, method: 'enter', contextId: usedContextId };
    }

    /**
     * AntigravityのUI上のモードドロップダウンを操作し、指定モードに切り替える。
     * 2段階アプローチ:
     *   Step 1: モードトグルボタン（"Fast"/"Plan" + chevronアイコン）をクリック → ドロップダウンを開く
     *   Step 2: ドロップダウン内から目的のモードオプションを選択する
     *
     * @param modeName 設定するモード名（例: 'fast', 'plan'）
     */
    async setUiMode(modeName: string): Promise<UiSyncResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
        }

        const safeMode = JSON.stringify(modeName);

        // 内部モード名 → AntigravityのUI表示名マッピング
        const uiNameMap = JSON.stringify({ fast: 'Fast', plan: 'Planning' });

        // テンプレートリテラル内にバッククォートが含まれないよう、DOM操作スクリプトを構築
        const expression = '(async () => {'
            + ' const targetMode = ' + safeMode + ';'
            + ' const targetModeLower = targetMode.toLowerCase();'
            + ' const uiNameMap = ' + uiNameMap + ';'
            + ' const targetUiName = uiNameMap[targetModeLower] || targetMode;'
            + ' const targetUiNameLower = targetUiName.toLowerCase();'
            + ' const allBtns = Array.from(document.querySelectorAll("button"));'
            + ' const visibleBtns = allBtns.filter(b => b.offsetParent !== null);'
            // Step 1: モードトグルボタンを検索（"Fast"/"Planning" + chevronアイコン）
            + ' const knownModes = Object.values(uiNameMap).map(n => n.toLowerCase());'
            + ' const modeToggleBtn = visibleBtns.find(b => {'
            + '   const text = (b.textContent || "").trim().toLowerCase();'
            + '   const hasChevron = b.querySelector("svg[class*=\\"chevron\\"]");'
            + '   return knownModes.some(m => text === m) && hasChevron;'
            + ' });'
            + ' if (!modeToggleBtn) {'
            + '   return { ok: false, error: "Mode toggle button not found" };'
            + ' }'
            + ' const currentModeText = (modeToggleBtn.textContent || "").trim().toLowerCase();'
            // 既に目的のモードなら何もしない
            + ' if (currentModeText === targetUiNameLower) {'
            + '   return { ok: true, mode: targetUiName, alreadySelected: true };'
            + ' }'
            // ドロップダウンを開く
            + ' modeToggleBtn.click();'
            + ' await new Promise(r => setTimeout(r, 500));'
            // Step 2: role="dialog" 内の .font-medium テキストでオプションを検索
            + ' const dialogs = Array.from(document.querySelectorAll("[role=\\"dialog\\"]"));'
            + ' const visibleDialog = dialogs.find(d => {'
            + '   const style = window.getComputedStyle(d);'
            + '   return style.visibility !== "hidden" && style.display !== "none";'
            + ' });'
            + ' let modeOption = null;'
            + ' if (visibleDialog) {'
            + '   const fontMediumEls = Array.from(visibleDialog.querySelectorAll(".font-medium"));'
            + '   const matchEl = fontMediumEls.find(el => {'
            + '     const text = (el.textContent || "").trim().toLowerCase();'
            + '     return text === targetUiNameLower;'
            + '   });'
            + '   if (matchEl) {'
            // .font-medium の親要素（cursor-pointer を持つ div）をクリック対象とする
            + '     modeOption = matchEl.closest("div.cursor-pointer") || matchEl.parentElement;'
            + '   }'
            + ' }'
            // ダイアログが見つからない場合のフォールバック: 従来のセレクター
            + ' if (!modeOption) {'
            + '   const fallbackEls = Array.from(document.querySelectorAll('
            + '     "div[class*=\\"cursor-pointer\\"]"'
            + '   )).filter(el => el.offsetParent !== null);'
            + '   modeOption = fallbackEls.find(el => {'
            + '     if (el === modeToggleBtn) return false;'
            + '     const fm = el.querySelector(".font-medium");'
            + '     if (fm) {'
            + '       const text = (fm.textContent || "").trim().toLowerCase();'
            + '       return text === targetUiNameLower;'
            + '     }'
            + '     return false;'
            + '   });'
            + ' }'
            + ' if (modeOption) {'
            + '   modeOption.click();'
            + '   await new Promise(r => setTimeout(r, 500));'
            // 確認: モードボタンのテキストが変わったか
            + '   const updBtn = Array.from(document.querySelectorAll("button"))'
            + '     .filter(b => b.offsetParent !== null)'
            + '     .find(b => b.querySelector("svg[class*=\\"chevron\\"]") && knownModes.some(m => (b.textContent || "").trim().toLowerCase() === m));'
            + '   const newMode = updBtn ? (updBtn.textContent || "").trim() : "unknown";'
            + '   return { ok: true, mode: newMode };'
            + ' }'
            // 失敗 → ドロップダウンを閉じる
            + ' document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));'
            + ' await new Promise(r => setTimeout(r, 200));'
            + ' return { ok: false, error: "Mode option " + targetUiName + " not found in dropdown" };'
            + '})()';

        try {
            const contextId = this.getPrimaryContextId();
            const callParams: any = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;

            const res = await this.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            if (value?.ok) {
                return { ok: true, mode: value.mode };
            }
            return { ok: false, error: value?.error || 'UI操作に失敗しました（setUiMode）' };
        } catch (error: any) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    /**
     * AntigravityのUIから利用可能なモデル一覧を動的に取得する
     */
    async getUiModels(): Promise < string[] > {
    if(!this.isConnectedFlag || !this.ws) {
    throw new Error('CDPに接続されていません。');
}

const expression = `(async () => {
            return Array.from(document.querySelectorAll('div.cursor-pointer'))
                .map(e => ({text: (e.textContent || '').trim().replace(/New$/, ''), class: e.className}))
                .filter(e => e.class.includes('px-2 py-1 flex items-center justify-between') || e.text.includes('Gemini') || e.text.includes('GPT') || e.text.includes('Claude'))
                .map(e => e.text);
        })()`;

try {
    const contextId = this.getPrimaryContextId();
    const callParams: any = {
        expression,
        returnByValue: true,
        awaitPromise: true,
    };
    if (contextId !== null) callParams.contextId = contextId;

    const res = await this.call('Runtime.evaluate', callParams);
    const value = res?.result?.value;
    if (Array.isArray(value) && value.length > 0) {
        // remove duplicates
        return Array.from(new Set(value));
    }
    return [];
} catch (error: any) {
    console.error('Failed to get UI models:', error);
    return [];
}
    }

    /**
     * AntigravityのUIから現在選択されているモデルを取得する
     */
    async getCurrentModel(): Promise < string | null > {
    if(!this.isConnectedFlag || !this.ws) {
    return null;
}
const expression = `(() => {
            return Array.from(document.querySelectorAll('div.cursor-pointer'))
                .find(e => e.className.includes('px-2 py-1 flex items-center justify-between') && e.className.includes('bg-gray-500/20'))
                ?.textContent?.trim().replace(/New$/, '') || null;
        })()`;
try {
    const contextId = this.getPrimaryContextId();
    const res = await this.call('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
        contextId: contextId || undefined
    });
    return res?.result?.value || null;
} catch (e: any) {
    return null;
}
    }

    /**
     * AntigravityのUI上のモデルドロップダウンを操作し、指定モデルに切り替える。
     * (Step 9: モデル・モード切替のUI同期)
     *
     * @param modelName 設定するモデル名（例: 'gpt-4o', 'claude-3-opus'）
     */
    async setUiModel(modelName: string): Promise < UiSyncResult > {
    if(!this.isConnectedFlag || !this.ws) {
    throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
}

// DOM操作スクリプト: 実際のAntigravity UIのDOM構造に基づく
// モデル一覧は div.cursor-pointer 要素で class に 'px-2 py-1 flex items-center justify-between' を含む
// 現在選択中は 'bg-gray-500/20' を持ち、それ以外は 'hover:bg-gray-500/10' を持つ
// textContent末尾に "New" が付く場合がある
const safeModel = JSON.stringify(modelName);
const expression = `(async () => {
            const targetModel = ${safeModel};
            
            // モデルリスト内の全アイテムを取得
            const modelItems = Array.from(document.querySelectorAll('div.cursor-pointer'))
                .filter(e => e.className.includes('px-2 py-1 flex items-center justify-between'));
            
            if (modelItems.length === 0) {
                return { ok: false, error: 'モデルリストが見つかりませんでした。ドロップダウンが開いていない可能性があります。' };
            }
            
            // ターゲットモデルを名前でマッチング (New suffix を除去して比較)
            const targetItem = modelItems.find(el => {
                const text = (el.textContent || '').trim().replace(/New$/, '').trim();
                return text === targetModel || text.toLowerCase() === targetModel.toLowerCase();
            });
            
            if (!targetItem) {
                const available = modelItems.map(el => (el.textContent || '').trim().replace(/New$/, '').trim()).join(', ');
                return { ok: false, error: 'モデル「' + targetModel + '」が見つかりません。利用可能: ' + available };
            }
            
            // 既に選択済みか確認
            if (targetItem.className.includes('bg-gray-500/20') && !targetItem.className.includes('hover:bg-gray-500/20')) {
                return { ok: true, model: targetModel, alreadySelected: true };
            }
            
            // クリックしてモデルを選択
            targetItem.click();
            await new Promise(r => setTimeout(r, 500));
            
            // 選択が反映されたか確認
            const updatedItems = Array.from(document.querySelectorAll('div.cursor-pointer'))
                .filter(e => e.className.includes('px-2 py-1 flex items-center justify-between'));
            const selectedItem = updatedItems.find(el => {
                const text = (el.textContent || '').trim().replace(/New$/, '').trim();
                return text === targetModel || text.toLowerCase() === targetModel.toLowerCase();
            });
            
            if (selectedItem && selectedItem.className.includes('bg-gray-500/20') && !selectedItem.className.includes('hover:bg-gray-500/20')) {
                return { ok: true, model: targetModel, verified: true };
            }
            
            // クリックは成功したが確認はできなかった
            return { ok: true, model: targetModel, verified: false };
        })()`;

try {
    const contextId = this.getPrimaryContextId();
    const callParams: any = {
        expression,
        returnByValue: true,
        awaitPromise: true,
    };
    if (contextId !== null) callParams.contextId = contextId;

    const res = await this.call('Runtime.evaluate', callParams);
    const value = res?.result?.value;
    if (value?.ok) {
        return { ok: true, model: value.model };
    }
    return { ok: false, error: value?.error || 'UI操作に失敗しました（setUiModel）' };
} catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
}
    }
}
