import { logger } from '../utils/logger';
import { extractProjectNameFromPath } from '../utils/pathUtils';
import { CdpService, CdpServiceOptions } from './cdpService';
import { ApprovalDetector } from './approvalDetector';
import { ErrorPopupDetector } from './errorPopupDetector';
import { PlanningDetector } from './planningDetector';
import { UserMessageDetector } from './userMessageDetector';

export interface AccountSelection {
    name?: string;
}

function buildConnectionKey(projectName: string, accountName: string): string {
    return `${accountName}::${projectName}`;
}

export class CdpConnectionPool {
    private readonly connections = new Map<string, CdpService>();
    private readonly workspaceToAccount = new Map<string, string>();
    private readonly approvalDetectors = new Map<string, ApprovalDetector>();
    private readonly errorPopupDetectors = new Map<string, ErrorPopupDetector>();
    private readonly planningDetectors = new Map<string, PlanningDetector>();
    private readonly userMessageDetectors = new Map<string, UserMessageDetector>();
    private readonly connectingPromises = new Map<string, Promise<CdpService>>();
    private readonly cdpOptions: CdpServiceOptions;

    constructor(cdpOptions: CdpServiceOptions = {}) {
        this.cdpOptions = cdpOptions;
    }

    private resolveAccountName(projectName: string, accountName: string): string {
        if (accountName !== 'default') return accountName;
        return this.workspaceToAccount.get(projectName) || accountName;
    }

    async getOrConnect(workspacePath: string, selection?: AccountSelection): Promise<CdpService> {
        const projectName = this.extractProjectName(workspacePath);
        const accountName = selection?.name || this.workspaceToAccount.get(projectName) || 'default';
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);

        const existing = this.connections.get(key);
        if (existing && existing.isConnected()) {
            await existing.discoverAndConnectForWorkspace(workspacePath);
            return existing;
        }

        const pending = this.connectingPromises.get(key);
        if (pending) return pending;

        const connectPromise = this.createAndConnect(workspacePath, projectName, accountName);
        this.connectingPromises.set(key, connectPromise);

        try {
            const cdp = await connectPromise;
            return cdp;
        } finally {
            this.connectingPromises.delete(key);
            this.workspaceToAccount.set(projectName, accountName);
        }
    }

    getConnected(projectName: string, accountName: string = 'default'): CdpService | null {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const cdp = this.connections.get(buildConnectionKey(projectName, effectiveAccount));
        return cdp && cdp.isConnected() ? cdp : null;
    }

    disconnectWorkspace(projectName: string, accountName: string = 'default'): void {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        const cdp = this.connections.get(key);
        if (cdp) {
            cdp.disconnect().catch((err) => logger.error(`[CdpConnectionPool] Error while disconnecting ${key}:`, err));
            this.connections.delete(key);
        }

        this.approvalDetectors.get(key)?.stop();
        this.approvalDetectors.delete(key);

        this.errorPopupDetectors.get(key)?.stop();
        this.errorPopupDetectors.delete(key);

        this.planningDetectors.get(key)?.stop();
        this.planningDetectors.delete(key);

        this.userMessageDetectors.get(key)?.stop();
        this.userMessageDetectors.delete(key);
    }

    disconnectAll(): void {
        for (const key of [...this.connections.keys()]) {
            const [accountName, projectName] = key.split('::');
            this.disconnectWorkspace(projectName, accountName);
        }
    }

    registerApprovalDetector(projectName: string, detector: ApprovalDetector, accountName: string = 'default'): void {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        this.approvalDetectors.get(key)?.stop();
        this.approvalDetectors.set(key, detector);
    }

    getApprovalDetector(projectName: string, accountName: string = 'default'): ApprovalDetector | undefined {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        return this.approvalDetectors.get(buildConnectionKey(projectName, effectiveAccount));
    }

    registerErrorPopupDetector(projectName: string, detector: ErrorPopupDetector, accountName: string = 'default'): void {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        this.errorPopupDetectors.get(key)?.stop();
        this.errorPopupDetectors.set(key, detector);
    }

    getErrorPopupDetector(projectName: string, accountName: string = 'default'): ErrorPopupDetector | undefined {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        return this.errorPopupDetectors.get(buildConnectionKey(projectName, effectiveAccount));
    }

    registerPlanningDetector(projectName: string, detector: PlanningDetector, accountName: string = 'default'): void {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        this.planningDetectors.get(key)?.stop();
        this.planningDetectors.set(key, detector);
    }

    getPlanningDetector(projectName: string, accountName: string = 'default'): PlanningDetector | undefined {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        return this.planningDetectors.get(buildConnectionKey(projectName, effectiveAccount));
    }

    registerUserMessageDetector(projectName: string, detector: UserMessageDetector, accountName: string = 'default'): void {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        this.userMessageDetectors.get(key)?.stop();
        this.userMessageDetectors.set(key, detector);
    }

    getUserMessageDetector(projectName: string, accountName: string = 'default'): UserMessageDetector | undefined {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        return this.userMessageDetectors.get(buildConnectionKey(projectName, effectiveAccount));
    }

    getActiveWorkspaceNames(): string[] {
        const active: string[] = [];
        for (const [key, cdp] of this.connections) {
            if (!cdp.isConnected()) continue;
            const [, projectName] = key.split('::');
            active.push(projectName || key);
        }
        return active;
    }

    extractProjectName(workspacePath: string): string {
        return extractProjectNameFromPath(workspacePath) || workspacePath;
    }

    private async createAndConnect(workspacePath: string, projectName: string, accountName: string): Promise<CdpService> {
        const effectiveAccount = this.resolveAccountName(projectName, accountName);
        const key = buildConnectionKey(projectName, effectiveAccount);
        const old = this.connections.get(key);
        if (old) {
            await old.disconnect().catch(() => {});
            this.connections.delete(key);
        }

        const cdp = new CdpService({ ...this.cdpOptions, accountName: effectiveAccount });

        cdp.on('reconnectFailed', () => {
            logger.error(`[CdpConnectionPool] Reconnection failed for workspace "${key}". Removing from pool`);
            this.connections.delete(key);
            this.approvalDetectors.get(key)?.stop();
            this.approvalDetectors.delete(key);
            this.errorPopupDetectors.get(key)?.stop();
            this.errorPopupDetectors.delete(key);
            this.planningDetectors.get(key)?.stop();
            this.planningDetectors.delete(key);
            this.userMessageDetectors.get(key)?.stop();
            this.userMessageDetectors.delete(key);
        });

        await cdp.discoverAndConnectForWorkspace(workspacePath);
        this.connections.set(key, cdp);
        return cdp;
    }
}
