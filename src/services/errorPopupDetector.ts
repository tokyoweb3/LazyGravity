import { logger } from '../utils/logger';
import { buildClickScript } from './approvalDetector';
import { CdpService } from './cdpService';

/** Error popup information */
export interface ErrorPopupInfo {
    /** Error popup title text */
    title: string;
    /** Error popup body/description text */
    body: string;
    /** Button labels found in the popup */
    buttons: string[];
}

export interface ErrorPopupDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 3000ms) */
    pollIntervalMs?: number;
    /** Callback when an error popup is detected */
    onErrorPopup: (info: ErrorPopupInfo) => void;
}

/**
 * Detection script for the Antigravity UI error popup.
 *
 * Looks for dialog/modal containers containing error-related text patterns
 * like "agent terminated", "error", "failed", etc. and extracts popup info.
 */
const DETECT_ERROR_POPUP_SCRIPT = `(() => {
    const ERROR_PATTERNS = [
        'agent terminated',
        'terminated due to error',
        'unexpected error',
        'something went wrong',
        'an error occurred',
    ];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    // Try dialog/modal first
    const dialogs = Array.from(document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], .modal, .dialog'
    )).filter(el => el.offsetParent !== null || el.getAttribute('aria-modal') === 'true');

    // Fallback: look for fixed/absolute positioned overlays
    if (dialogs.length === 0) {
        const overlays = Array.from(document.querySelectorAll('div[class*="fixed"], div[class*="absolute"]'))
            .filter(el => {
                const style = window.getComputedStyle(el);
                return (style.position === 'fixed' || style.position === 'absolute')
                    && style.zIndex && parseInt(style.zIndex, 10) > 10
                    && el.querySelector('button');
            });
        dialogs.push(...overlays);
    }

    for (const dialog of dialogs) {
        const fullText = normalize(dialog.textContent || '');
        const isError = ERROR_PATTERNS.some(p => fullText.includes(p));
        if (!isError) continue;

        // Extract title from heading elements or first prominent text
        const headingEl = dialog.querySelector('h1, h2, h3, h4, [class*="title"], [class*="heading"]');
        const title = headingEl ? (headingEl.textContent || '').trim() : '';

        // Extract body text (excluding button text and title)
        const allButtons = Array.from(dialog.querySelectorAll('button'))
            .filter(btn => btn.offsetParent !== null);
        const buttonTexts = new Set(allButtons.map(btn => (btn.textContent || '').trim()));

        const bodyParts = [];
        const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = (node.textContent || '').trim();
            if (!text) continue;
            if (buttonTexts.has(text)) continue;
            if (text === title) continue;
            bodyParts.push(text);
        }
        const body = bodyParts.join(' ').slice(0, 1000);

        const buttons = allButtons.map(btn => (btn.textContent || '').trim()).filter(t => t.length > 0);

        if (buttons.length === 0) continue;

        return { title: title || 'Error', body, buttons };
    }

    return null;
})()`;

/**
 * Read clipboard content via navigator.clipboard.readText().
 * Requires awaitPromise=true since clipboard API returns a Promise.
 */
const READ_CLIPBOARD_SCRIPT = `(async () => {
    try {
        const text = await navigator.clipboard.readText();
        return text || null;
    } catch (e) {
        return null;
    }
})()`;

/**
 * Detects error popup dialogs (e.g. "Agent terminated due to error") in the
 * Antigravity UI via polling.
 *
 * Follows the same polling pattern as PlanningDetector / ApprovalDetector:
 * - start()/stop() lifecycle
 * - Duplicate notification prevention via lastDetectedKey
 * - Cooldown to suppress rapid re-detection
 * - CDP error tolerance (continues polling on error)
 */
export class ErrorPopupDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onErrorPopup: (info: ErrorPopupInfo) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected error popup (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full ErrorPopupInfo from the last detection */
    private lastDetectedInfo: ErrorPopupInfo | null = null;
    /** Timestamp of last notification (for cooldown-based dedup) */
    private lastNotifiedAt: number = 0;
    /** Cooldown period in ms to suppress duplicate notifications (10s for error popups) */
    private static readonly COOLDOWN_MS = 10000;

    constructor(options: ErrorPopupDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 3000;
        this.onErrorPopup = options.onErrorPopup;
    }

    /** Start monitoring. */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.lastNotifiedAt = 0;
        this.schedulePoll();
    }

    /** Stop monitoring. */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Return the last detected error popup info. Returns null if nothing has been detected. */
    getLastDetectedInfo(): ErrorPopupInfo | null {
        return this.lastDetectedInfo;
    }

    /** Returns whether monitoring is currently active. */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Click the Dismiss button via CDP.
     * @returns true if click succeeded
     */
    async clickDismissButton(): Promise<boolean> {
        return this.clickButton('Dismiss');
    }

    /**
     * Click the "Copy debug info" button via CDP.
     * @returns true if click succeeded
     */
    async clickCopyDebugInfoButton(): Promise<boolean> {
        return this.clickButton('Copy debug info');
    }

    /**
     * Click the Retry button via CDP.
     * @returns true if click succeeded
     */
    async clickRetryButton(): Promise<boolean> {
        return this.clickButton('Retry');
    }

    /**
     * Read clipboard content from the browser via navigator.clipboard.readText().
     * Should be called after clickCopyDebugInfoButton() with a short delay.
     * @returns Clipboard text or null if unavailable
     */
    async readClipboard(): Promise<string | null> {
        try {
            const result = await this.runEvaluateScript(READ_CLIPBOARD_SCRIPT, true);
            return typeof result === 'string' ? result : null;
        } catch (error) {
            logger.error('[ErrorPopupDetector] Error reading clipboard:', error);
            return null;
        }
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
     *   1. Detect error popup from DOM (with contextId)
     *   2. Notify via callback only on new detection (prevent duplicates)
     *   3. Reset lastDetectedKey / lastDetectedInfo when popup disappears
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_ERROR_POPUP_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: ErrorPopupInfo | null = result?.result?.value ?? null;

            if (info) {
                // Duplicate prevention: use title + body snippet as key
                const key = `${info.title}::${info.body.slice(0, 100)}`;
                const now = Date.now();
                const withinCooldown = (now - this.lastNotifiedAt) < ErrorPopupDetector.COOLDOWN_MS;
                if (key !== this.lastDetectedKey && !withinCooldown) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.lastNotifiedAt = now;
                    this.onErrorPopup(info);
                } else if (key === this.lastDetectedKey) {
                    // Same key -- update stored info silently
                    this.lastDetectedInfo = info;
                }
            } else {
                // Reset when popup disappears (prepare for next detection)
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
            }
        } catch (error) {
            // Ignore CDP errors and continue monitoring
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[ErrorPopupDetector] Error during polling:', error);
        }
    }

    /** Internal click handler using buildClickScript from approvalDetector. */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.runEvaluateScript(buildClickScript(buttonText));
            return result?.ok === true;
        } catch (error) {
            logger.error('[ErrorPopupDetector] Error while clicking button:', error);
            return false;
        }
    }

    /** Execute Runtime.evaluate with contextId and return result.value. */
    private async runEvaluateScript(expression: string, awaitPromise: boolean = false): Promise<any> {
        const contextId = this.cdpService.getPrimaryContextId();
        const callParams: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise,
        };
        if (contextId !== null) {
            callParams.contextId = contextId;
        }
        const result = await this.cdpService.call('Runtime.evaluate', callParams);
        return result?.result?.value;
    }
}
