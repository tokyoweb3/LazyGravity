import { AttachmentBuilder, ChatInputCommandInteraction, Message } from 'discord.js';

import { CdpService } from '../services/cdpService';
import { ScreenshotService } from '../services/screenshotService';

/**
 * Capture a screenshot and send it to Discord
 */
export async function handleScreenshot(
    target: Message | ChatInputCommandInteraction,
    cdp: CdpService | null,
): Promise<void> {
    if (!cdp) {
        const content = 'Not connected to Antigravity.';
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
        return;
    }

    try {
        const screenshot = new ScreenshotService({ cdpService: cdp });
        const result = await screenshot.capture({ format: 'png' });
        if (result.success && result.buffer) {
            const attachment = new AttachmentBuilder(result.buffer, { name: 'screenshot.png' });
            if (target instanceof Message) {
                await target.reply({ files: [attachment] });
            } else {
                await target.editReply({ files: [attachment] });
            }
        } else {
            const content = `Screenshot failed: ${result.error}`;
            if (target instanceof Message) {
                await target.reply(content);
            } else {
                await target.editReply({ content });
            }
        }
    } catch (e: any) {
        const content = `Screenshot error: ${e.message}`;
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
    }
}
