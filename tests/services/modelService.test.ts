import { ModelService, AVAILABLE_MODELS, DEFAULT_MODEL } from '../../src/services/modelService';

describe('ModelService', () => {
    let modelService: ModelService;

    beforeEach(() => {
        modelService = new ModelService();
    });

    describe('getCurrentModel - get current model', () => {
        it('returns the default model in the initial state', () => {
            expect(modelService.getCurrentModel()).toBe(DEFAULT_MODEL);
        });
    });

    describe('setModel - switch model', () => {
        it('switches the model when a valid model name is specified', () => {
            const result = modelService.setModel('claude-3.5-sonnet');
            expect(result.success).toBe(true);
            expect(result.model).toBe('claude-3.5-sonnet');
            expect(modelService.getCurrentModel()).toBe('claude-3.5-sonnet');
        });

        it('retains the last set model after multiple switches', () => {
            modelService.setModel('claude-3.5-sonnet');
            modelService.setModel('gemini-2.5-pro');
            expect(modelService.getCurrentModel()).toBe('gemini-2.5-pro');
        });

        it('returns an error and does not change the model for an invalid model name', () => {
            const result = modelService.setModel('invalid_model');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(modelService.getCurrentModel()).toBe(DEFAULT_MODEL);
        });

        it('sets the model case-insensitively', () => {
            const result = modelService.setModel('GPT-4O');
            expect(result.success).toBe(true);
            expect(result.model).toBe('gpt-4o');
        });

        it('returns an error when an empty string is specified', () => {
            const result = modelService.setModel('');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('can set the o3-mini model', () => {
            const result = modelService.setModel('o3-mini');
            expect(result.success).toBe(true);
            expect(result.model).toBe('o3-mini');
        });

        it('can set the gemini-2.5-flash model', () => {
            const result = modelService.setModel('gemini-2.5-flash');
            expect(result.success).toBe(true);
            expect(result.model).toBe('gemini-2.5-flash');
        });
    });

    describe('getAvailableModels - get available model list', () => {
        it('returns the list of available models', () => {
            const models = modelService.getAvailableModels();
            expect(models).toEqual(AVAILABLE_MODELS);
            expect(models.length).toBeGreaterThan(0);
        });

        it('includes claude-3.5-sonnet, gpt-4o, and gemini-2.5-pro in the list', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('claude-3.5-sonnet');
            expect(models).toContain('gpt-4o');
            expect(models).toContain('gemini-2.5-pro');
        });

        it('includes o3-mini and gemini-2.5-flash in the list', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('o3-mini');
            expect(models).toContain('gemini-2.5-flash');
        });
    });
});
