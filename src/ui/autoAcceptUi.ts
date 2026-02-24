import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { AutoAcceptService } from '../services/autoAcceptService';

export const AUTOACCEPT_BTN_ON = 'autoaccept_btn_on';
export const AUTOACCEPT_BTN_OFF = 'autoaccept_btn_off';
export const AUTOACCEPT_BTN_REFRESH = 'autoaccept_btn_refresh';

export async function sendAutoAcceptUI(
    target: { editReply: (opts: any) => Promise<any> },
    autoAcceptService: AutoAcceptService,
): Promise<void> {
    const enabled = autoAcceptService.isEnabled();

    const embed = new EmbedBuilder()
        .setTitle('Auto-accept Management')
        .setColor(enabled ? 0x2ECC71 : 0x95A5A6)
        .setDescription(
            `**Current Status:** ${enabled ? '🟢 ON' : '⚪ OFF'}\n\n` +
            'ON: approval dialogs are automatically allowed.\n' +
            'OFF: approval dialogs require manual action.',
        )
        .setFooter({ text: 'Use buttons below to change mode' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(AUTOACCEPT_BTN_ON)
            .setLabel('Turn ON')
            .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(AUTOACCEPT_BTN_OFF)
            .setLabel('Turn OFF')
            .setStyle(!enabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(AUTOACCEPT_BTN_REFRESH)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary),
    );

    await target.editReply({
        content: '',
        embeds: [embed],
        components: [row],
    });
}
