import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import {
    AVAILABLE_MODES,
    MODE_DESCRIPTIONS,
    MODE_DISPLAY_NAMES,
    ModeService,
} from '../services/modeService';
import { CdpService } from '../services/cdpService';
import type { MessagePayload } from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

/**
 * Dependencies injected into Mode UI builder functions.
 */
export interface ModeUiDeps {
    /** Optional getter returning the currently active CdpService connection. */
    getCurrentCdp?: () => CdpService | null;
}

/**
 * Build a platform-agnostic MessagePayload for mode selection UI.
 * @param currentMode The current mode name
 * @param isPending Whether the mode is pending sync to Antigravity
 */
export function buildModePayload(currentMode: string, isPending: boolean = false): MessagePayload {
    const pendingSuffix = isPending ? ' (pending sync)' : '';
    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Mode Management'),
                    0x57F287,
                ),
                `**Current Mode:** ${MODE_DISPLAY_NAMES[currentMode] || currentMode}${pendingSuffix}\n` +
                `${MODE_DESCRIPTIONS[currentMode] || ''}\n\n` +
                `**Available Modes (${AVAILABLE_MODES.length})**\n` +
                AVAILABLE_MODES.map(m => {
                    const icon = m === currentMode ? '[x]' : '[ ]';
                    return `${icon} **${MODE_DISPLAY_NAMES[m] || m}** — ${MODE_DESCRIPTIONS[m] || ''}`;
                }).join('\n'),
            ),
            'Select a mode from the dropdown below',
        ),
    );

    return {
        richContent: rc,
        components: [
            {
                components: [
                    {
                        type: 'selectMenu' as const,
                        customId: 'mode_select',
                        placeholder: 'Select a mode...',
                        options: AVAILABLE_MODES.map(m => ({
                            label: MODE_DISPLAY_NAMES[m] || m,
                            description: MODE_DESCRIPTIONS[m] || '',
                            value: m,
                            isDefault: m === currentMode,
                        })),
                    },
                ],
            },
        ],
    };
}

/**
 * Build and send the interactive UI for the /mode command (dropdown style)
 */
export async function sendModeUI(
    target: { editReply: (opts: any) => Promise<any> },
    modeService: ModeService,
    deps?: ModeUiDeps,
): Promise<void> {
    // If CDP is available, query the live mode and sync modeService
    if (deps?.getCurrentCdp) {
        const cdp = deps.getCurrentCdp();
        if (cdp) {
            const liveMode = await cdp.getCurrentMode();
            if (liveMode) {
                modeService.setMode(liveMode, true);
            }
        }
    }

    const currentMode = modeService.getCurrentMode();

    const embed = new EmbedBuilder()
        .setTitle('Mode Management')
        .setColor(0x57F287)
        .setDescription(
            `**Current Mode:** ${MODE_DISPLAY_NAMES[currentMode] || currentMode}\n` +
            `${MODE_DESCRIPTIONS[currentMode] || ''}\n\n` +
            `**Available Modes (${AVAILABLE_MODES.length})**\n` +
            AVAILABLE_MODES.map(m => {
                const icon = m === currentMode ? '[x]' : '[ ]';
                return `${icon} **${MODE_DISPLAY_NAMES[m] || m}** — ${MODE_DESCRIPTIONS[m] || ''}`;
            }).join('\n'),
        )
        .setFooter({ text: 'Select a mode from the dropdown below' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('mode_select')
        .setPlaceholder('Select a mode...')
        .addOptions(
            AVAILABLE_MODES.map(m => ({
                label: MODE_DISPLAY_NAMES[m] || m,
                description: MODE_DESCRIPTIONS[m] || '',
                value: m,
                default: m === currentMode,
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await target.editReply({ content: '', embeds: [embed], components: [row] });
}
