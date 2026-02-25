import { logger } from '../utils/logger';
import { buildClickScript } from './approvalDetector';
import { CdpService } from './cdpService';

/** Planning mode button information */
export interface PlanningInfo {
    /** Open button text */
    openText: string;
    /** Proceed button text */
    proceedText: string;
    /** Plan title (file name shown in the card) */
    planTitle: string;
    /** Plan summary text */
    planSummary: string;
    /** Plan description (markdown rendered in leading-relaxed container) */
    description: string;
}

export interface PlanningDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 2000ms) */
    pollIntervalMs?: number;
    /** Callback when planning buttons are detected */
    onPlanningRequired: (info: PlanningInfo) => void;
}

/**
 * Detection script for the Antigravity UI planning mode.
 *
 * Looks for Open/Proceed button pairs inside .notify-user-container
 * and extracts plan metadata from the surrounding DOM elements.
 */
const DETECT_PLANNING_SCRIPT = `(() => {
    const OPEN_PATTERNS = ['open'];
    const PROCEED_PATTERNS = ['proceed'];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    // Find the notify container that holds planning UI
    const container = document.querySelector('.notify-user-container');
    if (!container) return null;

    const allButtons = Array.from(container.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null);

    const openBtn = allButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return OPEN_PATTERNS.some(p => t === p || t.includes(p));
    }) || null;

    const proceedBtn = allButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return PROCEED_PATTERNS.some(p => t === p || t.includes(p));
    }) || null;

    // Both buttons must exist for this to be a planning UI
    if (!openBtn || !proceedBtn) return null;

    const openText = (openBtn.textContent || '').trim();
    const proceedText = (proceedBtn.textContent || '').trim();

    // Extract plan title from .inline-flex.break-all
    const titleEl = container.querySelector('span.inline-flex.break-all, .inline-flex.break-all');
    const planTitle = titleEl ? (titleEl.textContent || '').trim() : '';

    // Extract plan summary from span.text-sm (excluding buttons text)
    const summaryEls = Array.from(container.querySelectorAll('span.text-sm'));
    const planSummary = summaryEls
        .map(el => (el.textContent || '').trim())
        .filter(text => text.length > 0 && text !== openText && text !== proceedText)
        .join(' ');

    // Extract description from leading-relaxed container, skipping code/style blocks
    const descEl = container.querySelector('.leading-relaxed.select-text');
    let description = '';
    if (descEl) {
        const SKIP_TAGS = new Set(['PRE', 'CODE', 'STYLE', 'SCRIPT']);
        const parts = [];
        const walk = (node) => {
            if (node.nodeType === 3) {
                const t = node.textContent || '';
                if (t.trim()) parts.push(t.trim());
            } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName)) {
                for (const child of node.childNodes) walk(child);
            }
        };
        walk(descEl);
        description = parts.join(' ').slice(0, 500);
    }

    return { openText, proceedText, planTitle, planSummary, description };
})()`;

/**
 * Extract plan content displayed after clicking Open.
 *
 * Looks for the rendered markdown inside the plan content area
 * and returns the text, truncated to 4000 characters for Discord embed limits.
 */
const EXTRACT_PLAN_CONTENT_SCRIPT = `(() => {
    // Simple HTML-to-Markdown converter for plan content
    const htmlToMd = (el) => {
        const parts = [];
        const process = (node) => {
            if (node.nodeType === 3) {
                parts.push(node.textContent || '');
                return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.tagName;
            if (tag === 'H1') { parts.push('\\n# '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H2') { parts.push('\\n## '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H3') { parts.push('\\n### '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H4') { parts.push('\\n#### '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'STRONG' || tag === 'B') { parts.push('**'); node.childNodes.forEach(process); parts.push('**'); return; }
            if (tag === 'EM' || tag === 'I') { parts.push('*'); node.childNodes.forEach(process); parts.push('*'); return; }
            if (tag === 'PRE') {
                const code = node.querySelector('code');
                const text = code ? (code.textContent || '') : (node.textContent || '');
                parts.push('\\n\`\`\`\\n' + text + '\\n\`\`\`\\n');
                return;
            }
            if (tag === 'CODE') { parts.push('\`' + (node.textContent || '') + '\`'); return; }
            if (tag === 'A') {
                const href = node.getAttribute('href') || '';
                parts.push('['); node.childNodes.forEach(process); parts.push('](' + href + ')');
                return;
            }
            if (tag === 'LI') { parts.push('\\n- '); node.childNodes.forEach(process); return; }
            if (tag === 'BR') { parts.push('\\n'); return; }
            if (tag === 'P') { parts.push('\\n\\n'); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'UL' || tag === 'OL') { node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'STYLE' || tag === 'SCRIPT') return;
            node.childNodes.forEach(process);
        };
        process(el);
        return parts.join('').replace(/\\n{3,}/g, '\\n\\n').trim();
    };

    // Primary selector: plan content container
    const contentContainer = document.querySelector(
        'div.relative.pl-4.pr-4.py-1, div.relative.pl-4.pr-4'
    );
    if (contentContainer) {
        const textEl = contentContainer.querySelector('.leading-relaxed.select-text');
        if (textEl) {
            return htmlToMd(textEl);
        }
    }

    // Fallback: any leading-relaxed.select-text with significant content
    const allLeading = Array.from(document.querySelectorAll('.leading-relaxed.select-text'));
    for (const el of allLeading) {
        const md = htmlToMd(el);
        if (md.length > 100) {
            return md;
        }
    }

    return null;
})()`;

/**
 * Detects planning mode buttons (Open/Proceed) in the Antigravity UI via polling.
 *
 * Follows the same polling pattern as ApprovalDetector:
 * - start()/stop() lifecycle
 * - Duplicate notification prevention via lastDetectedKey
 * - CDP error tolerance (continues polling on error)
 */
export class PlanningDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onPlanningRequired: (info: PlanningInfo) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected planning info (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full PlanningInfo from the last detection */
    private lastDetectedInfo: PlanningInfo | null = null;
    /** Timestamp of last notification (for cooldown-based dedup) */
    private lastNotifiedAt: number = 0;
    /** Cooldown period in ms to suppress duplicate notifications */
    private static readonly COOLDOWN_MS = 5000;

    constructor(options: PlanningDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.onPlanningRequired = options.onPlanningRequired;
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

    /** Return the last detected planning info. Returns null if nothing has been detected. */
    getLastDetectedInfo(): PlanningInfo | null {
        return this.lastDetectedInfo;
    }

    /** Returns whether monitoring is currently active. */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Click the Open button via CDP.
     * @param buttonText Text of the button to click (default: detected openText or "Open")
     * @returns true if click succeeded
     */
    async clickOpenButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.openText ?? 'Open';
        return this.clickButton(text);
    }

    /**
     * Click the Proceed button via CDP.
     * @param buttonText Text of the button to click (default: detected proceedText or "Proceed")
     * @returns true if click succeeded
     */
    async clickProceedButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.proceedText ?? 'Proceed';
        return this.clickButton(text);
    }

    /**
     * Extract plan content from the DOM after Open has been clicked.
     * @returns Plan content text or null if not found
     */
    async extractPlanContent(): Promise<string | null> {
        try {
            const result = await this.runEvaluateScript(EXTRACT_PLAN_CONTENT_SCRIPT);
            return typeof result === 'string' ? result : null;
        } catch (error) {
            logger.error('[PlanningDetector] Error extracting plan content:', error);
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
     *   1. Get planning button info from DOM (with contextId)
     *   2. Notify via callback only on new detection (prevent duplicates)
     *   3. Reset lastDetectedKey / lastDetectedInfo when buttons disappear
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_PLANNING_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: PlanningInfo | null = result?.result?.value ?? null;

            if (info) {
                // Duplicate prevention: use button text pair as key (stable across DOM redraws)
                const key = `${info.openText}::${info.proceedText}`;
                const now = Date.now();
                const withinCooldown = (now - this.lastNotifiedAt) < PlanningDetector.COOLDOWN_MS;
                if (key !== this.lastDetectedKey && !withinCooldown) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.lastNotifiedAt = now;
                    this.onPlanningRequired(info);
                } else if (key === this.lastDetectedKey) {
                    // Same key — update stored info silently
                    this.lastDetectedInfo = info;
                }
            } else {
                // Reset when buttons disappear (prepare for next planning detection)
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
            }
        } catch (error) {
            // Ignore CDP errors and continue monitoring
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[PlanningDetector] Error during polling:', error);
        }
    }

    /** Internal click handler using buildClickScript from approvalDetector. */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.runEvaluateScript(buildClickScript(buttonText));
            return result?.ok === true;
        } catch (error) {
            logger.error('[PlanningDetector] Error while clicking button:', error);
            return false;
        }
    }

    /** Execute Runtime.evaluate with contextId and return result.value. */
    private async runEvaluateScript(expression: string): Promise<any> {
        const contextId = this.cdpService.getPrimaryContextId();
        const callParams: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise: false,
        };
        if (contextId !== null) {
            callParams.contextId = contextId;
        }
        const result = await this.cdpService.call('Runtime.evaluate', callParams);
        return result?.result?.value;
    }
}
