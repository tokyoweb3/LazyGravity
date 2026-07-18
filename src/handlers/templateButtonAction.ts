/**
 * Platform-agnostic ButtonAction for template execution interactions.
 *
 * When a template button is clicked, the template prompt is injected into
 * Antigravity via CDP. The user receives a confirmation message.
 *
 * Handles: template_btn_<id>
 */

import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import { TEMPLATE_BTN_PREFIX, parseTemplateButtonId } from '../ui/templateUi';
import type { TemplateRepository } from '../database/templateRepository';
import { logger } from '../utils/logger';

/**
 * Dependencies injected into template button action creator.
 */
export interface TemplateButtonActionDeps {
    /** Target CDP bridge manager instance. */
    readonly bridge: CdpBridge;
    /** Repository managing custom prompting templates. */
    readonly templateRepo: TemplateRepository;
}

/**
 * Factory creating ButtonAction for template injection button clicks.
 * @param deps Injected dependencies.
 * @returns ButtonAction implementation.
 */
export function createTemplateButtonAction(deps: TemplateButtonActionDeps): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            if (!customId.startsWith(TEMPLATE_BTN_PREFIX)) return null;
            const id = parseTemplateButtonId(customId);
            if (isNaN(id)) return null;
            return { templateId: String(id) };
        },

        async execute(interaction, params): Promise<void> {
            const templateId = parseInt(params.templateId, 10);
            const template = deps.templateRepo.findById(templateId);
            if (!template) {
                await interaction.reply({ text: 'Template not found. It may have been deleted.' }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();

            const cdp = getCurrentCdp(deps.bridge);
            if (!cdp) {
                await interaction.followUp({
                    text: 'Not connected to Antigravity. Send the prompt as a message instead.',
                }).catch(() => {});
                return;
            }

            // Inject the template prompt
            logger.info(`[TemplateButton] Executing template "${template.name}" (id=${template.id})`);
            const result = await cdp.injectMessage(template.prompt);
            if (!result.ok) {
                await interaction.followUp({
                    text: `Failed to execute template: ${result.error}`,
                }).catch(() => {});
                return;
            }

            await interaction.followUp({
                text: `Executing template: ${template.name}`,
            }).catch(() => {});
        },
    };
}
