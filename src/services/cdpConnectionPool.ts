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
        const projectName = this.extractProjectName(workspacePath);

        // Return existing connection if available
        const existing = this.connections.get(projectName);
        if (existing && existing.isConnected()) {
            // Re-validate that the still-open window is actually bound to this workspace.
            await existing.discoverAndConnectForWorkspace(workspacePath);
            return existing;
        }

        // Wait for the pending connection promise if one exists (prevents concurrent connections)
        const pending = this.connectingPromises.get(projectName);
        if (pending) {
            return pending;
        }

        // Start a new connection
        const connectPromise = this.createAndConnect(workspacePath, projectName);
        this.connectingPromises.set(projectName, connectPromise);

        try {
            const cdp = await connectPromise;
            return cdp;
        } finally {
            this.connectingPromises.delete(projectName);
        }
    }

    /**
     * Get a connected CdpService (read-only).
     * Returns null if not connected.
     */
    getConnected(projectName: string): CdpService | null {
        const cdp = this.connections.get(projectName);
        if (cdp && cdp.isConnected()) {
            return cdp;
        }
        return null;
    }

    /**
     * Disconnect the specified workspace.
     */
    disconnectWorkspace(projectName: string): void {
        const cdp = this.connections.get(projectName);
        if (cdp) {
            cdp.disconnect().catch((err) => {
                logger.error(`[CdpConnectionPool] Error while disconnecting ${projectName}:`, err);
            });
            this.connections.delete(projectName);
        }

        const detector = this.approvalDetectors.get(projectName);
        if (detector) {
            detector.stop();
            this.approvalDetectors.delete(projectName);
        }

        const errorPopupDetector = this.errorPopupDetectors.get(projectName);
        if (errorPopupDetector) {
            errorPopupDetector.stop();
            this.errorPopupDetectors.delete(projectName);
        }

        const planningDetector = this.planningDetectors.get(projectName);
        if (planningDetector) {
            planningDetector.stop();
            this.planningDetectors.delete(projectName);
        }

        const userMsgDetector = this.userMessageDetectors.get(projectName);
        if (userMsgDetector) {
            userMsgDetector.stop();
            this.userMessageDetectors.delete(projectName);
        }
    }

    /**
     * Disconnect all workspace connections.
     */
    disconnectAll(): void {
        for (const projectName of [...this.connections.keys()]) {
            this.disconnectWorkspace(projectName);
        }
    }

    /**
     * Register an approval detector for a workspace.
     */
    registerApprovalDetector(projectName: string, detector: ApprovalDetector): void {
        // Stop existing detector
        const existing = this.approvalDetectors.get(projectName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.approvalDetectors.set(projectName, detector);
    }

    /**
     * Get the approval detector for a workspace.
     */
    getApprovalDetector(projectName: string): ApprovalDetector | undefined {
        return this.approvalDetectors.get(projectName);
    }

    /**
     * Register an error popup detector for a workspace.
     */
    registerErrorPopupDetector(projectName: string, detector: ErrorPopupDetector): void {
        // Stop existing detector
        const existing = this.errorPopupDetectors.get(projectName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.errorPopupDetectors.set(projectName, detector);
    }

    /**
     * Get the error popup detector for a workspace.
     */
    getErrorPopupDetector(projectName: string): ErrorPopupDetector | undefined {
        return this.errorPopupDetectors.get(projectName);
    }

    /**
     * Register a planning detector for a workspace.
     */
    registerPlanningDetector(projectName: string, detector: PlanningDetector): void {
        // Stop existing detector
        const existing = this.planningDetectors.get(projectName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.planningDetectors.set(projectName, detector);
    }

    /**
     * Get the planning detector for a workspace.
     */
    getPlanningDetector(projectName: string): PlanningDetector | undefined {
        return this.planningDetectors.get(projectName);
    }

    /**
     * Register a user message detector for a workspace.
     */
    registerUserMessageDetector(projectName: string, detector: UserMessageDetector): void {
        const existing = this.userMessageDetectors.get(projectName);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.userMessageDetectors.set(projectName, detector);
    }

    /**
     * Get the user message detector for a workspace.
     */
    getUserMessageDetector(projectName: string): UserMessageDetector | undefined {
        return this.userMessageDetectors.get(projectName);
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
     * Extract the project name from a workspace path.
     */
    extractProjectName(workspacePath: string): string {
        return workspacePath.split('/').filter(Boolean).pop() || workspacePath;
    }

    /**
     * Create a new CdpService and connect to the workspace.
     */
    private async createAndConnect(workspacePath: string, projectName: string): Promise<CdpService> {
        // Disconnect old connection if exists
        const old = this.connections.get(projectName);
        if (old) {
            await old.disconnect().catch(() => {});
            this.connections.delete(projectName);
        }

        const cdp = new CdpService(this.cdpOptions);

        // Auto-cleanup on disconnect
        cdp.on('disconnected', () => {
            logger.error(`[CdpConnectionPool] Workspace "${projectName}" disconnected`);
            // Only remove from Map when reconnection fails
            // (CdpService attempts reconnection internally, so we don't remove here)
        });

        cdp.on('reconnectFailed', () => {
            logger.error(`[CdpConnectionPool] Reconnection failed for workspace "${projectName}". Removing from pool`);
            this.connections.delete(projectName);
            const detector = this.approvalDetectors.get(projectName);
            if (detector) {
                detector.stop();
                this.approvalDetectors.delete(projectName);
            }
            const errorDetector = this.errorPopupDetectors.get(projectName);
            if (errorDetector) {
                errorDetector.stop();
                this.errorPopupDetectors.delete(projectName);
            }
            const planDetector = this.planningDetectors.get(projectName);
            if (planDetector) {
                planDetector.stop();
                this.planningDetectors.delete(projectName);
            }
            const userMsgDetector = this.userMessageDetectors.get(projectName);
            if (userMsgDetector) {
                userMsgDetector.stop();
                this.userMessageDetectors.delete(projectName);
            }
        });

        // Connect to the workspace
        await cdp.discoverAndConnectForWorkspace(workspacePath);
        this.connections.set(projectName, cdp);

        return cdp;
    }
}
