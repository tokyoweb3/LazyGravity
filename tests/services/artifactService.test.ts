
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ArtifactService, ArtifactInfo } from '../../src/services/artifactService';

describe('ArtifactService', () => {
    let tmpBrainPath: string;
    let artifactService: ArtifactService;

    beforeEach(() => {
        tmpBrainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
        artifactService = new ArtifactService(tmpBrainPath);
    });

    afterEach(() => {
        fs.rmSync(tmpBrainPath, { recursive: true, force: true });
    });

    describe('encodeSelectValue / decodeSelectValue', () => {
        it('should round-trip encode and decode properly', () => {
            const conversationId = '123e4567-e89b-12d3-a456-426614174000';
            const filename = 'implementation_plan.md';
            
            const expectedHash = crypto
                .createHash('sha256')
                .update(`${conversationId}:${filename}`)
                .digest('hex')
                .slice(0, 8);

            const encoded = ArtifactService.encodeSelectValue(conversationId, filename);
            // Assert exact known SHA-256 hash for the fixture
            expect(encoded).toBe(`art_123e4567_${expectedHash}_implementation_plan.md`);

            const artifacts: ArtifactInfo[] = [
                {
                    conversationId,
                    filename,
                    artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN',
                    absolutePath: 'ignored'
                }
            ];

            const decoded = artifactService.decodeSelectValue(encoded, artifacts);
            expect(decoded).not.toBeNull();
            expect(decoded?.conversationId).toBe(conversationId);
            expect(decoded?.filename).toBe(filename);
        });

        it('should return null for unknown values', () => {
            const decoded = artifactService.decodeSelectValue('art_unknown', []);
            expect(decoded).toBeNull();
        });

        it('should reject tampered or changed hashes', () => {
            const conversationId = '123e4567-e89b-12d3-a456-426614174000';
            const filename = 'implementation_plan.md';
            const encoded = ArtifactService.encodeSelectValue(conversationId, filename);
            
            // Tamper with the hash segment (middle part)
            const parts = encoded.split('_');
            parts[2] = 'deadbeef';
            const tampered = parts.join('_');

            const artifacts: ArtifactInfo[] = [
                { conversationId, filename, artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN', absolutePath: 'ignored' }
            ];

            const decoded = artifactService.decodeSelectValue(tampered, artifacts);
            expect(decoded).toBeNull();
        });

        it('should reject decoding when filename is swapped but original hash is retained', () => {
            const conversationId = '123e4567-e89b-12d3-a456-426614174000';
            const originalFile = 'implementation_plan.md';
            const swappedFile = 'walkthrough.md';

            // Generate encoded value for implementation_plan.md
            const encodedOriginal = ArtifactService.encodeSelectValue(conversationId, originalFile);
            
            // Swap out implementation_plan.md with walkthrough.md in the select string while retaining original hash
            const hash = encodedOriginal.split('_')[2];
            const swappedSelectValue = `art_123e4567_${hash}_${swappedFile}`;

            const artifacts: ArtifactInfo[] = [
                { conversationId, filename: swappedFile, artifactType: 'ARTIFACT_TYPE_WALKTHROUGH', absolutePath: 'ignored' }
            ];

            const decoded = artifactService.decodeSelectValue(swappedSelectValue, artifacts);
            expect(decoded).toBeNull();
        });

        it('should correctly resolve between two conversation IDs sharing the same short prefix and filename', () => {
            // Both IDs share the same 8-char shortConv prefix ('123e4567')
            const convA = '123e4567-aaaa-1111-2222-333333333333';
            const convB = '123e4567-bbbb-4444-5555-666666666666';
            const filename = 'walkthrough.md';

            const encodedA = ArtifactService.encodeSelectValue(convA, filename);
            const encodedB = ArtifactService.encodeSelectValue(convB, filename);

            const artifacts: ArtifactInfo[] = [
                { conversationId: convA, filename, artifactType: 'ARTIFACT_TYPE_WALKTHROUGH', absolutePath: 'a' },
                { conversationId: convB, filename, artifactType: 'ARTIFACT_TYPE_WALKTHROUGH', absolutePath: 'b' }
            ];

            const decodedA = artifactService.decodeSelectValue(encodedA, artifacts);
            const decodedB = artifactService.decodeSelectValue(encodedB, artifacts);

            expect(decodedA?.conversationId).toBe(convA);
            expect(decodedB?.conversationId).toBe(convB);
        });

        it('should reject decoding when encoded for convB but candidate list only contains convA (prefix collision)', () => {
            const convA = '123e4567-aaaa-1111-2222-333333333333';
            const convB = '123e4567-bbbb-4444-5555-666666666666';
            const filename = 'walkthrough.md';

            const encodedB = ArtifactService.encodeSelectValue(convB, filename);

            const artifacts: ArtifactInfo[] = [
                { conversationId: convA, filename, artifactType: 'ARTIFACT_TYPE_WALKTHROUGH', absolutePath: 'a' },
            ];

            const decoded = artifactService.decodeSelectValue(encodedB, artifacts);
            expect(decoded).toBeNull();
        });
    });

    describe('listArtifacts', () => {
        it('should list valid artifacts and sort by updatedAt descending', () => {
            const conversationId = '00000000-0000-0000-0000-000000000000';
            const convDir = path.join(tmpBrainPath, conversationId);
            fs.mkdirSync(convDir, { recursive: true });

            // Artifact 1: Oldest
            fs.writeFileSync(path.join(convDir, 'plan1.md'), 'content1');
            fs.writeFileSync(path.join(convDir, 'plan1.md.metadata.json'), JSON.stringify({
                artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN',
                updatedAt: '2023-01-01T10:00:00Z'
            }));

            // Artifact 2: Newest
            fs.writeFileSync(path.join(convDir, 'plan2.md'), 'content2');
            fs.writeFileSync(path.join(convDir, 'plan2.md.metadata.json'), JSON.stringify({
                artifactType: 'ARTIFACT_TYPE_TASK',
                updatedAt: '2023-01-01T12:00:00Z'
            }));

            // Ignored files
            fs.writeFileSync(path.join(convDir, 'ignored.txt'), 'not md');
            fs.writeFileSync(path.join(convDir, 'missing_meta.md'), 'no meta');

            const artifacts = artifactService.listArtifacts(conversationId);
            
            expect(artifacts).toHaveLength(2);
            // First should be plan2.md because it's newest
            expect(artifacts[0].filename).toBe('plan2.md');
            expect(artifacts[0].artifactType).toBe('ARTIFACT_TYPE_TASK');
            
            // Second should be plan1.md
            expect(artifacts[1].filename).toBe('plan1.md');
            expect(artifacts[1].artifactType).toBe('ARTIFACT_TYPE_IMPLEMENTATION_PLAN');
        });

        it('should return empty array if directory does not exist', () => {
            const artifacts = artifactService.listArtifacts('non-existent-id');
            expect(artifacts).toEqual([]);
        });
    });
    describe('findConversationByTitle', () => {
        const conversationId = '00000000-0000-0000-0000-000000000001';
        let convDir: string;
        let logDir: string;

        beforeEach(() => {
            convDir = path.join(tmpBrainPath, conversationId);
            logDir = path.join(convDir, '.system_generated', 'logs');
            fs.mkdirSync(logDir, { recursive: true });
        });

        it('should find by exact match', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Session Title: Fix Deployment Bug');
            const found = artifactService.findConversationByTitle('Fix Deployment Bug');
            expect(found).toBe(conversationId);
        });

        it('should find by fuzzy match with high score', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Context: fixing memory leak in production');
            // "memory" and "leak" are meaningful (score 2). "fixing" is no longer a stopword.
            const found = artifactService.findConversationByTitle('Memory Leak Issue');
            expect(found).toBe(conversationId);
        });

        it('should reject fuzzy match with low score (minScore=2)', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Context: fix production bug');
            // only "production" matches. score 1 < minScore 2.
            const found = artifactService.findConversationByTitle('Production Release');
            expect(found).toBeNull();
        });

        it('should ignore common stopwords in fuzzy match', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Context: the production for this that');
            // "the", "for", "this", "that" are stopwords. "production" matches but score is 1.
            const found = artifactService.findConversationByTitle('The Production System');
            expect(found).toBeNull();
        });

        it('should support CJK characters in fuzzy match', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Session: ログイン機能の修正 (Login fix)');
            // "ログイン" (login), "機能" (function), "修正" (fix). 
            // Matching "ログイン" and "機能" should score 2.
            const found = artifactService.findConversationByTitle('ログイン機能');
            expect(found).toBe(conversationId);
        });
        
        it('should support Chinese characters', () => {
            fs.writeFileSync(path.join(logDir, 'overview.txt'), 'Session: 修复部署错误');
            // "修复" (fix), "部署" (deploy), "错误" (error).
            const found = artifactService.findConversationByTitle('修复部署');
            expect(found).toBe(conversationId);
        });

        it('should reject workspace matches containing .gemini, brain, or antigravity', () => {
            fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), '{"content":"c:\\\\Users\\\\dgomez\\\\.gemini\\\\antigravity\\\\brain\\\\test"}');
            const found = artifactService.findConversationByTitle('Fix Deployment Bug', 'test');
            expect(found).toBeNull();
        });
    });

    describe('getLatestConversationWithArtifacts', () => {
        it('should reject conversations matching workspace filters containing .gemini, brain, or antigravity', () => {
            const conversationId = '00000000-0000-0000-0000-000000000002';
            const convDir = path.join(tmpBrainPath, conversationId);
            fs.mkdirSync(path.join(convDir, '.system_generated', 'logs'), { recursive: true });
            
            // Create plan to make it eligible
            fs.writeFileSync(path.join(convDir, 'implementation_plan.md'), 'Workspace: test');
            fs.writeFileSync(path.join(convDir, 'implementation_plan.md.metadata.json'), JSON.stringify({
                artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN',
                updatedAt: '2023-01-01T10:00:00Z'
            }));

            // Path matches workspace but it is inside a brain folder
            fs.writeFileSync(
                path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl'),
                '{"content":"c:\\\\Users\\\\dgomez\\\\.gemini\\\\antigravity\\\\brain\\\\test\\\\file.txt"}'
            );

            const found = artifactService.getLatestConversationWithArtifacts('test');
            expect(found).toBeNull();
        });
    });
});
