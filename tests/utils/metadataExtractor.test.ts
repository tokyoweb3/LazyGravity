import { extractMetadataFromFooter } from '../../src/utils/metadataExtractor';

describe('Metadata Extractor', () => {
    it('FooterからTaskIDと対象ディレクトリを正しく抽出できるか', () => {
        const footerText = 'TaskID: abc-123 | Dir: /workspace/projectA';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('abc-123');
        expect(result.directory).toBe('/workspace/projectA');
    });

    it('TaskIDのみが存在する場合も抽出できるか', () => {
        const footerText = 'TaskID: xyz-999';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('xyz-999');
        expect(result.directory).toBeUndefined();
    });

    it('対象ディレクトリのみが存在する場合も抽出できるか', () => {
        const footerText = 'Dir: /tmp/testDir';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBeUndefined();
        expect(result.directory).toBe('/tmp/testDir');
    });

    it('メタデータが含まれない場合は空オブジェクトを返すか', () => {
        const footerText = 'LazyGravity System';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBeUndefined();
        expect(result.directory).toBeUndefined();
    });

    it('空白の揺らぎやフォーマットの違いにも耐性があるか', () => {
        const footerText = '  TaskID:   foo-bar   |   Dir:   /project/a/b/c  ';
        const result = extractMetadataFromFooter(footerText);
        expect(result.taskId).toBe('foo-bar');
        expect(result.directory).toBe('/project/a/b/c');
    });
});
