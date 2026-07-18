import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { OutputFormat } from '../database/userPreferenceRepository';
import type { MessagePayload } from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

export const OUTPUT_BTN_EMBED = 'output_btn_embed';
export const OUTPUT_BTN_PLAIN = 'output_btn_plain';

/**
 * Build a platform-agnostic MessagePayload for output format UI.
 */
export function buildOutputPayload(currentFormat: OutputFormat): MessagePayload {
    const isEmbed = currentFormat === 'embed';

    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Output Format'),
                    isEmbed ? 0x5865F2 : 0x2ECC71,
                ),
                `**Current Format:** ${isEmbed ? 'Embed' : 'Plain Text'}\n\n` +
                'Embed: Rich formatting with colored borders (default).\n' +
                'Plain Text: Simple text output, easy to copy on mobile.',
            ),
            'Use buttons below to change format',
        ),
    );

    return {
        richContent: rc,
        components: [
            {
                components: [
                    {
                        type: 'button' as const,
                        customId: OUTPUT_BTN_EMBED,
                        label: 'Embed',
                        style: isEmbed ? 'primary' as const : 'secondary' as const,
                    },
                    {
                        type: 'button' as const,
                        customId: OUTPUT_BTN_PLAIN,
                        label: 'Plain Text',
                        style: !isEmbed ? 'success' as const : 'secondary' as const,
                    },
                ],
            },
        ],
    };
}

/**
 * Sends or updates the output format preference UI.
 * @param target The target Discord response context.
 * @param currentFormat Active OutputFormat preference.
 */
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
