import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';

/**
 * Resolves the target workspace project name. If not explicitly provided, attempts to resolve
 * from the session channel bindings.
 * @param deps Injected dependencies.
 * @param channelId Active channel ID.
 * @param providedProjectName Optional explicit project name.
 * @returns Resolved project name, or undefined.
 */
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
