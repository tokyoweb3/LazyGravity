import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import { logger } from '../utils/logger';
import { resolveProjectName } from '../utils/projectResolver';

import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { executeBrowserClick } from '../utils/questionActionUtils';
export interface GenericActionButtonActionDeps {
    readonly bridge: CdpBridge;
    readonly wsHandler: WorkspaceCommandHandler;
}

/**
 * Parses a generic action button customId into its components.
 * Format: action_btn_[action_name]:[project_name]:[channel_id]
 *
 * @param customId The customId to parse
 * @returns Parsed action details, or null if not an action button
 */
export interface ParsedGenericAction {
    actionName: string;
    projectName?: string;
    channelId?: string;
}

export function parseGenericActionCustomId(customId: string): ParsedGenericAction | null {
    if (!customId.startsWith('action_btn_')) return null;
    const parts = customId.split(':');
    const actionName = parts[0].replace('action_btn_', '').replace(/_/g, ' ');
    // Capitalize first letter
    const formattedName = actionName.charAt(0).toUpperCase() + actionName.slice(1);
    
    if (parts.length < 3) {
        return { actionName: formattedName };
    }
    
    const channelId = parts[parts.length - 1];
    const projectName = parts.slice(1, parts.length - 1).join(':');

    return {
        actionName: formattedName,
        projectName: projectName || undefined,
        channelId: channelId || undefined,
    };
}

export function createGenericActionButtonAction(deps: GenericActionButtonActionDeps): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseGenericActionCustomId(customId);
            if (!parsed) return null;
            const result: Record<string, string> = { actionName: parsed.actionName };
            if (parsed.projectName) result.projectName = parsed.projectName;
            if (parsed.channelId) result.channelId = parsed.channelId;
            return result;
        },

        async execute(interaction, params): Promise<void> {
            const actionName = params.actionName;
            const channelId = params.channelId || interaction.channel?.id;
            if (!channelId) {
                await interaction.reply({
                    text: 'Error: Cannot resolve channel ID.',
                    ephemeral: true,
                }).catch(() => {});
                return;
            }
            const projectName = resolveProjectName(deps, channelId, params.projectName);

            await interaction.deferUpdate().catch(() => {});

            const accountName = deps.bridge.selectedAccountByChannel?.get(channelId) || 'default';
            const cdp = projectName 
                ? deps.bridge.pool.getConnected(projectName, accountName)
                : null;
                
            if (!cdp) {
                await interaction.followUp({
                    text: 'Not connected to Antigravity. Send the action as a message instead.',
                }).catch(() => {});
                return;
            }

            // Simulate DOM click instead of chat injection
            logger.info(`[GenericActionButton] Clicking action button "${actionName}" via DOM script`);
            const success = await executeBrowserClick(cdp, actionName);

            if (!success) {
                await interaction.followUp({
                    text: `Failed to execute action: Button "${actionName}" not found or obscured.`,
                }).catch(() => {});
                return;
            }
        },
    };
}
