import { CdpService } from './cdpService';

/** チャットセッション情報 */
export interface ChatSessionInfo {
    /** 現在のチャットタイトル（取得できた場合） */
    title: string;
    /** チャットが存在するか */
    hasActiveChat: boolean;
}

export interface ChatSessionServiceOptions {
    cdpService: CdpService;
}

/**
 * Antigravity UIの「新規チャット」ボタンをCDPでクリックするスクリプト。
 *
 * 候補セレクタ:
 *   1. aria-label による直接検索
 *   2. ボタンテキスト検索
 *   3. SVGアイコンベース（lucide-plus, lucide-message-square-plus）
 */
const START_NEW_CHAT_SCRIPT = `(async () => {
    // 1. aria-label ベース
    const ariaSelectors = [
        'button[aria-label="New Chat"]',
        'button[aria-label="新しいチャット"]',
        'button[aria-label="New Conversation"]',
    ];
    for (const sel of ariaSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            return { ok: true, method: 'aria-label', selector: sel };
        }
    }

    // 2. ボタンテキスト検索
    const textPatterns = ['new chat', 'new conversation', '新しいチャット', '新規チャット'];
    const allButtons = Array.from(document.querySelectorAll('button'));
    for (const btn of allButtons) {
        if (!btn.offsetParent) continue;
        const text = (btn.textContent || '').trim().toLowerCase();
        if (textPatterns.some(p => text.includes(p))) {
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            return { ok: true, method: 'text', text };
        }
    }

    // 3. SVGアイコンベース
    const svgClasses = ['lucide-plus', 'lucide-message-square-plus', 'lucide-square-pen'];
    for (const cls of svgClasses) {
        const svg = document.querySelector('svg.' + cls);
        if (!svg) continue;
        const btn = svg.closest('button');
        if (btn && btn.offsetParent !== null) {
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            return { ok: true, method: 'svg-icon', class: cls };
        }
    }

    return { ok: false, error: '新規チャットボタンが見つかりませんでした' };
})()`;

/**
 * 現在のチャット情報を取得するスクリプト。
 * タイトル要素やアクティブなチャットの有無をDOMから推定する。
 */
const GET_SESSION_INFO_SCRIPT = `(() => {
    // タイトル要素の候補
    const titleSelectors = [
        '[data-testid="chat-title"]',
        '.chat-title',
        'h1',
        'h2',
        '[aria-label="Chat title"]',
    ];

    let title = '';
    for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
            const t = el.textContent.trim();
            if (t.length > 0 && t.length < 200) {
                title = t;
                break;
            }
        }
    }

    // チャットメッセージの存在確認
    const messageSelectors = [
        '[data-testid="message"]',
        '.message',
        '.chat-message',
        '[role="log"] > div',
    ];
    let hasActiveChat = false;
    for (const sel of messageSelectors) {
        if (document.querySelectorAll(sel).length > 0) {
            hasActiveChat = true;
            break;
        }
    }

    // テキストエディタの存在でもアクティブ判定
    if (!hasActiveChat) {
        const editor = document.querySelector('div[role="textbox"]:not(.xterm-helper-textarea)');
        if (editor && editor.offsetParent !== null) {
            hasActiveChat = true;
        }
    }

    return { title: title || '(無題)', hasActiveChat };
})()`;

/**
 * Antigravity上のチャットセッションをCDP経由で操作するサービス。
 */
export class ChatSessionService {
    private cdpService: CdpService;

    constructor(options: ChatSessionServiceOptions) {
        this.cdpService = options.cdpService;
    }

    /**
     * Antigravity UIで新しいチャットセッションを開始する。
     * @returns 成功時 { ok: true }, 失敗時 { ok: false, error: string }
     */
    async startNewChat(): Promise<{ ok: boolean; error?: string }> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: START_NEW_CHAT_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const value = result?.result?.value;

            if (value?.ok) {
                return { ok: true };
            }
            return { ok: false, error: value?.error || '新規チャットの開始に失敗しました' };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: message };
        }
    }

    /**
     * 現在のチャットセッション情報を取得する。
     * @returns チャットセッション情報
     */
    async getCurrentSessionInfo(): Promise<ChatSessionInfo> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: GET_SESSION_INFO_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const value = result?.result?.value;

            if (value) {
                return {
                    title: value.title || '(無題)',
                    hasActiveChat: value.hasActiveChat ?? false,
                };
            }
            return { title: '(取得失敗)', hasActiveChat: false };
        } catch (error) {
            return { title: '(取得失敗)', hasActiveChat: false };
        }
    }
}
