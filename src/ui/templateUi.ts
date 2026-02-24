import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { TemplateRecord } from '../database/templateRepository';

/** Button customId prefix. Format: template_btn_<id> */
export const TEMPLATE_BTN_PREFIX = 'template_btn_';

const MAX_PROMPT_PREVIEW_LEN = 60;
const MAX_BUTTONS = 25;

/**
 * Extract template ID from a button customId.
 * Returns NaN if the customId does not match the expected format.
 */
export function parseTemplateButtonId(customId: string): number {
    if (!customId.startsWith(TEMPLATE_BTN_PREFIX)) return NaN;
    return parseInt(customId.slice(TEMPLATE_BTN_PREFIX.length), 10);
}

/**
 * Build and send the template list UI with clickable buttons.
 * Follows the same pattern as modelsUi.ts.
 */
export async function sendTemplateUI(
    target: { editReply: (opts: any) => Promise<any> },
    templates: TemplateRecord[],
): Promise<void> {
    if (templates.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('テンプレート管理')
            .setColor(0x57F287)
            .setDescription(
                '登録されているテンプレートはありません。\n\n' +
                '`/template add name:<name> prompt:<prompt>` で追加してください。',
            )
            .setTimestamp();

        await target.editReply({ content: '', embeds: [embed], components: [] });
        return;
    }

    const truncate = (text: string, max: number): string =>
        text.length > max ? `${text.substring(0, max - 3)}...` : text;

    const displayTemplates = templates.slice(0, MAX_BUTTONS);
    const hasMore = templates.length > MAX_BUTTONS;

    const description = displayTemplates
        .map((tpl, i) => `**${i + 1}. ${tpl.name}**\n> ${truncate(tpl.prompt, MAX_PROMPT_PREVIEW_LEN)}`)
        .join('\n\n');

    const footerText = hasMore
        ? `${templates.length - MAX_BUTTONS}件のテンプレートが非表示です。/template use <name> で直接実行できます。`
        : 'ボタンをクリックするとテンプレートを実行します';

    const embed = new EmbedBuilder()
        .setTitle('テンプレート管理')
        .setColor(0x57F287)
        .setDescription(
            `**登録テンプレート (${templates.length}件)**\n\n${description}`,
        )
        .setFooter({ text: footerText })
        .setTimestamp();

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (const tpl of displayTemplates) {
        if (currentRow.components.length === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder<ButtonBuilder>();
        }

        const safeLabel = tpl.name.length > 80 ? `${tpl.name.substring(0, 77)}...` : tpl.name;

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${TEMPLATE_BTN_PREFIX}${tpl.id}`)
                .setLabel(safeLabel)
                .setStyle(ButtonStyle.Primary),
        );
    }

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }

    await target.editReply({ content: '', embeds: [embed], components: rows });
}
