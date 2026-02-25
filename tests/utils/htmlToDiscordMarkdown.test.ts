import { htmlToDiscordMarkdown } from '../../src/utils/htmlToDiscordMarkdown';

describe('htmlToDiscordMarkdown', () => {
    it('returns empty string for falsy input', () => {
        expect(htmlToDiscordMarkdown('')).toBe('');
        expect(htmlToDiscordMarkdown(null as any)).toBe('');
        expect(htmlToDiscordMarkdown(undefined as any)).toBe('');
    });

    it('passes through plain text unchanged', () => {
        expect(htmlToDiscordMarkdown('Hello world')).toBe('Hello world');
    });

    describe('headings', () => {
        it('converts h1 to #', () => {
            expect(htmlToDiscordMarkdown('<h1>Title</h1>')).toBe('# Title');
        });

        it('converts h2 to ##', () => {
            expect(htmlToDiscordMarkdown('<h2>Subtitle</h2>')).toBe('## Subtitle');
        });

        it('converts h3 to ###', () => {
            expect(htmlToDiscordMarkdown('<h3>Section</h3>')).toBe('### Section');
        });
    });

    describe('inline formatting', () => {
        it('converts strong/b to bold', () => {
            expect(htmlToDiscordMarkdown('<strong>bold</strong>')).toBe('**bold**');
            expect(htmlToDiscordMarkdown('<b>bold</b>')).toBe('**bold**');
        });

        it('converts em/i to italic', () => {
            expect(htmlToDiscordMarkdown('<em>italic</em>')).toBe('*italic*');
            expect(htmlToDiscordMarkdown('<i>italic</i>')).toBe('*italic*');
        });

        it('converts inline code', () => {
            expect(htmlToDiscordMarkdown('<code>foo()</code>')).toBe('`foo()`');
        });
    });

    describe('code blocks', () => {
        it('converts pre+code to fenced code block', () => {
            const html = '<pre><code>const x = 1;\nconst y = 2;</code></pre>';
            const expected = '```\nconst x = 1;\nconst y = 2;\n```';
            expect(htmlToDiscordMarkdown(html)).toBe(expected);
        });

        it('decodes HTML entities inside code blocks', () => {
            const html = '<pre><code>if (a &lt; b &amp;&amp; c &gt; d) {}</code></pre>';
            expect(htmlToDiscordMarkdown(html)).toContain('if (a < b && c > d) {}');
        });
    });

    describe('lists', () => {
        it('converts ordered list', () => {
            const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
            const result = htmlToDiscordMarkdown(html);
            expect(result).toContain('1. First');
            expect(result).toContain('2. Second');
            expect(result).toContain('3. Third');
        });

        it('converts unordered list', () => {
            const html = '<ul><li>Alpha</li><li>Beta</li></ul>';
            const result = htmlToDiscordMarkdown(html);
            expect(result).toContain('- Alpha');
            expect(result).toContain('- Beta');
        });
    });

    describe('paragraphs and line breaks', () => {
        it('converts p tags to double newlines', () => {
            const html = '<p>First paragraph</p><p>Second paragraph</p>';
            const result = htmlToDiscordMarkdown(html);
            expect(result).toContain('First paragraph');
            expect(result).toContain('Second paragraph');
            expect(result).toMatch(/First paragraph\n\n/);
        });

        it('converts br to newline', () => {
            expect(htmlToDiscordMarkdown('line1<br>line2')).toBe('line1\nline2');
            expect(htmlToDiscordMarkdown('line1<br/>line2')).toBe('line1\nline2');
        });
    });

    describe('special elements', () => {
        it('converts context-scope-mention spans to inline code', () => {
            const html = '<span class="context-scope-mention">config.ts</span>';
            expect(htmlToDiscordMarkdown(html)).toBe('`config.ts`');
        });

        it('restores file path from title attribute', () => {
            const html = '<div title="src/bot/index.ts">:54</div>';
            expect(htmlToDiscordMarkdown(html)).toBe('src/bot/index.ts:54');
        });

        it('ignores title attribute that does not look like a file path', () => {
            const html = '<div title="some tooltip">content</div>';
            expect(htmlToDiscordMarkdown(html)).toBe('content');
        });

        it('removes style tags completely', () => {
            const html = '<style>.foo { color: red; }</style><p>visible</p>';
            expect(htmlToDiscordMarkdown(html)).toBe('visible');
        });
    });

    describe('HTML entities', () => {
        it('decodes common entities', () => {
            expect(htmlToDiscordMarkdown('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
        });

        it('decodes &nbsp; to space', () => {
            expect(htmlToDiscordMarkdown('hello&nbsp;world')).toBe('hello world');
        });
    });

    describe('mixed content', () => {
        it('handles complex HTML with multiple element types', () => {
            const html = [
                '<h2>Summary</h2>',
                '<p>Here is the <strong>result</strong>:</p>',
                '<ol><li>Item one</li><li>Item two</li></ol>',
                '<p>See <code>utils.ts</code> for details.</p>',
            ].join('');

            const result = htmlToDiscordMarkdown(html);
            expect(result).toContain('## Summary');
            expect(result).toContain('**result**');
            expect(result).toContain('1. Item one');
            expect(result).toContain('2. Item two');
            expect(result).toContain('`utils.ts`');
        });
    });

    describe('strips unknown tags', () => {
        it('removes unrecognized tags while keeping text', () => {
            const html = '<section><article>Content here</article></section>';
            expect(htmlToDiscordMarkdown(html)).toBe('Content here');
        });
    });
});
