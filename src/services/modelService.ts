/**
 * 利用可能なLLMモデル一覧
 * Antigravity（Cursor Fork）のUIで選択可能なモデルに準拠
 * 注意: Antigravityのバージョンアップに伴いモデルは変更される可能性があります
 */
export const AVAILABLE_MODELS = [
    'claude-3.5-sonnet',
    'claude-3.5-haiku',
    'cursor-small',
    'gpt-4o',
    'gpt-4o-mini',
    'o1-mini',
    'o1-preview',
    'o3-mini',
    'claude-3-opus',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gpt-4.1',
    'gpt-4.1-mini',
    'deepseek-r1',
    'deepseek-v3',
] as const;

/** デフォルトのLLMモデル */
export const DEFAULT_MODEL: Model = 'claude-3.5-sonnet';

/** モデルの型定義 */
export type Model = typeof AVAILABLE_MODELS[number];

/** モデル設定結果の型定義 */
export interface ModelSetResult {
    success: boolean;
    model?: Model;
    error?: string;
}

/**
 * LLMモデルを管理するサービスクラス。
 * /models コマンドによるモデル切り替えを担う。
 */
export class ModelService {
    private currentModel: Model = DEFAULT_MODEL;

    /**
     * 現在のLLMモデルを取得する
     */
    public getCurrentModel(): Model {
        return this.currentModel;
    }

    /**
     * LLMモデルを切り替える
     * @param modelName 設定するモデル名（大文字小文字は区別しない）
     */
    public setModel(modelName: string): ModelSetResult {
        if (!modelName || modelName.trim() === '') {
            return {
                success: false,
                error: '⚠️ モデル名が指定されていません。利用可能なモデル: ' + AVAILABLE_MODELS.join(', '),
            };
        }

        const normalized = modelName.trim().toLowerCase() as Model;

        if (!AVAILABLE_MODELS.includes(normalized)) {
            return {
                success: false,
                error: `⚠️ 無効なモデル "${modelName}" です。利用可能なモデル: ${AVAILABLE_MODELS.join(', ')}`,
            };
        }

        this.currentModel = normalized;
        return {
            success: true,
            model: this.currentModel,
        };
    }

    /**
     * 利用可能なモデル一覧を取得する
     */
    public getAvailableModels(): readonly string[] {
        return AVAILABLE_MODELS;
    }
}
