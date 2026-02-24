import { extractMetadataFromFooter } from '../../src/utils/metadataExtractor';

describe('Metadata Extractor', () => {
    it('correctly extracts TaskID and target directory from a Footer', () => {
        const footerText = 'TaskID: abc-123 | Dir: /workspace/projectA';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('abc-123');
        expect(result.directory).toBe('/workspace/projectA');
    });

    it('extracts correctly when only TaskID is present', () => {
        const footerText = 'TaskID: xyz-999';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('xyz-999');
        expect(result.directory).toBeUndefined();
    });

    it('extracts correctly when only the target directory is present', () => {
        const footerText = 'Dir: /tmp/testDir';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBeUndefined();
        expect(result.directory).toBe('/tmp/testDir');
    });

    it('returns an empty object when no metadata is present', () => {
        const footerText = 'LazyGravity System';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBeUndefined();
        expect(result.directory).toBeUndefined();
    });

    it('is resilient to whitespace variations and format differences', () => {
        const footerText = '  TaskID:   foo-bar   |   Dir:   /project/a/b/c  ';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('foo-bar');
        expect(result.directory).toBe('/project/a/b/c');
    });
});
