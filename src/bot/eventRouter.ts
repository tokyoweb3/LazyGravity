import type { PlatformAdapter, PlatformAdapterEvents } from '../platform/adapter';
import type {
    PlatformMessage,
    PlatformButtonInteraction,
    PlatformSelectInteraction,
    PlatformCommandInteraction,
    PlatformType,
} from '../platform/types';
import { logger } from '../utils/logger';

/**
 * Configuration options dictionary for the EventRouter.
 */
export interface EventRouterConfig {
    /** Map of platform type to allowed user IDs on that platform. */
    readonly allowedUsers: ReadonlyMap<PlatformType, ReadonlySet<string>>;
}

/**
 * Event callbacks mappings object.
 */
export interface EventHandlers {
    /** Triggered on new inbound messages. */
    readonly onMessage?: (message: PlatformMessage) => Promise<void>;
    /** Triggered on button click interactions. */
    readonly onButtonInteraction?: (interaction: PlatformButtonInteraction) => Promise<void>;
    /** Triggered on dropdown select menu interactions. */
    readonly onSelectInteraction?: (interaction: PlatformSelectInteraction) => Promise<void>;
    /** Triggered on slash command invocations. */
    readonly onCommandInteraction?: (interaction: PlatformCommandInteraction) => Promise<void>;
}

/**
 * Routes events from multiple PlatformAdapters through auth check
 * and dispatches to unified handlers.
 */
export class EventRouter {
    private readonly config: EventRouterConfig;
    private readonly handlers: EventHandlers;
    private readonly adapters: PlatformAdapter[] = [];

    /**
     * @param config EventRouter configurations.
     * @param handlers Handlers registry object.
     */
    constructor(config: EventRouterConfig, handlers: EventHandlers) {
        this.config = config;
        this.handlers = handlers;
    }

    /** Register an adapter. Stores it for later start/stop. */
    registerAdapter(adapter: PlatformAdapter): void {
        this.adapters.push(adapter);
    }

    /** Start all registered adapters. */
    async startAll(): Promise<void> {
        await Promise.all(
            this.adapters.map((adapter) => {
                const events = this.createAdapterEvents(adapter);
                return adapter.start(events);
            }),
        );
    }

    /** Stop all registered adapters. */
    async stopAll(): Promise<void> {
        await Promise.all(this.adapters.map((a) => a.stop()));
    }

    /** Check if a user is authorized on a given platform. */
    isAuthorized(platform: PlatformType, userId: string): boolean {
        const allowed = this.config.allowedUsers.get(platform);
        return allowed ? allowed.has(userId) : false;
    }

    /**
     * Internal factory constructing platform events listener callbacks.
     * @param adapter Target PlatformAdapter instance.
     * @returns AdapterEvents configuration callbacks.
     */
    private createAdapterEvents(adapter: PlatformAdapter): PlatformAdapterEvents {
        return {
            onReady: () => {
                logger.info(`[EventRouter] ${adapter.platform} adapter ready`);
            },

            onMessage: async (msg) => {
                if (msg.author.isBot) return;
                if (!this.isAuthorized(msg.platform, msg.author.id)) return;
                await this.handlers.onMessage?.(msg);
            },

            onButtonInteraction: async (interaction) => {
                if (!this.isAuthorized(interaction.platform, interaction.user.id)) return;
                await this.handlers.onButtonInteraction?.(interaction);
            },

            onSelectInteraction: async (interaction) => {
                if (!this.isAuthorized(interaction.platform, interaction.user.id)) return;
                await this.handlers.onSelectInteraction?.(interaction);
            },

            onCommandInteraction: async (interaction) => {
                if (!this.isAuthorized(interaction.platform, interaction.user.id)) return;
                await this.handlers.onCommandInteraction?.(interaction);
            },

            onError: (err) => {
                logger.error(`[EventRouter] ${adapter.platform} error:`, err);
            },
        };
    }
}
