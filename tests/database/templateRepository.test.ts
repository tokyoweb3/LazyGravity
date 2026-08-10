import Database from 'better-sqlite3';
import { TemplateRepository, TemplateRecord } from '../../src/database/templateRepository';

describe('TemplateRepository', () => {
    let db: Database.Database;
    let repo: TemplateRepository;

    beforeEach(() => {
        // Run tests with in-memory DB
        db = new Database(':memory:');
        repo = new TemplateRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the templates table on initialization', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='templates'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - save template', () => {
        it('saves the template name and prompt, and returns the ID', () => {
            const result = repo.create({
                name: 'PR作成',
                prompt: 'PRを作成してください。変更点をまとめてください。',
            });
            expect(result.id).toBeDefined();
            expect(result.name).toBe('PR作成');
            expect(result.prompt).toBe('PRを作成してください。変更点をまとめてください。');
        });

        it('can save multiple templates', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            repo.create({ name: 'エラー調査', prompt: 'エラーを調査して' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });

        it('cannot save duplicate templates with the same name', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            expect(() => {
                repo.create({ name: 'PR作成', prompt: '別のプロンプト' });
            }).toThrow();
        });
    });

    describe('findAll - retrieve all templates', () => {
        it('retrieves all saved templates', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            repo.create({ name: 'エラー調査', prompt: 'エラーを調査して' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
            expect(all[0].name).toBe('PR作成');
            expect(all[1].name).toBe('エラー調査');
        });

        it('returns an empty array when there are no templates', () => {
            const all = repo.findAll();
            expect(all).toEqual([]);
        });
    });

    describe('findByName - retrieve template by name', () => {
        it('retrieves the template with the specified name', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const found = repo.findByName('PR作成');
            expect(found).toBeDefined();
            expect(found?.name).toBe('PR作成');
        });

        it('returns undefined for a non-existent name', () => {
            const found = repo.findByName('存在しないテンプレート');
            expect(found).toBeUndefined();
        });
    });

    describe('delete - delete template', () => {
        it('deletes the template with the specified name', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const deleted = repo.deleteByName('PR作成');
            expect(deleted).toBe(true);
            expect(repo.findByName('PR作成')).toBeUndefined();
        });

        it('returns false when deleting a non-existent name', () => {
            const deleted = repo.deleteByName('存在しない');
            expect(deleted).toBe(false);
        });
    });

    describe('update - update template', () => {
        it('can update the prompt', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const updated = repo.updateByName('PR作成', { prompt: '新しいPR作成プロンプト' });
            expect(updated).toBe(true);
            const found = repo.findByName('PR作成');
            expect(found?.prompt).toBe('新しいPR作成プロンプト');
        });

        it('returns false when updating a non-existent name', () => {
            const updated = repo.updateByName('存在しない', { prompt: '新しいプロンプト' });
            expect(updated).toBe(false);
        });
    });

    describe('exportTemplates - export templates to JSON', () => {
        it('exports all templates as a formatted JSON string', () => {
            repo.create({ name: 'code-review', prompt: 'Review code' });
            repo.create({ name: 'bug-fix', prompt: 'Fix bug' });

            const jsonStr = repo.exportTemplates();
            const parsed = JSON.parse(jsonStr);

            expect(parsed.version).toBe(1);
            expect(parsed.templates).toHaveLength(2);
            expect(parsed.templates).toEqual([
                { name: 'code-review', prompt: 'Review code' },
                { name: 'bug-fix', prompt: 'Fix bug' },
            ]);
        });

        it('exports empty templates list when repository is empty', () => {
            const jsonStr = repo.exportTemplates();
            const parsed = JSON.parse(jsonStr);

            expect(parsed.version).toBe(1);
            expect(parsed.templates).toEqual([]);
        });
    });

    describe('importTemplates - import templates from JSON', () => {
        it('imports new templates successfully with skip mode (default)', () => {
            const payload = JSON.stringify({
                version: 1,
                templates: [
                    { name: 't1', prompt: 'Prompt 1' },
                    { name: 't2', prompt: 'Prompt 2' },
                ],
            });

            const result = repo.importTemplates(payload);
            expect(result).toEqual({
                imported: 2,
                updated: 0,
                skipped: 0,
                total: 2,
            });

            expect(repo.findAll()).toHaveLength(2);
            expect(repo.findByName('t1')?.prompt).toBe('Prompt 1');
        });

        it('skips duplicate template names in skip mode', () => {
            repo.create({ name: 't1', prompt: 'Original Prompt' });

            const payload = {
                version: 1,
                templates: [
                    { name: 't1', prompt: 'New Prompt' },
                    { name: 't2', prompt: 'Prompt 2' },
                ],
            };

            const result = repo.importTemplates(payload, 'skip');
            expect(result).toEqual({
                imported: 1,
                updated: 0,
                skipped: 1,
                total: 2,
            });

            expect(repo.findByName('t1')?.prompt).toBe('Original Prompt');
            expect(repo.findByName('t2')?.prompt).toBe('Prompt 2');
        });

        it('overwrites existing templates in overwrite mode', () => {
            repo.create({ name: 't1', prompt: 'Original Prompt' });

            const payload = {
                version: 1,
                templates: [
                    { name: 't1', prompt: 'Updated Prompt' },
                    { name: 't2', prompt: 'Prompt 2' },
                ],
            };

            const result = repo.importTemplates(payload, 'overwrite');
            expect(result).toEqual({
                imported: 1,
                updated: 1,
                skipped: 0,
                total: 2,
            });

            expect(repo.findByName('t1')?.prompt).toBe('Updated Prompt');
            expect(repo.findByName('t2')?.prompt).toBe('Prompt 2');
        });

        it('throws an error for invalid JSON string', () => {
            expect(() => {
                repo.importTemplates('invalid json');
            }).toThrow('Invalid JSON format');
        });

        it('throws an error for missing templates array', () => {
            expect(() => {
                repo.importTemplates(JSON.stringify({ version: 1 }));
            }).toThrow('missing "templates" array');
        });

        it('throws an error for invalid template item schema', () => {
            expect(() => {
                repo.importTemplates({
                    version: 1,
                    templates: [{ name: '', prompt: 'valid' }],
                });
            }).toThrow('"name" must be a non-empty string');

            expect(() => {
                repo.importTemplates({
                    version: 1,
                    templates: [{ name: 'valid', prompt: 123 as any }],
                });
            }).toThrow('"prompt" must be a string');
        });
    });
});

