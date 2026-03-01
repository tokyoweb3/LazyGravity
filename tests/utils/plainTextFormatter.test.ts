import { formatAsPlainText, splitPlainText } from '../../src/utils/plainTextFormatter';

describe('splitPlainText', () => {
    it('returns text as-is when within limit', () => {
        const result = splitPlainText('short text', 1900);
        expect(result).toEqual(['short text']);
    });

    it('splits at line boundaries', () => {
        const line1 = 'a'.repeat(100);
        const line2 = 'b'.repeat(100);
        const text = `${line1}\n${line2}`;
        const result = splitPlainText(text, 150);
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(line1);
        expect(result[1]).toBe(line2);
    });

    it('hard-splits lines exceeding maxLength', () => {
        const longLine = 'x'.repeat(300);
        const result = splitPlainText(longLine, 100);
        expect(result).toHaveLength(3);
        expect(result[0]).toBe('x'.repeat(100));
        expect(result[1]).toBe('x'.repeat(100));
        expect(result[2]).toBe('x'.repeat(100));
    });

    it('returns empty string array for empty input', () => {
        const result = splitPlainText('');
        expect(result).toEqual(['']);
    });

    it('preserves code blocks', () => {
        const text = '```js\nconst x = 1;\n```';
        const result = splitPlainText(text, 1900);
        expect(result).toEqual([text]);
    });
});

describe('formatAsPlainText', () => {
    it('formats title and description', () => {
        const result = formatAsPlainText({
            title: 'Test Title',
            description: 'Test description',
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('**Test Title**');
        expect(result[0]).toContain('Test description');
    });

    it('formats fields', () => {
        const result = formatAsPlainText({
            title: 'Status',
            description: 'All good',
            fields: [
                { name: 'Mode', value: 'Fast', inline: true },
                { name: 'Model', value: 'GPT-4', inline: true },
            ],
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('**Mode:** Fast');
        expect(result[0]).toContain('**Model:** GPT-4');
    });

    it('formats footer in italics', () => {
        const result = formatAsPlainText({
            title: 'Help',
            description: 'Commands list',
            footerText: 'Use /help for more info',
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('_Use /help for more info_');
    });

    it('handles missing optional fields', () => {
        const result = formatAsPlainText({ description: 'Only description' });
        expect(result).toHaveLength(1);
        expect(result[0]).toBe('Only description');
    });

    it('splits long text into multiple chunks', () => {
        const longDescription = 'line\n'.repeat(500);
        const result = formatAsPlainText({
            title: 'Long Output',
            description: longDescription,
        });
        expect(result.length).toBeGreaterThan(1);
        for (const chunk of result) {
            expect(chunk.length).toBeLessThanOrEqual(1900);
        }
    });

    it('handles empty input', () => {
        const result = formatAsPlainText({});
        expect(result).toEqual(['']);
    });
});
