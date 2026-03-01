import Database from 'better-sqlite3';
import { UserPreferenceRepository } from '../../src/database/userPreferenceRepository';

describe('UserPreferenceRepository', () => {
    let db: Database.Database;
    let repo: UserPreferenceRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        repo = new UserPreferenceRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the user_preferences table on initialization', () => {
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'"
            ).all();
            expect(tables).toHaveLength(1);
        });
    });

    describe('getOutputFormat', () => {
        it('returns embed as default for unknown user', () => {
            const format = repo.getOutputFormat('unknown-user-id');
            expect(format).toBe('embed');
        });

        it('returns the stored format', () => {
            repo.setOutputFormat('user-1', 'plain');
            expect(repo.getOutputFormat('user-1')).toBe('plain');
        });

        it('returns embed after setting to embed', () => {
            repo.setOutputFormat('user-1', 'embed');
            expect(repo.getOutputFormat('user-1')).toBe('embed');
        });
    });

    describe('setOutputFormat', () => {
        it('inserts a new preference record', () => {
            repo.setOutputFormat('user-1', 'plain');
            const record = repo.findByUserId('user-1');
            expect(record).toBeDefined();
            expect(record?.outputFormat).toBe('plain');
        });

        it('updates an existing preference via upsert', () => {
            repo.setOutputFormat('user-1', 'plain');
            repo.setOutputFormat('user-1', 'embed');
            expect(repo.getOutputFormat('user-1')).toBe('embed');
        });

        it('handles multiple users independently', () => {
            repo.setOutputFormat('user-1', 'plain');
            repo.setOutputFormat('user-2', 'embed');
            expect(repo.getOutputFormat('user-1')).toBe('plain');
            expect(repo.getOutputFormat('user-2')).toBe('embed');
        });
    });

    describe('findByUserId', () => {
        it('returns undefined for non-existent user', () => {
            const record = repo.findByUserId('no-such-user');
            expect(record).toBeUndefined();
        });

        it('returns full record with mapped fields', () => {
            repo.setOutputFormat('user-1', 'plain');
            const record = repo.findByUserId('user-1');
            expect(record).toBeDefined();
            expect(record?.id).toBeDefined();
            expect(record?.userId).toBe('user-1');
            expect(record?.outputFormat).toBe('plain');
            expect(record?.createdAt).toBeDefined();
            expect(record?.updatedAt).toBeDefined();
        });
    });
});
