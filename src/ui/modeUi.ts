import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import {
    AVAILABLE_MODES,
    MODE_DESCRIPTIONS,
    MODE_DISPLAY_NAMES,
    ModeService,
} from '../services/modeService';
import { CdpService } from '../services/cdpService';

export interface ModeUiDeps {
    getCurrentCdp?: () => CdpService | null;
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
                modeService.setMode(liveMode);
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
