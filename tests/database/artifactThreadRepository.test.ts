import Database from 'better-sqlite3';
import { ArtifactThreadRepository } from '../../src/database/artifactThreadRepository';

describe('ArtifactThreadRepository', () => {
    let db: Database.Database;
    let repo: ArtifactThreadRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        repo = new ArtifactThreadRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    describe('table initialization', () => {
        it('creates the artifact_threads table on initialization with proper columns', () => {
            const columns = db.prepare('PRAGMA table_info(artifact_threads)').all() as any[];
            expect(columns).toHaveLength(4);
            expect(columns.find(c => c.name === 'channel_id')).toBeDefined();
            expect(columns.find(c => c.name === 'conversation_id')).toBeDefined();
            expect(columns.find(c => c.name === 'filename')).toBeDefined();
            expect(columns.find(c => c.name === 'thread_id')).toBeDefined();
            
            // Check primary key (cid = 1, 2, 3 indicates part of pk)
            const pkColumns = columns.filter(c => c.pk > 0);
            expect(pkColumns).toHaveLength(3);
        });
    });

    describe('CRUD operations', () => {
        it('can set and get a thread ID', () => {
            repo.setThreadId('ch-1', 'conv-1', 'test.md', 'thread-1');
            expect(repo.getThreadId('ch-1', 'conv-1', 'test.md')).toBe('thread-1');
        });

        it('returns null for non-existent thread', () => {
            expect(repo.getThreadId('ch-1', 'conv-1', 'test.md')).toBeNull();
        });

        it('replaces existing thread ID when set again', () => {
            repo.setThreadId('ch-1', 'conv-1', 'test.md', 'thread-1');
            repo.setThreadId('ch-1', 'conv-1', 'test.md', 'thread-2');
            expect(repo.getThreadId('ch-1', 'conv-1', 'test.md')).toBe('thread-2');
        });

        it('can delete a thread ID', () => {
            repo.setThreadId('ch-1', 'conv-1', 'test.md', 'thread-1');
            repo.deleteThreadId('ch-1', 'conv-1', 'test.md');
            expect(repo.getThreadId('ch-1', 'conv-1', 'test.md')).toBeNull();
        });

        it('distinguishes between conversations in the same channel for the same filename', () => {
            repo.setThreadId('ch-1', 'conv-1', 'test.md', 'thread-1');
            repo.setThreadId('ch-1', 'conv-2', 'test.md', 'thread-2');
            
            expect(repo.getThreadId('ch-1', 'conv-1', 'test.md')).toBe('thread-1');
            expect(repo.getThreadId('ch-1', 'conv-2', 'test.md')).toBe('thread-2');
        });
    });
});
