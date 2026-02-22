import { EventEmitter } from 'events';
import * as http from 'http';
import WebSocket from 'ws';

export interface CdpServiceOptions {
    portsToScan?: number[];
    cdpCallTimeout?: number;
    /** 切断時の自動再接続試行回数。0は再接続しない。デフォルト: 3 */
    maxReconnectAttempts?: number;
    /** 再接続試行間のディレイ（ミリ秒）。デフォルト: 2000 */
    reconnectDelayMs?: number;
}

export interface CdpContext {
    id: number;
    name: string;
    url: string;
}

export interface InjectResult {
    ok: boolean;
    method?: string;
    contextId?: number;
    error?: string;
}

/** UI同期操作結果の型定義 (Step 9) */
export interface UiSyncResult {
    ok: boolean;
    /** 設定されたモード名（setUiMode成功時） */
    mode?: string;
    /** 設定されたモデル名（setUiModel成功時） */
    model?: string;
    error?: string;
}

/** Antigravity UIのDOMセレクター定数 */
const SELECTORS = {
    /** チャット入力ボックス: xterm を除いた textbox */
    CHAT_INPUT: 'div[role="textbox"]:not(.xterm-helper-textarea)',
    /** 送信ボタン検索対象タグ */
    SUBMIT_BUTTON_CONTAINER: 'button',
    /** 送信アイコンのSVGクラス候補 */
    SUBMIT_BUTTON_SVG_CLASSES: ['lucide-arrow-right', 'lucide-arrow-up', 'lucide-send'],
    /** メッセージ注入対象コンテキストを識別するキーワード */
    CONTEXT_URL_KEYWORD: 'cascade-panel',
};

export class CdpService extends EventEmitter {
    private ports: number[];
    private isConnectedFlag: boolean = false;
    private ws: WebSocket | null = null;
    private contexts: CdpContext[] = [];
    private pendingCalls = new Map<number, { resolve: Function, reject: Function, timeoutId: NodeJS.Timeout }>();
    private idCounter = 1;
    private cdpCallTimeout = 30000;
    private targetUrl: string | null = null;
    /** 切断時の自動再接続試行回数 */
    private maxReconnectAttempts: number;
    /** 再接続試行間のディレイ（ミリ秒） */
    private reconnectDelayMs: number;
    /** 現在の再接続試行回数 */
    private reconnectAttemptCount: number = 0;
    /** 再接続中フラグ（二重接続防止） */
    private isReconnecting: boolean = false;

    constructor(options: CdpServiceOptions = {}) {
        super();
        this.ports = options.portsToScan || [9222, 9223, 9333, 9444, 9555, 9666];
        if (options.cdpCallTimeout) this.cdpCallTimeout = options.cdpCallTimeout;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    }

    private async getJson(url: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }

    async discoverTarget(): Promise<string> {
        for (const port of this.ports) {
            try {
                const list = await this.getJson(`http://127.0.0.1:${port}/json/list`);
                let target = list.find(t =>
                    t.type === 'page' &&
                    t.webSocketDebuggerUrl &&
                    !t.title?.includes('Launchpad') &&
                    !t.url?.includes('workbench-jetski-agent') &&
                    (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade'))
                );

                if (!target) {
                    target = list.find(t =>
                        t.webSocketDebuggerUrl &&
                        (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade')) &&
                        !t.title?.includes('Launchpad')
                    );
                }

                if (!target) {
                    target = list.find(t =>
                        t.webSocketDebuggerUrl &&
                        (t.url?.includes('workbench') || t.title?.includes('Antigravity') || t.title?.includes('Cascade') || t.title?.includes('Launchpad'))
                    );
                }

                if (target && target.webSocketDebuggerUrl) {
                    this.targetUrl = target.webSocketDebuggerUrl;
                    return target.webSocketDebuggerUrl;
                }
            } catch (e) {
                // Ignore port not found
            }
        }
        throw new Error('CDP target not found on any port.');
    }

    async connect(): Promise<void> {
        if (!this.targetUrl) {
            await this.discoverTarget();
        }

        if (!this.targetUrl) throw new Error('Target URL not established.');

        this.ws = new WebSocket(this.targetUrl);

        await new Promise<void>((resolve, reject) => {
            if (!this.ws) return reject(new Error('WebSocket not initialized'));
            this.ws.on('open', () => {
                this.isConnectedFlag = true;
                resolve();
            });
            this.ws.on('error', reject);
        });

        this.ws.on('message', (msg: WebSocket.Data) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id !== undefined && this.pendingCalls.has(data.id)) {
                    const { resolve, reject, timeoutId } = this.pendingCalls.get(data.id)!;
                    clearTimeout(timeoutId);
                    this.pendingCalls.delete(data.id);
                    if (data.error) reject(data.error); else resolve(data.result);
                }

                if (data.method === 'Runtime.executionContextCreated') {
                    this.contexts.push(data.params.context);
                }
                if (data.method === 'Runtime.executionContextDestroyed') {
                    const idx = this.contexts.findIndex(c => c.id === data.params.executionContextId);
                    if (idx !== -1) this.contexts.splice(idx, 1);
                }
            } catch (e) { }
        });

        this.ws.on('close', () => {
            this.isConnectedFlag = false;
            // 切断時に未解決のpendingCallsを全てrejectしてメモリリークを防ぐ
            this.clearPendingCalls(new Error('WebSocket切断'));
            this.ws = null;
            this.targetUrl = null;
            this.emit('disconnected');
            // 自動再接続を試みる（maxReconnectAttempts > 0の場合）
            if (this.maxReconnectAttempts > 0 && !this.isReconnecting) {
                this.tryReconnect();
            }
        });

        // Initialize Runtime to get execution contexts
        await this.call('Runtime.enable', {});
    }

    async call(method: string, params: any = {}): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }

        return new Promise((resolve, reject) => {
            const id = this.idCounter++;
            const timeoutId = setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error(`Timeout calling CDP method ${method}`));
                }
            }, this.cdpCallTimeout);

            this.pendingCalls.set(id, { resolve, reject, timeoutId });
            this.ws!.send(JSON.stringify({ id, method, params }));
        });
    }

    async disconnect(): Promise<void> {
        // 再接続を停止させる
        this.maxReconnectAttempts = 0;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnectedFlag = false;
        this.contexts = [];
        this.clearPendingCalls(new Error('disconnect()が呼ばれました'));
    }

    /**
     * 未解決のpendingCallsを全てrejectし、メモリリークを防ぐ。
     * (Step 12: エラーハンドリング)
     * @param error rejectに渡すエラー
     */
    private clearPendingCalls(error: Error): void {
        for (const [id, { reject, timeoutId }] of this.pendingCalls.entries()) {
            clearTimeout(timeoutId);
            reject(error);
        }
        this.pendingCalls.clear();
    }

    /**
     * CDP切断後に自動再接続を試みる。
     * maxReconnectAttempts回失敗したら 'reconnectFailed' イベントを発火する。
     * (Step 12: エラーハンドリングとタイムアウト処理)
     */
    private async tryReconnect(): Promise<void> {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.reconnectAttemptCount = 0;

        while (this.reconnectAttemptCount < this.maxReconnectAttempts) {
            this.reconnectAttemptCount++;
            console.error(
                `[CdpService] 再接続試行 ${this.reconnectAttemptCount}/${this.maxReconnectAttempts}...`
            );

            // ディレイを挟む
            await new Promise(r => setTimeout(r, this.reconnectDelayMs));

            try {
                this.contexts = [];
                await this.discoverTarget();
                await this.connect();
                console.error('[CdpService] 再接続成功。');
                this.reconnectAttemptCount = 0;
                this.isReconnecting = false;
                this.emit('reconnected');
                return;
            } catch (err) {
                console.error('[CdpService] 再接続失敗:', err);
            }
        }

        this.isReconnecting = false;
        const finalError = new Error(
            `CDPへの再接続が${this.maxReconnectAttempts}回失敗しました。手動での再起動が必要です。`
        );
        console.error('[CdpService]', finalError.message);
        this.emit('reconnectFailed', finalError);
    }

    isConnected(): boolean {
        return this.isConnectedFlag;
    }

    getContexts(): CdpContext[] {
        return [...this.contexts];
    }

    getPrimaryContextId(): number | null {
        // Find cascade-panel context
        const context = this.contexts.find(c => c.url && c.url.includes('cascade-panel'));
        if (context) return context.id;

        // Fallback to Extension context or first one
        const extContext = this.contexts.find(c => c.name && c.name.includes('Extension'));
        if (extContext) return extContext.id;

        return this.contexts.length > 0 ? this.contexts[0].id : null;
    }

    /**
     * 指定テキストをAntigravityのチャット入力欄に注入し送信する。
     *
     * 戦略:
     *   1. cascade-panel / Extension コンテキストを優先してスクリプトを実行
     *   2. 優先コンテキストが全滅したら残り全コンテキストにフォールバック
     *   3. DOM スクリプトはテキスト挿入 → 送信ボタンクリック → Enter キーの順で試みる
     */
    async injectMessage(text: string): Promise<InjectResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
        }

        // ブラウザ内で実行するDOM操作スクリプト（JSON.stringifyでXSS等を防ぐ）
        const safeText = JSON.stringify(text);
        const selectorsJson = JSON.stringify(SELECTORS);
        const expression = `(async () => {
            const SELECTORS = ${selectorsJson};

            // 送信ボタンかどうかを判定するヘルパー
            function isSubmitButton(btn) {
                if (btn.disabled || btn.offsetWidth === 0) return false;
                const svg = btn.querySelector('svg');
                if (svg) {
                    const cls = (svg.getAttribute('class') || '') + ' ' + (btn.getAttribute('class') || '');
                    if (SELECTORS.SUBMIT_BUTTON_SVG_CLASSES.some(c => cls.includes(c))) return true;
                }
                const txt = (btn.innerText || '').trim().toLowerCase();
                if (['send', 'run'].includes(txt)) return true;
                return false;
            }

            const doc = document;

            // 1. 入力エディタを探す (xterm は除外、最後の表示中要素を使用)
            const editors = Array.from(doc.querySelectorAll(SELECTORS.CHAT_INPUT));
            const validEditors = editors.filter(el => el.offsetParent !== null);
            const editor = validEditors.at(-1);
            if (!editor) return { ok: false, error: 'No editor found in this context' };

            // 2. フォーカスしてテキストを挿入
            editor.focus();
            let inserted = doc.execCommand('insertText', false, ${safeText});
            if (!inserted) {
                editor.textContent = ${safeText};
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${safeText} }));
                editor.dispatchEvent(new InputEvent('input',       { bubbles: true, inputType: 'insertText', data: ${safeText} }));
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));

            // 3. 送信ボタンをクリック、なければ Enter キー送信
            const allButtons = Array.from(doc.querySelectorAll(SELECTORS.SUBMIT_BUTTON_CONTAINER));
            const submit = allButtons.find(isSubmitButton);
            if (submit) {
                submit.click();
                return { ok: true, method: 'click' };
            }
            editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
            return { ok: true, method: 'enter' };
        })()`;

        // cascade-panel または Extension コンテキストを優先ターゲットに
        const priorityContexts = this.contexts.filter(c =>
            (c.url && c.url.includes(SELECTORS.CONTEXT_URL_KEYWORD)) ||
            (c.name && c.name.includes('Extension'))
        );
        const contextsToTry = priorityContexts.length > 0 ? priorityContexts : this.contexts;

        // 優先コンテキストで注入を試みる
        for (const ctx of contextsToTry) {
            try {
                const res = await this.call('Runtime.evaluate', {
                    expression,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id,
                });
                if (res?.result?.value?.ok) {
                    return { ...res.result.value, contextId: ctx.id };
                }
            } catch (_) { /* 失敗は許容しフォールバックへ */ }
        }

        // フォールバック: 残りコンテキストを全試行
        if (priorityContexts.length > 0) {
            const fallbackContexts = this.contexts.filter(c => !priorityContexts.includes(c));
            for (const ctx of fallbackContexts) {
                try {
                    const res = await this.call('Runtime.evaluate', {
                        expression,
                        returnByValue: true,
                        awaitPromise: true,
                        contextId: ctx.id,
                    });
                    if (res?.result?.value?.ok) {
                        return { ...res.result.value, contextId: ctx.id };
                    }
                } catch (_) { }
            }
        }

        return { ok: false, error: `注入失敗: ${this.contexts.length}コンテキストを試みましたが全て失敗しました。` };
    }

    /**
     * AntigravityのUI上のモードドロップダウンを操作し、指定モードに切り替える。
     * (Step 9: モデル・モード切替のUI同期)
     *
     * @param modeName 設定するモード名（例: 'code', 'architect', 'ask'）
     */
    async setUiMode(modeName: string): Promise<UiSyncResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
        }

        // DOM操作スクリプトを文字列として構築（テンプレートリテラルのネストを避けるため）
        const safeMode = JSON.stringify(modeName);
        const expression = [
            '(async () => {',
            '  const targetMode = ' + safeMode + ';',
            '  const selectors = [',
            '    "[data-value=\\"" + targetMode + "\\"]",',
            '    "[aria-label*=\\"" + targetMode + "\\"]",',
            '  ];',
            '  for (const sel of selectors) {',
            '    const el = document.querySelector(sel);',
            '    if (el && el.offsetParent !== null) {',
            '      el.click();',
            '      await new Promise(r => setTimeout(r, 200));',
            '      return { ok: true, mode: targetMode };',
            '    }',
            '  }',
            '  const allBtns = Array.from(document.querySelectorAll("button, [role=\\"option\\"], [role=\\"menuitem\\"]"));',
            '  const modeBtn = allBtns.find(btn => {',
            '    const t = (btn.textContent || "").trim().toLowerCase();',
            '    return t === targetMode.toLowerCase() || t.includes(targetMode.toLowerCase());',
            '  });',
            '  if (modeBtn && modeBtn.offsetParent !== null) {',
            '    modeBtn.click();',
            '    await new Promise(r => setTimeout(r, 200));',
            '    return { ok: true, mode: targetMode };',
            '  }',
            '  return { ok: false, error: "モードセレクターが見つかりませんでした: " + targetMode };',
            '})()',
        ].join('\n');

        try {
            const contextId = this.getPrimaryContextId();
            const callParams: any = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;

            const res = await this.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            if (value?.ok) {
                return { ok: true, mode: value.mode };
            }
            return { ok: false, error: value?.error || 'UI操作に失敗しました（setUiMode）' };
        } catch (error: any) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    /**
     * AntigravityのUI上のモデルドロップダウンを操作し、指定モデルに切り替える。
     * (Step 9: モデル・モード切替のUI同期)
     *
     * @param modelName 設定するモデル名（例: 'gpt-4o', 'claude-3-opus'）
     */
    async setUiModel(modelName: string): Promise<UiSyncResult> {
        if (!this.isConnectedFlag || !this.ws) {
            throw new Error('CDPに接続されていません。connect()を先に呼んでください。');
        }

        // DOM操作スクリプトを文字列として構築
        const safeModel = JSON.stringify(modelName);
        const expression = [
            '(async () => {',
            '  const targetModel = ' + safeModel + ';',
            '  const selectors = [',
            '    "[data-value=\\"" + targetModel + "\\"]",',
            '    "[aria-label*=\\"" + targetModel + "\\"]",',
            '    "option[value=\\"" + targetModel + "\\"]",',
            '  ];',
            '  for (const sel of selectors) {',
            '    const el = document.querySelector(sel);',
            '    if (el) {',
            '      if (el.tagName === "OPTION") {',
            '        const select = el.closest("select");',
            '        if (select) {',
            '          select.value = targetModel;',
            '          select.dispatchEvent(new Event("change", { bubbles: true }));',
            '          await new Promise(r => setTimeout(r, 200));',
            '          return { ok: true, model: targetModel };',
            '        }',
            '      }',
            '      if (el.offsetParent !== null) {',
            '        el.click();',
            '        await new Promise(r => setTimeout(r, 200));',
            '        return { ok: true, model: targetModel };',
            '      }',
            '    }',
            '  }',
            '  const candidates = Array.from(document.querySelectorAll("button, [role=\\"option\\"], [role=\\"menuitem\\"], option"));',
            '  const modelEl = candidates.find(el => {',
            '    const t = (el.textContent || el.getAttribute("value") || "").trim().toLowerCase();',
            '    return t === targetModel.toLowerCase() || t.includes(targetModel.toLowerCase());',
            '  });',
            '  if (modelEl) {',
            '    if (modelEl.tagName === "OPTION") {',
            '      const select = modelEl.closest("select");',
            '      if (select) {',
            '        select.value = targetModel;',
            '        select.dispatchEvent(new Event("change", { bubbles: true }));',
            '        await new Promise(r => setTimeout(r, 200));',
            '        return { ok: true, model: targetModel };',
            '      }',
            '    }',
            '    modelEl.click();',
            '    await new Promise(r => setTimeout(r, 200));',
            '    return { ok: true, model: targetModel };',
            '  }',
            '  return { ok: false, error: "モデルセレクターが見つかりませんでした: " + targetModel };',
            '})()',
        ].join('\n');

        try {
            const contextId = this.getPrimaryContextId();
            const callParams: any = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;

            const res = await this.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            if (value?.ok) {
                return { ok: true, model: value.model };
            }
            return { ok: false, error: value?.error || 'UI操作に失敗しました（setUiModel）' };
        } catch (error: any) {
            return { ok: false, error: error?.message || String(error) };
        }
    }
}
