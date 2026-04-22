
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
            
            const encoded = ArtifactService.encodeSelectValue(conversationId, filename);
            // New format includes a 4-char hash, e.g. art_123e4567e89b_abcd_implementation_plan.md
            expect(encoded).toMatch(/^art_123e4567e89b_[a-z0-9]{4}_implementation_plan\.md$/);

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
});
