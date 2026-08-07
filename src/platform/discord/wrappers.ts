/**
 * Wrapper functions to convert discord.js types to/from platform types.
 *
 * These functions form the boundary between the discord.js library and
 * the platform-agnostic core. All conversions are pure (no mutation).
 */

import {
    Message,
    TextChannel,
    ButtonInteraction,
    StringSelectMenuInteraction,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle as DiscordButtonStyle,
    StringSelectMenuBuilder,
    AttachmentBuilder,
    MessageFlags,
    User,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
} from 'discord.js';
import type {
    PlatformMessage,
    PlatformChannel,
    PlatformUser,
    PlatformButtonInteraction,
    PlatformSelectInteraction,
    PlatformCommandInteraction,
    MessagePayload,
    PlatformSentMessage,
    ButtonStyle,
    ComponentRow,
    RichContent,
    PlatformAttachment,
    ModalDef,
    PlatformModalSubmitInteraction,
} from '../types';

// ---------------------------------------------------------------------------
// Style mapping
// ---------------------------------------------------------------------------

const BUTTON_STYLE_MAP: Record<ButtonStyle, DiscordButtonStyle> = {
    primary: DiscordButtonStyle.Primary,
    secondary: DiscordButtonStyle.Secondary,
    success: DiscordButtonStyle.Success,
    danger: DiscordButtonStyle.Danger,
};

/** Map a platform ButtonStyle to its discord.js equivalent. */
export function toDiscordButtonStyle(style: ButtonStyle): DiscordButtonStyle {
    return BUTTON_STYLE_MAP[style];
}

// ---------------------------------------------------------------------------
// Payload conversion
// ---------------------------------------------------------------------------

/**
 * Convert a platform RichContent to a discord.js EmbedBuilder.
 * Returns a new EmbedBuilder instance.
 */
function toDiscordEmbed(rc: RichContent): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (rc.title !== undefined) {
        embed.setTitle(rc.title);
    }
    if (rc.description !== undefined) {
        embed.setDescription(rc.description);
    }
    if (rc.color !== undefined) {
        embed.setColor(rc.color);
    }
    if (rc.fields !== undefined) {
        for (const field of rc.fields) {
            embed.addFields({ name: field.name, value: field.value, inline: field.inline });
        }
    }
    if (rc.footer !== undefined) {
        embed.setFooter({ text: rc.footer });
    }
    if (rc.timestamp !== undefined) {
        embed.setTimestamp(rc.timestamp);
    }
    if (rc.thumbnailUrl !== undefined) {
        embed.setThumbnail(rc.thumbnailUrl);
    }
    if (rc.imageUrl !== undefined) {
        embed.setImage(rc.imageUrl);
    }

    return embed;
}

/**
 * Convert platform ComponentRow[] to discord.js ActionRowBuilder[].
 * Each row produces one ActionRowBuilder containing buttons or a select menu.
 */
function toDiscordComponents(
    rows: readonly ComponentRow[],
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    return rows.map((row) => {
        const hasButton = row.components.some((c) => c.type === 'button');
        const hasSelect = row.components.some((c) => c.type === 'selectMenu');
        if (hasButton && hasSelect) {
            throw new Error(
                'Discord does not allow mixing buttons and select menus in the same ActionRow.',
            );
        }

        const actionRow = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();

        for (const comp of row.components) {
            if (comp.type === 'button') {
                const button = new ButtonBuilder()
                    .setCustomId(comp.customId)
                    .setLabel(comp.label)
                    .setStyle(toDiscordButtonStyle(comp.style));

                if (comp.disabled === true) {
                    button.setDisabled(true);
                }

                actionRow.addComponents(button);
            } else if (comp.type === 'selectMenu') {
                const select = new StringSelectMenuBuilder()
                    .setCustomId(comp.customId)
                    .addOptions(
                        comp.options.map((opt) => ({
                            label: opt.label,
                            value: opt.value,
                            description: opt.description,
                            default: opt.isDefault,
                        })),
                    );

                if (comp.placeholder !== undefined) {
                    select.setPlaceholder(comp.placeholder);
                }

                actionRow.addComponents(select);
            }
        }

        return actionRow;
    });
}

/**
 * Convert a platform ModalDef to a discord.js ModalBuilder.
 */
function toDiscordModal(modal: ModalDef): ModalBuilder {
    const builder = new ModalBuilder()
        .setCustomId(modal.customId)
        .setTitle(modal.title);

    for (const row of modal.components) {
        const actionRow = new ActionRowBuilder<TextInputBuilder>();
        for (const comp of row.components) {
            const input = new TextInputBuilder()
                .setCustomId(comp.customId)
                .setLabel(comp.label)
                .setStyle(comp.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short);
            
            if (comp.placeholder !== undefined) {
                input.setPlaceholder(comp.placeholder);
            }
            if (comp.required !== undefined) {
                input.setRequired(comp.required);
            }
            actionRow.addComponents(input);
        }
        builder.addComponents(actionRow);
    }
    return builder;
}

/** Options controlling platform-specific behaviour of payload conversion. */
export interface ToDiscordPayloadOpts {
    /**
     * When true, the ephemeral flag on the payload is honoured.
     * Ephemeral messages are only valid for interaction responses —
     * passing this as true for a regular channel message would cause
     * a Discord API error. Defaults to false.
     */
    readonly allowEphemeral?: boolean;
}

/**
 * Convert a platform MessagePayload to discord.js message send/reply options.
 *
 * This is the central conversion point used by wrapDiscordChannel.send(),
 * wrapDiscordMessage.reply(), and interaction reply/update methods.
 *
 * @param payload  The platform-agnostic message payload.
 * @param opts     Conversion options. Only interaction callers should set
 *                 `allowEphemeral: true`.
 */
export function toDiscordPayload(
    payload: MessagePayload,
    opts: ToDiscordPayloadOpts = {},
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (payload.text !== undefined) {
        result.content = payload.text;
    }

    if (payload.richContent !== undefined) {
        result.embeds = [toDiscordEmbed(payload.richContent)];
    }

    if (payload.components !== undefined && payload.components.length > 0) {
        result.components = toDiscordComponents(payload.components);
    }

    if (payload.files !== undefined && payload.files.length > 0) {
        result.files = payload.files.map(
            (f) => new AttachmentBuilder(f.data, { name: f.name }),
        );
    }

    if (opts.allowEphemeral === true && payload.ephemeral === true) {
        result.flags = MessageFlags.Ephemeral;
    }

    return result;
}

/** Reusable opts constant for interaction callers that allow ephemeral. */
const EPHEMERAL_ALLOWED: ToDiscordPayloadOpts = Object.freeze({ allowEphemeral: true });

/**
 * Build a minimal PlatformChannel fallback when `interaction.channel` is null
 * (e.g. DMs or uncached channels). Uses `interaction.channelId` which is
 * always available as a string.
 */
function buildFallbackChannel(channelId: string): PlatformChannel {
    return {
        id: channelId,
        platform: 'discord',
        name: undefined,
        async send(): Promise<PlatformSentMessage> {
            throw new Error(
                `Cannot send to channel ${channelId}: channel object is not available (DM or uncached)`,
            );
        },
    };
}

// ---------------------------------------------------------------------------
// Entity wrappers
// ---------------------------------------------------------------------------

/** Wrap a discord.js User as a PlatformUser. */
export function wrapDiscordUser(user: User): PlatformUser {
    return {
        id: user.id,
        platform: 'discord',
        username: user.username,
        displayName: user.displayName ?? undefined,
        isBot: user.bot,
    };
}

/** Wrap a discord.js Message as a PlatformSentMessage (for edit/delete). */
export function wrapDiscordSentMessage(msg: Message): PlatformSentMessage {
    return {
        id: msg.id,
        platform: 'discord',
        channelId: msg.channelId,
        async edit(payload: MessagePayload): Promise<PlatformSentMessage> {
            const edited = await msg.edit(toDiscordPayload(payload) as Parameters<Message['edit']>[0]);
            return wrapDiscordSentMessage(edited);
        },
        async delete(): Promise<void> {
            await msg.delete();
        },
    };
}

/** Wrap a discord.js TextChannel (or any channel with send()) as a PlatformChannel. */
export function wrapDiscordChannel(channel: TextChannel | { id: string; name?: string; send: Function }): PlatformChannel {
    return {
        id: channel.id,
        platform: 'discord',
        name: 'name' in channel ? (channel as TextChannel).name : undefined,
        async send(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await channel.send(toDiscordPayload(payload));
            return wrapDiscordSentMessage(sent as Message);
        },
    };
}

/** Convert discord.js message attachments to PlatformAttachment[]. */
function toAttachments(msg: Message): readonly PlatformAttachment[] {
    return [...msg.attachments.values()].map((a) => ({
        name: a.name,
        contentType: a.contentType,
        url: a.url,
        size: a.size,
    }));
}

/** Wrap a discord.js Message as a PlatformMessage. */
export function wrapDiscordMessage(message: Message): PlatformMessage {
    const author = wrapDiscordUser(message.author);
    const channel = wrapDiscordChannel(message.channel as TextChannel);
    const attachments = toAttachments(message);

    return {
        id: message.id,
        platform: 'discord',
        content: message.content,
        author,
        channel,
        attachments,
        createdAt: message.createdAt,
        async react(emoji: string): Promise<void> {
            await message.react(emoji);
        },
        async reply(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await message.reply(toDiscordPayload(payload) as Parameters<Message['reply']>[0]);
            return wrapDiscordSentMessage(sent);
        },
    };
}

// ---------------------------------------------------------------------------
// Interaction wrappers
// ---------------------------------------------------------------------------

/** Wrap a discord.js ButtonInteraction as a PlatformButtonInteraction. */
export function wrapDiscordButton(interaction: ButtonInteraction): PlatformButtonInteraction {
    const user = wrapDiscordUser(interaction.user);
    const channel = interaction.channel
        ? wrapDiscordChannel(interaction.channel as TextChannel)
        : buildFallbackChannel(interaction.channelId);

    return {
        id: interaction.id,
        platform: 'discord',
        customId: interaction.customId,
        user,
        channel,
        messageId: interaction.message.id,
        async deferUpdate(): Promise<void> {
            await interaction.deferUpdate();
        },
        async reply(payload: MessagePayload): Promise<void> {
            await interaction.reply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ButtonInteraction['reply']>[0]);
        },
        async update(payload: MessagePayload): Promise<void> {
            await interaction.update(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ButtonInteraction['update']>[0]);
        },
        async editReply(payload: MessagePayload): Promise<void> {
            await interaction.editReply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ButtonInteraction['editReply']>[0]);
        },
        async followUp(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await interaction.followUp(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ButtonInteraction['followUp']>[0]);
            return wrapDiscordSentMessage(sent as Message);
        },
        async showModal(modal: ModalDef): Promise<void> {
            await interaction.showModal(toDiscordModal(modal));
        },
    };
}

/** Wrap a discord.js StringSelectMenuInteraction as a PlatformSelectInteraction. */
export function wrapDiscordSelect(interaction: StringSelectMenuInteraction): PlatformSelectInteraction {
    const user = wrapDiscordUser(interaction.user);
    const channel = interaction.channel
        ? wrapDiscordChannel(interaction.channel as TextChannel)
        : buildFallbackChannel(interaction.channelId);

    return {
        id: interaction.id,
        platform: 'discord',
        customId: interaction.customId,
        user,
        channel,
        values: interaction.values,
        messageId: interaction.message.id,
        async deferUpdate(): Promise<void> {
            await interaction.deferUpdate();
        },
        async reply(payload: MessagePayload): Promise<void> {
            await interaction.reply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<StringSelectMenuInteraction['reply']>[0]);
        },
        async update(payload: MessagePayload): Promise<void> {
            await interaction.update(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<StringSelectMenuInteraction['update']>[0]);
        },
        async editReply(payload: MessagePayload): Promise<void> {
            await interaction.editReply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<StringSelectMenuInteraction['editReply']>[0]);
        },
        async followUp(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await interaction.followUp(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<StringSelectMenuInteraction['followUp']>[0]);
            return wrapDiscordSentMessage(sent as Message);
        },
    };
}

/** Extract command options from a ChatInputCommandInteraction into a ReadonlyMap. */
function extractCommandOptions(
    interaction: ChatInputCommandInteraction,
): ReadonlyMap<string, string | number | boolean> {
    const map = new Map<string, string | number | boolean>();

    for (const opt of interaction.options.data) {
        if (opt.value !== undefined && opt.value !== null) {
            map.set(opt.name, opt.value as string | number | boolean);
        }
    }

    return map;
}

/** Wrap a discord.js ChatInputCommandInteraction as a PlatformCommandInteraction. */
export function wrapDiscordCommand(interaction: ChatInputCommandInteraction): PlatformCommandInteraction {
    const user = wrapDiscordUser(interaction.user);
    const channel = interaction.channel
        ? wrapDiscordChannel(interaction.channel as TextChannel)
        : buildFallbackChannel(interaction.channelId);
    const options = extractCommandOptions(interaction);

    return {
        id: interaction.id,
        platform: 'discord',
        commandName: interaction.commandName,
        user,
        channel,
        options,
        async deferReply(opts?: { ephemeral?: boolean }): Promise<void> {
            await interaction.deferReply({ flags: opts?.ephemeral ? MessageFlags.Ephemeral : undefined });
        },
        async reply(payload: MessagePayload): Promise<void> {
            await interaction.reply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ChatInputCommandInteraction['reply']>[0]);
        },
        async editReply(payload: MessagePayload): Promise<void> {
            await interaction.editReply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ChatInputCommandInteraction['editReply']>[0]);
        },
        async followUp(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await interaction.followUp(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ChatInputCommandInteraction['followUp']>[0]);
            return wrapDiscordSentMessage(sent as Message);
        },
    };
}

/** Wrap a discord.js ModalSubmitInteraction as a PlatformModalSubmitInteraction. */
export function wrapDiscordModalSubmit(interaction: ModalSubmitInteraction): PlatformModalSubmitInteraction {
    const user = wrapDiscordUser(interaction.user);
    const channel = interaction.channel
        ? wrapDiscordChannel(interaction.channel as TextChannel)
        : buildFallbackChannel(interaction.channelId ?? 'unknown');

    const fields = new Map<string, string>();
    for (const [key, field] of interaction.fields.fields.entries()) {
        fields.set(key, interaction.fields.getTextInputValue(key));
    }

    return {
        id: interaction.id,
        platform: 'discord',
        customId: interaction.customId,
        user,
        channel,
        messageId: interaction.message?.id ?? null,
        fields,
        async deferUpdate(): Promise<void> {
            if (interaction.isFromMessage()) {
                await interaction.deferUpdate();
            } else {
                await interaction.deferReply({ ephemeral: true });
            }
        },
        async reply(payload: MessagePayload): Promise<void> {
            await interaction.reply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ModalSubmitInteraction['reply']>[0]);
        },
        async update(payload: MessagePayload): Promise<void> {
            if (interaction.isFromMessage()) {
                await interaction.update(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<typeof interaction.update>[0]);
            } else {
                await interaction.reply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ModalSubmitInteraction['reply']>[0]);
            }
        },
        async editReply(payload: MessagePayload): Promise<void> {
            await interaction.editReply(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ModalSubmitInteraction['editReply']>[0]);
        },
        async followUp(payload: MessagePayload): Promise<PlatformSentMessage> {
            const sent = await interaction.followUp(toDiscordPayload(payload, EPHEMERAL_ALLOWED) as Parameters<ModalSubmitInteraction['followUp']>[0]);
            return wrapDiscordSentMessage(sent as Message);
        },
    };
}

