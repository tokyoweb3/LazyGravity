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
