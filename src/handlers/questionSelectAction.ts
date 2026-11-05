import type { PlatformSelectInteraction } from '../platform/types';
import type { SelectAction } from './selectHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { restoreQuestionDetector } from '../services/cdpBridgeManager';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';
import { QUESTION_SELECT_ACTION_PREFIX, QUESTION_SKIP_ACTION_PREFIX } from '../services/notificationSender';
import { createQuestionSkipAction } from './questionSkipAction';
import { parseQuestionCustomId } from '../utils/questionActionUtils';
import { resolveProjectName } from '../utils/projectResolver';

/**
 * Dependencies injected into question selection action creator.
 */
export interface QuestionSelectActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Workspace command handler instance. */
    readonly wsHandler: Pick<WorkspaceCommandHandler, 'getWorkspaceForChannel'>;
    /** Account selected for this session. */
    readonly accountName?: string;
    /** Resolve the account belonging to the question's platform chat. */
    readonly resolveAccountName?: (channelId: string, userId: string) => string;
}

/**
 * Factory creating SelectAction for interactive question select menu changes.
 * @param deps Injected dependencies.
 * @returns SelectAction implementation.
 */
export function createQuestionSelectAction(deps: QuestionSelectActionDeps): SelectAction {
    return {
        /** Accept answer and skip dropdowns, including controls sent before a bot restart. */
        match(customId: string): boolean {
            return customId.startsWith(QUESTION_SELECT_ACTION_PREFIX) || customId.startsWith(QUESTION_SKIP_ACTION_PREFIX);
        },

        /** Restore the bound session and submit only the selected option of the matching live question. */
        async execute(
            interaction: PlatformSelectInteraction,
            values: readonly string[],
        ): Promise<boolean> {
            if (interaction.customId.startsWith(QUESTION_SKIP_ACTION_PREFIX)) {
                return values[0] === 'skip' ? !!(await createQuestionSkipAction(deps).execute(interaction, {})) : false;
            }
            const parsed = parseQuestionCustomId(interaction.customId, QUESTION_SELECT_ACTION_PREFIX);
            if (!parsed) return false;

            const selectedOption = Number(values[0]);
            if (!/^\d+$/.test(values[0] || '') || !Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 24) return false;

            const channelId = parsed.channelId;
            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This question is linked to a different session channel.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, parsed.projectName, { preferChannelBinding: true });
            const accountName = deps.resolveAccountName?.(interaction.channel.id, interaction.user.id) ?? deps.accountName;
            logger.debug(`[QuestionSelectAction] project=${projectName ?? 'null'} channel=${interaction.channel.id}`);

            await interaction.deferUpdate().catch(() => {});
            let detector = projectName
                ? deps.bridge.pool.getQuestionDetector(projectName, accountName)
                : undefined;

            try {
                if (detector) await detector.refresh?.();
                else if (projectName) detector = await restoreQuestionDetector(
                    deps.bridge, projectName, deps.wsHandler.getWorkspaceForChannel(interaction.channel.id),
                    interaction.channel, parsed.questionId, accountName,
                );
            } catch (error) {
                logger.warn('[QuestionSelectAction] Could not restore the question:', error);
                detector = undefined;
            }

            if (!detector) {
                logger.warn(`[QuestionSelectAction] No detector for project=${projectName}`);
                await interaction
                    .followUp({ text: 'Unable to restore this question. Run /model to refresh the question.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            let success = false;
            try {
                success = parsed.questionId
                    ? await detector.submitOption(selectedOption, parsed.questionId)
                    : await detector.submitOption(selectedOption);
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
