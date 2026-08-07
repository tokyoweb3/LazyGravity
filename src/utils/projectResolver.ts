import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';

export function resolveProjectName(
    deps: { wsHandler: WorkspaceCommandHandler; bridge: CdpBridge },
    channelId: string,
    providedProjectName?: string | null
): string | undefined {
    if (providedProjectName) {
        return providedProjectName;
    }
    const workspacePath = deps.wsHandler.getWorkspaceForChannel(channelId);
    return workspacePath ? deps.bridge.pool.extractProjectName(workspacePath) : undefined;
}
