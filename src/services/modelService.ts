import { t } from "../utils/i18n";

/**
 * Available LLM models
 * Aligned with models selectable in the Antigravity (Cursor fork) UI
 * Note: Models may change with Antigravity version updates
 */
export const AVAILABLE_MODELS = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash-thinking-exp',
    'gemini-2.0-pro-exp-02-05',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'claude-3-5-sonnet-20241022',
    'claude-3.5-sonnet',
    'gpt-4o',
    'o3-mini'
] as const;

/** Default LLM model */
export const DEFAULT_MODEL: Model = 'gemini-2.5-pro';

/** Model type definition */
export type Model = typeof AVAILABLE_MODELS[number];

/** Model set result type definition */
export interface ModelSetResult {
    success: boolean;
    model?: Model;
    error?: string;
}

/**
 * Service class for managing LLM models.
 * Handles model switching via the /model command.
 */
export class ModelService {
    private currentModel: Model = DEFAULT_MODEL;

    /**
     * Get the current LLM model
     */
    public getCurrentModel(): Model {
        return this.currentModel;
    }

    /**
     * Switch LLM model
     * @param modelName Model name to set (case-insensitive)
     */
    public setModel(modelName: string): ModelSetResult {
        if (!modelName || modelName.trim() === '') {
            return {
                success: false,
                error: t('⚠️ Model name not specified. Available models: ') + AVAILABLE_MODELS.join(', '),
            };
        }

        const normalized = modelName.trim().toLowerCase() as Model;

        if (!AVAILABLE_MODELS.includes(normalized)) {
            return {
                success: false,
                error: t(`⚠️ Invalid model "${modelName}". Available models: ${AVAILABLE_MODELS.join(', ')}`),
            };
        }

        this.currentModel = normalized;
        return {
            success: true,
            model: this.currentModel,
        };
    }

    /**
     * Get the list of available models
     */
    public getAvailableModels(): readonly string[] {
        return AVAILABLE_MODELS;
    }
}
