/**
 * 利用可能な実行モード一覧
 * code: コードの生成・修正
 * architect: 設計・アーキテクチャの提案
 * ask: 質問・調査モード
 */
export const AVAILABLE_MODES = ['code', 'architect', 'ask'] as const;

/** デフォルトの実行モード */
export const DEFAULT_MODE: Mode = 'code';

/** モードの型定義 */
export type Mode = typeof AVAILABLE_MODES[number];

/** モード設定結果の型定義 */
export interface ModeSetResult {
    success: boolean;
    mode?: Mode;
    error?: string;
}

/**
 * 実行モードを管理するサービスクラス。
 * /mode コマンドによるモード切り替えを担う。
 */
export class ModeService {
    private currentMode: Mode = DEFAULT_MODE;

    /**
     * 現在の実行モードを取得する
     */
    public getCurrentMode(): Mode {
        return this.currentMode;
    }

    /**
     * 実行モードを切り替える
     * @param modeName 設定するモード名（大文字小文字は区別しない）
     */
    public setMode(modeName: string): ModeSetResult {
        if (!modeName || modeName.trim() === '') {
            return {
                success: false,
                error: '⚠️ モード名が指定されていません。利用可能なモード: ' + AVAILABLE_MODES.join(', '),
            };
        }

        const normalized = modeName.trim().toLowerCase() as Mode;

        if (!AVAILABLE_MODES.includes(normalized)) {
            return {
                success: false,
                error: `⚠️ 無効なモード "${modeName}" です。利用可能なモード: ${AVAILABLE_MODES.join(', ')}`,
            };
        }

        this.currentMode = normalized;
        return {
            success: true,
            mode: this.currentMode,
        };
    }

    /**
     * 利用可能なモード一覧を取得する
     */
    public getAvailableModes(): readonly string[] {
        return AVAILABLE_MODES;
    }
}
