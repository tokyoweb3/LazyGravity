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

/**
 * Supported messaging platform types.
 */
export type PlatformType = 'discord' | 'telegram';

/**
 * Uniquely identifies an entity across platforms.
 * Encoded as "platform:id" string for use as map keys.
 */
export interface PlatformId {
    /** The target messaging platform. */
    readonly platform: PlatformType;
    /** The platform-native ID of the entity. */
    readonly id: string;
}

/**
 * Encodes a PlatformId into a "platform:id" string key.
 * @param pid The PlatformId object.
 * @returns Serialized string key.
 */
export function toPlatformKey(pid: PlatformId): string {
    return `${pid.platform}:${pid.id}`;
}

/**
 * Decodes a "platform:id" string key back to a PlatformId.
 * @param key Serialized key.
 * @returns The deserialized PlatformId, or null if the key format is invalid.
 */
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

/**
 * Represents a user across messaging platforms.
 */
export interface PlatformUser {
    /** Native user ID. */
    readonly id: string;
    /** Platform of the user. */
    readonly platform: PlatformType;
    /** Handle/username. */
    readonly username: string;
    /** Optional friendly display name. */
    readonly displayName?: string;
    /** True if the user is an automated bot. */
    readonly isBot: boolean;
}

/**
 * Represents a conversation channel or chat group.
 */
export interface PlatformChannel {
    /** Native channel ID. */
    readonly id: string;
    /** Platform of the channel. */
    readonly platform: PlatformType;
    /** Optional friendly name of the channel. */
    readonly name?: string;
    /**
     * Send a message to this channel.
     * @param payload Message contents and components.
     * @returns A promise resolving to the sent message wrapper.
     */
    send(payload: MessagePayload): Promise<PlatformSentMessage>;
}

/**
 * Represents a file attachment in a message.
 */
export interface PlatformAttachment {
    /** Filename. */
    readonly name: string;
    /** MIME content-type of the attachment. */
    readonly contentType: string | null;
    /** Resource download URL. */
    readonly url: string;
    /** Size of the attachment in bytes. */
    readonly size: number;
}

/**
 * Represents a chat message received from a platform.
 */
export interface PlatformMessage {
    /** Native message ID. */
    readonly id: string;
    /** Platform of the message. */
    readonly platform: PlatformType;
    /** Text content of the message. */
    readonly content: string;
    /** The author user of the message. */
    readonly author: PlatformUser;
    /** The channel the message was posted in. */
    readonly channel: PlatformChannel;
    /** Attachments linked with the message. */
    readonly attachments: readonly PlatformAttachment[];
    /** Creation timestamp. */
    readonly createdAt: Date;
    /**
     * Add a reaction (emoji) to this message.
     * @param emoji Reaction emoji symbol.
     */
    react(emoji: string): Promise<void>;
    /**
     * Reply to this message.
     * @param payload Reply message content.
     */
    reply(payload: MessagePayload): Promise<PlatformSentMessage>;
}

// ---------------------------------------------------------------------------
// Rich content (Embed abstraction)
// ---------------------------------------------------------------------------

/**
 * Single field within a rich content embed.
 */
export interface RichContentField {
    /** Field title/label. */
    readonly name: string;
    /** Field body/value. */
    readonly value: string;
    /** True to align inline. */
    readonly inline?: boolean;
}

/**
 * Platform-independent rich text embed message card.
 */
export interface RichContent {
    /** Embed title. */
    readonly title?: string;
    /** Embed description. */
    readonly description?: string;
    /** Hex color integer. */
    readonly color?: number;
    /** Structured lists/fields. */
    readonly fields?: readonly RichContentField[];
    /** Footer text string. */
    readonly footer?: string;
    /** Optional timestamp. */
    readonly timestamp?: Date;
    /** URL of the thumbnail preview. */
    readonly thumbnailUrl?: string;
    /** URL of the main display image. */
    readonly imageUrl?: string;
}

// ---------------------------------------------------------------------------
// UI Components (Button / Select Menu abstraction)
// ---------------------------------------------------------------------------

/**
 * Styling styles for interface buttons.
 */
export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

/**
 * Definition of an interactive interface button component.
 */
export interface ButtonDef {
    /** Type identifier. */
    readonly type: 'button';
    /** Unique developer identifier for handling clicks. */
    readonly customId: string;
    /** Text label printed on the button. */
    readonly label: string;
    /** Theme styling style. */
    readonly style: ButtonStyle;
    /** True to disable clicking. */
    readonly disabled?: boolean;
}

/**
 * Single selectable option in a dropdown/select menu.
 */
export interface SelectMenuOption {
    /** User-visible label. */
    readonly label: string;
    /** Internally returned value on selection. */
    readonly value: string;
    /** Description helper. */
    readonly description?: string;
    /** True if selected by default. */
    readonly isDefault?: boolean;
}

/**
 * Definition of a dropdown/select menu component.
 */
export interface SelectMenuDef {
    /** Type identifier. */
    readonly type: 'selectMenu';
    /** Unique developer identifier for select changes. */
    readonly customId: string;
    /** Placeholder message when empty. */
    readonly placeholder?: string;
    /** Selectable menu options list. */
    readonly options: readonly SelectMenuOption[];
}

/**
 * Supported component definitions.
 */
export type ComponentDef = ButtonDef | SelectMenuDef;

/**
 * A row of interactive components.
 */
export interface ComponentRow {
    /** Ordered list of components in the row. */
    readonly components: readonly ComponentDef[];
}

// ---------------------------------------------------------------------------
// Modals (Dialog boxes)
// ---------------------------------------------------------------------------

/**
 * Single text input field inside a modal popup.
 */
export interface ModalTextInput {
    /** Type identifier. */
    readonly type: 'textInput';
    /** Unique developer identifier. */
    readonly customId: string;
    /** User-visible label. */
    readonly label: string;
    /** Text layout style. */
    readonly style: 'short' | 'paragraph';
    /** Optional placeholder string. */
    readonly placeholder?: string;
    /** True if input is mandatory. */
    readonly required?: boolean;
}

/**
 * Row layout containing text inputs inside a modal.
 */
export interface ModalRow {
    /** Input elements within the row. */
    readonly components: readonly ModalTextInput[];
}

/**
 * Modal form configuration definition.
 */
export interface ModalDef {
    /** Form header title. */
    readonly title: string;
    /** Unique modal ID. */
    readonly customId: string;
    /** Ordered grid rows of inputs. */
    readonly components: readonly ModalRow[];
}

// ---------------------------------------------------------------------------
// Message payload (what gets sent)
// ---------------------------------------------------------------------------

/**
 * Configuration of a file attachment payload.
 */
export interface FileAttachment {
    /** Target file name. */
    readonly name: string;
    /** Binary buffer. */
    readonly data: Buffer;
    /** MIME content type. */
    readonly contentType?: string;
}

/**
 * Payload contents sent to channels or used to update messages.
 */
export interface MessagePayload {
    /** Raw text message. */
    readonly text?: string;
    /** Optional rich content card. */
    readonly richContent?: RichContent;
    /** Grid layout of components. */
    readonly components?: readonly ComponentRow[];
    /** Files to attach. */
    readonly files?: readonly FileAttachment[];
    /** True if only visible to the trigger user. */
    readonly ephemeral?: boolean;
}

// ---------------------------------------------------------------------------
// Sent message handle (for edit / delete)
// ---------------------------------------------------------------------------

/**
 * Wrapper class representing a message successfully posted.
 */
export interface PlatformSentMessage {
    /** Native message ID. */
    readonly id: string;
    /** Target platform. */
    readonly platform: PlatformType;
    /** Channel ID containing the message. */
    readonly channelId: string;
    /**
     * Edit the contents of this message.
     * @param payload Updated details.
     */
    edit(payload: MessagePayload): Promise<PlatformSentMessage>;
    /** Delete this message. */
    delete(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Interaction types
// ---------------------------------------------------------------------------

/**
 * Represents a button click interaction.
 */
export interface PlatformButtonInteraction {
    /** Unique interaction ID. */
    readonly id: string;
    /** Target platform. */
    readonly platform: PlatformType;
    /** Component custom identifier. */
    readonly customId: string;
    /** User who clicked the button. */
    readonly user: PlatformUser;
    /** Channel containing the button message. */
    readonly channel: PlatformChannel;
    /** Message containing the button. */
    readonly messageId: string;
    /** Acknowledge the interaction without immediate updates. */
    deferUpdate(): Promise<void>;
    /**
     * Reply to the interaction.
     * @param payload Reply text/components.
     */
    reply(payload: MessagePayload): Promise<void>;
    /**
     * Replace the message content.
     * @param payload New contents.
     */
    update(payload: MessagePayload): Promise<void>;
    /**
     * Edit the original interaction response.
     * @param payload New reply contents.
     */
    editReply(payload: MessagePayload): Promise<void>;
    /**
     * Post a follow-up message linked to the interaction.
     * @param payload Message parameters.
     */
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
    /**
     * Show a popup form modal.
     * @param modal Modal specifications.
     */
    showModal?(modal: ModalDef): Promise<void>;
}

/**
 * Represents a dropdown option change interaction.
 */
export interface PlatformSelectInteraction {
    /** Unique interaction ID. */
    readonly id: string;
    /** Target platform. */
    readonly platform: PlatformType;
    /** Component custom identifier. */
    readonly customId: string;
    /** User who made the selection. */
    readonly user: PlatformUser;
    /** Channel containing the selection menu. */
    readonly channel: PlatformChannel;
    /** Selected string values. */
    readonly values: readonly string[];
    /** Message containing the selection. */
    readonly messageId: string;
    /** Acknowledge the interaction. */
    deferUpdate(): Promise<void>;
    /**
     * Reply to the selection.
     * @param payload Response contents.
     */
    reply(payload: MessagePayload): Promise<void>;
    /**
     * Replace the selection message contents.
     * @param payload Updated components/text.
     */
    update(payload: MessagePayload): Promise<void>;
    /**
     * Edit the original response.
     * @param payload Updated reply payload.
     */
    editReply(payload: MessagePayload): Promise<void>;
    /**
     * Send a subsequent follow-up.
     * @param payload Follow-up contents.
     */
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}

/**
 * Represents a slash command invocation.
 */
export interface PlatformCommandInteraction {
    /** Unique interaction ID. */
    readonly id: string;
    /** Target platform. */
    readonly platform: PlatformType;
    /** Command name triggered. */
    readonly commandName: string;
    /** User who invoked the command. */
    readonly user: PlatformUser;
    /** Channel where command was run. */
    readonly channel: PlatformChannel;
    /** Arguments map passed to the command. */
    readonly options: ReadonlyMap<string, string | number | boolean>;
    /**
     * Defer response rendering.
     * @param opts Option flags.
     */
    deferReply(opts?: { ephemeral?: boolean }): Promise<void>;
    /**
     * Post the response message.
     * @param payload Response parameters.
     */
    reply(payload: MessagePayload): Promise<void>;
    /**
     * Edit the deferred response message.
     * @param payload Updated details.
     */
    editReply(payload: MessagePayload): Promise<void>;
    /**
     * Post a subsequent follow-up response.
     * @param payload Subsequent response details.
     */
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}

/**
 * Represents a modal form submit event.
 */
export interface PlatformModalSubmitInteraction {
    /** Unique interaction ID. */
    readonly id: string;
    /** Target platform. */
    readonly platform: PlatformType;
    /** Modal custom identifier. */
    readonly customId: string;
    /** User who submitted the form. */
    readonly user: PlatformUser;
    /** Channel where modal was submitted. */
    readonly channel: PlatformChannel;
    /** Message ID modal was opened from, if any. */
    readonly messageId: string | null;
    /** Submitted input values mapped by customId. */
    readonly fields: ReadonlyMap<string, string>;
    /** Acknowledge form submission. */
    deferUpdate(): Promise<void>;
    /**
     * Reply to the modal submission.
     * @param payload Reply details.
     */
    reply(payload: MessagePayload): Promise<void>;
    /**
     * Update the modal source message.
     * @param payload Updated message layout.
     */
    update(payload: MessagePayload): Promise<void>;
    /**
     * Edit the reply response.
     * @param payload Updated contents.
     */
    editReply(payload: MessagePayload): Promise<void>;
    /**
     * Send subsequent updates.
     * @param payload Follow-up contents.
     */
    followUp(payload: MessagePayload): Promise<PlatformSentMessage>;
}
