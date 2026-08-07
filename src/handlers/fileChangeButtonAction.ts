import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { parseFileChangeCustomId } from '../services/cdpBridgeManager';
import { resolveProjectName } from '../utils/projectResolver';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';

import { executeBrowserClick } from '../utils/questionActionUtils';
export interface FileChangeButtonActionDeps {
    readonly bridge: CdpBridge;
    readonly wsHandler: WorkspaceCommandHandler;
}

export function createFileChangeButtonAction(
    deps: FileChangeButtonActionDeps,
): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseFileChangeCustomId(customId);
            if (!parsed) return null;
            return {
                action: parsed.action,
                projectName: parsed.projectName ?? '',
                channelId: parsed.channelId ?? '',
            };
        },

        async execute(
            interaction: PlatformButtonInteraction,
            params: Record<string, string>,
        ): Promise<void> {
            const { action, channelId } = params;

            // Acknowledge immediately so Telegram/Discord doesn't time out
            await interaction.deferUpdate().catch(() => {});

            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This file change action is linked to a different session channel.' })
                    .catch(() => {});
                return;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, params.projectName);
            const cdp = projectName ? deps.bridge.pool.getConnected(projectName) : undefined;

            if (!cdp || !cdp.isConnected()) {
                await interaction
                    .reply({ text: 'Not connected to IDE.' })
                    .catch(() => {});
                return;
            }

            const targetText = action === 'accept' ? 'Accept all' : 'Reject all';

            const success = await executeBrowserClick(cdp, targetText);

            if (success) {
                await interaction
                    .update({
                        text: `${action === 'accept' ? '✅ Accepted' : '❌ Rejected'} file changes.`,
                        components: [],
                    })
                    .catch((err) => {
                        logger.warn('[FileChangeAction] update failed:', err);
                    });
            } else {
                await interaction
                    .followUp({ text: `Could not find the "${targetText}" button in the IDE. The file change prompt may have been dismissed.` })
                    .catch(() => {});
            }
        },
    };
}
