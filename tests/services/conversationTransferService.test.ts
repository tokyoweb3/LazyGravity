import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
    exportConversationBundleByTitle,
    exportConversationBundleByConversationId,
    findLatestTrajectoryEntryByTitle,
    importConversationBundleToProfile,
    parseTrajectorySummariesBase64,
    transferConversationByTitle,
    waitForConversationPersistence,
} from '../../src/services/conversationTransferService';

function encodeVarint(value: number): Buffer {
    const bytes: number[] = [];
    let remaining = value >>> 0;
    while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining >>>= 7;
    }
    bytes.push(remaining);
    return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
    return Buffer.concat([
        encodeVarint((fieldNumber << 3) | 2),
        encodeVarint(payload.length),
        payload,
    ]);
}

function buildTrajectoryEntry(conversationId: string, title: string): Buffer {
    const inner = encodeLengthDelimited(1, Buffer.from(title, 'utf8'));
    const field2Ascii = Buffer.from(inner.toString('base64'), 'utf8');
    const entryPayload = Buffer.concat([
        encodeLengthDelimited(1, Buffer.from(conversationId, 'utf8')),
        encodeLengthDelimited(2, field2Ascii),
    ]);
    return encodeLengthDelimited(1, entryPayload);
}

function buildTrajectoryEntryWithRawInner(conversationId: string, title: string): Buffer {
    const inner = encodeLengthDelimited(1, Buffer.from(title, 'utf8'));
    const entryPayload = Buffer.concat([
        encodeLengthDelimited(1, Buffer.from(conversationId, 'utf8')),
        encodeLengthDelimited(2, inner),
    ]);
    return encodeLengthDelimited(1, entryPayload);
}

function buildTrajectoryEntryWithNestedBase64Title(conversationId: string, title: string): Buffer {
    const nestedInner = encodeLengthDelimited(1, Buffer.from(title, 'utf8'));
    const outerInner = encodeLengthDelimited(1, Buffer.from(nestedInner.toString('base64'), 'utf8'));
    const entryPayload = Buffer.concat([
        encodeLengthDelimited(1, Buffer.from(conversationId, 'utf8')),
        encodeLengthDelimited(2, outerInner),
    ]);
    return encodeLengthDelimited(1, entryPayload);
}

describe('conversationTransferService', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lazy-gravity-transfer-'));
        process.env.LAZY_GRAVITY_TEST_HOME = tempRoot;
    });

    afterEach(() => {
        delete process.env.LAZY_GRAVITY_TEST_HOME;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    function createDb(dbPath: string, trajectoryBase64: string = ''): void {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)');
        if (trajectoryBase64) {
            db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
                'antigravityUnifiedStateSync.trajectorySummaries',
                trajectoryBase64,
            );
        }
        db.close();
    }

    it('exports a bundle with trajectory entry and related files', () => {
        const conversationId = '11111111-2222-3333-4444-555555555555';
        const title = 'Listing DevTools Directory';
        const entry = buildTrajectoryEntry(conversationId, title);
        const trajectoryBase64 = entry.toString('base64');

        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, trajectoryBase64);

        const sharedRoot = path.join(tempRoot, '.gemini', 'antigravity');
        fs.mkdirSync(path.join(sharedRoot, 'conversations'), { recursive: true });
        fs.mkdirSync(path.join(sharedRoot, 'annotations'), { recursive: true });
        fs.mkdirSync(path.join(sharedRoot, 'brain', conversationId), { recursive: true });
        fs.writeFileSync(path.join(sharedRoot, 'conversations', `${conversationId}.pb`), 'conversation');
        fs.writeFileSync(path.join(sharedRoot, 'annotations', `${conversationId}.pbtxt`), 'annotation');
        fs.writeFileSync(path.join(sharedRoot, 'brain', conversationId, 'artifact.txt'), 'artifact');

        const outDir = path.join(tempRoot, 'exports');
        const bundleDir = exportConversationBundleByTitle('default', title, outDir);
        const manifestPath = path.join(bundleDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            conversationId: string;
            title: string;
            trajectoryEntryBase64: string;
            files: { conversationPb?: string; annotationsPbtxt?: string; brainDir?: string };
        };

        expect(manifest.conversationId).toBe(conversationId);
        expect(manifest.title).toBe(title);
        expect(manifest.trajectoryEntryBase64).toBe(entry.toString('base64'));
        expect(fs.existsSync(path.join(bundleDir, manifest.files.conversationPb!))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, manifest.files.annotationsPbtxt!))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, manifest.files.brainDir!, 'artifact.txt'))).toBe(true);
    });

    it('imports a bundle into another profile by appending trajectory entry', () => {
        const conversationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const title = 'Listing DevTools Directory';
        const entry = buildTrajectoryEntry(conversationId, title);
        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, entry.toString('base64'));

        const sharedRoot = path.join(tempRoot, '.gemini', 'antigravity');
        fs.mkdirSync(path.join(sharedRoot, 'conversations'), { recursive: true });
        fs.writeFileSync(path.join(sharedRoot, 'conversations', `${conversationId}.pb`), 'conversation');

        const bundleDir = exportConversationBundleByTitle('default', title, path.join(tempRoot, 'exports'));

        const work3UserDataDir = path.join(tempRoot, '.antigravity_cockpit', 'instances', 'antigravity', 'work3-data');
        fs.mkdirSync(path.dirname(path.join(tempRoot, '.antigravity_cockpit', 'instances.json')), { recursive: true });
        fs.writeFileSync(
            path.join(tempRoot, '.antigravity_cockpit', 'instances.json'),
            JSON.stringify({
                instances: [
                    {
                        name: 'work3',
                        userDataDir: work3UserDataDir,
                    },
                ],
            }),
            'utf8',
        );

        const work3Db = path.join(work3UserDataDir, 'User', 'globalStorage', 'state.vscdb');
        createDb(work3Db, '');

        const result = importConversationBundleToProfile(bundleDir, 'work3');
        expect(result.conversationId).toBe(conversationId);
        expect(fs.existsSync(result.dbBackupPath)).toBe(true);

        const db = new Database(work3Db, { readonly: true });
        const row = db
            .prepare('SELECT value FROM ItemTable WHERE key = ?')
            .get('antigravityUnifiedStateSync.trajectorySummaries') as { value: string };
        db.close();

        const parsed = parseTrajectorySummariesBase64(String(row.value));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].conversationId).toBe(conversationId);
        expect(parsed[0].title).toBe(title);
    });

    it('rejects bundle manifests that escape the bundle directory', () => {
        const bundleDir = path.join(tempRoot, 'exports', 'unsafe-bundle');
        fs.mkdirSync(bundleDir, { recursive: true });
        fs.writeFileSync(
            path.join(bundleDir, 'manifest.json'),
            JSON.stringify({
                conversationId: 'unsafe-conversation',
                title: 'Unsafe Bundle',
                trajectoryEntryBase64: buildTrajectoryEntry('unsafe-conversation', 'Unsafe Bundle').toString('base64'),
                files: {
                    conversationPb: '../../outside.pb',
                },
            }),
            'utf8',
        );

        const work3UserDataDir = path.join(tempRoot, '.antigravity_cockpit', 'instances', 'antigravity', 'work3-data');
        fs.mkdirSync(path.dirname(path.join(tempRoot, '.antigravity_cockpit', 'instances.json')), { recursive: true });
        fs.writeFileSync(
            path.join(tempRoot, '.antigravity_cockpit', 'instances.json'),
            JSON.stringify({
                instances: [
                    {
                        name: 'work3',
                        userDataDir: work3UserDataDir,
                    },
                ],
            }),
            'utf8',
        );
        createDb(path.join(work3UserDataDir, 'User', 'globalStorage', 'state.vscdb'), '');

        expect(() => importConversationBundleToProfile(bundleDir, 'work3')).toThrow(
            'Bundle manifest field "conversationPb" points outside the bundle directory.',
        );
    });

    it('parses trajectory entries whose inner payload is stored as raw protobuf bytes', () => {
        const conversationId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
        const title = 'Raw Trajectory Title';
        const entry = buildTrajectoryEntryWithRawInner(conversationId, title);

        const parsed = parseTrajectorySummariesBase64(entry.toString('base64'));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].conversationId).toBe(conversationId);
        expect(parsed[0].title).toBe(title);
    });

    it('parses trajectory entries whose title payload is nested base64 protobuf', () => {
        const conversationId = 'cccccccc-dddd-eeee-ffff-000000000000';
        const title = 'Listing DevTools Directory';
        const entry = buildTrajectoryEntryWithNestedBase64Title(conversationId, title);

        const parsed = parseTrajectorySummariesBase64(entry.toString('base64'));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].conversationId).toBe(conversationId);
        expect(parsed[0].title).toBe(title);
    });

    it('transfers a conversation by title across profiles', () => {
        const conversationId = 'dddddddd-eeee-ffff-0000-111111111111';
        const title = 'Imported Across Profiles';
        const entry = buildTrajectoryEntry(conversationId, title);
        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, entry.toString('base64'));

        const sharedRoot = path.join(tempRoot, '.gemini', 'antigravity');
        fs.mkdirSync(path.join(sharedRoot, 'conversations'), { recursive: true });
        fs.writeFileSync(path.join(sharedRoot, 'conversations', `${conversationId}.pb`), 'conversation');

        const work3UserDataDir = path.join(tempRoot, '.antigravity_cockpit', 'instances', 'antigravity', 'work3-data');
        fs.mkdirSync(path.dirname(path.join(tempRoot, '.antigravity_cockpit', 'instances.json')), { recursive: true });
        fs.writeFileSync(
            path.join(tempRoot, '.antigravity_cockpit', 'instances.json'),
            JSON.stringify({
                instances: [
                    {
                        name: 'work3',
                        userDataDir: work3UserDataDir,
                    },
                ],
            }),
            'utf8',
        );
        const work3Db = path.join(work3UserDataDir, 'User', 'globalStorage', 'state.vscdb');
        createDb(work3Db, '');

        const result = transferConversationByTitle('default', 'work3', title);
        expect(result.conversationId).toBe(conversationId);
        expect(fs.existsSync(result.dbBackupPath)).toBe(true);

        const db = new Database(work3Db, { readonly: true });
        const row = db
            .prepare('SELECT value FROM ItemTable WHERE key = ?')
            .get('antigravityUnifiedStateSync.trajectorySummaries') as { value: string };
        db.close();

        const parsed = parseTrajectorySummariesBase64(String(row.value));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].title).toBe(title);
    });

    it('prefers the latest matching trajectory entry when titles collide', () => {
        const olderId = '11111111-aaaa-bbbb-cccc-000000000001';
        const newerId = '11111111-aaaa-bbbb-cccc-000000000002';
        const title = 'Analyzing Project Directory';
        const trajectoryBase64 = Buffer.concat([
            buildTrajectoryEntry(olderId, title),
            buildTrajectoryEntry(newerId, title),
        ]).toString('base64');

        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, trajectoryBase64);

        const latest = findLatestTrajectoryEntryByTitle('default', title);
        expect(latest?.conversationId).toBe(newerId);
    });

    it('exports the exact requested conversation id even when titles collide', () => {
        const olderId = '21111111-aaaa-bbbb-cccc-000000000001';
        const newerId = '21111111-aaaa-bbbb-cccc-000000000002';
        const title = 'Analyzing Project Directory';
        const trajectoryBase64 = Buffer.concat([
            buildTrajectoryEntry(olderId, title),
            buildTrajectoryEntry(newerId, title),
        ]).toString('base64');

        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, trajectoryBase64);

        const sharedRoot = path.join(tempRoot, '.gemini', 'antigravity');
        fs.mkdirSync(path.join(sharedRoot, 'conversations'), { recursive: true });
        fs.writeFileSync(path.join(sharedRoot, 'conversations', `${olderId}.pb`), 'older-conversation');
        fs.writeFileSync(path.join(sharedRoot, 'conversations', `${newerId}.pb`), 'newer-conversation');

        const bundleDir = exportConversationBundleByConversationId('default', olderId, path.join(tempRoot, 'exports'));
        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8')) as {
            conversationId: string;
            title: string;
            files: { conversationPb?: string };
        };

        expect(manifest.conversationId).toBe(olderId);
        expect(manifest.title).toBe(title);
        expect(fs.readFileSync(path.join(bundleDir, manifest.files.conversationPb!), 'utf8')).toBe('older-conversation');
    });

    it('waits until a conversation appears in trajectory summaries', async () => {
        const conversationId = 'eeeeeeee-ffff-0000-1111-222222222222';
        const title = 'Eventually Persisted';
        const defaultDb = path.join(
            tempRoot,
            'Library',
            'Application Support',
            'Antigravity',
            'User',
            'globalStorage',
            'state.vscdb',
        );
        createDb(defaultDb, Buffer.alloc(0).toString('base64'));

        const delayedEntry = buildTrajectoryEntry(conversationId, title).toString('base64');
        setTimeout(() => {
            const db = new Database(defaultDb);
            db.prepare(`
                INSERT INTO ItemTable (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(
                'antigravityUnifiedStateSync.trajectorySummaries',
                delayedEntry,
            );
            db.close();
        }, 10);

        const entry = await waitForConversationPersistence('default', title, {
            timeoutMs: 1000,
            pollIntervalMs: 5,
        });

        expect(entry.conversationId).toBe(conversationId);
        expect(entry.title).toBe(title);
    });
});
