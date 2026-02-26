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
    /** Callback when a new user message is detected */
    onUserMessage: (info: UserMessageInfo) => void;
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

    // User message bubbles: bg-gray-500/15 + rounded-lg + select-text
    const userBubbles = scope.querySelectorAll(
        '[class*="bg-gray-500/15"][class*="rounded-lg"][class*="select-text"]'
    );

    if (userBubbles.length === 0) return null;

    // Get the last (most recent) user message bubble
    const lastBubble = userBubbles[userBubbles.length - 1];

    // Extract text from .whitespace-pre-wrap (the actual message content)
    const textEl = lastBubble.querySelector('.whitespace-pre-wrap')
        || lastBubble.querySelector('[style*="word-break"]');

    const text = textEl
        ? (textEl.textContent || '').trim()
        : (lastBubble.textContent || '').trim();

    if (!text || text.length < 1) return null;

    return { text };
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
export class UserMessageDetector {
    private readonly cdpService: CdpService;
    private readonly pollIntervalMs: number;
    private readonly onUserMessage: (info: UserMessageInfo) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Hash of the last detected message (for duplicate prevention) */
    private lastDetectedHash: string | null = null;
    /** Set of echo hashes — messages sent by LazyGravity that should be ignored */
    private readonly echoHashes = new Set<string>();

    constructor(options: UserMessageDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.onUserMessage = options.onUserMessage;
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

    /** Start monitoring. */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedHash = null;
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

            if (info && info.text) {
                const hash = computeEchoHash(info.text);

                // Skip if same as last detected message
                if (hash === this.lastDetectedHash) return;

                // Skip if this is an echo (sent by LazyGravity)
                if (this.echoHashes.has(hash)) {
                    this.lastDetectedHash = hash;
                    return;
                }

                this.lastDetectedHash = hash;
                this.onUserMessage(info);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) return;
            logger.error('[UserMessageDetector] Error during polling:', error);
        }
    }
}
