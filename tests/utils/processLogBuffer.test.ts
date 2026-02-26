import { ProcessLogBuffer } from '../../src/utils/processLogBuffer';

describe('ProcessLogBuffer', () => {
    it('formats entries with emoji prefixes for readability', () => {
        const buffer = new ProcessLogBuffer({ maxChars: 500 });

        const result = buffer.append(
            [
                'Initiating Project Setup',
                '',
                'Thought for 6s',
                '',
                'jina-mcp-server / search_web',
            ].join('\n'),
        );

        expect(result).toContain('🚀 Initiating Project Setup');
        expect(result).toContain('🧠 Thought for 6s');
        expect(result).toContain('🛠️ jina-mcp-server / search_web');
    });

    it('uses 📄 emoji for past-tense file operations', () => {
        const buffer = new ProcessLogBuffer({ maxChars: 1000 });

        const result = buffer.append(
            [
                'Analyzed package.json#L1-75',
                '',
                'Read src/index.ts',
                '',
                'Created new-file.ts',
                '',
                'Built project successfully',
            ].join('\n'),
        );

        expect(result).toContain('📄 Analyzed package.json#L1-75');
        expect(result).toContain('📄 Read src/index.ts');
        expect(result).toContain('📄 Created new-file.ts');
        expect(result).toContain('📄 Built project successfully');
    });

    it('uses 🔍 emoji for present-tense activity operations', () => {
        const buffer = new ProcessLogBuffer({ maxChars: 1000 });

        const result = buffer.append(
            [
                'Fetching data from API',
                '',
                'Scanning directory for files',
                '',
                'Building project',
                '',
                'Creating test fixtures',
            ].join('\n'),
        );

        expect(result).toContain('🔍 Fetching data from API');
        expect(result).toContain('🔍 Scanning directory for files');
        expect(result).toContain('🔍 Building project');
        expect(result).toContain('🔍 Creating test fixtures');
    });

    it('drops oldest entries first when exceeding maxChars', () => {
        const buffer = new ProcessLogBuffer({ maxChars: 45, maxEntries: 10 });

        buffer.append('Initiating Step A');
        buffer.append('Initiating Step B');
        const result = buffer.append('Initiating Step C');

        expect(result).not.toContain('Step A');
        expect(result).toContain('Step B');
        expect(result).toContain('Step C');
    });
});
