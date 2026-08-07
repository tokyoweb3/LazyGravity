import type { CdpService } from '../services/cdpService';
import { logger } from './logger';
import { buildClickScript } from '../services/approvalDetector';

export function parseQuestionCustomId(customId: string, expectedPrefix: string): { action: string; projectName?: string; channelId?: string } | null {
    if (customId !== expectedPrefix && !customId.startsWith(expectedPrefix + ':')) return null;

    const parts = customId.split(':');
    const result: { action: string; projectName?: string; channelId?: string } = { action: parts[0] };
    
    try {
        if (parts.length > 1) {
            result.projectName = decodeURIComponent(parts[1]);
        }
        if (parts.length > 2) {
            result.channelId = decodeURIComponent(parts[2]);
        }
    } catch (e) {
        // Fallback in case of malformed URI component from truncation
        if (parts.length > 1) result.projectName = parts[1];
        if (parts.length > 2) result.channelId = parts[2];
    }
    
    return result;
}

/**
 * Executes a click on an element matching the target text in the IDE.
 * Returns true if the click was successfully dispatched, false otherwise.
 */
export async function executeBrowserClick(cdp: CdpService, buttonText: string): Promise<boolean> {
    try {
        const script = buildClickScript(buttonText);
        const evalResult = await cdp.call('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
            awaitPromise: true,
        });
        return !!evalResult?.result?.value?.ok;
    } catch (error) {
        logger.error(`[executeBrowserClick] Error clicking button "${buttonText}":`, error);
        return false;
    }
}
