/**
 * Service to manage and send periodic heartbeat messages to a configured Discord channel.
 */

import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { logger } from '../utils/logger';
import { ConfigLoader } from '../utils/configLoader';
import { CdpBridge } from './cdpBridgeManager';

/**
 * Service that publishes status, uptime, activity, and session metrics at regular intervals.
 */
export class HeartbeatService {
    /** Target Discord client interface instance. */
    private client: Client | null = null;
    /** Target CdpBridge manager. */
    private bridge: CdpBridge | null = null;
    /** Active polling interval timer. */
    private intervalId: NodeJS.Timeout | null = null;
    
    /** Generation token used to ignore obsolete delayed requests. */
    private generationToken: number = 0;
    /** Lock flag to prevent overlapping send requests. */
    private isSending: boolean = false;
    
    /** Timestamp when the bot application started. */
    public botStartTime: number = Date.now();
    /** Timestamp of the most recent user action. */
    public lastActivityTimestamp: number = Date.now();

    /**
     * Initializes a new HeartbeatService.
     */
    constructor() {}

    /**
     * Binds the Discord client and CdpBridge dependencies.
     * @param client Discord client connection.
     * @param bridge active bridge manager.
     */
    public init(client: Client, bridge: CdpBridge) {
        this.client = client;
        this.bridge = bridge;
        this.botStartTime = Date.now();
        this.lastActivityTimestamp = Date.now();
    }

    /**
     * Records user/client activity by resetting the activity timestamp.
     */
    public recordActivity() {
        this.lastActivityTimestamp = Date.now();
    }

    /**
     * Starts the periodic heartbeat posting loop if enabled by configuration.
     */
    public start() {
        this.stop();

        const config = ConfigLoader.load();
        if (!config.heartbeatEnabled) {
            logger.info('[HeartbeatService] Periodic heartbeat is disabled.');
            return;
        }

        const channelId = config.heartbeatChannelId;
        if (!channelId) {
            logger.warn('[HeartbeatService] Enabled but heartbeatChannelId is not configured.');
            return;
        }

        let interval = config.heartbeatIntervalMs ?? 3600000;
        if (interval < 10000) {
            logger.warn(`[HeartbeatService] Interval ${interval}ms is too low. Clamping to 10000ms.`);
            interval = 10000;
        } else if (interval > 2147483647) {
            logger.warn(`[HeartbeatService] Interval ${interval}ms is too high (max is 2147483647ms). Clamping to 2147483647ms.`);
            interval = 2147483647;
        }
        logger.info(`[HeartbeatService] Starting periodic heartbeat every ${interval}ms to channel ${channelId}`);

        // Run immediately on start
        this.sendHeartbeat().catch(err => {
            logger.error('[HeartbeatService] Failed to send initial heartbeat:', err);
        });

        this.intervalId = setInterval(() => {
            this.sendHeartbeat().catch(err => {
                logger.error('[HeartbeatService] Failed to send periodic heartbeat:', err);
            });
        }, interval);
    }

    /**
     * Stops the periodic heartbeat loop and increments the generation token.
     */
    public stop() {
        this.generationToken++;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Updates the local configuration and restarts the loop.
     * @param enabled Enabled state flag.
     * @param intervalMs Cycle delay in milliseconds.
     * @param channelId Destination Discord channel ID.
     */
    public async updateConfig(enabled: boolean, intervalMs: number, channelId: string) {
        this.generationToken++;
        const config = ConfigLoader.load();
        
        // If channel changed, clear the last message ID
        if (config.heartbeatChannelId !== channelId) {
            if (config.heartbeatChannelId && config.heartbeatLastMessageId) {
                try {
                    const oldChannel = await this.client?.channels.fetch(config.heartbeatChannelId);
                    if (oldChannel && oldChannel.isTextBased()) {
                        const oldMsg = await (oldChannel as TextChannel).messages.fetch(config.heartbeatLastMessageId);
                        if (oldMsg) {
                            await oldMsg.delete().catch(() => {});
                        }
                    }
                } catch (err) {
                    logger.debug('[HeartbeatService] Failed to delete old heartbeat message from previous channel:', err);
                }
            }
            ConfigLoader.save({ heartbeatLastMessageId: undefined });
        }

        // Save to config.json
        ConfigLoader.save({
            heartbeatEnabled: enabled,
            heartbeatIntervalMs: intervalMs,
            heartbeatChannelId: channelId,
        });

        logger.info(`[HeartbeatService] Config updated: enabled=${enabled}, interval=${intervalMs}ms, channel=${channelId}`);
        
        // Restart loop
        this.start();
    }

    /**
     * Deletes the active message, updates configuration state to disabled, and stops the loop.
     */
    public async disable() {
        this.generationToken++;
        const config = ConfigLoader.load();
        if (config.heartbeatChannelId && config.heartbeatLastMessageId) {
            try {
                const oldChannel = await this.client?.channels.fetch(config.heartbeatChannelId);
                if (oldChannel && oldChannel.isTextBased()) {
                    const oldMsg = await (oldChannel as TextChannel).messages.fetch(config.heartbeatLastMessageId);
                    if (oldMsg) {
                        await oldMsg.delete().catch(() => {});
                    }
                }
            } catch (err) {
                logger.debug('[HeartbeatService] Failed to delete heartbeat message upon disabling:', err);
            }
        }
        ConfigLoader.save({
            heartbeatEnabled: false,
            heartbeatLastMessageId: undefined,
        });
        this.stop();
        logger.info('[HeartbeatService] Heartbeat disabled.');
    }

    /**
     * Formulates and posts/edits the heartbeat embed on the configured channel.
     */
    public async sendHeartbeat() {
        if (!this.client || !this.bridge) {
            logger.warn('[HeartbeatService] Cannot send heartbeat: client or bridge not initialized.');
            return;
        }

        if (this.isSending) {
            logger.debug('[HeartbeatService] Heartbeat send already in flight. Skipping overlapping execution.');
            return;
        }

        const gen = this.generationToken;
        this.isSending = true;

        const config = ConfigLoader.load();
        const channelId = config.heartbeatChannelId;
        if (!channelId) {
            this.isSending = false;
            return;
        }

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (gen !== this.generationToken) {
                logger.debug(`[HeartbeatService] Aborting heartbeat send: stale generation (expected ${gen}, current ${this.generationToken})`);
                return;
            }

            if (!channel || !channel.isTextBased()) {
                logger.warn(`[HeartbeatService] Channel ${channelId} not found or is not a text channel.`);
                return;
            }

            const embed = this.buildHeartbeatEmbed();
            const lastMessageId = config.heartbeatLastMessageId;

            if (lastMessageId) {
                try {
                    const message = await (channel as TextChannel).messages.fetch(lastMessageId);
                    if (gen !== this.generationToken) {
                        logger.debug('[HeartbeatService] Aborting message edit: stale generation');
                        return;
                    }
                    if (message && message.author.id === this.client.user?.id) {
                        await message.edit({ embeds: [embed] });
                        logger.debug(`[HeartbeatService] Updated heartbeat message in-place: ${lastMessageId}`);
                        return;
                    }
                } catch (fetchErr) {
                    logger.debug(`[HeartbeatService] Failed to fetch or edit message ${lastMessageId}, sending new one.`);
                }
            }

            if (gen !== this.generationToken) {
                logger.debug('[HeartbeatService] Aborting message send: stale generation');
                return;
            }

            // Send new message
            const newMsg = await (channel as TextChannel).send({ embeds: [embed] });

            if (gen !== this.generationToken) {
                logger.debug(`[HeartbeatService] Stale generation after send. Deleting new message ${newMsg.id} to avoid leakage.`);
                await newMsg.delete().catch(() => {});
                return;
            }

            ConfigLoader.save({ heartbeatLastMessageId: newMsg.id });
            logger.info(`[HeartbeatService] Sent new heartbeat message: ${newMsg.id}`);
        } catch (error) {
            logger.error('[HeartbeatService] Error in sendHeartbeat:', error);
        } finally {
            this.isSending = false;
        }
    }

    /**
     * Constructs the heartbeat visual embed with diagnostic information.
     * @returns Mapped EmbedBuilder instance.
     */
    private buildHeartbeatEmbed(): EmbedBuilder {
        const uptimeMs = Date.now() - this.botStartTime;
        const uptimeStr = formatDuration(uptimeMs);
        
        const activeWorkspaces = this.bridge?.pool.getActiveWorkspaceNames() || [];
        const activeCount = activeWorkspaces.length;
        const activeList = activeCount > 0 ? activeWorkspaces.join(', ') : 'None';

        const lastActivityStr = formatRelativeTime(this.lastActivityTimestamp);

        return new EmbedBuilder()
            .setTitle('💓 LazyGravity Heartbeat')
            .setColor(0x00CC88)
            .addFields(
                { name: 'Status', value: '🟢 Running', inline: true },
                { name: 'Uptime', value: uptimeStr, inline: true },
                { name: 'Active Sessions', value: `${activeCount} (${activeList})`, inline: true },
                { name: 'Last Activity', value: lastActivityStr, inline: true },
            )
            .setFooter({ text: `Last updated: ${new Date().toLocaleString()}` })
            .setTimestamp();
    }
}

/**
 * Parse a duration string like "1h", "6h", "30m", or "2d" to milliseconds.
 * Requiring a unit prevents ambiguity with bare numbers.
 * @param str Input raw interval string.
 * @returns Millisecond value, or null if parser pattern mismatch.
 */
export function parseInterval(str: string): number | null {
    const match = str.trim().toLowerCase().match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'ms': return value;
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

/**
 * Format milliseconds to a human-readable duration (e.g. "2h 15m")
 * @param ms Time segment in milliseconds.
 * @returns Formatted friendly duration text.
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

/**
 * Format a past timestamp to a relative string (e.g. "5m ago")
 * @param timestamp Historical epoch timestamp.
 * @returns Friendly relative time suffix.
 */
export function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    if (diff < 5000) return 'just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
