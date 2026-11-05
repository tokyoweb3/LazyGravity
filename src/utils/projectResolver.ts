import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';

/**
 * Resolve the workspace project, using channel bindings first for compact question controls
 * and explicit project names first for other callers.
 * @param deps Injected dependencies.
 * @param channelId Active channel ID.
 * @param providedProjectName Optional explicit project name.
 * @param options Prefer the channel binding when custom IDs may contain a truncated project name.
 * @returns Resolved project name, or undefined.
 */
export function resolveProjectName(
    deps: { wsHandler: Pick<WorkspaceCommandHandler, 'getWorkspaceForChannel'>; bridge: CdpBridge },
    channelId: string,
    providedProjectName?: string | null,
    options: { preferChannelBinding?: boolean } = {},
): string | undefined {
    if (providedProjectName && !options.preferChannelBinding) {
        return providedProjectName;
    }
    const workspacePath = deps.wsHandler.getWorkspaceForChannel(channelId);
    return workspacePath ? deps.bridge.pool.extractProjectName(workspacePath) : providedProjectName || undefined;
}
