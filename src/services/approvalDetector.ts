import { CdpService } from './cdpService';

/** 承認ボタンの情報 */
export interface ApprovalInfo {
    /** ボタンのテキスト（例: "Allow", "Deny"） */
    buttonText: string;
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
 * ファイル書き込みやコマンド実行時に表示される"Allow"/"Deny"ボタンを検知する。
 */
const DETECT_APPROVAL_SCRIPT = `(() => {
    // 承認ダイアログのボタンを探す：Antigravity特有のUIパターン
    const approvalSelectors = [
        'button[data-testid="allow-button"]',
        'button[data-testid="deny-button"]',
        '.approval-dialog button',
        '.permission-dialog button',
        '.confirm-dialog button',
    ];

    // ダイアログ内のボタン全体をスキャン
    const allButtons = Array.from(document.querySelectorAll('button'));
    const approvalPatterns = ['allow', 'deny', 'permit', 'reject', '許可', '拒否', '承認', '確認'];

    for (const btn of allButtons) {
        if (!btn.offsetParent) continue; // 非表示スキップ
        const text = (btn.textContent || '').trim();
        if (!text) continue;

        const lowerText = text.toLowerCase();
        const isApproval = approvalPatterns.some(p => lowerText.includes(p));
        if (!isApproval) continue;

        // ダイアログの説明文を探す
        let description = '';
        const dialog = btn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog');
        if (dialog) {
            const descEl = dialog.querySelector('p, .description, [data-testid="description"]');
            description = descEl?.textContent?.trim() ?? dialog.textContent?.trim() ?? '';
        }

        return { buttonText: text, description };
    }

    return null;
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
    /** 直前に検出したボタン情報（重複通知防止用） */
    private lastDetectedKey: string | null = null;

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
     *   1. DOMから承認ボタン情報を取得
     *   2. 新規検出の場合のみコールバック通知（重複防止）
     *   3. ボタンが消えたら lastDetectedKey をリセット
     */
    private async poll(): Promise<void> {
        try {
            const result = await this.cdpService.call('Runtime.evaluate', {
                expression: DETECT_APPROVAL_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            });

            const info: ApprovalInfo | null = result?.result?.value ?? null;

            if (info) {
                // 重複通知防止: buttonText + description の組み合わせをキーとする
                const key = `${info.buttonText}::${info.description}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.onApprovalRequired(info);
                }
            } else {
                // ボタンが消えたらリセット（次回の承認検出に備える）
                this.lastDetectedKey = null;
            }
        } catch (error) {
            // CDPエラーは無視して監視を継続
            console.error('[ApprovalDetector] ポーリング中にエラーが発生しました:', error);
        }
    }

    /**
     * 指定テキストの承認ボタンをCDP経由でクリックする（許可）。
     * @param buttonText クリックするボタンのテキスト（デフォルト: "Allow"）
     * @returns クリック成功なら true
     */
    async approveButton(buttonText: string = 'Allow'): Promise<boolean> {
        return this.clickButton(buttonText);
    }

    /**
     * 指定テキストの拒否ボタンをCDP経由でクリックする（拒否）。
     * @param buttonText クリックするボタンのテキスト（デフォルト: "Deny"）
     * @returns クリック成功なら true
     */
    async denyButton(buttonText: string = 'Deny'): Promise<boolean> {
        return this.clickButton(buttonText);
    }

    /**
     * 内部クリック処理（approveButton / denyButton の共通実装）
     */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.cdpService.call('Runtime.evaluate', {
                expression: buildClickScript(buttonText),
                returnByValue: true,
                awaitPromise: false,
            });
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
