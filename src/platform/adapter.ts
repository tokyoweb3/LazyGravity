/**
 * Platform adapter interface.
 *
 * Each messaging platform (Discord, Telegram, etc.) implements this interface
 * to provide a unified event-driven API for the bot core.
 */

import type {
    PlatformType,
    PlatformChannel,
    PlatformMessage,
    PlatformButtonInteraction,
    PlatformSelectInteraction,
    PlatformCommandInteraction,
} from './types';

// ---------------------------------------------------------------------------
// Adapter events
// ---------------------------------------------------------------------------

/**
 * Events emitted or handled by the platform adapter.
 */
export interface PlatformAdapterEvents {
    /** Called when the adapter completes authentication and is ready. */
    onReady?: () => void;
    /** Called when a user message is received. */
    onMessage?: (message: PlatformMessage) => Promise<void>;
    /** Called when a user interacts with a button UI element. */
    onButtonInteraction?: (interaction: PlatformButtonInteraction) => Promise<void>;
    /** Called when a user interacts with a dropdown/select menu UI element. */
    onSelectInteraction?: (interaction: PlatformSelectInteraction) => Promise<void>;
    /** Called when a slash or chat command is triggered. */
    onCommandInteraction?: (interaction: PlatformCommandInteraction) => Promise<void>;
    /** Called when a platform-level error occurs. */
    onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Interface that messaging platforms (Discord, Telegram) must implement.
 */
export interface PlatformAdapter {
    /** Which platform this adapter serves. */
    readonly platform: PlatformType;

    /**
     * Start the adapter (connect, login, begin polling/listening).
     * @param events Event handler callbacks.
     */
    start(events: PlatformAdapterEvents): Promise<void>;

    /** Stop the adapter (disconnect, cleanup). */
    stop(): Promise<void>;

    /**
     * Retrieve a channel by its platform-native ID. Returns null if not found.
     * @param channelId Native channel ID.
     */
    getChannel(channelId: string): Promise<PlatformChannel | null>;

    /** Return the bot's own user ID on this platform. */
    getBotUserId(): string;
}

