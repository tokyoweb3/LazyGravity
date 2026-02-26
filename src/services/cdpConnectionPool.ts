import { logger } from '../utils/logger';
import { CdpService, CdpServiceOptions } from './cdpService';
import { ApprovalDetector } from './approvalDetector';
import { ErrorPopupDetector } from './errorPopupDetector';
import { PlanningDetector } from './planningDetector';
import { UserMessageDetector } from './userMessageDetector';

/**
 * Pool that manages independent CdpService instances per workspace.
 *
 * Each workspace owns its own WebSocket / contexts / pendingCalls, so
 * switching to workspace B while workspace A's ResponseMonitor is polling
 * does not destroy A's WebSocket.
 */
export class CdpConnectionPool {
    private readonly connections = new Map<string, CdpService>();
    private readonly approvalDetectors = new Map<string, ApprovalDetector>();
    private readonly errorPopupDetectors = new Map<string, ErrorPopupDetector>();
    private readonly planningDetectors = new Map<string, PlanningDetector>();
    private readonly userMessageDetectors = new Map<string, UserMessageDetector>();
    private readonly connectingPromises = new Map<string, Promise<CdpService>>();
    private readonly cdpOptions: CdpServiceOptions;

    constructor(cdpOptions: CdpServiceOptions = {}) {
        this.cdpOptions = cdpOptions;
    }

    /**
     * Get a CdpService for the given workspace path.
     * Creates a new connection and caches it if not already connected.
     * Prevents concurrent connections via Promise locking.
     *
     * @param workspacePath Full path of the workspace
     * @returns Connected CdpService
     */
    async getOrConnect(workspacePath: string): Promise<CdpService> {
        const dirName = this.extractDirName(workspacePath);

        // Return existing connection if available
        const existing = this.connections.get(dirName);
        if (existing && existing.isConnected()) {
            // Re-validate that the still-open window is actually bound to this workspace.
            await existing.discoverAndConnectForWorkspace(workspacePath);
            return existing;
        }

        // Wait for the pending connection promise if one exists (prevents concurrent connections)
        const pending = this.connectingPromises.get(dirName);
        if (pending) {
            return pending;
        }

        // Start a new connection
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
     * Get a connected CdpService (read-only).
     * Returns null if not connected.
     */
    getConnected(workspaceDirName: string): CdpService | null {
        const cdp = this.connections.get(workspaceDirName);
        if (cdp && cdp.isConnected()) {
            return cdp;
        }
        return null;
    }

    /**
     * Disconnect the specified workspace.
     */
    disconnectWorkspace(workspaceDirName: string): void {
        const cdp = this.connections.get(workspaceDirName);
        if (cdp) {
            cdp.disconnect().catch((err) => {
                logger.error(`[CdpConnectionPool] Error while disconnecting ${workspaceDirName}:`, err);
            });
            this.connections.delete(workspaceDirName);
        }

        const detector = this.approvalDetectors.get(workspaceDirName);
        if (detector) {
            detector.stop();
            this.approvalDetectors.delete(workspaceDirName);
        }

        const errorPopupDetector = this.errorPopupDetectors.get(workspaceDirName);
        if (errorPopupDetector) {
            errorPopupDetector.stop();
            this.errorPopupDetectors.delete(workspaceDirName);
        }

        const planningDetector = this.planningDetectors.get(workspaceDirName);
        if (planningDetector) {
            planningDetector.stop();
            this.planningDetectors.delete(workspaceDirName);
        }

        const userMsgDetector = this.userMessageDetectors.get(workspaceDirName);
        if (userMsgDetector) {
            userMsgDetector.stop();
            this.userMessageDetectors.delete(workspaceDirName);
        }
    }

    /**
     * Disconnect all workspace connections.
     */
    disconnectAll(): void {
        for (const dirName of [...this.connections.keys()]) {
            this.disconnectWorkspace(dirName);
        }
    }

    /**
     * Register an approval detector for a workspace.
     */
    registerApprovalDetector(workspaceDirName: string, detector: ApprovalDetector): void {
        // Stop existing detector
        const existing = this.approvalDetectors.get(workspaceDirName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.approvalDetectors.set(workspaceDirName, detector);
    }

    /**
     * Get the approval detector for a workspace.
     */
    getApprovalDetector(workspaceDirName: string): ApprovalDetector | undefined {
        return this.approvalDetectors.get(workspaceDirName);
    }

    /**
     * Register an error popup detector for a workspace.
     */
    registerErrorPopupDetector(workspaceDirName: string, detector: ErrorPopupDetector): void {
        // Stop existing detector
        const existing = this.errorPopupDetectors.get(workspaceDirName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.errorPopupDetectors.set(workspaceDirName, detector);
    }

    /**
     * Get the error popup detector for a workspace.
     */
    getErrorPopupDetector(workspaceDirName: string): ErrorPopupDetector | undefined {
        return this.errorPopupDetectors.get(workspaceDirName);
    }

    /**
     * Register a planning detector for a workspace.
     */
    registerPlanningDetector(workspaceDirName: string, detector: PlanningDetector): void {
        // Stop existing detector
        const existing = this.planningDetectors.get(workspaceDirName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.planningDetectors.set(workspaceDirName, detector);
    }

    /**
     * Get the planning detector for a workspace.
     */
    getPlanningDetector(workspaceDirName: string): PlanningDetector | undefined {
        return this.planningDetectors.get(workspaceDirName);
    }

    /**
     * Register a user message detector for a workspace.
     */
    registerUserMessageDetector(workspaceDirName: string, detector: UserMessageDetector): void {
        const existing = this.userMessageDetectors.get(workspaceDirName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.userMessageDetectors.set(workspaceDirName, detector);
    }

    /**
     * Get the user message detector for a workspace.
     */
    getUserMessageDetector(workspaceDirName: string): UserMessageDetector | undefined {
        return this.userMessageDetectors.get(workspaceDirName);
    }

    /**
     * Return a list of workspace names with active connections.
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
     * Extract the directory name from a workspace path.
     */
    extractDirName(workspacePath: string): string {
        return workspacePath.split('/').filter(Boolean).pop() || workspacePath;
    }

    /**
     * Create a new CdpService and connect to the workspace.
     */
    private async createAndConnect(workspacePath: string, dirName: string): Promise<CdpService> {
        // Disconnect old connection if exists
        const old = this.connections.get(dirName);
        if (old) {
            await old.disconnect().catch(() => {});
            this.connections.delete(dirName);
        }

        const cdp = new CdpService(this.cdpOptions);

        // Auto-cleanup on disconnect
        cdp.on('disconnected', () => {
            logger.error(`[CdpConnectionPool] Workspace "${dirName}" disconnected`);
            // Only remove from Map when reconnection fails
            // (CdpService attempts reconnection internally, so we don't remove here)
        });

        cdp.on('reconnectFailed', () => {
            logger.error(`[CdpConnectionPool] Reconnection failed for workspace "${dirName}". Removing from pool`);
            this.connections.delete(dirName);
            const detector = this.approvalDetectors.get(dirName);
            if (detector) {
                detector.stop();
                this.approvalDetectors.delete(dirName);
            }
            const errorDetector = this.errorPopupDetectors.get(dirName);
            if (errorDetector) {
                errorDetector.stop();
                this.errorPopupDetectors.delete(dirName);
            }
            const planDetector = this.planningDetectors.get(dirName);
            if (planDetector) {
                planDetector.stop();
                this.planningDetectors.delete(dirName);
            }
            const userMsgDetector = this.userMessageDetectors.get(dirName);
            if (userMsgDetector) {
                userMsgDetector.stop();
                this.userMessageDetectors.delete(dirName);
            }
        });

        // Connect to the workspace
        await cdp.discoverAndConnectForWorkspace(workspacePath);
        this.connections.set(dirName, cdp);

        return cdp;
    }
}
