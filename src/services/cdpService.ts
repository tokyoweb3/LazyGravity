import { logger } from '../utils/logger';
import { CDP_PORTS } from '../utils/cdpPorts';
import { EventEmitter } from 'events';
import * as http from 'http';
import { spawn } from 'child_process';
import WebSocket from 'ws';

export interface CdpServiceOptions {
    portsToScan?: number[];
    cdpCallTimeout?: number;
    /** Number of auto-reconnect attempts on disconnect. 0 = no reconnect. Default: 3 */
    maxReconnectAttempts?: number;
    /** Delay between reconnect attempts (ms). Default: 2000 */
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

export interface ExtractedResponseImage {
    name: string;
    mimeType: string;
    base64Data?: string;
    url?: string;
}

/** UI sync operation result type (Step 9) */
export interface UiSyncResult {
    ok: boolean;
    /** Mode name set (on setUiMode success) */
    mode?: string;
    /** Model name set (on setUiModel success) */
    model?: string;
    error?: string;
}

/** Antigravity UI DOM selector constants */
const SELECTORS = {
    /** Chat input box: textbox excluding xterm */
    CHAT_INPUT: 'div[role="textbox"]:not(.xterm-helper-textarea)',
    /** Submit button search target tag */
    SUBMIT_BUTTON_CONTAINER: 'button',
    /** Submit icon SVG class candidates */
    SUBMIT_BUTTON_SVG_CLASSES: ['lucide-arrow-right', 'lucide-arrow-up', 'lucide-send'],
    /** Keyword to identify message injection target context */
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
    /** Number of auto-reconnect attempts on disconnect */
    private maxReconnectAttempts: number;
    /** Delay between reconnect attempts (ms) */
    private reconnectDelayMs: number;
    /** Current reconnect attempt count */
    private reconnectAttemptCount: number = 0;
    /** Reconnecting flag (prevents double connections) */
    private isReconnecting: boolean = false;
    /** Currently connected workspace name */
    private currentWorkspaceName: string | null = null;
    /** Last requested workspace path (used for deterministic reconnect) */
    private currentWorkspacePath: string | null = null;
    /** Workspace switching flag (suppresses disconnected event) */
    private isSwitchingWorkspace: boolean = false;

    constructor(options: CdpServiceOptions = {}) {
        super();
        this.ports = options.portsToScan || [...CDP_PORTS];
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
        let allPages: any[] = [];
        for (const port of this.ports) {
            try {
                const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                allPages.push(...list);
            } catch (e) {
                // Ignore port not found
            }
        }

        let target = allPages.find(t =>
            t.type === 'page' &&
            t.webSocketDebuggerUrl &&
            !t.title?.includes('Launchpad') &&
            !t.url?.includes('workbench-jetski-agent') &&
            (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade'))
        );

        if (!target) {
            target = allPages.find(t =>
                t.webSocketDebuggerUrl &&
                (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade')) &&
                !t.title?.includes('Launchpad')
            );
        }

        if (!target) {
            target = allPages.find(t =>
                t.webSocketDebuggerUrl &&
                (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade') || t.title?.includes('Launchpad'))
            );
        }

        if (target && target.webSocketDebuggerUrl) {
            this.targetUrl = target.webSocketDebuggerUrl;
            // Extract workspace name from title (e.g., "ProjectName — Antigravity")
            if (target.title && !this.currentWorkspaceName) {
                const titleParts = target.title.split(/\\s[—–-]\\s/);
                if (titleParts.length > 0) {
                    this.currentWorkspaceName = titleParts[0].trim();
                }
            }
            return target.webSocketDebuggerUrl;
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

                // Forward CDP events via EventEmitter (Network.*, Runtime.*, etc.)
                if (data.method) {
                    this.emit(data.method, data.params);
                }
            } catch (e) { }
        });

        this.ws.on('close', () => {
            this.isConnectedFlag = false;
            // Reject all unresolved pending calls to prevent memory leaks
            this.clearPendingCalls(new Error('WebSocket disconnected'));
            this.ws = null;
            this.targetUrl = null;
            // Suppress disconnected event and auto-reconnect during workspace switching
            if (this.isSwitchingWorkspace) return;
            this.emit('disconnected');
            // Attempt auto-reconnect (when maxReconnectAttempts > 0)
            if (this.maxReconnectAttempts > 0 && !this.isReconnecting) {
                this.tryReconnect();
            }
        });

        // Initialize Runtime to get execution contexts
        await this.call('Runtime.enable', {});

        // Enable Network domain for event-based completion detection
        try {
            await this.call('Network.enable', {});
        } catch {
            // Network.enable failure is non-fatal; polling fallback still works
            logger.warn('[CdpService] Network.enable failed — network event detection disabled');
        }
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
        // Stop reconnection attempts
        this.maxReconnectAttempts = 0;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnectedFlag = false;
        this.contexts = [];
        this.currentWorkspacePath = null;
        this.currentWorkspaceName = null;
        this.clearPendingCalls(new Error('disconnect() was called'));
    }

    /**
     * Return the currently connected workspace name.
     */
    getCurrentWorkspaceName(): string | null {
        return this.currentWorkspaceName;
    }

    /**
     * Discover and connect to the workbench page for the specified workspace.
     * Does nothing if already connected to the correct page.
     *
     * @param workspacePath Full workspace path (e.g., /home/user/Code/MyProject)
     * @returns true on successful connection
     */
    async discoverAndConnectForWorkspace(workspacePath: string): Promise<boolean> {
        const workspaceDirName = workspacePath.split('/').filter(Boolean).pop() || '';
        this.currentWorkspacePath = workspacePath;

        // Re-validate existing connection before skipping reconnect.
        if (this.isConnectedFlag && this.currentWorkspaceName === workspaceDirName) {
            const stillMatched = await this.verifyCurrentWorkspace(workspaceDirName, workspacePath);
            if (stillMatched) {
                return true;
            }
            logger.warn(
                `[CdpService] Workspace mismatch detected while reusing connection (expected="${workspaceDirName}"). Reconnecting...`,
            );
        }

        this.isSwitchingWorkspace = true;
        try {
            return await this._discoverAndConnectForWorkspaceImpl(workspacePath, workspaceDirName);
        } finally {
            this.isSwitchingWorkspace = false;
        }
    }

    /**
     * Verify whether the currently attached page still represents the expected workspace.
     */
    private async verifyCurrentWorkspace(workspaceDirName: string, workspacePath: string): Promise<boolean> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnectedFlag) {
            return false;
        }

        try {
            const titleResult = await this.call('Runtime.evaluate', {
                expression: 'document.title',
                returnByValue: true,
            });
            const liveTitle = String(titleResult?.result?.value || '');
            if (liveTitle.includes(workspaceDirName)) {
                this.currentWorkspaceName = workspaceDirName;
                return true;
            }
        } catch {
            // Fall through to folder-path probe.
        }

        return this.probeWorkspaceFolderPath(workspaceDirName, workspacePath);
    }

    private async _discoverAndConnectForWorkspaceImpl(
        workspacePath: string,
        workspaceDirName: string,
    ): Promise<boolean> {
        // Scan all ports to collect workbench pages
        let pages: any[] = [];
        let respondingPort: number | null = null;

        for (const port of this.ports) {
            try {
                const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                pages.push(...list);
                // Prioritize recording ports that contain workbench pages
                const hasWorkbench = list.some((t: any) => t.url?.includes('workbench'));
                if (hasWorkbench && respondingPort === null) {
                    respondingPort = port;
                }
            } catch {
                // No response from this port, next
            }
        }

        if (respondingPort === null && pages.length > 0) {
            // No workbench found but ports responded
            respondingPort = this.ports[0]; // logging purposes
        }

        if (respondingPort === null) {
            // Launch Antigravity if no port responds
            return this.launchAndConnectWorkspace(workspacePath, workspaceDirName);
        }

        // Filter workbench pages only (exclude Launchpad, Manager, iframe, worker)
        const workbenchPages = pages.filter(
            (t: any) =>
                t.type === 'page' &&
                t.webSocketDebuggerUrl &&
                !t.title?.includes('Launchpad') &&
                !t.url?.includes('workbench-jetski-agent') &&
                t.url?.includes('workbench'),
        );

        logger.debug(`[CdpService] Searching for workspace "${workspaceDirName}" (port=${respondingPort})... ${workbenchPages.length} workbench pages:`);
        for (const p of workbenchPages) {
            logger.debug(`  - title="${p.title}" url=${p.url}`);
        }

        // 1. Title match (fast path)
        const titleMatch = workbenchPages.find((t: any) => t.title?.includes(workspaceDirName));
        if (titleMatch) {
            return this.connectToPage(titleMatch, workspaceDirName);
        }

        // 2. Title match failed -> CDP probe (connect to each page and check document.title)
        logger.debug(`[CdpService] Title match failed. Searching via CDP probe...`);
        const probeResult = await this.probeWorkbenchPages(workbenchPages, workspaceDirName, workspacePath);
        if (probeResult) {
            return true;
        }

        // 3. If not found by probe either, launch a new window
        return this.launchAndConnectWorkspace(workspacePath, workspaceDirName);
    }

    /**
     * Connect to the specified page (skip if already connected).
     */
    private async connectToPage(page: any, workspaceDirName: string): Promise<boolean> {
        // No reconnection needed if already connected to the same URL
        if (this.isConnectedFlag && this.targetUrl === page.webSocketDebuggerUrl) {
            this.currentWorkspaceName = workspaceDirName;
            return true;
        }

        this.disconnectQuietly();
        this.targetUrl = page.webSocketDebuggerUrl;
        await this.connect();
        this.currentWorkspaceName = workspaceDirName;
        logger.debug(`[CdpService] Connected to workspace "${workspaceDirName}"`);

        return true;
    }

    /**
     * Connect to each workbench page via CDP to get document.title and detect workspace name.
     * Fallback when /json/list titles are stale or incomplete.
     *
     * If the title is "Untitled (Workspace)", verify workspace folder path via CDP.
     *
     * @param workbenchPages List of workbench pages
     * @param workspaceDirName Workspace directory name
     * @param workspacePath Full workspace path (for folder path matching)
     */
    private async probeWorkbenchPages(
        workbenchPages: any[],
        workspaceDirName: string,
        workspacePath?: string,
    ): Promise<boolean> {
        for (const page of workbenchPages) {
            try {
                // Temporarily connect to retrieve document.title
                this.disconnectQuietly();
                this.targetUrl = page.webSocketDebuggerUrl;
                await this.connect();

                const result = await this.call('Runtime.evaluate', {
                    expression: 'document.title',
                    returnByValue: true,
                });
                const liveTitle = result?.result?.value || '';

                if (liveTitle.includes(workspaceDirName)) {
                    this.currentWorkspaceName = workspaceDirName;
                    logger.debug(`[CdpService] Probe success: detected "${workspaceDirName}"`);
                    return true;
                }

                // If title is "Untitled (Workspace)", verify by folder path
                if (liveTitle.includes('Untitled') && workspacePath) {
                    const folderMatch = await this.probeWorkspaceFolderPath(workspaceDirName, workspacePath);
                    if (folderMatch) {
                        return true;
                    }
                }
            } catch (e) {
                logger.warn(`[CdpService] Probe failed (page.id=${page.id}):`, e);
            }
        }

        // Probe complete, not found -> return to disconnected state
        this.disconnectQuietly();
        return false;
    }

    /**
     * Check if the currently connected page has the specified workspace folder open.
     * In Antigravity (VS Code-based), info may be available from explorer views or APIs.
     *
     * Detects folder path via multiple approaches:
     * 1. Check vscode.workspace.workspaceFolders via VS Code API
     * 2. Check folder path display in DOM
     * 3. Get workspace info from window.location.hash, etc.
     */
    private async probeWorkspaceFolderPath(
        workspaceDirName: string,
        workspacePath: string,
    ): Promise<boolean> {
        try {
            // Instead of DOM/document.title, check folder parameter in page URL or
            // folder name in explorer view
            const expression = `(() => {
                // Method 1: Check window title data attribute
                const titleEl = document.querySelector('title');
                if (titleEl && titleEl.textContent) {
                    const t = titleEl.textContent;
                    if (t !== document.title) return { found: true, source: 'title-element', value: t };
                }
                
                // Method 2: Check folder name in explorer view
                const explorerItems = document.querySelectorAll('.explorer-item-label, .monaco-icon-label .label-name');
                const folderNames = Array.from(explorerItems).map(e => (e.textContent || '').trim()).filter(Boolean);
                if (folderNames.length > 0) return { found: true, source: 'explorer', value: folderNames.join(',') };
                
                // Method 3: Get path from tab titles or breadcrumbs
                const breadcrumbs = document.querySelectorAll('.breadcrumbs-view .folder-icon, .tabs-breadcrumbs .label-name');
                const crumbs = Array.from(breadcrumbs).map(e => (e.textContent || '').trim()).filter(Boolean);
                if (crumbs.length > 0) return { found: true, source: 'breadcrumbs', value: crumbs.join(',') };
                
                // Method 4: Check body data-uri attribute, etc.
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

                if (
                    detectedValue.includes(workspaceDirName) ||
                    detectedValue.includes(workspacePath)
                ) {
                    this.currentWorkspaceName = workspaceDirName;
                    logger.debug(`[CdpService] Folder path match success: "${workspaceDirName}"`);
                    return true;
                }
            }

            // Additional fallback: check URL params (VS Code-based editors may have folder parameter)
            const urlResult = await this.call('Runtime.evaluate', {
                expression: 'window.location.href',
                returnByValue: true,
            });
            const pageUrl = urlResult?.result?.value || '';
            if (pageUrl.includes(encodeURIComponent(workspacePath)) || pageUrl.includes(workspaceDirName)) {
                this.currentWorkspaceName = workspaceDirName;
                logger.debug(`[CdpService] URL parameter match success: "${workspaceDirName}"`);
                return true;
            }

        } catch (e) {
            logger.warn(`[CdpService] Folder path probe failed:`, e);
        }

        return false;
    }

    /**
     * Launch Antigravity and wait for a new workbench page to appear, then connect.
     */
    private async launchAndConnectWorkspace(
        workspacePath: string,
        workspaceDirName: string,
    ): Promise<boolean> {
        // Open as folder using Antigravity CLI (not as workspace mode).
        // `open -a Antigravity` may open as workspace, resulting in title "Untitled (Workspace)".
        // CLI --new-window opens as folder, immediately reflecting directory name in title.
        const antigravityCli = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
        logger.debug(`[CdpService] Launching Antigravity: ${antigravityCli} --new-window ${workspacePath}`);
        try {
            await this.runCommand(antigravityCli, ['--new-window', workspacePath]);
        } catch (error: any) {
            // Fall back to open -a if CLI not found
            logger.warn(`[CdpService] CLI launch failed, falling back to open -a: ${error?.message || String(error)}`);
            await this.runCommand('open', ['-a', 'Antigravity', workspacePath]);
        }

        // Poll until a new workbench page appears (max 30 seconds)
        const maxWaitMs = 30000;
        const pollIntervalMs = 1000;
        const startTime = Date.now();
        /** Pre-launch workbench page IDs (for detecting new pages) */
        let knownPageIds: Set<string> = new Set();
        for (const port of this.ports) {
            try {
                const preLaunchPages = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                preLaunchPages.forEach((p: any) => {
                    if (p.id) knownPageIds.add(p.id);
                });
            } catch {
                // No response from this port
            }
        }

        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(r => setTimeout(r, pollIntervalMs));

            let pages: any[] = [];
            for (const port of this.ports) {
                try {
                    const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                    pages.push(...list);
                } catch {
                    // Next port
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

            // Title match
            const titleMatch = workbenchPages.find((t: any) => t.title?.includes(workspaceDirName));
            if (titleMatch) {
                return this.connectToPage(titleMatch, workspaceDirName);
            }

            // CDP probe (also check folder path if title is not updated)
            const probeResult = await this.probeWorkbenchPages(workbenchPages, workspaceDirName, workspacePath);
            if (probeResult) {
                return true;
            }

            // Fallback: connect to newly appeared "Untitled (Workspace)" page after launch
            // If title update and folder path both fail, treat new page as target
            if (Date.now() - startTime > 10000) {
                const newUntitledPages = workbenchPages.filter(
                    (t: any) =>
                        !knownPageIds.has(t.id) &&
                        (t.title?.includes('Untitled') || t.title === ''),
                );
                if (newUntitledPages.length === 1) {
                    logger.debug(`[CdpService] New Untitled page detected. Connecting as "${workspaceDirName}" (page.id=${newUntitledPages[0].id})`);
                    return this.connectToPage(newUntitledPages[0], workspaceDirName);
                }
            }
        }

        throw new Error(
            `Workbench page for workspace "${workspaceDirName}" not found within ${maxWaitMs / 1000} seconds`,
        );
    }

    private async runCommand(command: string, args: string[]): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, { stdio: 'ignore' });

            child.once('error', (error) => {
                reject(error);
            });

            child.once('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
            });
        });
    }

    /**
     * Quietly disconnect the existing connection (no reconnect attempts).
     * Used during workspace switching.
     *
     * Important: ws.close() fires close event asynchronously, so all listeners
     * must be removed first to prevent targetUrl reset and tryReconnect()
     * from reconnecting to a different workbench.
     */
    private disconnectQuietly(): void {
        if (this.ws) {
            // Remove all listeners including close event handlers to prevent side effects
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
            this.isConnectedFlag = false;
            this.contexts = [];
            this.clearPendingCalls(new Error('Disconnected for workspace switch'));
            this.targetUrl = null;
        }
    }

    /**
     * Reject all unresolved pending calls to prevent memory leaks.
     * (Step 12: Error handling)
     * @param error Error to pass to reject
     */
    private clearPendingCalls(error: Error): void {
        for (const [, { reject, timeoutId }] of this.pendingCalls.entries()) {
            clearTimeout(timeoutId);
            reject(error);
        }
        this.pendingCalls.clear();
    }

    /**
     * Attempt auto-reconnect after CDP disconnection.
     * Fires 'reconnectFailed' event after maxReconnectAttempts failures.
     * (Step 12: Error handling and timeout management)
     */
    private async tryReconnect(): Promise<void> {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.reconnectAttemptCount = 0;

        while (this.reconnectAttemptCount < this.maxReconnectAttempts) {
            this.reconnectAttemptCount++;
            logger.error(
                `[CdpService] Reconnect attempt ${this.reconnectAttemptCount}/${this.maxReconnectAttempts}...`
            );

            // Add delay between attempts
            await new Promise(r => setTimeout(r, this.reconnectDelayMs));

            try {
                this.contexts = [];
                if (this.currentWorkspacePath) {
                    await this.discoverAndConnectForWorkspace(this.currentWorkspacePath);
                } else {
                    await this.discoverTarget();
                    await this.connect();
                }
                logger.error('[CdpService] Reconnect succeeded.');
                this.reconnectAttemptCount = 0;
                this.isReconnecting = false;
                this.emit('reconnected');
                return;
            } catch (err) {
                logger.error('[CdpService] Reconnect failed:', err);
            }
        }

        this.isReconnecting = false;
        const finalError = new Error(
            `CDP reconnection failed ${this.maxReconnectAttempts} times. Manual restart required.`
        );
        logger.error('[CdpService]', finalError.message);
        this.emit('reconnectFailed', finalError);
    }

    isConnected(): boolean {
        return this.isConnectedFlag;
    }

    getContexts(): CdpContext[] {
        return [...this.contexts];
    }

    /**
     * Wait by polling until cascade-panel context becomes available.
     * Right after Antigravity launch, contexts are created asynchronously even after Runtime.enable,
     * so use this method to confirm readiness before DOM operations.
     *
     * @param timeoutMs Maximum wait time (ms). Default: 10000
     * @param pollIntervalMs Polling interval (ms). Default: 500
     * @returns true if cascade-panel context was found
     */
    async waitForCascadePanelReady(timeoutMs = 10000, pollIntervalMs = 500): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const cascadeCtx = this.contexts.find(
                c => c.url && c.url.includes(SELECTORS.CONTEXT_URL_KEYWORD),
            );
            if (cascadeCtx) {
                return true;
            }
            await new Promise(r => setTimeout(r, pollIntervalMs));
        }
        return false;
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
     * Focus the chat input field.
     */
    private async focusChatInput(): Promise<{ ok: boolean; contextId?: number; error?: string }> {
        const focusScript = `(() => {
            const editors = Array.from(document.querySelectorAll('${SELECTORS.CHAT_INPUT}'));
            const visible = editors.filter(el => el.offsetParent !== null);
            const editor = visible[visible.length - 1];
            if (!editor) return { ok: false, error: 'No editor found' };
            editor.focus();
            return { ok: true };
        })()`;

        for (const ctx of this.contexts) {
            try {
                const res = await this.call('Runtime.evaluate', {
                    expression: focusScript,
                    returnByValue: true,
                    contextId: ctx.id,
                });
                if (res?.result?.value?.ok) {
                    return { ok: true, contextId: ctx.id };
                }
            } catch {
                // Try next context
            }
        }

        return { ok: false, error: 'Chat input field not found' };
    }

    /**
     * Select all text in the focused input and delete it to ensure a clean state.
     * Uses Meta+A (select all) then Backspace (delete) via CDP key events.
     */
    private async clearInputField(): Promise<void> {
        // Meta+A to select all content
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'a',
            code: 'KeyA',
            modifiers: 4, // Meta (Cmd on macOS)
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
        });
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'a',
            code: 'KeyA',
            modifiers: 4,
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
        });
        // Backspace to delete selected content
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Backspace',
            code: 'Backspace',
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
        });
        await this.call('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Backspace',
            code: 'Backspace',
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
        });
        // Wait for DOM to settle
        await new Promise(r => setTimeout(r, 50));
    }

    /**
     * Send Enter key to submit the message.
     */
    private async pressEnterToSend(): Promise<void> {
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
    }

    /**
     * Detect file input in the UI and attach the specified files.
     */
    private async attachImageFiles(filePaths: string[], contextId?: number): Promise<{ ok: boolean; error?: string }> {
        if (filePaths.length === 0) return { ok: true };

        await this.call('DOM.enable', {});

        const locateInputScript = `(async () => {
            const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const visible = (el) => {
                if (!el) return false;
                if (el.offsetParent !== null) return true;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
                return !!rect && rect.width > 0 && rect.height > 0;
            };
            const normalize = (v) => (v || '').toLowerCase();
            const hasImageAccept = (input) => {
                const accept = normalize(input.getAttribute('accept'));
                return !accept || accept.includes('image') || accept.includes('*/*');
            };
            const findInput = () => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                const visibleInput = inputs.find(i => visible(i) && hasImageAccept(i));
                if (visibleInput) return visibleInput;
                return inputs.find(hasImageAccept) || null;
            };

            let input = findInput();
            if (!input) {
                const triggerKeywords = ['attach', 'upload', 'image', 'file', 'paperclip', 'plus'];
                const triggers = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(visible)
                    .filter((el) => {
                        const text = normalize(el.textContent);
                        const aria = normalize(el.getAttribute('aria-label'));
                        const title = normalize(el.getAttribute('title'));
                        const cls = normalize(el.getAttribute('class'));
                        const all = [text, aria, title, cls].join(' ');
                        return triggerKeywords.some(k => all.includes(k));
                    })
                    .slice(-8);

                for (const trigger of triggers) {
                    if (typeof trigger.click === 'function') {
                        trigger.click();
                        await wait(150);
                        input = findInput();
                        if (input) break;
                    }
                }
            }

            if (!input) {
                return { ok: false, error: 'Image upload input not found' };
            }

            const token = 'agclaw-upload-' + Math.random().toString(36).slice(2, 10);
            input.setAttribute('data-agclaw-upload-token', token);
            return { ok: true, token };
        })()`;

        const callParams: Record<string, unknown> = {
            expression: locateInputScript,
            returnByValue: true,
            awaitPromise: true,
        };
        if (contextId !== undefined) {
            callParams.contextId = contextId;
        }

        const locateResult = await this.call('Runtime.evaluate', callParams);
        const locateValue = locateResult?.result?.value;
        if (!locateValue?.ok || !locateValue?.token) {
            return { ok: false, error: locateValue?.error || 'Failed to locate file input' };
        }

        const token = String(locateValue.token);
        const documentResult = await this.call('DOM.getDocument', { depth: 1, pierce: true });
        const rootNodeId = documentResult?.root?.nodeId;
        if (!rootNodeId) {
            return { ok: false, error: 'Failed to get DOM root' };
        }

        const selector = `input[data-agclaw-upload-token="${token}"]`;
        const nodeResult = await this.call('DOM.querySelector', {
            nodeId: rootNodeId,
            selector,
        });
        const nodeId = nodeResult?.nodeId;
        if (!nodeId) {
            return { ok: false, error: 'Failed to get upload input node' };
        }

        await this.call('DOM.setFileInputFiles', {
            nodeId,
            files: filePaths,
        });

        const notifyScript = `(() => {
            const input = document.querySelector('${selector}');
            if (!input) return { ok: false, error: 'Image input not found' };
            input.removeAttribute('data-agclaw-upload-token');
            return { ok: true };
        })()`;

        await this.call('Runtime.evaluate', {
            expression: notifyScript,
            returnByValue: true,
            awaitPromise: true,
            ...(contextId !== undefined ? { contextId } : {}),
        });

        await new Promise(r => setTimeout(r, 250));
        return { ok: true };
    }

    /**
     * Inject and send the specified text into Antigravity's chat input field.
     *
     * Strategy:
     *   1. Focus editor via Runtime.evaluate
     *   2. Input text via CDP Input.insertText
     *   3. Send via CDP Input.dispatchKeyEvent(Enter)
     *
     * Using CDP Input API instead of DOM manipulation ensures reliable
     * delivery to Cascade panel's React/framework event handlers.
     */
    async injectMessage(text: string): Promise<InjectResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('Not connected to CDP. Call connect() first.');
        }

        const focusResult = await this.focusChatInput();
        if (!focusResult.ok) {
            return { ok: false, error: focusResult.error || 'Chat input field not found' };
        }

        // Clear any existing text in the input field before injecting
        await this.clearInputField();

        // 1. Input text via CDP Input.insertText
        await this.call('Input.insertText', { text });
        await new Promise(r => setTimeout(r, 200));

        // 2. Send via Enter key
        await this.pressEnterToSend();

        return { ok: true, method: 'enter', contextId: focusResult.contextId };
    }

    /**
     * Attach image files to the UI and send the specified text.
     */
    async injectMessageWithImageFiles(text: string, imageFilePaths: string[]): Promise<InjectResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('Not connected to CDP. Call connect() first.');
        }

        const focusResult = await this.focusChatInput();
        if (!focusResult.ok) {
            return { ok: false, error: focusResult.error || 'Chat input field not found' };
        }

        // Clear any existing text in the input field before injecting
        await this.clearInputField();

        const attachResult = await this.attachImageFiles(imageFilePaths, focusResult.contextId);
        if (!attachResult.ok) {
            return { ok: false, error: attachResult.error || 'Failed to attach images' };
        }

        await this.call('Input.insertText', { text });
        await new Promise(r => setTimeout(r, 200));
        await this.pressEnterToSend();

        return { ok: true, method: 'enter', contextId: focusResult.contextId };
    }

    /**
     * Extract images from the latest AI response.
     */
    async extractLatestResponseImages(maxImages: number = 4): Promise<ExtractedResponseImage[]> {
        if (!this.isConnectedFlag || !this.ws) {
            return [];
        }

        const safeMaxImages = Math.max(1, Math.min(8, Math.floor(maxImages)));
        const expression = `(async () => {
            const maxImages = ${safeMaxImages};
            const panel = document.querySelector('.antigravity-agent-side-panel');
            const scope = panel || document;

            const candidateSelectors = [
                '.rendered-markdown',
                '.leading-relaxed.select-text',
                '.flex.flex-col.gap-y-3',
                '[data-message-author-role="assistant"]',
                '[data-message-role="assistant"]',
                '[class*="assistant-message"]',
                '[class*="message-content"]',
                '[class*="markdown-body"]',
                '.prose',
            ];

            const responseNodes = [];
            const seenNodes = new Set();
            for (const selector of candidateSelectors) {
                const nodes = scope.querySelectorAll(selector);
                for (const node of nodes) {
                    if (!node || seenNodes.has(node)) continue;
                    seenNodes.add(node);
                    responseNodes.push(node);
                }
            }

            // Skip image extraction when no response nodes found (prevent UI icon false positives)
            if (responseNodes.length === 0) return [];

            const normalize = (value) => (value || '').toLowerCase();
            const isLikelyUiImage = (img) => {
                if (!img) return true;
                const src = normalize(img.currentSrc || img.src || img.getAttribute('src') || '');
                const alt = normalize(img.getAttribute('alt') || '');
                const title = normalize(img.getAttribute('title') || '');
                const cls = normalize(img.getAttribute('class') || '');
                const blob = [src, alt, title, cls].join(' ');

                if (blob.includes('icon') || blob.includes('avatar') || blob.includes('emoji')) return true;
                if (blob.includes('thumb') || blob.includes('good') || blob.includes('bad')) return true;
                if (src.startsWith('data:image/svg+xml')) return true;
                if (img.closest('button, [role="button"], nav, header, footer, [class*="toolbar"], [class*="reaction"]')) return true;

                const rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : null;
                const w = Number(img.naturalWidth || img.width || rect?.width || 0);
                const h = Number(img.naturalHeight || img.height || rect?.height || 0);
                if (w < 96 || h < 96) return true;
                if ((w * h) < 12000) return true;

                return false;
            };

            const dedup = new Set();
            const images = [];
            for (let i = responseNodes.length - 1; i >= 0; i--) {
                const node = responseNodes[i];
                const nodeImages = Array.from(node.querySelectorAll('img'));
                for (const img of nodeImages) {
                    if (isLikelyUiImage(img)) continue;
                    const key = (img.currentSrc || img.src || img.getAttribute('src') || '') + '|' + (img.getAttribute('alt') || '');
                    if (!key || dedup.has(key)) continue;
                    dedup.add(key);
                    images.push(img);
                }
                if (images.length >= maxImages) break;
            }

            if (images.length === 0) return [];
            const picked = images.slice(-maxImages);

            const normalizeFileName = (value, idx) => {
                const raw = (value || '').trim();
                const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
                return safe || ('generated-image-' + (idx + 1));
            };

            const guessMimeType = (src) => {
                if (!src) return 'image/png';
                if (src.startsWith('data:')) {
                    const match = src.match(/^data:([^;]+);/);
                    return (match && match[1]) || 'image/png';
                }
                const lower = src.toLowerCase();
                if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
                if (lower.includes('.webp')) return 'image/webp';
                if (lower.includes('.gif')) return 'image/gif';
                return 'image/png';
            };

            const blobToBase64 = (blob) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const value = typeof reader.result === 'string' ? reader.result : '';
                    const commaIndex = value.indexOf(',');
                    resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
                };
                reader.onerror = () => reject(reader.error || new Error('read failed'));
                reader.readAsDataURL(blob);
            });

            const result = [];
            for (let i = 0; i < picked.length; i++) {
                const img = picked[i];
                const src = img.currentSrc || img.src || img.getAttribute('src') || '';
                if (!src) continue;

                const baseName = normalizeFileName(img.getAttribute('alt') || img.getAttribute('title'), i);
                const mimeType = guessMimeType(src);
                const extensionMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
                const ext = extensionMap[mimeType] || 'png';
                const name = baseName.includes('.') ? baseName : (baseName + '.' + ext);

                if (src.startsWith('data:')) {
                    const commaIndex = src.indexOf(',');
                    if (commaIndex > 0) {
                        result.push({
                            name,
                            mimeType,
                            base64Data: src.slice(commaIndex + 1),
                        });
                    }
                    continue;
                }

                try {
                    const response = await fetch(src);
                    if (!response.ok) throw new Error('fetch failed');
                    const blob = await response.blob();
                    const base64Data = await blobToBase64(blob);
                    result.push({
                        name,
                        mimeType: blob.type || mimeType,
                        base64Data,
                    });
                } catch {
                    result.push({
                        name,
                        mimeType,
                        url: src,
                    });
                }
            }

            return result;
        })()`;

        try {
            const contextId = this.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const response = await this.call('Runtime.evaluate', callParams);
            const value = response?.result?.value;
            if (!Array.isArray(value)) return [];

            return value
                .filter((item) => item && typeof item === 'object' && typeof item.name === 'string')
                .map((item) => ({
                    name: item.name,
                    mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'image/png',
                    base64Data: typeof item.base64Data === 'string' ? item.base64Data : undefined,
                    url: typeof item.url === 'string' ? item.url : undefined,
                }));
        } catch {
            return [];
        }

    }

    /**
     * Get the currently selected mode from the Antigravity UI.
     * Reads the mode toggle button text and maps it back to internal mode name.
     *
     * @returns Internal mode name (e.g., 'fast', 'plan') or null if not found
     */
    async getCurrentMode(): Promise<string | null> {
        if (!this.isConnectedFlag || !this.ws) {
            return null;
        }
        const expression = '(() => {'
            + ' const uiNameMap = { fast: "Fast", plan: "Planning" };'
            + ' const knownModes = Object.values(uiNameMap).map(n => n.toLowerCase());'
            + ' const reverseMap = {};'
            + ' Object.entries(uiNameMap).forEach(([k, v]) => { reverseMap[v.toLowerCase()] = k; });'
            + ' const allBtns = Array.from(document.querySelectorAll("button"));'
            + ' const visibleBtns = allBtns.filter(b => b.offsetParent !== null);'
            + ' const modeToggleBtn = visibleBtns.find(b => {'
            + '   const text = (b.textContent || "").trim().toLowerCase();'
            + '   const hasChevron = b.querySelector("svg[class*=\\"chevron\\"]");'
            + '   return knownModes.some(m => text === m) && hasChevron;'
            + ' });'
            + ' if (!modeToggleBtn) return null;'
            + ' const currentModeText = (modeToggleBtn.textContent || "").trim().toLowerCase();'
            + ' return reverseMap[currentModeText] || null;'
            + '})()';
        try {
            const contextId = this.getPrimaryContextId();
            const callParams: any = {
                expression,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) callParams.contextId = contextId;
            const res = await this.call('Runtime.evaluate', callParams);
            return res?.result?.value || null;
        } catch {
            return null;
        }
    }

    /**
     * Operate Antigravity UI mode dropdown to switch to the specified mode.
     * Two-step approach:
     *   Step 1: Click mode toggle button ("Fast"/"Plan" + chevron icon) to open dropdown
     *   Step 2: Select the target mode option from dropdown
     *
     * @param modeName Mode name to set (e.g., 'fast', 'plan')
     */
    async setUiMode(modeName: string): Promise<UiSyncResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('Not connected to CDP. Call connect() first.');
        }

        const safeMode = JSON.stringify(modeName);

        // Internal mode name -> Antigravity UI display name mapping
        const uiNameMap = JSON.stringify({ fast: 'Fast', plan: 'Planning' });

        // Build DOM manipulation script avoiding backticks in template literals
        const expression = '(async () => {'
            + ' const targetMode = ' + safeMode + ';'
            + ' const targetModeLower = targetMode.toLowerCase();'
            + ' const uiNameMap = ' + uiNameMap + ';'
            + ' const targetUiName = uiNameMap[targetModeLower] || targetMode;'
            + ' const targetUiNameLower = targetUiName.toLowerCase();'
            + ' const allBtns = Array.from(document.querySelectorAll("button"));'
            + ' const visibleBtns = allBtns.filter(b => b.offsetParent !== null);'
            // Step 1: Search for mode toggle button ("Fast"/"Planning" + chevron icon)
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
            // Do nothing if already on the target mode
            + ' if (currentModeText === targetUiNameLower) {'
            + '   return { ok: true, mode: targetUiName, alreadySelected: true };'
            + ' }'
            // Open dropdown
            + ' modeToggleBtn.click();'
            + ' await new Promise(r => setTimeout(r, 500));'
            // Step 2: Search for option by .font-medium text inside role="dialog"
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
            // Target the parent element of .font-medium (div with cursor-pointer) for clicking
            + '     modeOption = matchEl.closest("div.cursor-pointer") || matchEl.parentElement;'
            + '   }'
            + ' }'
            // Fallback when dialog not found: legacy selectors
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
            // Verify: check if mode button text has changed
            + '   const updBtn = Array.from(document.querySelectorAll("button"))'
            + '     .filter(b => b.offsetParent !== null)'
            + '     .find(b => b.querySelector("svg[class*=\\"chevron\\"]") && knownModes.some(m => (b.textContent || "").trim().toLowerCase() === m));'
            + '   const newMode = updBtn ? (updBtn.textContent || "").trim() : "unknown";'
            + '   return { ok: true, mode: newMode };'
            + ' }'
            // Failed -> close dropdown
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
            return { ok: false, error: value?.error || 'UI operation failed (setUiMode)' };
        } catch (error: any) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    /**
     * Dynamically retrieve the list of available models from the Antigravity UI.
     */
    async getUiModels(): Promise<string[]> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('Not connected to CDP.');
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
            logger.error('Failed to get UI models:', error);
            return [];
        }
    }

    /**
     * Get the currently selected model from the Antigravity UI.
     */
    async getCurrentModel(): Promise<string | null> {
        if (!this.isConnectedFlag || !this.ws) {
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
     * Operate Antigravity UI model dropdown to switch to the specified model.
     * (Step 9: Model/mode switching UI sync)
     *
     * @param modelName Model name to set (e.g., 'gpt-4o', 'claude-3-opus')
     */
    async setUiModel(modelName: string): Promise<UiSyncResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('Not connected to CDP. Call connect() first.');
        }

        // DOM manipulation script: based on actual Antigravity UI DOM structure
        // Model list uses div.cursor-pointer elements with class 'px-2 py-1 flex items-center justify-between'
        // Currently selected has 'bg-gray-500/20', others have 'hover:bg-gray-500/10'
        // textContent may have "New" suffix
        const safeModel = JSON.stringify(modelName);
        const expression = `(async () => {
            const targetModel = ${safeModel};
            
            // Get all items in the model list
            const modelItems = Array.from(document.querySelectorAll('div.cursor-pointer'))
                .filter(e => e.className.includes('px-2 py-1 flex items-center justify-between'));
            
            if (modelItems.length === 0) {
                return { ok: false, error: 'Model list not found. The dropdown may not be open.' };
            }
            
            // Match target model by name (compare after removing New suffix)
            const targetItem = modelItems.find(el => {
                const text = (el.textContent || '').trim().replace(/New$/, '').trim();
                return text === targetModel || text.toLowerCase() === targetModel.toLowerCase();
            });
            
            if (!targetItem) {
                const available = modelItems.map(el => (el.textContent || '').trim().replace(/New$/, '').trim()).join(', ');
                return { ok: false, error: 'Model "' + targetModel + '" not found. Available: ' + available };
            }
            
            // Check if already selected
            if (targetItem.className.includes('bg-gray-500/20') && !targetItem.className.includes('hover:bg-gray-500/20')) {
                return { ok: true, model: targetModel, alreadySelected: true };
            }
            
            // Click to select model
            targetItem.click();
            await new Promise(r => setTimeout(r, 500));
            
            // Verify selection was applied
            const updatedItems = Array.from(document.querySelectorAll('div.cursor-pointer'))
                .filter(e => e.className.includes('px-2 py-1 flex items-center justify-between'));
            const selectedItem = updatedItems.find(el => {
                const text = (el.textContent || '').trim().replace(/New$/, '').trim();
                return text === targetModel || text.toLowerCase() === targetModel.toLowerCase();
            });
            
            if (selectedItem && selectedItem.className.includes('bg-gray-500/20') && !selectedItem.className.includes('hover:bg-gray-500/20')) {
                return { ok: true, model: targetModel, verified: true };
            }
            
            // Click succeeded but verification failed
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
            return { ok: false, error: value?.error || 'UI operation failed (setUiModel)' };
        } catch (error: any) {
            return { ok: false, error: error?.message || String(error) };
        }
    }
}
