import { logger } from '../utils/logger';
import { ConsecutiveEmptyPollGate } from '../utils/consecutiveEmptyPollGate';
import { CdpService } from './cdpService';

/** Approval button information */
export interface ApprovalInfo {
    /** Allow button text (e.g. "Allow") */
    approveText: string;
    /** Per-conversation allow button text (e.g. "Allow This Conversation") */
    alwaysAllowText?: string;
    /** Deny button text (e.g. "Deny") */
    denyText: string;
    /** Action description (e.g. "write to file.ts") */
    description: string;
}

export interface ApprovalDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 1500ms) */
    pollIntervalMs?: number;
    /** Callback when an approval button is detected */
    onApprovalRequired: (info: ApprovalInfo) => void;
    /** Callback when a previously detected approval is resolved (buttons disappeared) */
    onResolved?: () => void;
}

/**
 * Approval button detection script for the Antigravity UI
 *
 * Detects allow/deny button pairs and extracts descriptions with fallbacks.
 */
export const DETECT_APPROVAL_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = ['allow once', 'allow one time', 'yes, allow this time', '今回のみ許可', '1回のみ許可', '一度許可'];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        'yes, and always allow',
        '常に許可',
        'この会話を許可',
    ];
    const ALLOW_PATTERNS = ['allow', 'permit', 'accept', 'approve', '許可', '承認', '確認'];
    const DENY_PATTERNS = ['deny', 'reject', '拒否', 'decline', 'no (tell the agent'];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], span.cursor-pointer, div.cursor-pointer'))
        .filter(btn => btn.offsetParent !== null)
        .reverse();

    const STOP_PATTERNS_GEN = [/^stop$/, /^stop generating$/, /^stop response$/, /^停止$/, /^生成を停止$/, /^応答を停止$/];
    const isGenerating = allButtons.some(btn => {
        const tooltipId = btn.getAttribute('data-tooltip-id');
        if (tooltipId === 'input-send-button-cancel-tooltip') return true;
        const labels = [btn.textContent || '', btn.getAttribute('aria-label') || '', btn.getAttribute('title') || ''];
        return labels.some(val => {
            const normalized = (val || '').toLowerCase().replace(/\\s+/g, ' ').trim();
            return normalized && STOP_PATTERNS_GEN.some(re => re.test(normalized));
        });
    });

    if (isGenerating) return null; // Wait for generation to finish!

    let approveBtn = allButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALLOW_ONCE_PATTERNS.some(p => t.includes(p));
    }) || null;

    if (!approveBtn) {
        approveBtn = allButtons.find(btn => {
            const t = normalize(btn.textContent || '');
            const isAlways = ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
            return !isAlways && ALLOW_PATTERNS.some(p => t.includes(p));
        }) || null;
    }

    if (!approveBtn) return null;

    const container = approveBtn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog')
        || approveBtn.parentElement?.parentElement
        || approveBtn.parentElement
        || document.body;

    const containerButtons = Array.from(container.querySelectorAll('button, [role="button"], span.cursor-pointer, div.cursor-pointer'))
        .filter(btn => btn.offsetParent !== null)
        .reverse();

    const denyBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return DENY_PATTERNS.some(p => t.includes(p));
    }) || null;

    if (!denyBtn) return null;

    const alwaysAllowBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
    }) || null;

    const approveText = (approveBtn.innerText || approveBtn.textContent || '').trim();
    const alwaysAllowText = alwaysAllowBtn ? (alwaysAllowBtn.innerText || alwaysAllowBtn.textContent || '').trim() : '';
    const denyText = (denyBtn.innerText || denyBtn.textContent || '').trim();

    // Description extraction (multiple fallbacks)
    let description = '';

    // 1. p or .description inside dialog/modal
    const dialog = container;
    if (dialog) {
        const descEl = dialog.querySelector('p, .description, [data-testid="description"]');
        if (descEl) {
            description = (descEl.textContent || '').trim();
        }
    }

    // 2. Parent element text (excluding button text)
    if (!description) {
        let modal = approveBtn.closest('.notify-user-container, [role="dialog"], .modal, .dialog, .approval-container, .permission-dialog');
        
        if (!modal) {
            // New Antigravity IDE uses a sticky footer with no identifying modal classes.
            // Traverse up until we find a container that includes the file list popup (.bottom-full)
            let p = approveBtn.parentElement;
            while (p && p.tagName !== 'BODY') {
                if (p.querySelector('.bottom-full')) {
                    modal = p;
                    break;
                }
                p = p.parentElement;
            }
            if (!modal) {
                modal = approveBtn.parentElement?.parentElement?.parentElement || approveBtn.parentElement?.parentElement;
                if (modal === document.body || modal?.id === 'root') modal = null;
            }
        }

        if (modal) {
            const parts = [];
            const walk = (node) => {
                if (node.nodeType === 1) {
                    // Skip buttons entirely
                    if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') return;
                    
                    // Skip menu bars and sidebars
                    if (node.tagName === 'NAV' || node.getAttribute('role') === 'menubar' || node.closest('nav') || node.closest('.monaco-menu') || node.closest('.sidebar') || node.classList.contains('sidebar')) return;

                    const display = window.getComputedStyle(node).display;
                    if (display === 'none') return;
                    
                    const isBlock = display === 'block' || display === 'flex' || node.tagName === 'DIV' || node.tagName === 'LI';
                    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== '\\n') parts.push('\\n');
                    for (const child of node.childNodes) walk(child);
                    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== '\\n') parts.push('\\n');
                } else if (node.nodeType === 3) {
                    const t = node.textContent || '';
                    if (t.trim()) parts.push(t.trim());
                }
            };
            walk(modal);
            
            const parentText = parts.join(' ').replace(/\\n\\s*/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
            if (parentText.length > 5) {
                if (parentText.length > 800 || parentText.includes('F ile\\nE dit\\nS election')) {
                    description = 'Code changes require your approval.';
                } else {
                    description = parentText;
                }
            }
        }
    }

    // 3. aria-label fallback
    if (!description) {
        const ariaLabel = approveBtn.getAttribute('aria-label') || '';
        if (ariaLabel) description = ariaLabel;
    }

    return { approveText, alwaysAllowText, denyText, description };
})()`;

/**
 * Press the toggle on the right side of Allow Once to expand the Always Allow dropdown.
 */
const EXPAND_ALWAYS_ALLOW_MENU_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = ['allow once', 'allow one time', 'yes, allow this time', '今回のみ許可', '1回のみ許可', '一度許可'];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        'yes, and always allow',
        '常に許可',
        'この会話を許可',
    ];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const visibleButtons = Array.from(document.querySelectorAll('button, [role="button"], span.cursor-pointer, div.cursor-pointer'))
        .filter(btn => btn.offsetParent !== null);

    const directAlways = visibleButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
    });
    if (directAlways) return { ok: true, reason: 'already-visible' };

    const allowOnceBtn = visibleButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALLOW_ONCE_PATTERNS.some(p => t.includes(p));
    });
    if (!allowOnceBtn) return { ok: false, error: 'allow-once button not found' };

    const container = allowOnceBtn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog')
        || allowOnceBtn.parentElement?.parentElement
        || allowOnceBtn.parentElement
        || document.body;

    const containerButtons = Array.from(container.querySelectorAll('button, [role="button"], span.cursor-pointer, div.cursor-pointer'))
        .filter(btn => btn.offsetParent !== null);

    const toggleBtn = containerButtons.find(btn => {
        if (btn === allowOnceBtn) return false;
        const text = normalize(btn.textContent || '');
        const aria = normalize(btn.getAttribute('aria-label') || '');
        const hasPopup = btn.getAttribute('aria-haspopup');
        if (hasPopup === 'menu' || hasPopup === 'listbox') return true;
        if (text === '') return true;
        return /menu|more|expand|options|dropdown|chevron|arrow/.test(aria);
    });

    if (toggleBtn) {
        toggleBtn.click();
        return { ok: true, reason: 'toggle-button' };
    }

    const rect = allowOnceBtn.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { ok: false, error: 'allow-once button rect unavailable' };
    }

    const clickX = rect.right - Math.max(4, Math.min(12, rect.width * 0.15));
    const clickY = rect.top + rect.height / 2;

    const events = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    for (const type of events) {
        allowOnceBtn.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: clickX,
            clientY: clickY,
        }));
    }
    return { ok: true, reason: 'allow-once-right-edge' };
})()`;

/**
 * Generate a CDP script that clicks a button
 *
 * @param buttonText Text of the button to click
 */
export function buildClickScript(buttonText: string): string {
    const safeText = JSON.stringify(buttonText);
    return `(() => {
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const text = ${safeText};
        const wanted = normalize(text);
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.action-btn, a[class*="btn"], span.cursor-pointer, div.cursor-pointer')).reverse();
        const target = allButtons.find(btn => {
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden' || btn.disabled) return false;
            const buttonText = normalize(btn.innerText || btn.textContent || '');
            const ariaLabel = normalize(btn.getAttribute('aria-label') || '');
            
            const isShort = wanted.length < 5;
            if (isShort) {
                return buttonText === wanted || ariaLabel === wanted;
            }
            
            return buttonText === wanted ||
                ariaLabel === wanted ||
                (buttonText.includes(wanted) && buttonText.length < wanted.length + 10) ||
                (ariaLabel.includes(wanted) && ariaLabel.length < wanted.length + 10);
        });
        if (!target) return { ok: false, error: 'Button not found: ' + text };
        target.scrollIntoView({ block: 'center' });
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            target.dispatchEvent(new PointerEvent(type, { ...eventInit, pointerId: 1 }));
        }
        if (typeof target.click === 'function') target.click();
        return { ok: true };
    })()`;
}

/**
 * Class that detects approval buttons in the Antigravity UI via polling.
 *
 * Notifies detected button info through the onApprovalRequired callback,
 * and performs the actual click operations via approveButton() / denyButton() methods.
 */
export class ApprovalDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onApprovalRequired: (info: ApprovalInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected button info (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full ApprovalInfo from the last detection (used for clicking) */
    private lastDetectedInfo: ApprovalInfo | null = null;
    /** Gate for empty polls before reset */
    private emptyPollGate = new ConsecutiveEmptyPollGate(3);

    constructor(options: ApprovalDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1500;
        this.onApprovalRequired = options.onApprovalRequired;
        this.onResolved = options.onResolved;
    }

    /**
     * Start monitoring.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.emptyPollGate.reset();
        this.schedulePoll();
    }

    /**
     * Stop monitoring.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Return the last detected approval button info.
     * Returns null if nothing has been detected.
     */
    getLastDetectedInfo(): ApprovalInfo | null {
        return this.lastDetectedInfo;
    }

    /** Schedule the next poll */
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
     *   1. Get approval button info from DOM (with contextId)
     *   2. Notify via callback only on new detection (prevent duplicates)
     *   3. Reset lastDetectedKey / lastDetectedInfo when buttons disappear
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_APPROVAL_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: ApprovalInfo | null = result?.result?.value ?? null;

            if (info) {
                this.emptyPollGate.recordDetection();
                // Duplicate prevention: use approveText + description combination as key
                const key = `${info.approveText}::${info.description}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.onApprovalRequired(info);
                }
            } else {
                if (this.emptyPollGate.recordEmptyPoll()) {
                    // Reset when buttons disappear for consecutive polls
                    const wasDetected = this.lastDetectedKey !== null;
                    this.lastDetectedKey = null;
                    this.lastDetectedInfo = null;
                    if (wasDetected && this.onResolved) {
                        this.onResolved();
                    }
                }
            }
        } catch (error) {
            // Ignore CDP errors and continue monitoring
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[ApprovalDetector] Error during polling:', error);
        }
    }

    /**
     * Click the approve button with the specified text via CDP.
     * @param buttonText Text of the button to click (default: detected approveText or "Allow")
     * @returns true if click succeeded
     */
    async approveButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.approveText ?? 'Allow';
        return this.clickButton(text);
    }

    /**
     * Select "Allow This Conversation / Always Allow".
     * If the button is not directly visible, expand the Allow Once dropdown and select it.
     */
    async alwaysAllowButton(): Promise<boolean> {
        const directCandidates = [
            this.lastDetectedInfo?.alwaysAllowText,
            'Allow This Conversation',
            'Allow This Chat',
            'この会話を許可',
            'Always Allow',
            '常に許可',
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

        for (const candidate of directCandidates) {
            if (await this.clickButton(candidate)) return true;
        }

        const expanded = await this.runEvaluateScript(EXPAND_ALWAYS_ALLOW_MENU_SCRIPT);
        if (expanded?.ok !== true) {
            return false;
        }

        for (let i = 0; i < 5; i++) {
            for (const candidate of directCandidates) {
                if (await this.clickButton(candidate)) return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        }

        return false;
    }

    /**
     * Click the deny button with the specified text via CDP.
     * @param buttonText Text of the button to click (default: detected denyText or "Deny")
     * @returns true if click succeeded
     */
    async denyButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.denyText ?? 'Deny';
        return this.clickButton(text);
    }

    /**
     * Internal click handler (shared implementation for approveButton / denyButton).
     * Specifies contextId to click in the correct execution context.
     */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const script = buildClickScript(buttonText);
            const result = await this.runEvaluateScript(script);
            if (result?.ok !== true) {
                logger.warn(`[ApprovalDetector] Click failed for "${buttonText}":`, result?.error ?? 'unknown');
            } else {
                logger.debug(`[ApprovalDetector] Click OK for "${buttonText}"`);
            }
            return result?.ok === true;
        } catch (error) {
            logger.error('[ApprovalDetector] Error while clicking button:', error);
            return false;
        }
    }

    /**
     * Execute Runtime.evaluate with contextId and return result.value.
     */
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

    /** Returns whether monitoring is currently active */
    isActive(): boolean {
        return this.isRunning;
    }
}
