import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { logger } from '../utils/logger';
import { ConfigLoader } from '../utils/configLoader';
import { CdpBridge } from './cdpBridgeManager';

export class HeartbeatService {
    private client: Client | null = null;
    private bridge: CdpBridge | null = null;
    private intervalId: NodeJS.Timeout | null = null;
    
    public botStartTime: number = Date.now();
    public lastActivityTimestamp: number = Date.now();

    constructor() {}

    public init(client: Client, bridge: CdpBridge) {
        this.client = client;
        this.bridge = bridge;
        this.botStartTime = Date.now();
        this.lastActivityTimestamp = Date.now();
    }

    public recordActivity() {
        this.lastActivityTimestamp = Date.now();
    }

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

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    public async updateConfig(enabled: boolean, intervalMs: number, channelId: string) {
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

    public async disable() {
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

    public async sendHeartbeat() {
        if (!this.client || !this.bridge) {
            logger.warn('[HeartbeatService] Cannot send heartbeat: client or bridge not initialized.');
            return;
        }

        const config = ConfigLoader.load();
        const channelId = config.heartbeatChannelId;
        if (!channelId) return;

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) {
                logger.warn(`[HeartbeatService] Channel ${channelId} not found or is not a text channel.`);
                return;
            }

            const embed = this.buildHeartbeatEmbed();
            const lastMessageId = config.heartbeatLastMessageId;

            if (lastMessageId) {
                try {
                    const message = await (channel as TextChannel).messages.fetch(lastMessageId);
                    if (message && message.author.id === this.client.user?.id) {
                        await message.edit({ embeds: [embed] });
                        logger.debug(`[HeartbeatService] Updated heartbeat message in-place: ${lastMessageId}`);
                        return;
                    }
                } catch (fetchErr) {
                    logger.debug(`[HeartbeatService] Failed to fetch or edit message ${lastMessageId}, sending new one.`);
                }
            }

            // Send new message
            const newMsg = await (channel as TextChannel).send({ embeds: [embed] });
            ConfigLoader.save({ heartbeatLastMessageId: newMsg.id });
            logger.info(`[HeartbeatService] Sent new heartbeat message: ${newMsg.id}`);
        } catch (error) {
            logger.error('[HeartbeatService] Error in sendHeartbeat:', error);
        }
    }

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
