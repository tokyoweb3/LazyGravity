import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { AutoAcceptService } from '../services/autoAcceptService';
import type { MessagePayload } from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

export const AUTOACCEPT_BTN_ON = 'autoaccept_btn_on';
export const AUTOACCEPT_BTN_OFF = 'autoaccept_btn_off';
export const AUTOACCEPT_BTN_REFRESH = 'autoaccept_btn_refresh';

/**
 * Build a platform-agnostic MessagePayload for auto-accept UI.
 */
export function buildAutoAcceptPayload(enabled: boolean): MessagePayload {
    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Auto-accept Management'),
                    enabled ? 0x2ECC71 : 0x95A5A6,
                ),
                `**Current Status:** ${enabled ? 'ON' : 'OFF'}\n\n` +
                'ON: approval dialogs are automatically allowed.\n' +
                'OFF: approval dialogs require manual action.',
            ),
            'Use buttons below to change mode',
        ),
    );

    return {
        richContent: rc,
        components: [
            {
                components: [
                    {
                        type: 'button' as const,
                        customId: AUTOACCEPT_BTN_ON,
                        label: 'Turn ON',
                        style: enabled ? 'success' as const : 'secondary' as const,
                    },
                    {
                        type: 'button' as const,
                        customId: AUTOACCEPT_BTN_OFF,
                        label: 'Turn OFF',
                        style: !enabled ? 'danger' as const : 'secondary' as const,
                    },
                    {
                        type: 'button' as const,
                        customId: AUTOACCEPT_BTN_REFRESH,
                        label: 'Refresh',
                        style: 'primary' as const,
                    },
                ],
            },
        ],
    };
}

/**
 * Sends or updates the auto-accept configuration UI.
 * @param target The target response handler.
 * @param autoAcceptService AutoAcceptService managing current configuration state.
 */
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
