import { PlatformModalSubmitInteraction } from '../platform/types';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import { t } from '../utils/i18n';
import { logger } from '../utils/logger';

/**
 * Executes the modal submission logic for custom comments injected into the workspace plan.
 * @param interaction Platform modal submit interaction payload.
 * @param projectName Active workspace project name.
 * @param pool CDP connection pool service.
 * @param accountName Active user account name.
 */
export async function execute(
    interaction: PlatformModalSubmitInteraction,
    projectName: string | null,
    pool: CdpConnectionPool,
    accountName: string,
): Promise<void> {
    try {
        if (!projectName) {
            await interaction.reply({ text: t('Project name not found.'), ephemeral: true });
            return;
        }

        const cdp = pool.getConnected(projectName, accountName);
        if (!cdp) {
            await interaction.reply({ text: t('Not connected to workspace.'), ephemeral: true });
            return;
        }

        const comment = interaction.fields.get('comment')?.trim();
        if (!comment) {
            await interaction.reply({ text: t('Comment cannot be empty.'), ephemeral: true });
            return;
        }

        await interaction.deferUpdate();

        // Inject the comment into the chat
        const result = await cdp.injectMessage(comment);

        if (!result.ok) {
            await interaction.followUp({ text: t('Failed to submit comment: {{error}}', { error: result.error }), ephemeral: true });
            return;
        }

        await interaction.followUp({ text: t('Comment submitted to the plan successfully.'), ephemeral: true });
    } catch (error: any) {
        logger.error('[PlanningModalSubmit] Error:', error);
        try {
            await interaction.followUp({ text: t('An error occurred while submitting your comment.'), ephemeral: true });
        } catch { /* ignore */ }
    }
}
