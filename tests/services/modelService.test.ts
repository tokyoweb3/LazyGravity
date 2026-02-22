import { ModelService, AVAILABLE_MODELS, DEFAULT_MODEL } from '../../src/services/modelService';

describe('ModelService', () => {
    let modelService: ModelService;

    beforeEach(() => {
        modelService = new ModelService();
    });

    describe('getCurrentModel - 現在のモデルの取得', () => {
        it('初期状態ではデフォルトモデルを返すこと', () => {
            expect(modelService.getCurrentModel()).toBe(DEFAULT_MODEL);
        });
    });

    describe('setModel - モデルの切り替え', () => {
        it('有効なモデル名を指定した場合、モデルが切り替わること', () => {
            const result = modelService.setModel('claude-3-opus');
            expect(result.success).toBe(true);
            expect(result.model).toBe('claude-3-opus');
            expect(modelService.getCurrentModel()).toBe('claude-3-opus');
        });

        it('複数回切り替えても最後に設定したモデルが保持されること', () => {
            modelService.setModel('claude-3-opus');
            modelService.setModel('gemini-2.5-pro');
            expect(modelService.getCurrentModel()).toBe('gemini-2.5-pro');
        });

        it('無効なモデル名を指定した場合、エラーを返しモデルは変更されないこと', () => {
            const result = modelService.setModel('invalid_model');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(modelService.getCurrentModel()).toBe(DEFAULT_MODEL);
        });

        it('大文字小文字を区別せずにモデルを設定できること', () => {
            const result = modelService.setModel('GPT-4O');
            expect(result.success).toBe(true);
            expect(result.model).toBe('gpt-4o');
        });

        it('空文字列を指定した場合、エラーを返すこと', () => {
            const result = modelService.setModel('');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('o3-miniモデルを設定できること', () => {
            const result = modelService.setModel('o3-mini');
            expect(result.success).toBe(true);
            expect(result.model).toBe('o3-mini');
        });

        it('deepseek-r1モデルを設定できること', () => {
            const result = modelService.setModel('deepseek-r1');
            expect(result.success).toBe(true);
            expect(result.model).toBe('deepseek-r1');
        });
    });

    describe('getAvailableModels - 利用可能なモデル一覧の取得', () => {
        it('利用可能なモデルの一覧を返すこと', () => {
            const models = modelService.getAvailableModels();
            expect(models).toEqual(AVAILABLE_MODELS);
            expect(models.length).toBeGreaterThan(0);
        });

        it('一覧にはclaude-3.5-sonnet, gpt-4o, gemini-2.5-proが含まれていること', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('claude-3.5-sonnet');
            expect(models).toContain('gpt-4o');
            expect(models).toContain('gemini-2.5-pro');
        });

        it('一覧にはo3-mini, deepseek-r1が含まれていること', () => {
            const models = modelService.getAvailableModels();
            expect(models).toContain('o3-mini');
            expect(models).toContain('deepseek-r1');
        });
    });
});
