import { CdpService } from './cdpService';

/** Antigravity UIのDOMセレクター定数（レスポンス抽出用） */
const RESPONSE_SELECTORS = {
    /** AIの最新応答テキストを取得する（Antigravity Cascade Panel 実DOM対応） */
    RESPONSE_TEXT: `(() => {
        // style/script/svg等の非表示要素を除外してテキストを抽出するヘルパー
        function extractVisibleText(element) {
            const clone = element.cloneNode(true);
            // 非コンテンツ要素を全て除去
            const removeTags = ['style', 'script', 'svg', 'link', 'meta'];
            for (const tag of removeTags) {
                const els = clone.querySelectorAll(tag);
                els.forEach(el => el.remove());
            }
            // CSS定義を含むコードブロックも除去（@media, .selector {, --variable: 等）
            const codeBlocks = clone.querySelectorAll('pre, code');
            for (const block of codeBlocks) {
                const content = block.textContent || '';
                if (/@media\\b/.test(content) || /\\{[\\s\\S]*--[\\w-]+:/.test(content) || /\\.markdown-alert/.test(content)) {
                    block.remove();
                }
            }
            return clone.textContent?.trim() || null;
        }

        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;

        // 1. Cascade Panel 内の AI応答要素を探す（最も確実）
        const aiResponses = scope.querySelectorAll('.leading-relaxed.select-text');
        if (aiResponses.length > 0) {
            const last = aiResponses[aiResponses.length - 1];
            const text = extractVisibleText(last);
            if (text) return text;
        }

        // 2. flex-col gap-y-3 コンテナ（AIの応答ブロック）
        const responseBlocks = scope.querySelectorAll('.flex.flex-col.gap-y-3');
        if (responseBlocks.length > 0) {
            const last = responseBlocks[responseBlocks.length - 1];
            const text = extractVisibleText(last);
            if (text) return text;
        }

        // 3. rendered-markdown（チャット内のmarkdown表示）
        const markdown = scope.querySelectorAll('.rendered-markdown');
        if (markdown.length > 0) {
            const last = markdown[markdown.length - 1];
            const text = extractVisibleText(last);
            if (text) return text;
        }

        return null;
    })()`,
    /** ストップボタンの存在チェック（生成中かどうかを判定） */
    STOP_BUTTON: `(() => {
        // Cascade Panel 内のストップボタンを探す
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;
        
        // 既知のストップボタンセレクター
        const stopSelectors = [
            'button[aria-label="Stop generating"]',
            'button[aria-label="Stop"]',
            'button[title="Stop"]',
            'button.stop-button',
            '.stop-generating-button',
        ];
        for (const sel of stopSelectors) {
            const el = scope.querySelector(sel);
            if (el && el.offsetParent !== null) return true;
        }
        // SVGの停止アイコン（squareアイコン）を持つボタンを検索
        const btns = Array.from(scope.querySelectorAll('button'));
        return btns.some(btn => {
            if (!btn.offsetParent) return false;
            const svg = btn.querySelector('svg');
            if (!svg) return false;
            const cls = (svg.getAttribute('class') || '') + ' ' + (btn.getAttribute('class') || '');
            return cls.includes('lucide-square') || cls.includes('stop') || cls.includes('halt');
        });
    })()`,
};

export interface ResponseMonitorOptions {
    /** CDPサービスインスタンス */
    cdpService: CdpService;
    /** ポーリング間隔（ミリ秒）デフォルト: 1000ms */
    pollIntervalMs?: number;
    /** 最大監視時間（ミリ秒）デフォルト: 180000ms（3分） */
    maxDurationMs?: number;
    /** テキスト更新時のコールバック */
    onProgress?: (text: string) => void;
    /** 生成完了時のコールバック */
    onComplete?: (finalText: string) => void;
    /** タイムアウト時のコールバック */
    onTimeout?: (lastText: string) => void;
}

/**
 * AIレスポンスの抽出とプログレス監視クラス
 *
 * ポーリングによりAntigravityのDOMからAIの応答テキストを定期的に取得し、
 * テキストの変化・生成完了・タイムアウトを検知してコールバックで通知する。
 */
export class ResponseMonitor {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private maxDurationMs: number;
    private onProgress?: (text: string) => void;
    private onComplete?: (finalText: string) => void;
    private onTimeout?: (lastText: string) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private timeoutTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastText: string | null = null;
    private startTime: number = 0;

    /** 送信前の既存テキスト（古い応答を除外するため） */
    private baselineText: string | null = null;
    /** ストップボタンが一度でも出現したか（生成開始を検知済みか） */
    private generationStarted: boolean = false;

    constructor(options: ResponseMonitorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxDurationMs = options.maxDurationMs ?? 180000;
        this.onProgress = options.onProgress;
        this.onComplete = options.onComplete;
        this.onTimeout = options.onTimeout;
    }

    /**
     * 監視を開始する。
     * まず現在のテキストをベースラインとして記録し、
     * 内部でポーリングタイマーとタイムアウトタイマーを設定する。
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastText = null;
        this.generationStarted = false;
        this.startTime = Date.now();

        // ベースライン取得: 送信前の既存テキストを記録して除外対象にする
        try {
            const baseResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.RESPONSE_TEXT,
                returnByValue: true,
                awaitPromise: true,
            });
            this.baselineText = baseResult?.result?.value ?? null;
        } catch {
            this.baselineText = null;
        }

        // タイムアウトタイマーの設定
        if (this.maxDurationMs > 0) {
            this.timeoutTimer = setTimeout(async () => {
                const lastText = this.lastText ?? '';
                await this.stop();
                this.onTimeout?.(lastText);
            }, this.maxDurationMs);
        }

        // ポーリングの開始
        this.schedulePoll();
    }

    /**
     * 監視を停止する（外部から呼び出し可能）。
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
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
     *   1. ストップボタンの存在チェック（生成中かどうか）
     *   2. 最新テキストの取得
     *   3. テキスト変化があれば onProgress コールバック
     *   4. 生成完了なら onComplete コールバックを呼んで停止
     */
    private async poll(): Promise<void> {
        try {
            // ストップボタンの存在チェック（生成中かどうか）
            const stopResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.STOP_BUTTON,
                returnByValue: true,
                awaitPromise: true,
            });
            const isGenerating: boolean = stopResult?.result?.value ?? false;

            // ストップボタンが出現したら生成開始を記録
            if (isGenerating) {
                this.generationStarted = true;
            }

            // テキスト取得
            const textResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.RESPONSE_TEXT,
                returnByValue: true,
                awaitPromise: true,
            });
            const currentText: string | null = textResult?.result?.value ?? null;

            // ベースライン（送信前の古い応答）と同じテキストは無視
            if (currentText !== null && currentText === this.baselineText) {
                return;
            }

            // テキストが変化した場合のみ通知
            if (currentText !== null && currentText !== this.lastText) {
                this.lastText = currentText;
                this.onProgress?.(currentText);
            }

            // 完了判定: ストップボタンが一度出現してから消えた場合のみ完了とする
            if (!isGenerating && this.generationStarted) {
                const finalText = this.lastText ?? '';
                await this.stop();
                this.onComplete?.(finalText);
            }
        } catch (error) {
            // CDPエラーは無視して監視を継続（クラッシュさせない）
            console.error('[ResponseMonitor] ポーリング中にエラーが発生しました:', error);
        }
    }

    /** 現在監視中かどうかを返す */
    isActive(): boolean {
        return this.isRunning;
    }

    /** 最後に取得したテキストを返す */
    getLastText(): string | null {
        return this.lastText;
    }
}
