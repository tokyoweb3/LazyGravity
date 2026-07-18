import type { PlatformSelectInteraction } from '../platform/types';
import type { SelectAction } from './selectHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';
import { QUESTION_SELECT_ACTION_PREFIX } from '../services/notificationSender';
import { parseQuestionCustomId } from '../utils/questionActionUtils';
import { resolveProjectName } from '../utils/projectResolver';

/**
 * Dependencies injected into question selection action creator.
 */
export interface QuestionSelectActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Workspace command handler instance. */
    readonly wsHandler: WorkspaceCommandHandler;
}

/**
 * Factory creating SelectAction for interactive question select menu changes.
 * @param deps Injected dependencies.
 * @returns SelectAction implementation.
 */
export function createQuestionSelectAction(deps: QuestionSelectActionDeps): SelectAction {
    return {
        match(customId: string): boolean {
            return customId.startsWith(QUESTION_SELECT_ACTION_PREFIX);
        },

        async execute(
            interaction: PlatformSelectInteraction,
            values: readonly string[],
        ): Promise<boolean> {
            const parsed = parseQuestionCustomId(interaction.customId, QUESTION_SELECT_ACTION_PREFIX);
            if (!parsed) return false;

            const selectedOption = parseInt(values[0], 10);
            if (isNaN(selectedOption)) return false;

            const channelId = parsed.channelId;
            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This question is linked to a different session channel.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, parsed.projectName);
            logger.debug(`[QuestionSelectAction] project=${projectName ?? 'null'} channel=${interaction.channel.id}`);

            const detector = projectName
                ? deps.bridge.pool.getQuestionDetector(projectName)
                : undefined;

            if (!detector) {
                logger.warn(`[QuestionSelectAction] No detector for project=${projectName}`);
                await interaction
                    .reply({ text: 'Question detector not found.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            await interaction.deferUpdate().catch(() => {});

            let success = false;
            try {
                success = await detector.submitOption(selectedOption);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`[QuestionSelectAction] CDP click failed: ${msg}`);
                await interaction
                    .followUp({ text: `Failed to answer question: ${msg}`, ephemeral: true })
                    .catch(() => {});
                return false;
            }

            if (success) {
                const updatePayload = { text: `✅ Submitted option ${selectedOption + 1}.\n\n⏳ IDE is working on the response...`, components: [] as any[] };
                try {
                    await interaction.editReply(updatePayload);
                } catch (editErr) {
                    logger.warn('[QuestionSelectAction] editReply failed, sending followUp:', editErr);
                    await interaction.followUp({ text: `✅ Submitted option ${selectedOption + 1}.\n\n⏳ IDE is working on the response...` }).catch(() => {});
                }
            } else {
                await interaction
                    .followUp({ text: 'Failed to answer question (it may have been resolved already).', ephemeral: true })
                    .catch(() => {});
            }

            return success;
        },
    };
}
