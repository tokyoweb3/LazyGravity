/**
 * Platform-agnostic ButtonAction for model selection interactions.
 *
 * Handles:
 *   model_btn_<name>  — Switch to the specified model
 *   model_refresh_btn — Refresh the model list UI
 */

import type { ButtonAction } from './buttonHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import { buildModelsPayload } from '../ui/modelsUi';
import type { ModelService } from '../services/modelService';
import type { UserPreferenceRepository } from '../database/userPreferenceRepository';
import { logger } from '../utils/logger';

export interface ModelButtonActionDeps {
    readonly bridge: CdpBridge;
    readonly fetchQuota: () => Promise<any[]>;
    readonly modelService?: ModelService;
    readonly userPrefRepo?: UserPreferenceRepository;
    readonly ensureSessionActivated?: (channelId: string, userId: string, cdp: NonNullable<ReturnType<typeof getCurrentCdp>>) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function createModelButtonAction(deps: ModelButtonActionDeps): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            if (customId === 'model_refresh_btn') {
                return { action: 'refresh' };
            }
            if (customId === 'model_set_default_btn') {
                return { action: 'set_default' };
            }
            if (customId === 'model_clear_default_btn') {
                return { action: 'clear_default' };
            }
            if (customId.startsWith('model_btn_')) {
                return { action: 'select', modelName: customId.slice('model_btn_'.length) };
            }
            return null;
        },

        async execute(interaction, params): Promise<void> {
            await interaction.deferUpdate();

            const cdp = getCurrentCdp(deps.bridge);
            if (!cdp) {
                logger.warn(`[ModelCommand] source=button user=${interaction.user.id} action=${params.action} cdp=unavailable`);
                await interaction.followUp({ text: 'Not connected to CDP.' }).catch(() => {});
                return;
            }
            if (deps.ensureSessionActivated) {
                const sessionReady = await deps.ensureSessionActivated(interaction.channel.id, interaction.user.id, cdp);
                if (!sessionReady.ok) {
                    await interaction.followUp({ text: sessionReady.error }).catch(() => {});
                    return;
                }
            }

            if (params.action === 'set_default') {
                const currentModel = await cdp.getCurrentModel();
                if (!currentModel) {
                    await interaction.followUp({ text: 'No current model detected.' }).catch(() => {});
                    return;
                }
                if (deps.modelService) {
                    deps.modelService.setDefaultModel(currentModel);
                }
                if (deps.userPrefRepo) {
                    deps.userPrefRepo.setDefaultModel(interaction.user.id, currentModel);
                }
                await refreshModelsUI(cdp, deps, interaction);
                await interaction.followUp({
                    text: `Default model set to ${currentModel}.`,
                }).catch(() => {});
            } else if (params.action === 'clear_default') {
                if (deps.modelService) {
                    deps.modelService.setDefaultModel(null);
                }
                if (deps.userPrefRepo) {
                    deps.userPrefRepo.setDefaultModel(interaction.user.id, null);
                }
                await refreshModelsUI(cdp, deps, interaction);
                await interaction.followUp({
                    text: 'Default model cleared.',
                }).catch(() => {});
            } else if (params.action === 'select') {
                logger.info(`[ModelCommand] source=button user=${interaction.user.id} target="${params.modelName}"`);
                const res = await cdp.setUiModel(params.modelName);
                logger.info(
                    `[ModelCommand] source=button user=${interaction.user.id} target="${params.modelName}" ` +
                    `ok=${res.ok} applied=${res.model ? `"${res.model}"` : 'null'} ` +
                    `verified=${res.verified === true} alreadySelected=${res.alreadySelected === true} ` +
                    `error=${res.error ? `"${res.error}"` : 'null'}`,
                );
                if (!res.ok) {
                    await interaction.followUp({
                        text: res.error || 'Failed to change model.',
                    }).catch(() => {});
                    return;
                }

                // Refresh UI after model change
                await refreshModelsUI(cdp, deps, interaction);

                await interaction.followUp({
                    text: `Model changed to ${res.model}.`,
                }).catch(() => {});
            } else {
                // refresh
                await refreshModelsUI(cdp, deps, interaction);
            }
        },
    };
}

async function refreshModelsUI(
    cdp: NonNullable<ReturnType<typeof getCurrentCdp>>,
    actionDeps: ModelButtonActionDeps,
    interaction: { update(payload: any): Promise<void> },
): Promise<void> {
    try {
        const models = await cdp.getUiModels();
        const currentModel = await cdp.getCurrentModel();
        const quotaData = await actionDeps.fetchQuota();
        const defaultModel = actionDeps.modelService?.getDefaultModel() ?? null;
        const payload = buildModelsPayload(models, currentModel, quotaData, defaultModel);
        if (payload) {
            await interaction.update(payload);
        }
    } catch (err: any) {
        logger.warn('[ModelButton] Failed to refresh models UI:', err?.message || err);
    }
}
