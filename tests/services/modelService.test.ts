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
            const result = modelService.setModel('claude-sonnet-4.6-thinking');
            expect(result.success).toBe(true);
            expect(result.model).toBe('claude-sonnet-4.6-thinking');
            expect(modelService.getCurrentModel()).toBe('claude-sonnet-4.6-thinking');
        });

        it('retains the last set model after multiple switches', () => {
            modelService.setModel('claude-sonnet-4.6-thinking');
            modelService.setModel('gemini-3.1-pro-high');
            expect(modelService.getCurrentModel()).toBe('gemini-3.1-pro-high');
        });

        it('returns an error and does not change the model for an invalid model name', () => {
            const result = modelService.setModel('invalid_model');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(modelService.getCurrentModel()).toBe(DEFAULT_MODEL);
        });

        it('sets the model case-insensitively', () => {
            const result = modelService.setModel('GEMINI-3-FLASH');
            expect(result.success).toBe(true);
            expect(result.model).toBe('gemini-3-flash');
        });

        it('returns an error when an empty string is specified', () => {
            const result = modelService.setModel('');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('can set the claude-opus-4.6-thinking model', () => {
            const result = modelService.setModel('claude-opus-4.6-thinking');
            expect(result.success).toBe(true);
            expect(result.model).toBe('claude-opus-4.6-thinking');
        });

        it('can set the gpt-oss-120b-medium model', () => {
            const result = modelService.setModel('gpt-oss-120b-medium');
            expect(result.success).toBe(true);
            expect(result.model).toBe('gpt-oss-120b-medium');
        });
    });

    describe('getAvailableModels - get available model list', () => {
        it('returns the list of available models', () => {
            const models = modelService.getAvailableModels();
            expect(models).toEqual(AVAILABLE_MODELS);
            expect(models.length).toBeGreaterThan(0);
        });

        it('includes claude-sonnet-4.6-thinking, gpt-oss-120b-medium, and gemini-3.1-pro-high in the list', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('claude-sonnet-4.6-thinking');
            expect(models).toContain('gpt-oss-120b-medium');
            expect(models).toContain('gemini-3.1-pro-high');
        });

        it('includes claude-opus-4.6-thinking and gemini-3-flash in the list', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('claude-opus-4.6-thinking');
            expect(models).toContain('gemini-3-flash');
        });
    });
});
