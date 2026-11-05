import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { restoreQuestionDetector } from '../services/cdpBridgeManager';
import type { WorkspaceCommandHandler } from '../commands/workspaceCommandHandler';
import { logger } from '../utils/logger';
import { QUESTION_SKIP_ACTION_PREFIX } from '../services/notificationSender';
import { parseQuestionCustomId } from '../utils/questionActionUtils';
import { resolveProjectName } from '../utils/projectResolver';

/**
 * Dependencies injected into question skip action creator.
 */
export interface QuestionSkipActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Workspace command handler instance. */
    readonly wsHandler: WorkspaceCommandHandler;
    /** Account selected for this session. */
    readonly accountName?: string;
}

/**
 * Factory creating ButtonAction for skipping interactive question inputs.
 * @param deps Injected dependencies.
 * @returns ButtonAction implementation.
 */
export function createQuestionSkipAction(deps: QuestionSkipActionDeps): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseQuestionCustomId(customId, QUESTION_SKIP_ACTION_PREFIX);
            return parsed ? { action: parsed.action } : null;
        },

        /** Restore the bound session and skip only the question identified by this control. */
        async execute(
            interaction: PlatformButtonInteraction,
            params: Record<string, string>,
        ): Promise<boolean> {
            const parsed = parseQuestionCustomId(interaction.customId, QUESTION_SKIP_ACTION_PREFIX);
            if (!parsed) return false;

            const channelId = parsed.channelId;
            if (channelId && channelId !== interaction.channel.id) {
                await interaction
                    .reply({ text: 'This question is linked to a different session channel.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            const projectName = resolveProjectName(deps, interaction.channel.id, parsed.projectName, { preferChannelBinding: true });
            logger.debug(`[QuestionSkipAction] project=${projectName ?? 'null'} channel=${interaction.channel.id}`);

            await interaction.deferUpdate().catch(() => {});
            let detector = projectName
                ? deps.bridge.pool.getQuestionDetector(projectName, deps.accountName)
                : undefined;

            try {
                if (detector) await detector.refresh?.();
                else if (projectName) detector = await restoreQuestionDetector(
                    deps.bridge, projectName, deps.wsHandler.getWorkspaceForChannel(interaction.channel.id),
                    interaction.channel, parsed.questionId, deps.accountName,
                );
            } catch (error) {
                logger.warn('[QuestionSkipAction] Could not restore the question:', error);
                detector = undefined;
            }

            if (!detector) {
                logger.warn(`[QuestionSkipAction] No detector for project=${projectName}`);
                await interaction
                    .followUp({ text: 'Unable to restore this question. Run /model to refresh the question.', ephemeral: true })
                    .catch(() => {});
                return false;
            }

            let success = false;
            try {
                success = parsed.questionId
                    ? await detector.skipQuestion(parsed.questionId)
                    : await detector.skipQuestion();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`[QuestionSkipAction] CDP click failed: ${msg}`);
                await interaction
                    .followUp({ text: `Failed to skip question: ${msg}`, ephemeral: true })
                    .catch(() => {});
                return false;
            }

            if (success) {
                const updatePayload = { text: '✅ Skipped question.\n\n⏳ IDE is working on the response...', components: [] as any[] };
                try {
                    await interaction.editReply(updatePayload);
                } catch (editErr) {
                    logger.warn('[QuestionSkipAction] editReply failed, sending followUp:', editErr);
                    await interaction.followUp({ text: '✅ Skipped question.\n\n⏳ IDE is working on the response...' }).catch(() => {});
                }
            } else {
                await interaction
                    .followUp({ text: 'Failed to skip question (it may have been resolved already).', ephemeral: true })
                    .catch(() => {});
            }

            return success;
        },
    };
}
