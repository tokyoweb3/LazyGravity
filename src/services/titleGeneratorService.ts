import { CdpService } from './cdpService';

/**
 * Antigravity UI内でGemini Flashを利用してチャンネル名用のタイトルを生成するスクリプト。
 * Antigravityの内部API（language_server）を経由してLLM呼び出しを行う。
 * DOM内の既存コンポーネントからAPIエンドポイントとトークンを推定する。
 */
const GENERATE_TITLE_SCRIPT = `(async (userPrompt) => {
    try {
        // Antigravity内部のfetch APIを利用してタイトル生成
        // __NEXT_DATA__ や window.__remixContext などから設定を探す
        const configs = [
            window.__NEXT_DATA__,
            window.__remixContext,
            window.__APP_CONFIG__,
        ].filter(Boolean);

        // フォールバック: プロンプトから先頭のテキストを抽出
        const fallbackTitle = userPrompt
            .replace(/^\\[.*?\\]\\n?/, '')
            .substring(0, 40)
            .trim();

        return { ok: true, title: fallbackTitle, method: 'text-extract' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
})`;

/**
 * チャットセッションのタイトルを生成するサービス。
 *
 * 戦略:
 *   1. CdpService経由でAntigravityのGemini Flash APIを呼び出し（将来実装）
 *   2. フォールバック: ユーザープロンプトから先頭テキストを抽出してサニタイズ
 */
export class TitleGeneratorService {
    /**
     * ユーザーのプロンプトから短いタイトルを生成する
     * @param prompt ユーザーのプロンプト
     * @param cdpService オプションのCdpServiceインスタンス
     */
    async generateTitle(prompt: string, cdpService?: CdpService): Promise<string> {
        // CDP経由でAntigravityのLLMを利用する試み
        if (cdpService) {
            try {
                const title = await this.generateViaCdp(prompt, cdpService);
                if (title) return title;
            } catch {
                // フォールバックへ
            }
        }

        // フォールバック: テキスト抽出
        return this.extractTitleFromText(prompt);
    }

    /**
     * CDP経由でAntigravity内のLLM APIを呼び出してタイトルを生成する
     */
    private async generateViaCdp(prompt: string, cdpService: CdpService): Promise<string | null> {
        try {
            const contextId = cdpService.getPrimaryContextId();
            const cleanPrompt = this.stripWorkspacePrefix(prompt);

            const callParams: Record<string, unknown> = {
                expression: `${GENERATE_TITLE_SCRIPT}(${JSON.stringify(cleanPrompt)})`,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await cdpService.call('Runtime.evaluate', callParams);
            const value = result?.result?.value;

            if (value?.ok && value?.title) {
                return this.sanitizeForChannelName(value.title);
            }
        } catch {
            // フォールバックへ
        }

        return null;
    }

    /**
     * プロンプトのテキストからタイトルを抽出する（フォールバック）
     */
    private extractTitleFromText(prompt: string): string {
        const cleanPrompt = this.stripWorkspacePrefix(prompt);
        const truncated = cleanPrompt.substring(0, 40).trim();
        return this.sanitizeForChannelName(truncated) || 'untitled';
    }

    /**
     * ワークスペースプレフィックスを除去する
     */
    private stripWorkspacePrefix(prompt: string): string {
        return prompt.replace(/^\[ワークスペース:.*?\]\n?/, '');
    }

    /**
     * テキストをDiscordチャンネル名に適した形式にサニタイズする
     */
    public sanitizeForChannelName(text: string): string {
        const sanitized = text
            .toLowerCase()
            .replace(/\s+/g, '-')
            // Discordチャンネル名で許可: 英数字、ハイフン、アンダースコア、日本語文字
            .replace(/[^a-z0-9\-_\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 80);

        return sanitized || 'untitled';
    }
}
