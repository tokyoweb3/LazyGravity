import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import type { MessagePayload } from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

export const ACCOUNT_SELECT_ID = 'account_select';

export function buildAccountPayload(currentAccount: string, accountNames: string[]): MessagePayload {
    const names = accountNames.length > 0 ? accountNames : ['default'];

    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Account Management'),
                    0x57F287,
                ),
                `**Current Account:** ${currentAccount}\n\n` +
                `**Available Accounts (${names.length})**\n` +
                names.map((name) => {
                    const icon = name === currentAccount ? '[x]' : '[ ]';
                    return `${icon} **${name}**`;
                }).join('\n'),
            ),
            'Select an account from the dropdown below',
        ),
    );

    return {
        richContent: rc,
        components: [
            {
                components: [
                    {
                        type: 'selectMenu' as const,
                        customId: ACCOUNT_SELECT_ID,
                        placeholder: 'Select an account...',
                        options: names.map((name) => ({
                            label: name,
                            value: name,
                            isDefault: name === currentAccount,
                        })),
                    },
                ],
            },
        ],
    };
}

export async function sendAccountUI(
    target: { editReply: (opts: any) => Promise<any> },
    currentAccount: string,
    accountNames: string[],
): Promise<void> {
    const names = accountNames.length > 0 ? accountNames : ['default'];

    const embed = new EmbedBuilder()
        .setTitle('Account Management')
        .setColor(0x57F287)
        .setDescription(
            `**Current Account:** ${currentAccount}\n\n` +
            `**Available Accounts (${names.length})**\n` +
            names.map((name) => {
                const icon = name === currentAccount ? '[x]' : '[ ]';
                return `${icon} **${name}**`;
            }).join('\n'),
        )
        .setFooter({ text: 'Select an account from the dropdown below' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(ACCOUNT_SELECT_ID)
        .setPlaceholder('Select an account...')
        .addOptions(
            names.map((name) => ({
                label: name,
                value: name,
                default: name === currentAccount,
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await target.editReply({ content: '', embeds: [embed], components: [row] });
}
