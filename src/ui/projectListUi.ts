import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';

import { t } from '../utils/i18n';

/** Select menu custom ID (legacy, page 0) */
export const PROJECT_SELECT_ID = 'project_select';
/** Backward compatibility: also accept old ID */
export const WORKSPACE_SELECT_ID = 'workspace_select';

/** Button customId prefix for page navigation. Format: project_page:<page> */
export const PROJECT_PAGE_PREFIX = 'project_page';

/** Maximum items per page (Discord select menu limit) */
export const ITEMS_PER_PAGE = 25;

/**
 * Parse page number from a page-button customId.
 * Returns NaN if the customId does not match the expected format.
 */
export function parseProjectPageId(customId: string): number {
    if (!customId.startsWith(`${PROJECT_PAGE_PREFIX}:`)) return NaN;
    return parseInt(customId.slice(PROJECT_PAGE_PREFIX.length + 1), 10);
}

/**
 * Check if a customId belongs to a project select menu.
 * Matches legacy IDs (`project_select`, `workspace_select`) and
 * paginated IDs (`project_select:<page>`).
 */
export function isProjectSelectId(customId: string): boolean {
    return (
        customId === PROJECT_SELECT_ID ||
        customId === WORKSPACE_SELECT_ID ||
        customId.startsWith(`${PROJECT_SELECT_ID}:`)
    );
}

/**
 * Build the project list UI with select menu and optional Prev/Next buttons.
 *
 * @param workspaces - Full list of workspace names
 * @param page - Zero-based page index (clamped to valid range)
 * @returns Object with embeds and components arrays ready for Discord reply
 */
export function buildProjectListUI(
    workspaces: string[],
    page: number = 0,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<any>[] } {
    const totalPages = Math.max(1, Math.ceil(workspaces.length / ITEMS_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const embed = new EmbedBuilder()
        .setTitle('\u{1F4C1} Projects')
        .setColor(0x5865F2)
        .setDescription(t('Select a project to auto-create a category and session channel'))
        .setTimestamp();

    if (workspaces.length === 0) {
        return { embeds: [embed], components: [] };
    }

    const start = safePage * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, workspaces.length);
    const pageItems = workspaces.slice(start, end);

    if (totalPages > 1) {
        embed.setFooter({
            text: `Page ${safePage + 1} / ${totalPages} (${workspaces.length} projects total)`,
        });
    }

    const components: ActionRowBuilder<any>[] = [];

    const options = pageItems.map((ws) => ({ label: ws, value: ws }));
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`${PROJECT_SELECT_ID}:${safePage}`)
        .setPlaceholder(t('Select a project...'))
        .addOptions(options);

    components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    );

    if (totalPages > 1) {
        const prevBtn = new ButtonBuilder()
            .setCustomId(`${PROJECT_PAGE_PREFIX}:${Math.max(0, safePage - 1)}`)
            .setLabel('\u25C0 Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage === 0);

        const nextBtn = new ButtonBuilder()
            .setCustomId(`${PROJECT_PAGE_PREFIX}:${safePage + 1}`)
            .setLabel('Next \u25B6')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1);

        components.push(
            new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn),
        );
    }

    return { embeds: [embed], components };
}
