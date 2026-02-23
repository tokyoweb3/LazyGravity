import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import {
    AVAILABLE_MODES,
    MODE_DESCRIPTIONS,
    MODE_DISPLAY_NAMES,
    ModeService,
} from '../services/modeService';

/**
 * /mode コマンドのインタラクティブなUIを組み立てて送信する（Dropdown方式）
 */
export async function sendModeUI(
    target: { editReply: (opts: any) => Promise<any> },
    modeService: ModeService,
): Promise<void> {
    const currentMode = modeService.getCurrentMode();

    const embed = new EmbedBuilder()
        .setTitle('モード管理')
        .setColor(0x57F287)
        .setDescription(
            `**現在のモード:** ${MODE_DISPLAY_NAMES[currentMode] || currentMode}\n` +
            `${MODE_DESCRIPTIONS[currentMode] || ''}\n\n` +
            `**利用可能なモード (${AVAILABLE_MODES.length}件)**\n` +
            AVAILABLE_MODES.map(m => {
                const icon = m === currentMode ? '[x]' : '[ ]';
                return `${icon} **${MODE_DISPLAY_NAMES[m] || m}** — ${MODE_DESCRIPTIONS[m] || ''}`;
            }).join('\n'),
        )
        .setFooter({ text: '下のドロップダウンからモードを選択してください' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('mode_select')
        .setPlaceholder('モードを選択...')
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
