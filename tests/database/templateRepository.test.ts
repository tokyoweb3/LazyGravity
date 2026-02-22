import Database from 'better-sqlite3';
import { TemplateRepository, TemplateRecord } from '../../src/database/templateRepository';

describe('TemplateRepository', () => {
    let db: Database.Database;
    let repo: TemplateRepository;

    beforeEach(() => {
        // インメモリDBでテスト実行
        db = new Database(':memory:');
        repo = new TemplateRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('テーブル初期化', () => {
        it('初期化時にtemplatesテーブルが作成されること', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='templates'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('create - テンプレートの保存', () => {
        it('テンプレート名とプロンプトを保存し、IDを返すこと', () => {
            const result = repo.create({
                name: 'PR作成',
                prompt: 'PRを作成してください。変更点をまとめてください。',
            });
            expect(result.id).toBeDefined();
            expect(result.name).toBe('PR作成');
            expect(result.prompt).toBe('PRを作成してください。変更点をまとめてください。');
        });

        it('複数のテンプレートを保存できること', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            repo.create({ name: 'エラー調査', prompt: 'エラーを調査して' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
        });

        it('同名のテンプレートは重複して保存できないこと', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            expect(() => {
                repo.create({ name: 'PR作成', prompt: '別のプロンプト' });
            }).toThrow();
        });
    });

    describe('findAll - 全テンプレートの取得', () => {
        it('保存された全テンプレートを取得できること', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            repo.create({ name: 'エラー調査', prompt: 'エラーを調査して' });
            const all = repo.findAll();
            expect(all).toHaveLength(2);
            expect(all[0].name).toBe('PR作成');
            expect(all[1].name).toBe('エラー調査');
        });

        it('テンプレートが無い場合は空配列を返すこと', () => {
            const all = repo.findAll();
            expect(all).toEqual([]);
        });
    });

    describe('findByName - 名前によるテンプレート取得', () => {
        it('指定した名前のテンプレートを取得できること', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const found = repo.findByName('PR作成');
            expect(found).toBeDefined();
            expect(found?.name).toBe('PR作成');
        });

        it('存在しない名前の場合はundefinedを返すこと', () => {
            const found = repo.findByName('存在しないテンプレート');
            expect(found).toBeUndefined();
        });
    });

    describe('delete - テンプレートの削除', () => {
        it('指定した名前のテンプレートを削除できること', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const deleted = repo.deleteByName('PR作成');
            expect(deleted).toBe(true);
            expect(repo.findByName('PR作成')).toBeUndefined();
        });

        it('存在しない名前の削除はfalseを返すこと', () => {
            const deleted = repo.deleteByName('存在しない');
            expect(deleted).toBe(false);
        });
    });

    describe('update - テンプレートの更新', () => {
        it('プロンプトの更新ができること', () => {
            repo.create({ name: 'PR作成', prompt: 'PRを作成して' });
            const updated = repo.updateByName('PR作成', { prompt: '新しいPR作成プロンプト' });
            expect(updated).toBe(true);
            const found = repo.findByName('PR作成');
            expect(found?.prompt).toBe('新しいPR作成プロンプト');
        });

        it('存在しない名前の更新はfalseを返すこと', () => {
            const updated = repo.updateByName('存在しない', { prompt: '新しいプロンプト' });
            expect(updated).toBe(false);
        });
    });
});
