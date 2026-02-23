import { t } from "../utils/i18n";

/**
 * 利用可能な実行モード一覧
 * fast: 高速応答モード（シンプルなタスク向け）
 * plan: 計画モード（複雑なタスクを段階的に実行）
 */
export const AVAILABLE_MODES = ['fast', 'plan'] as const;

/** モードの表示名マッピング */
export const MODE_DISPLAY_NAMES: Record<string, string> = {
    fast: '⚡ Fast',
    plan: '📋 Plan',
};

/** モードの説明文マッピング */
export const MODE_DESCRIPTIONS: Record<string, string> = {
    fast: t('Fast Mode — for simple tasks'),
    plan: t('Plan Mode — for complex step-by-step tasks'),
};

/** Antigravity UIでの表示名マッピング（内部名 → UI表示名） */
export const MODE_UI_NAMES: Record<string, string> = {
    fast: 'Fast',
    plan: 'Planning',
};

/** UI表示名 → 内部名の逆引きマッピング */
export const MODE_UI_NAME_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(MODE_UI_NAMES).map(([k, v]) => [v.toLowerCase(), k])
);

/** デフォルトの実行モード */
export const DEFAULT_MODE: Mode = 'fast';

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
                error: t('⚠️ Mode name not specified. Available modes: ') + AVAILABLE_MODES.join(', '),
            };
        }

        const normalized = modeName.trim().toLowerCase() as Mode;

        if (!AVAILABLE_MODES.includes(normalized)) {
            return {
                success: false,
                error: t(`⚠️ Invalid mode "${modeName}". Available modes: ${AVAILABLE_MODES.join(', ')}`),
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
