import {
    SlashCommandHandler,
    CommandResult,
} from '../../src/commands/slashCommandHandler';
import { ModeService } from '../../src/services/modeService';
import { ModelService } from '../../src/services/modelService';

/**
 * TemplateRepositoryのモック型定義
 */
const mockTemplateRepo = {
    findAll: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    deleteByName: jest.fn(),
    updateByName: jest.fn(),
};

describe('SlashCommandHandler', () => {
    let handler: SlashCommandHandler;
    let modeService: ModeService;
    let modelService: ModelService;

    beforeEach(() => {
        modeService = new ModeService();
        modelService = new ModelService();
        jest.clearAllMocks();
        handler = new SlashCommandHandler(modeService, modelService, mockTemplateRepo as any);
    });

    describe('handleCommand - コマンドのルーティング', () => {
        it('未知のコマンド名に対してエラー結果を返すこと', async () => {
            const result = await handler.handleCommand('unknown', []);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Unknown command');
        });
    });

    describe('/mode コマンド', () => {
        it('引数なしで現在のモードを表示すること', async () => {
            const result = await handler.handleCommand('mode', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('fast');
        });

        it('有効なモード名で切り替えが成功すること', async () => {
            const result = await handler.handleCommand('mode', ['plan']);
            expect(result.success).toBe(true);
            expect(result.message).toContain('plan');
        });

        it('無効なモード名でエラーを返すこと', async () => {
            const result = await handler.handleCommand('mode', ['invalid']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid mode');
        });
    });

    // NOTE: /model コマンドは index.ts で直接CDP経由で処理されるため、
    // SlashCommandHandler のテストではルーティングのみ確認する
    describe('/model コマンド（ルーティング確認）', () => {
        it('model コマンドがルーティングされること', async () => {
            const result = await handler.handleCommand('model', []);
            // handleModelsCommand は CDP依存のため stub 返却
            expect(result).toBeDefined();
        });

        it('後方互換: models でもルーティングされること', async () => {
            const result = await handler.handleCommand('models', []);
            expect(result).toBeDefined();
        });
    });

    describe('/template コマンド', () => {
        it('引数なしで登録済みテンプレート一覧を表示すること', async () => {
            mockTemplateRepo.findAll.mockReturnValue([
                { id: 1, name: 'PR作成', prompt: 'PRを作成して' },
                { id: 2, name: 'エラー調査', prompt: 'エラーを調査して' },
            ]);
            const result = await handler.handleCommand('template', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('PR作成');
            expect(result.message).toContain('エラー調査');
        });

        it('テンプレートが無い場合は空メッセージを返すこと', async () => {
            mockTemplateRepo.findAll.mockReturnValue([]);
            const result = await handler.handleCommand('template', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No templates registered');
        });

        it('テンプレート名を指定するとそのプロンプトを返すこと', async () => {
            mockTemplateRepo.findByName.mockReturnValue({
                id: 1,
                name: 'PR作成',
                prompt: 'PRを作成してください。',
            });
            const result = await handler.handleCommand('template', ['PR作成']);
            expect(result.success).toBe(true);
            expect(result.prompt).toBe('PRを作成してください。');
        });

        it('存在しないテンプレート名にはエラーを返すこと', async () => {
            mockTemplateRepo.findByName.mockReturnValue(undefined);
            const result = await handler.handleCommand('template', ['存在しない']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        it('add サブコマンドでテンプレートを登録できること', async () => {
            mockTemplateRepo.create.mockReturnValue({
                id: 1,
                name: 'テスト実行',
                prompt: 'テストを実行して',
            });
            const result = await handler.handleCommand('template', ['add', 'テスト実行', 'テストを実行して']);
            expect(result.success).toBe(true);
            expect(mockTemplateRepo.create).toHaveBeenCalledWith({
                name: 'テスト実行',
                prompt: 'テストを実行して',
            });
        });

        it('add サブコマンドで引数不足の場合エラーを返すこと', async () => {
            const result = await handler.handleCommand('template', ['add']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Missing arguments');
        });

        it('delete サブコマンドでテンプレートを削除できること', async () => {
            mockTemplateRepo.deleteByName.mockReturnValue(true);
            const result = await handler.handleCommand('template', ['delete', 'テスト実行']);
            expect(result.success).toBe(true);
            expect(mockTemplateRepo.deleteByName).toHaveBeenCalledWith('テスト実行');
        });

        it('delete サブコマンドで存在しないテンプレートはエラーを返すこと', async () => {
            mockTemplateRepo.deleteByName.mockReturnValue(false);
            const result = await handler.handleCommand('template', ['delete', '存在しない']);
            expect(result.success).toBe(false);
        });

        it('後方互換: templates でも動作すること', async () => {
            mockTemplateRepo.findAll.mockReturnValue([]);
            const result = await handler.handleCommand('templates', []);
            expect(result.success).toBe(true);
        });
    });
});
