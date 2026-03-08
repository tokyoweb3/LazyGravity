import { logger } from '../utils/logger';
import { CdpService } from './cdpService';
import { buildClickScript } from './approvalDetector';

/** Run command dialog information */
export interface RunCommandInfo {
    /** The command text to be executed (e.g. "python3 -m http.server 8000") */
    commandText: string;
    /** Working directory shown in the dialog (e.g. "~/Code/login") */
    workingDirectory: string;
    /** Run button text (e.g. "Run") */
    runText: string;
    /** Reject button text (e.g. "Reject") */
    rejectText: string;
}

export interface RunCommandDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 1500ms) */
    pollIntervalMs?: number;
    /** Callback when a run command dialog is detected */
    onRunCommandRequired: (info: RunCommandInfo) => void;
    /** Callback when a previously detected dialog is resolved (disappeared) */
    onResolved?: () => void;
}

/**
 * CDP detection script for the "Run command?" dialog in Claude Code / Antigravity.
 *
 * DOM structure (from user-provided inspection):
 *   <div class="flex flex-col gap-2 border-gray-500/25 border rounded-lg my-1">
 *     <div>
 *       <div class="... border-b ..."><span class="opacity-60">Run command?</span></div>
 *       <div class="...">
 *         <pre class="whitespace-pre-wrap break-all font-mono text-sm">
 *           <span class="... opacity-50">~/Code/login</span>
 *           <span class="opacity-50"> $ </span>python3 -m http.server 8000
 *         </pre>
 *       </div>
 *       <div class="... border-t ...">
 *         <button>Reject</button>
 *         <button>Run</button>  (split button with chevron for options)
 *       </div>
 *     </div>
 *   </div>
 */
const DETECT_RUN_COMMAND_SCRIPT = `(() => {
    const RUN_COMMAND_HEADER_PATTERNS = [
        'run command?', 'run command', 'execute command',
        'コマンドを実行', 'コマンド実行'
    ];
    const RUN_PATTERNS = ['run', 'accept', '実行', 'execute'];
    const REJECT_PATTERNS = ['reject', 'cancel', '拒否', 'キャンセル'];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    // Find the "Run command?" header span (reverse order to prefer newest card)
    const allSpans = Array.from(document.querySelectorAll('span')).reverse();
    const headerSpan = allSpans.find(span => {
        if (!span.offsetParent && span.offsetParent !== document.body) {
            const rect = span.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
        }
        const t = normalize(span.textContent || '');
        return RUN_COMMAND_HEADER_PATTERNS.some(p => t.includes(p));
    });
    if (!headerSpan) return null;

    // Navigate up to the rounded-lg container
    const container = headerSpan.closest('div[class*="rounded-lg"][class*="border"]')
        || headerSpan.closest('div[class*="gap-2"]')
        || headerSpan.parentElement?.parentElement?.parentElement;
    if (!container) return null;

    // Extract command text from <pre> element
    const pre = container.querySelector('pre');
    if (!pre) return null;

    const preText = (pre.textContent || '').trim();
    // Format: "~/Code/login $ python3 -m http.server 8000"
    // Split on " $ " to separate working directory from command
    const dollarIdx = preText.indexOf(' $ ');
    let commandText = preText;
    let workingDirectory = '';
    if (dollarIdx >= 0) {
        workingDirectory = preText.substring(0, dollarIdx).trim();
        commandText = preText.substring(dollarIdx + 3).trim();
    }

    // Find Run and Reject buttons within the container
    const containerButtons = Array.from(container.querySelectorAll('button'))
        .filter(btn => {
            if (btn.offsetParent !== null) return true;
            const rect = btn.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

    const runBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        // Exclude buttons that are clearly not the Run button (dropdowns, copy, etc.)
        if (t === '' || t.length > 30) return false;
        return RUN_PATTERNS.some(p => t === p || t.startsWith(p));
    });

    const rejectBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        if (t === '' || t.length > 30) return false;
        return REJECT_PATTERNS.some(p => t === p || t.startsWith(p));
    });

    if (!runBtn || !rejectBtn) return null;

    return {
        commandText,
        workingDirectory,
        runText: (runBtn.textContent || '').trim(),
        rejectText: (rejectBtn.textContent || '').trim(),
    };
})()`;

/**
 * Class that detects "Run command?" dialogs in the Antigravity UI via polling.
 *
 * Notifies detected dialog info through the onRunCommandRequired callback,
 * and performs the actual click operations via runButton() / rejectButton() methods.
 */
export class RunCommandDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onRunCommandRequired: (info: RunCommandInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected dialog (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full RunCommandInfo from the last detection (used for clicking) */
    private lastDetectedInfo: RunCommandInfo | null = null;

    constructor(options: RunCommandDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1500;
        this.onRunCommandRequired = options.onRunCommandRequired;
        this.onResolved = options.onResolved;
    }

    /** Start monitoring. */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
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

    /** Return the last detected run command info. */
    getLastDetectedInfo(): RunCommandInfo | null {
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
     *   1. Detect run command dialog in DOM (with contextId)
     *   2. Notify via callback only on new detection (prevent duplicates)
     *   3. Reset when dialog disappears
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_RUN_COMMAND_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: RunCommandInfo | null = result?.result?.value ?? null;

            if (info) {
                // Duplicate prevention: use commandText as key
                const key = `${info.commandText}::${info.workingDirectory}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.onRunCommandRequired(info);
                }
            } else {
                const wasDetected = this.lastDetectedKey !== null;
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
                if (wasDetected && this.onResolved) {
                    this.onResolved();
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[RunCommandDetector] Error during polling:', error);
        }
    }

    /**
     * Click the Run button via CDP.
     * @param buttonText Text of the button to click (default: detected runText or "Run")
     * @returns true if click succeeded
     */
    async runButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.runText ?? 'Run';
        return this.clickButton(text);
    }

    /**
     * Click the Reject button via CDP.
     * @param buttonText Text of the button to click (default: detected rejectText or "Reject")
     * @returns true if click succeeded
     */
    async rejectButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.rejectText ?? 'Reject';
        return this.clickButton(text);
    }

    /**
     * Internal click handler (shared implementation for runButton / rejectButton).
     */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const script = buildClickScript(buttonText);
            const result = await this.runEvaluateScript(script);
            if (result?.ok !== true) {
                logger.warn(`[RunCommandDetector] Click failed for "${buttonText}":`, result?.error ?? 'unknown');
            } else {
                logger.debug(`[RunCommandDetector] Click OK for "${buttonText}"`);
            }
            return result?.ok === true;
        } catch (error) {
            logger.error('[RunCommandDetector] Error while clicking button:', error);
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
