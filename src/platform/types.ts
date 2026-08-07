/**
 * Platform abstraction types for multi-platform support.
 *
 * These types provide a common interface layer between Discord, Telegram,
 * and future messaging platforms. All platform-specific code should convert
 * to/from these types at the adapter boundary.
 */

// ---------------------------------------------------------------------------
// Platform identification
// ---------------------------------------------------------------------------

export type PlatformType = 'discord' | 'telegram';

/**
 * Uniquely identifies an entity across platforms.
 * Encoded as "platform:id" string for use as map keys.
 */
export interface PlatformId {
    readonly platform: PlatformType;
    readonly id: string;
}

/** Encode a PlatformId to a "platform:id" string key. */
export function toPlatformKey(pid: PlatformId): string {
    return `${pid.platform}:${pid.id}`;
}

/** Decode a "platform:id" string key to a PlatformId. Returns null on invalid input. */
export function fromPlatformKey(key: string): PlatformId | null {
    const idx = key.indexOf(':');
    if (idx <= 0) return null;
    const platform = key.slice(0, idx);
    if (platform !== 'discord' && platform !== 'telegram') return null;
    const id = key.slice(idx + 1);
    if (!id) return null;
    return { platform: platform as PlatformType, id };
}

// ---------------------------------------------------------------------------
// Core platform entities
// ---------------------------------------------------------------------------

export interface PlatformUser {
    readonly id: string;
    readonly platform: PlatformType;
    readonly username: string;
    readonly displayName?: string;
    readonly isBot: boolean;
}

export interface PlatformChannel {
    readonly id: string;
    readonly platform: PlatformType;
    readonly name?: string;
    /** Send a message to this channel. */
    send(payload: MessagePayload): Promise<PlatformSentMessage>;
}

export interface PlatformAttachment {
    readonly name: string;
    readonly contentType: string | null;
    readonly url: string;
    readonly size: number;
}

export interface PlatformMessage {
    readonly id: string;
    readonly platform: PlatformType;
    readonly content: string;
    readonly author: PlatformUser;
    readonly channel: PlatformChannel;
    readonly attachments: readonly PlatformAttachment[];
    readonly createdAt: Date;
    /** Add a reaction (emoji) to this message. Platform-specific format. */
    react(emoji: string): Promise<void>;
    /** Reply to this message. */
    reply(payload: MessagePayload): Promise<PlatformSentMessage>;
}

// ---------------------------------------------------------------------------
// Rich content (Embed abstraction)
// ---------------------------------------------------------------------------

export interface RichContentField {
    readonly name: string;
    readonly value: string;
    readonly inline?: boolean;
}

export interface RichContent {
    readonly title?: string;
    readonly description?: string;
    readonly color?: number;
    readonly fields?: readonly RichContentField[];
    readonly footer?: string;
    readonly timestamp?: Date;
    readonly thumbnailUrl?: string;
    readonly imageUrl?: string;
}

// ---------------------------------------------------------------------------
// UI Components (Button / Select Menu abstraction)
// ---------------------------------------------------------------------------

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

export interface ButtonDef {
    readonly type: 'button';
    readonly customId: string;
    readonly label: string;
    readonly style: ButtonStyle;
    readonly disabled?: boolean;
}

export interface SelectMenuOption {
    readonly label: string;
    readonly value: string;
    readonly description?: string;
    readonly isDefault?: boolean;
}

export interface SelectMenuDef {
    readonly type: 'selectMenu';
    readonly customId: string;
    readonly placeholder?: string;
    readonly options: readonly SelectMenuOption[];
}

export type ComponentDef = ButtonDef | SelectMenuDef;

/**
 * A row of components. Discord allows up to 5 buttons per row,
 * or 1 select menu per row. Telegram uses InlineKeyboard rows.
 */
export interface ComponentRow {
    readonly components: readonly ComponentDef[];
}

// ---------------------------------------------------------------------------
// Modals (Dialog boxes)
// ---------------------------------------------------------------------------

export interface ModalTextInput {
    readonly type: 'textInput';
    readonly customId: string;
    readonly label: string;
    readonly style: 'short' | 'paragraph';
    readonly placeholder?: string;
    readonly required?: boolean;
}

export interface ModalRow {
    readonly components: readonly ModalTextInput[];
}

export interface ModalDef {
    readonly title: string;
    readonly customId: string;
    readonly components: readonly ModalRow[];
}

// ---------------------------------------------------------------------------
// Message payload (what gets sent)
// ---------------------------------------------------------------------------

export interface FileAttachment {
    readonly name: string;
    readonly data: Buffer;
    readonly contentType?: string;
}

export interface MessagePayload {
    readonly text?: string;
    readonly richContent?: RichContent;
    readonly components?: readonly ComponentRow[];
    readonly files?: readonly FileAttachment[];
    /** Platform-specific: whether the message is ephemeral (only visible to the user). */
    readonly ephemeral?: boolean;
}

// ---------------------------------------------------------------------------
// Sent message handle (for edit / delete)
// ---------------------------------------------------------------------------

export interface PlatformSentMessage {
    readonly id: string;
    readonly platform: PlatformType;
    readonly channelId: string;
    /** Edit the sent message content. */
    edit(payload: MessagePayload): Promise<PlatformSentMessage>;
    /** Delete the sent message. */
    delete(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Interaction types
// ---------------------------------------------------------------------------

export interface PlatformButtonInteraction {
    readonly id: string;
    readonly platform: PlatformType;
    readonly customId: string;
    readonly user: PlatformUser;
    readonly channel: PlatformChannel;
    readonly messageId: string;
    /** Acknowledge the interaction (defer). */
    deferUpdate(): Promise<void>;
    /** Reply to the interaction. */
    reply(payload: MessagePayload): Promise<void>;
    /** Update the original message. */
    update(payload: MessagePayload): Promise<void>;
    /** Edit the original reply. */
    editReply(payload: MessagePayload): Promise<void>;
    /** Send a follow-up message. */
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
    /** Show a modal dialog box. Must be the first response. */
    showModal?(modal: ModalDef): Promise<void>;
}

export interface PlatformSelectInteraction {
    readonly id: string;
    readonly platform: PlatformType;
    readonly customId: string;
    readonly user: PlatformUser;
    readonly channel: PlatformChannel;
    readonly values: readonly string[];
    readonly messageId: string;
    deferUpdate(): Promise<void>;
    reply(payload: MessagePayload): Promise<void>;
    update(payload: MessagePayload): Promise<void>;
    editReply(payload: MessagePayload): Promise<void>;
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}

export interface PlatformCommandInteraction {
    readonly id: string;
    readonly platform: PlatformType;
    readonly commandName: string;
    readonly user: PlatformUser;
    readonly channel: PlatformChannel;
    readonly options: ReadonlyMap<string, string | number | boolean>;
    deferReply(opts?: { ephemeral?: boolean }): Promise<void>;
    reply(payload: MessagePayload): Promise<void>;
    editReply(payload: MessagePayload): Promise<void>;
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}

export interface PlatformModalSubmitInteraction {
    readonly id: string;
    readonly platform: PlatformType;
    readonly customId: string;
    readonly user: PlatformUser;
    readonly channel: PlatformChannel;
    readonly messageId: string | null;
    readonly fields: ReadonlyMap<string, string>;
    deferUpdate(): Promise<void>;
    reply(payload: MessagePayload): Promise<void>;
    update(payload: MessagePayload): Promise<void>;
    editReply(payload: MessagePayload): Promise<void>;
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}
