import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** 承認ボタンの情報 */
export interface ApprovalInfo {
    /** 許可ボタンのテキスト（例: "Allow", "許可"） */
    approveText: string;
    /** 会話単位の許可ボタンのテキスト（例: "Allow This Conversation", "常に許可"） */
    alwaysAllowText?: string;
    /** 拒否ボタンのテキスト（例: "Deny", "拒否"） */
    denyText: string;
    /** アクションの説明文（例: "write to file.ts"） */
    description: string;
}

export interface ApprovalDetectorOptions {
    /** CDPサービスインスタンス */
    cdpService: CdpService;
    /** ポーリング間隔（ミリ秒）デフォルト: 1500ms */
    pollIntervalMs?: number;
    /** 承認ボタン検出時のコールバック */
    onApprovalRequired: (info: ApprovalInfo) => void;
}

/**
 * Antigravity UIの承認ボタン検出スクリプト
 *
 * 許可/拒否ボタンをペアで検出し、説明文もフォールバック付きで抽出する。
 */
const DETECT_APPROVAL_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = ['allow once', 'allow one time', '今回のみ許可', '1回のみ許可', '一度許可'];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        '常に許可',
        'この会話を許可',
    ];
    const ALLOW_PATTERNS = ['allow', 'permit', '許可', '承認', '確認'];
    const DENY_PATTERNS = ['deny', '拒否', 'decline'];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    const allButtons = Array.from(document.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null);

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

    const containerButtons = Array.from(container.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null);

    const denyBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return DENY_PATTERNS.some(p => t.includes(p));
    }) || null;

    if (!denyBtn) return null;

    const alwaysAllowBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
    }) || null;

    const approveText = (approveBtn.textContent || '').trim();
    const alwaysAllowText = alwaysAllowBtn ? (alwaysAllowBtn.textContent || '').trim() : '';
    const denyText = (denyBtn.textContent || '').trim();

    // 説明文の抽出（複数フォールバック）
    let description = '';

    // 1. ダイアログ/モーダル内のpや.description
    const dialog = container;
    if (dialog) {
        const descEl = dialog.querySelector('p, .description, [data-testid="description"]');
        if (descEl) {
            description = (descEl.textContent || '').trim();
        }
    }

    // 2. ボタンの親要素のテキスト（ボタンテキストを除く）
    if (!description) {
        const parent = approveBtn.parentElement?.parentElement || approveBtn.parentElement;
        if (parent) {
            const clone = parent.cloneNode(true);
            const buttons = clone.querySelectorAll('button');
            buttons.forEach(b => b.remove());
            const parentText = (clone.textContent || '').trim();
            if (parentText.length > 5 && parentText.length < 500) {
                description = parentText;
            }
        }
    }

    // 3. aria-label フォールバック
    if (!description) {
        const ariaLabel = approveBtn.getAttribute('aria-label') || '';
        if (ariaLabel) description = ariaLabel;
    }

    return { approveText, alwaysAllowText, denyText, description };
})()`;

/**
 * Allow Once の右側トグルを押して Always Allow のドロップダウンを展開する。
 */
const EXPAND_ALWAYS_ALLOW_MENU_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = ['allow once', 'allow one time', '今回のみ許可', '1回のみ許可', '一度許可'];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        '常に許可',
        'この会話を許可',
    ];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const visibleButtons = Array.from(document.querySelectorAll('button'))
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

    const containerButtons = Array.from(container.querySelectorAll('button'))
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
 * ボタンをクリックするCDPスクリプトを生成する
 *
 * @param buttonText クリックするボタンのテキスト
 */
function buildClickScript(buttonText: string): string {
    const safeText = JSON.stringify(buttonText);
    return `(() => {
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const text = ${safeText};
        const wanted = normalize(text);
        const allButtons = Array.from(document.querySelectorAll('button'));
        const target = allButtons.find(btn => {
            if (!btn.offsetParent) return false;
            const buttonText = normalize(btn.textContent || '');
            const ariaLabel = normalize(btn.getAttribute('aria-label') || '');
            return buttonText === wanted ||
                ariaLabel === wanted ||
                buttonText.includes(wanted) ||
                ariaLabel.includes(wanted);
        });
        if (!target) return { ok: false, error: 'ボタンが見つかりませんでした: ' + text };
        target.click();
        return { ok: true };
    })()`;
}

/**
 * AntigravityのUIに現れる承認ボタンをポーリングで検出するクラス。
 *
 * 検出したボタン情報を onApprovalRequired コールバックで通知し、
 * approveButton() / denyButton() メソッドで実際のクリック操作を行う。
 */
export class ApprovalDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onApprovalRequired: (info: ApprovalInfo) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** 直前に検出したボタン情報（重複通知防止用キー） */
    private lastDetectedKey: string | null = null;
    /** 直前に検出した完全なApprovalInfo（クリック時に使用） */
    private lastDetectedInfo: ApprovalInfo | null = null;

    constructor(options: ApprovalDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1500;
        this.onApprovalRequired = options.onApprovalRequired;
    }

    /**
     * 監視を開始する。
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.schedulePoll();
    }

    /**
     * 監視を停止する。
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * 最後に検出した承認ボタン情報を返す。
     * 未検出の場合は null。
     */
    getLastDetectedInfo(): ApprovalInfo | null {
        return this.lastDetectedInfo;
    }

    /** 次のポーリングをスケジュールする */
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
     * 1回のポーリング処理:
     *   1. DOMから承認ボタン情報を取得（contextId指定）
     *   2. 新規検出の場合のみコールバック通知（重複防止）
     *   3. ボタンが消えたら lastDetectedKey / lastDetectedInfo をリセット
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
                // 重複通知防止: approveText + description の組み合わせをキーとする
                const key = `${info.approveText}::${info.description}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.onApprovalRequired(info);
                }
            } else {
                // ボタンが消えたらリセット（次回の承認検出に備える）
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
            }
        } catch (error) {
            // CDPエラーは無視して監視を継続
            logger.error('[ApprovalDetector] ポーリング中にエラーが発生しました:', error);
        }
    }

    /**
     * 指定テキストの承認ボタンをCDP経由でクリックする（許可）。
     * @param buttonText クリックするボタンのテキスト（デフォルト: 検出済みのapproveText or "Allow"）
     * @returns クリック成功なら true
     */
    async approveButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.approveText ?? 'Allow';
        return this.clickButton(text);
    }

    /**
     * 「Allow This Conversation / Always Allow」を選択する。
     * 直接ボタンが見えない場合は、Allow Onceのドロップダウンを展開して選択する。
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
     * 指定テキストの拒否ボタンをCDP経由でクリックする（拒否）。
     * @param buttonText クリックするボタンのテキスト（デフォルト: 検出済みのdenyText or "Deny"）
     * @returns クリック成功なら true
     */
    async denyButton(buttonText?: string): Promise<boolean> {
        const text = buttonText ?? this.lastDetectedInfo?.denyText ?? 'Deny';
        return this.clickButton(text);
    }

    /**
     * 内部クリック処理（approveButton / denyButton の共通実装）
     * contextIdを指定して正しい実行コンテキストでクリックする。
     */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.runEvaluateScript(buildClickScript(buttonText));
            return result?.ok === true;
        } catch (error) {
            logger.error('[ApprovalDetector] ボタンクリック中にエラーが発生しました:', error);
            return false;
        }
    }

    /**
     * contextId を指定して Runtime.evaluate を実行し、result.value を返す。
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

    /** 現在監視中かどうかを返す */
    isActive(): boolean {
        return this.isRunning;
    }
}
