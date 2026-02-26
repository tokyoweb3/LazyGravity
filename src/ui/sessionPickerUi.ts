import {
    ActionRowBuilder,
    EmbedBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';

import { t } from '../utils/i18n';
import { SessionListItem } from '../services/chatSessionService';

/** Select menu custom ID for session picker */
export const SESSION_SELECT_ID = 'session_select';

/** Maximum items per select menu (Discord limit) */
const MAX_SELECT_OPTIONS = 25;

/**
 * Check if a customId belongs to the session select menu.
 */
export function isSessionSelectId(customId: string): boolean {
    return customId === SESSION_SELECT_ID;
}

/**
 * Build the session picker UI with a select menu.
 *
 * @param sessions - List of sessions from the side panel
 * @returns Object with embeds and components arrays ready for Discord reply
 */
export function buildSessionPickerUI(
    sessions: SessionListItem[],
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<any>[] } {
    const embed = new EmbedBuilder()
        .setTitle(t('🔗 Join Session'))
        .setColor(0x5865F2)
        .setTimestamp();

    if (sessions.length === 0) {
        embed.setDescription(t('No sessions found in the Antigravity side panel.'));
        return { embeds: [embed], components: [] };
    }

    embed.setDescription(t(`Select a session to join (${sessions.length} found)`));

    const pageItems = sessions.slice(0, MAX_SELECT_OPTIONS);

    const options = pageItems.map((session) => ({
        label: session.title.slice(0, 100),
        value: session.title.slice(0, 100),
        description: session.isActive ? t('Current') : undefined,
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(SESSION_SELECT_ID)
        .setPlaceholder(t('Select a session...'))
        .addOptions(options);

    const components: ActionRowBuilder<any>[] = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    ];

    return { embeds: [embed], components };
}
