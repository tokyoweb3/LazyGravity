import {
    SlashCommandHandler,
    CommandResult,
} from '../../src/commands/slashCommandHandler';
import { ModeService } from '../../src/services/modeService';
import { ModelService } from '../../src/services/modelService';

/**
 * Mock type definition for TemplateRepository
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

    describe('handleCommand - command routing', () => {
        it('returns an error result for an unknown command name', async () => {
            const result = await handler.handleCommand('unknown', []);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Unknown command');
        });
    });

    describe('/mode command', () => {
        it('displays the current mode when called without arguments', async () => {
            const result = await handler.handleCommand('mode', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('fast');
        });

        it('successfully switches mode with a valid mode name', async () => {
            const result = await handler.handleCommand('mode', ['plan']);
            expect(result.success).toBe(true);
            expect(result.message).toContain('plan');
        });

        it('returns an error for an invalid mode name', async () => {
            const result = await handler.handleCommand('mode', ['invalid']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid mode');
        });
    });

    // NOTE: The /model command is handled directly via CDP in index.ts,
    // so in the SlashCommandHandler tests we only verify routing
    describe('/model command (routing verification)', () => {
        it('routes the model command', async () => {
            const result = await handler.handleCommand('model', []);
            // handleModelsCommand returns a stub since it depends on CDP
            expect(result).toBeDefined();
        });

        it('backward compatibility: also routes via "models"', async () => {
            const result = await handler.handleCommand('models', []);
            expect(result).toBeDefined();
        });
    });

    describe('/template command', () => {
        it('displays the registered template list when called without arguments', async () => {
            mockTemplateRepo.findAll.mockReturnValue([
                { id: 1, name: 'PR作成', prompt: 'PRを作成して' },
                { id: 2, name: 'エラー調査', prompt: 'エラーを調査して' },
            ]);
            const result = await handler.handleCommand('template', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('PR作成');
            expect(result.message).toContain('エラー調査');
        });

        it('returns an empty message when there are no templates', async () => {
            mockTemplateRepo.findAll.mockReturnValue([]);
            const result = await handler.handleCommand('template', []);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No templates registered');
        });

        it('returns the prompt when a template name is specified', async () => {
            mockTemplateRepo.findByName.mockReturnValue({
                id: 1,
                name: 'PR作成',
                prompt: 'PRを作成してください。',
            });
            const result = await handler.handleCommand('template', ['PR作成']);
            expect(result.success).toBe(true);
            expect(result.prompt).toBe('PRを作成してください。');
        });

        it('returns an error for a non-existent template name', async () => {
            mockTemplateRepo.findByName.mockReturnValue(undefined);
            const result = await handler.handleCommand('template', ['存在しない']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        it('registers a template via the add subcommand', async () => {
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

        it('returns an error when the add subcommand has insufficient arguments', async () => {
            const result = await handler.handleCommand('template', ['add']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Missing arguments');
        });

        it('deletes a template via the delete subcommand', async () => {
            mockTemplateRepo.deleteByName.mockReturnValue(true);
            const result = await handler.handleCommand('template', ['delete', 'テスト実行']);
            expect(result.success).toBe(true);
            expect(mockTemplateRepo.deleteByName).toHaveBeenCalledWith('テスト実行');
        });

        it('returns an error when deleting a non-existent template via the delete subcommand', async () => {
            mockTemplateRepo.deleteByName.mockReturnValue(false);
            const result = await handler.handleCommand('template', ['delete', '存在しない']);
            expect(result.success).toBe(false);
        });

        it('backward compatibility: also works via "templates"', async () => {
            mockTemplateRepo.findAll.mockReturnValue([]);
            const result = await handler.handleCommand('templates', []);
            expect(result.success).toBe(true);
        });
    });
});
