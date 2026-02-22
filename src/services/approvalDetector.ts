import { CdpService } from './cdpService';

/** 承認ボタンの情報 */
export interface ApprovalInfo {
    /** 許可ボタンのテキスト（例: "Allow", "許可"） */
    approveText: string;
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
    const APPROVE_PATTERNS = ['allow', 'permit', '許可', '承認', '確認', 'accept', 'approve'];
    const DENY_PATTERNS = ['deny', 'reject', '拒否', 'cancel', 'キャンセル', 'decline'];

    const allButtons = Array.from(document.querySelectorAll('button'));
    const visibleButtons = allButtons.filter(btn => btn.offsetParent !== null);

    let approveBtn = null;
    let denyBtn = null;

    for (const btn of visibleButtons) {
        const text = (btn.textContent || '').trim();
        if (!text) continue;
        const lower = text.toLowerCase();

        if (!approveBtn && APPROVE_PATTERNS.some(p => lower.includes(p))) {
            approveBtn = btn;
        }
        if (!denyBtn && DENY_PATTERNS.some(p => lower.includes(p))) {
            denyBtn = btn;
        }
        if (approveBtn && denyBtn) break;
    }

    if (!approveBtn) return null;

    const approveText = (approveBtn.textContent || '').trim();
    const denyText = denyBtn ? (denyBtn.textContent || '').trim() : '';

    // 説明文の抽出（複数フォールバック）
    let description = '';

    // 1. ダイアログ/モーダル内のpや.description
    const dialog = approveBtn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog');
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

    return { approveText, denyText, description };
})()`;

/**
 * ボタンをクリックするCDPスクリプトを生成する
 *
 * @param buttonText クリックするボタンのテキスト
 */
function buildClickScript(buttonText: string): string {
    const safeText = JSON.stringify(buttonText);
    return `(() => {
        const text = ${safeText};
        const allButtons = Array.from(document.querySelectorAll('button'));
        const target = allButtons.find(btn => {
            if (!btn.offsetParent) return false;
            const t = (btn.textContent || '').trim();
            return t.toLowerCase() === text.toLowerCase() || t === text;
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
            console.error('[ApprovalDetector] ポーリング中にエラーが発生しました:', error);
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
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: buildClickScript(buttonText),
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            return result?.result?.value?.ok === true;
        } catch (error) {
            console.error('[ApprovalDetector] ボタンクリック中にエラーが発生しました:', error);
            return false;
        }
    }

    /** 現在監視中かどうかを返す */
    isActive(): boolean {
        return this.isRunning;
    }
}
