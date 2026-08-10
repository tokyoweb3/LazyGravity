import { SlashCommandHandler } from '../../src/commands/slashCommandHandler';

/**
 * Mock type definition for TemplateRepository
 */
const mockTemplateRepo = {
    findAll: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    deleteByName: jest.fn(),
    updateByName: jest.fn(),
    exportTemplates: jest.fn(),
    importTemplates: jest.fn(),
};

describe('SlashCommandHandler', () => {
    let handler: SlashCommandHandler;

    beforeEach(() => {
        jest.clearAllMocks();
        handler = new SlashCommandHandler(mockTemplateRepo as any);
    });

    describe('handleCommand - command routing', () => {
        it('returns an error result for an unknown command name', async () => {
            const result = await handler.handleCommand('unknown', []);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Unknown command');
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

        it('exports templates via the export subcommand', async () => {
            mockTemplateRepo.findAll.mockReturnValue([{ id: 1, name: 't1', prompt: 'p1' }]);
            mockTemplateRepo.exportTemplates.mockReturnValue('{"version":1,"templates":[{"name":"t1","prompt":"p1"}]}');

            const result = await handler.handleCommand('template', ['export']);
            expect(result.success).toBe(true);
            expect(result.prompt).toContain('"t1"');
        });

        it('handles export subcommand when no templates exist', async () => {
            mockTemplateRepo.findAll.mockReturnValue([]);
            const result = await handler.handleCommand('template', ['export']);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No templates registered');
        });

        it('imports templates via the import subcommand', async () => {
            mockTemplateRepo.importTemplates.mockReturnValue({ imported: 1, updated: 0, skipped: 0, total: 1 });
            const jsonText = '{"version":1,"templates":[{"name":"t1","prompt":"p1"}]}';

            const result = await handler.handleCommand('template', ['import', jsonText, 'skip']);
            expect(result.success).toBe(true);
            expect(mockTemplateRepo.importTemplates).toHaveBeenCalledWith(jsonText, 'skip');
            expect(result.message).toContain('Imported 1');
        });

        it('returns error when import subcommand fails', async () => {
            mockTemplateRepo.importTemplates.mockImplementation(() => {
                throw new Error('Invalid format');
            });

            const result = await handler.handleCommand('template', ['import', 'bad json']);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Failed to import templates: Invalid format');
        });

        it('rejects old plural alias "templates"', async () => {
            const result = await handler.handleCommand('templates', []);
            expect(result.success).toBe(false);
            expect(result.message).toContain('Unknown command');
        });
    });
});

