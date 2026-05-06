import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** User message information detected from the DOM */
export interface UserMessageInfo {
    /** Message text content */
    text: string;
}

export interface UserMessageDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 2000ms) */
    pollIntervalMs?: number;
}

/**
 * Script to detect the latest user message in the Antigravity chat.
 *
 * Antigravity user message DOM structure:
 *   <div class="bg-gray-500/15 p-2 rounded-lg w-full text-sm select-text">
 *     <div class="flex flex-row items-end gap-2">
 *       <div class="flex-1 flex flex-col gap-2">
 *         <div>
 *           <div class="whitespace-pre-wrap text-sm" style="word-break: break-word;">
 *             {user message text}
 *           </div>
 *         </div>
 *       </div>
 *       <div> <!-- undo button --> </div>
 *     </div>
 *   </div>
 */
const DETECT_USER_MESSAGE_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel');
    const scope = panel || document;

    const bubbles = Array.from(scope.querySelectorAll('.bg-input.p-2'));
    const userBubbles = bubbles.filter(el => {
        if (el.closest('.text-ide-message-block-bot-color')) return false;
        if (el.closest('.rendered-markdown, .prose')) return false;
        if (el.closest('[data-message-author-role="assistant"], [data-message-role="assistant"]')) return false;
        return !!el.querySelector('.whitespace-pre-wrap');
    });

    if (userBubbles.length > 0) {
        const lastBubble = userBubbles[userBubbles.length - 1];
        // Surgical extraction: only the content of the message div
        const textEl = lastBubble.querySelector('.whitespace-pre-wrap');
        if (textEl) {
            // Clone to strip buttons without affecting the real UI
            const clone = textEl.cloneNode(true);
            const buttons = clone.querySelectorAll('button, [role="button"]');
            buttons.forEach(b => b.remove());
            
            let text = (clone.textContent || '').trim();
            // Final safety strip
            text = text.replace(/\\s*(?:Undo|撤銷|撤销|元に戻す)\\s*$/i, '').trim();
            if (text.length > 0) return { text };
        }
    }
    return null;
})()`;

/**
 * Normalize text for echo hash comparison.
 * Trims, collapses whitespace, and takes first 200 chars.
 */
function normalizeForHash(text: string): string {
    return text.trim().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Compute a short hash for echo prevention.
 */
function computeEchoHash(text: string): string {
    return createHash('sha256').update(normalizeForHash(text)).digest('hex').slice(0, 16);
}

/**
 * Detects user messages posted directly in the Antigravity UI (e.g., from a PC).
 * Follows the ApprovalDetector polling pattern.
 */
export class UserMessageDetector extends EventEmitter {
    private readonly cdpService: CdpService;
    private readonly pollIntervalMs: number;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Hash of the last detected message (for duplicate prevention) */
    private lastDetectedHash: string | null = null;
    /** Set of echo hashes — messages sent by LazyGravity that should be ignored */
    private readonly echoHashes = new Set<string>();
    /** Set of all previously detected message hashes (defense-in-depth dedup) */
    private readonly seenHashes = new Set<string>();
    private static readonly MAX_SEEN_HASHES = 50;
    /** The actual text of the last emitted message (extra safety dedup) */
    private lastSentText: string | null = null;
    /** True during the first poll — seeds existing DOM state without firing callback */
    private isPriming: boolean = false;

    constructor(options: UserMessageDetectorOptions) {
        super();
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    }

    /**
     * Register a message hash as an echo (sent by LazyGravity).
     * When this message is detected in the DOM, it will be skipped.
     */
    addEchoHash(text: string): void {
        const hash = computeEchoHash(text);
        this.echoHashes.add(hash);
        // Auto-cleanup: remove after 60s to prevent memory leak
        setTimeout(() => {
            this.echoHashes.delete(hash);
        }, 60000);
    }

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedHash = null;
        this.lastSentText = null;
        this.seenHashes.clear();
        this.isPriming = true;
        // echoHashes are intentionally NOT cleared — they have their own 60s TTL
        // and keeping them prevents false echo pickup during rapid stop/start cycles.
        this.schedulePoll();
    }

    /** Stop monitoring. */
    stop(): void {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Returns whether monitoring is currently active. */
    isActive(): boolean {
        return this.isRunning;
    }

    /** Add a hash to the seenHashes set, evicting the oldest entry if at capacity. */
    private addToSeenHashes(hash: string): void {
        if (this.seenHashes.size >= UserMessageDetector.MAX_SEEN_HASHES) {
            // Evict the oldest entry (first inserted)
            const oldest = this.seenHashes.values().next().value;
            if (oldest !== undefined) {
                this.seenHashes.delete(oldest);
            }
        }
        this.seenHashes.add(hash);
    }

    /** Schedule the next poll. */
    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    /**
     * Single poll iteration:
     *   1. Get latest user message from DOM
     *   2. Check for duplicates and echoes
     *   3. Notify via callback on new detection
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_USER_MESSAGE_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: UserMessageInfo | null = result?.result?.value ?? null;

            // Clear priming flag even if DOM is empty (e.g., new/empty chat)
            if (this.isPriming && (!info || !info.text)) {
                this.isPriming = false;
                logger.debug('[UserMessageDetector] Primed with empty DOM');
                return;
            }

            if (info && info.text) {
                const hash = computeEchoHash(info.text);
                const preview = info.text.slice(0, 40);

                // First poll: seed the current DOM state without firing callback
                if (this.isPriming) {
                    this.isPriming = false;
                    this.lastDetectedHash = hash;
                    this.addToSeenHashes(hash);
                    logger.debug(`[UserMessageDetector] Primed with existing message: "${preview}..."`);
                    return;
                }

                // Skip if same as last detected message
                if (hash === this.lastDetectedHash) return;

                // Skip if already seen (defense-in-depth dedup)
                if (this.seenHashes.has(hash)) {
                    logger.debug(`[UserMessageDetector] seenHash hit, skipping: "${preview}..."`);
                    this.lastDetectedHash = hash;
                    return;
                }

                // Skip if this is an echo (sent by LazyGravity)
                if (this.echoHashes.has(hash)) {
                    logger.debug(`[UserMessageDetector] Echo hash match, skipping: "${preview}..."`);
                    this.lastDetectedHash = hash;
                    this.addToSeenHashes(hash);
                    return;
                }

                if (info.text === this.lastSentText) {
                    logger.debug(`[UserMessageDetector] lastSentText match, skipping: "${preview}..."`);
                    this.lastDetectedHash = hash;
                    return;
                }

                this.lastDetectedHash = hash;
                this.lastSentText = info.text;
                this.addToSeenHashes(hash);
                logger.debug(`[UserMessageDetector] New message detected: "${preview}..."`);
                this.emit('message', info);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) return;
            logger.error('[UserMessageDetector] Error during polling:', error);
        }
    }
}
