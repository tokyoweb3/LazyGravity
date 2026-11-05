import { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';

import { CdpService } from '../services/cdpService';
import type { MessagePayload, ComponentRow } from '../platform/types';
import { toDiscordPayload } from '../platform/discord/wrappers';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

/**
 * Dependencies injected into Model UI builder functions.
 */
export interface ModelsUiDeps {
    /** Getter returning the currently active CdpService connection. */
    getCurrentCdp: () => CdpService | null;
    /** Callback for fetching quota data. */
    fetchQuota: () => Promise<any[]>;
}

/**
 * Return type containing the structured Discord components payload for model display.
 */
export interface ModelsUiPayload {
    /** Formatted embed cards. */
    embeds: EmbedBuilder[];
    /** Model and management select menus. */
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
}

export const MODEL_SELECT_ID = 'model_select';
export const MODEL_ACTIONS_SELECT_ID = 'model_actions_select';

function modelSelectRows(models: string[], currentModel: string | null, defaultModel: string | null = null): ComponentRow[] {
    return [{ components: [{
        type: 'selectMenu', customId: MODEL_SELECT_ID, placeholder: 'Select a model...',
        options: models.slice(0, 25).map(model => ({
            label: model.substring(0, 100), value: model,
            isDefault: model === currentModel,
            ...(model === defaultModel ? { description: 'Default model' } : {}),
        })),
    }] }, { components: [{
        type: 'selectMenu', customId: MODEL_ACTIONS_SELECT_ID, placeholder: 'Model actions...',
        options: [
            { label: 'Refresh model list', value: 'refresh' },
            defaultModel
                ? { label: 'Clear default model', value: 'clear_default' }
                : { label: 'Set current model as default', value: 'set_default' },
        ],
    }] }];
}

function quotaFooter(quotaData: any[]): string {
    return quotaData.some(model => model.quotaInfo)
        ? 'Latest quota information retrieved'
        : 'Model list retrieved from IDE; quota information unavailable';
}

/**
 * Build a platform-agnostic MessagePayload for model selection UI.
 */
export function buildModelsPayload(
    models: string[],
    currentModel: string | null,
    quotaData: any[],
    defaultModel: string | null = null,
): MessagePayload | null {
    if (models.length === 0) return null;

    function formatQuota(mName: string, current: boolean) {
        if (!mName) return `${current ? '[x]' : '[ ]'} Unknown`;

        const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
        const nName = normalize(mName);
        const q = quotaData.find(q => {
            const nLabel = normalize(q.label);
            const nModel = normalize(q.model || '');
            return nLabel === nName || nModel === nName
                || nName.includes(nLabel) || nLabel.includes(nName)
                || (nModel && (nName.includes(nModel) || nModel.includes(nName)));
        });
        if (!q || !q.quotaInfo) return `${current ? '[x]' : '[ ]'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const resetTime = q.quotaInfo.resetTime ? new Date(q.quotaInfo.resetTime) : null;
        const diffMs = resetTime ? resetTime.getTime() - Date.now() : 0;
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        if (rem !== undefined && rem !== null) {
            const percent = Math.round(rem * 100);
            return `${current ? '[x]' : '[ ]'} ${mName} ${percent}% (${timeStr})`;
        }

        return `${current ? '[x]' : '[ ]'} ${mName} (${timeStr})`;
    }

    const currentModelFormatted = currentModel ? formatQuota(currentModel, true) : 'Unknown';
    const defaultLine = defaultModel
        ? `\n**Default:** ⭐ ${defaultModel}`
        : '\n**Default:** Not set';

    const modelLines = models.map(m => {
        const isCurrent = m === currentModel;
        const isDefault = defaultModel != null && m.toLowerCase() === defaultModel.toLowerCase();
        const star = isDefault ? ' ⭐' : '';
        return `${formatQuota(m, isCurrent)}${star}`;
    }).join('\n');

    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Model Management'),
                    0x5865F2,
                ),
                `**Current Model:**\n${currentModelFormatted}${defaultLine}\n\n` +
                `**Available Models (${models.length})**\n` +
                modelLines,
            ),
            quotaFooter(quotaData),
        ),
    );

    return { richContent: rc, components: modelSelectRows(models, currentModel, defaultModel) };
}

/**
 * Build the embed + select menu components for the models UI.
 * Returns null when CDP is unavailable or no models are found.
 */
export async function buildModelsUI(
    cdp: CdpService,
    fetchQuota: () => Promise<any[]>,
): Promise<ModelsUiPayload | null> {
    const models = await cdp.getUiModels();
    const currentModel = await cdp.getCurrentModel();
    const quotaData = await fetchQuota();

    if (models.length === 0) return null;

    function formatQuota(mName: string, current: boolean) {
        if (!mName) return `${current ? '[x]' : '[ ]'} Unknown`;

        const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
        const nName = normalize(mName);
        const q = quotaData.find(q => {
            const nLabel = normalize(q.label);
            const nModel = normalize(q.model || '');
            return nLabel === nName || nModel === nName
                || nName.includes(nLabel) || nLabel.includes(nName)
                || (nModel && (nName.includes(nModel) || nModel.includes(nName)));
        });
        if (!q || !q.quotaInfo) return `${current ? '[x]' : '[ ]'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const resetTime = q.quotaInfo.resetTime ? new Date(q.quotaInfo.resetTime) : null;
        const diffMs = resetTime ? resetTime.getTime() - Date.now() : 0;
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        if (rem !== undefined && rem !== null) {
            const percent = Math.round(rem * 100);
            let icon = '🟢';
            if (percent <= 20) icon = '🔴';
            else if (percent <= 50) icon = '🟡';
            return `${current ? '[x]' : '[ ]'} ${mName} ${icon} ${percent}% (⏱️ ${timeStr})`;
        }

        return `${current ? '[x]' : '[ ]'} ${mName} (⏱️ ${timeStr})`;
    }

    const currentModelFormatted = currentModel ? formatQuota(currentModel, true) : 'Unknown';

    const embed = new EmbedBuilder()
        .setTitle('Model Management')
        .setColor(0x5865F2)
        .setDescription(`**Current Model:**\n${currentModelFormatted}\n\n` +
            `**Available Models (${models.length})**\n` +
            models.map(m => formatQuota(m, m === currentModel)).join('\n'),
        )
        .setFooter({ text: quotaFooter(quotaData) })
        .setTimestamp();

    const converted = toDiscordPayload({ components: modelSelectRows(models, currentModel) });
    return { embeds: [embed], components: converted.components as ActionRowBuilder<StringSelectMenuBuilder>[] };
}

/**
 * Build and send the interactive UI for the /models command
 */
export async function sendModelsUI(
    target: { editReply: (opts: any) => Promise<any> },
    deps: ModelsUiDeps,
): Promise<void> {
    const cdp = deps.getCurrentCdp();
    if (!cdp) {
        await target.editReply({ content: 'Not connected to CDP.' });
        return;
    }

    const payload = await buildModelsUI(cdp, deps.fetchQuota);
    if (!payload) {
        await target.editReply({ content: 'Failed to retrieve model list from Antigravity.' });
        return;
    }

    await target.editReply({ content: '', ...payload });
}
