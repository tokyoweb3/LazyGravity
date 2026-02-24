import { CdpService } from './cdpService';

/** チャットセッション情報 */
export interface ChatSessionInfo {
    /** 現在のチャットタイトル（取得できた場合） */
    title: string;
    /** チャットが存在するか */
    hasActiveChat: boolean;
}

/** 新規チャットボタンの状態を取得するスクリプト */
const GET_NEW_CHAT_BUTTON_SCRIPT = `(() => {
    const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
    if (!btn) return { found: false };
    const cursor = window.getComputedStyle(btn).cursor;
    const rect = btn.getBoundingClientRect();
    return {
        found: true,
        enabled: cursor === 'pointer',
        cursor,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
    };
})()`;

/**
 * Cascade panel ヘッダーからチャットタイトルを取得するスクリプト。
 * ヘッダー内の text-ellipsis クラスを持つ div がタイトル要素。
 */
const GET_CHAT_TITLE_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel');
    if (!panel) return { title: '', hasActiveChat: false };
    const header = panel.querySelector('div[class*="border-b"]');
    if (!header) return { title: '', hasActiveChat: false };
    const titleEl = header.querySelector('div[class*="text-ellipsis"]');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    // "Agent" はデフォルトの空チャットタイトル
    const hasActiveChat = title.length > 0 && title !== 'Agent';
    return { title: title || '(無題)', hasActiveChat };
})()`;

/**
 * Antigravity上のチャットセッションをCDP経由で操作するサービス。
 *
 * CDP依存はメソッド引数で受け取る（接続プール対応）。
 */
export class ChatSessionService {
    /**
     * Antigravity UIで新しいチャットセッションを開始する。
     *
     * 戦略:
     *   1. 新規チャットボタンの状態を確認
     *   2. cursor: not-allowed → 既に空チャット（何もしない）
     *   3. cursor: pointer → Input.dispatchMouseEvent で座標クリック
     *   4. ボタンが見つからない場合 → エラー
     *
     * @param cdpService 使用するCdpServiceインスタンス
     * @returns 成功時 { ok: true }, 失敗時 { ok: false, error: string }
     */
    async startNewChat(cdpService: CdpService): Promise<{ ok: boolean; error?: string }> {
        try {
            // Antigravity起動直後はコンテキストが空の場合がある。
            // cascade-panel が準備完了するまで最大10秒待機する。
            let contexts = cdpService.getContexts();
            if (contexts.length === 0) {
                const ready = await cdpService.waitForCascadePanelReady(10000, 500);
                if (!ready) {
                    return { ok: false, error: 'コンテキストがありません（タイムアウト）' };
                }
                contexts = cdpService.getContexts();
            }

            // ボタン状態を取得（DOMロード待ちリトライ: 最大5回、1秒間隔）
            let btnState = await this.getNewChatButtonState(cdpService, contexts);

            if (!btnState.found) {
                const maxRetries = 5;
                for (let i = 0; i < maxRetries && !btnState.found; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    contexts = cdpService.getContexts();
                    btnState = await this.getNewChatButtonState(cdpService, contexts);
                }
            }

            if (!btnState.found) {
                return { ok: false, error: '新規チャットボタンが見つかりませんでした' };
            }

            // cursor: not-allowed → 既に空チャット（新規作成不要）
            if (!btnState.enabled) {
                return { ok: true };
            }

            // cursor: pointer → CDP Input API で座標クリック
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: btnState.x, y: btnState.y,
            });
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: btnState.x, y: btnState.y,
                button: 'left', clickCount: 1,
            });
            await cdpService.call('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: btnState.x, y: btnState.y,
                button: 'left', clickCount: 1,
            });

            // クリック後、UI反映を待機
            await new Promise(r => setTimeout(r, 1500));

            // ボタンが not-allowed に変わったか確認（新チャットが開かれた証拠）
            const afterState = await this.getNewChatButtonState(cdpService, contexts);
            if (afterState.found && !afterState.enabled) {
                return { ok: true };
            }

            // ボタンがまだ有効 → クリックが効かなかった可能性
            return { ok: false, error: '新規チャットボタンをクリックしましたが、状態が変化しませんでした' };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: message };
        }
    }

    /**
     * 現在のチャットセッション情報を取得する。
     * @param cdpService 使用するCdpServiceインスタンス
     * @returns チャットセッション情報
     */
    async getCurrentSessionInfo(cdpService: CdpService): Promise<ChatSessionInfo> {
        try {
            const contexts = cdpService.getContexts();
            for (const ctx of contexts) {
                try {
                    const result = await cdpService.call('Runtime.evaluate', {
                        expression: GET_CHAT_TITLE_SCRIPT,
                        returnByValue: true,
                        contextId: ctx.id,
                    });
                    const value = result?.result?.value;
                    if (value && value.title) {
                        return {
                            title: value.title,
                            hasActiveChat: value.hasActiveChat ?? false,
                        };
                    }
                } catch (_) { /* 次のコンテキストへ */ }
            }
            return { title: '(取得失敗)', hasActiveChat: false };
        } catch (error) {
            return { title: '(取得失敗)', hasActiveChat: false };
        }
    }

    /**
     * 新規チャットボタンの状態（有効/無効、座標）を取得する。
     */
    private async getNewChatButtonState(
        cdpService: CdpService,
        contexts: { id: number; name: string; url: string }[],
    ): Promise<{ found: boolean; enabled: boolean; x: number; y: number }> {
        for (const ctx of contexts) {
            try {
                const res = await cdpService.call('Runtime.evaluate', {
                    expression: GET_NEW_CHAT_BUTTON_SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id,
                });
                const value = res?.result?.value;
                if (value?.found) {
                    return { found: true, enabled: value.enabled, x: value.x, y: value.y };
                }
            } catch (_) { /* 次のコンテキストへ */ }
        }
        return { found: false, enabled: false, x: 0, y: 0 };
    }
}
