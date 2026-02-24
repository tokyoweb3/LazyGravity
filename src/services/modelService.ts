import { t } from "../utils/i18n";

/**
 * Available LLM models
 * Aligned with models selectable in the Antigravity (Cursor fork) UI
 * Note: Models may change with Antigravity version updates
 */
export const AVAILABLE_MODELS = [
    'gemini-3.1-pro-high',
    'gemini-3.1-pro-low',
    'gemini-3-flash',
    'claude-sonnet-4.6-thinking',
    'claude-opus-4.6-thinking',
    'gpt-oss-120b-medium'
] as const;

/** Default LLM model */
export const DEFAULT_MODEL: Model = 'gemini-3-flash';

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
