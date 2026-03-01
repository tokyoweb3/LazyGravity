import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { OutputFormat } from '../database/userPreferenceRepository';

export const OUTPUT_BTN_EMBED = 'output_btn_embed';
export const OUTPUT_BTN_PLAIN = 'output_btn_plain';

export async function sendOutputUI(
    target: { editReply: (opts: any) => Promise<any> },
    currentFormat: OutputFormat,
): Promise<void> {
    const isEmbed = currentFormat === 'embed';

    const embed = new EmbedBuilder()
        .setTitle('Output Format')
        .setColor(isEmbed ? 0x5865F2 : 0x2ECC71)
        .setDescription(
            `**Current Format:** ${isEmbed ? '📋 Embed' : '📝 Plain Text'}\n\n` +
            'Embed: Rich formatting with colored borders (default).\n' +
            'Plain Text: Simple text output, easy to copy on mobile.',
        )
        .setFooter({ text: 'Use buttons below to change format' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(OUTPUT_BTN_EMBED)
            .setLabel('Embed')
            .setStyle(isEmbed ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(OUTPUT_BTN_PLAIN)
            .setLabel('Plain Text')
            .setStyle(!isEmbed ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    await target.editReply({
        content: '',
        embeds: [embed],
        components: [row],
    });
}
