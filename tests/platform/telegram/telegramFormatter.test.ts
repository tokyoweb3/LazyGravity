import {
    escapeHtml,
    markdownToTelegramHtml,
    richContentToHtml,
} from '../../../src/platform/telegram/telegramFormatter';
import type { RichContent } from '../../../src/platform/types';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe('it&#x27;s');
    });

    it('escapes all special characters in one string', () => {
        expect(escapeHtml('<a href="x">&\'</a>')).toBe(
            '&lt;a href=&quot;x&quot;&gt;&amp;&#x27;&lt;/a&gt;',
        );
    });

    it('returns an empty string unchanged', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('does not alter safe text', () => {
        expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    });
});

// ---------------------------------------------------------------------------
// markdownToTelegramHtml
// ---------------------------------------------------------------------------

describe('markdownToTelegramHtml', () => {
    it('converts **bold** to <b>', () => {
        expect(markdownToTelegramHtml('**bold**')).toBe('<b>bold</b>');
    });

    it('converts *italic* to <i>', () => {
        expect(markdownToTelegramHtml('*italic*')).toBe('<i>italic</i>');
    });

    it('converts inline code to <code>', () => {
        expect(markdownToTelegramHtml('use `npm install`')).toBe(
            'use <code>npm install</code>',
        );
    });

    it('escapes HTML inside inline code', () => {
        expect(markdownToTelegramHtml('`<script>`')).toBe(
            '<code>&lt;script&gt;</code>',
        );
    });

    it('converts fenced code blocks to <pre>', () => {
        const input = '```\nconst x = 1;\n```';
        expect(markdownToTelegramHtml(input)).toBe('<pre>const x = 1;</pre>');
    });

    it('strips language identifier from fenced code blocks', () => {
        const input = '```typescript\nconst x = 1;\n```';
        expect(markdownToTelegramHtml(input)).toBe('<pre>const x = 1;</pre>');
    });

    it('converts ~~strikethrough~~ to <s>', () => {
        expect(markdownToTelegramHtml('~~removed~~')).toBe('<s>removed</s>');
    });

    it('converts [text](url) to <a href>', () => {
        expect(markdownToTelegramHtml('[click](https://example.com)')).toBe(
            '<a href="https://example.com">click</a>',
        );
    });

    it('escapes HTML in link URLs', () => {
        expect(markdownToTelegramHtml('[go](https://x.com?a=1&b=2)')).toBe(
            '<a href="https://x.com?a=1&amp;b=2">go</a>',
        );
    });

    it('handles mixed markdown', () => {
        const input = '**bold** and *italic* and `code`';
        expect(markdownToTelegramHtml(input)).toBe(
            '<b>bold</b> and <i>italic</i> and <code>code</code>',
        );
    });

    it('does not convert single asterisk inside bold', () => {
        // **bold** should not leave stray italic markers
        expect(markdownToTelegramHtml('**bold**')).toBe('<b>bold</b>');
    });

    it('handles plain text without markdown', () => {
        expect(markdownToTelegramHtml('just plain text')).toBe('just plain text');
    });

    it('handles empty string', () => {
        expect(markdownToTelegramHtml('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// richContentToHtml
// ---------------------------------------------------------------------------

describe('richContentToHtml', () => {
    it('renders title only', () => {
        const rc: RichContent = { title: 'Hello' };
        expect(richContentToHtml(rc)).toBe('<b>Hello</b>');
    });

    it('escapes HTML in title', () => {
        const rc: RichContent = { title: '<script>' };
        expect(richContentToHtml(rc)).toBe('<b>&lt;script&gt;</b>');
    });

    it('renders description with markdown conversion', () => {
        const rc: RichContent = { description: '**bold** text' };
        expect(richContentToHtml(rc)).toBe('<b>bold</b> text');
    });

    it('renders title and description with double newline', () => {
        const rc: RichContent = { title: 'Title', description: 'Body' };
        expect(richContentToHtml(rc)).toBe('<b>Title</b>\n\nBody');
    });

    it('renders fields with bold names', () => {
        const rc: RichContent = {
            fields: [{ name: 'Status', value: 'Active', inline: false }],
        };
        expect(richContentToHtml(rc)).toBe('<b>Status:</b> Active');
    });

    it('joins inline fields with pipe separator', () => {
        const rc: RichContent = {
            fields: [
                { name: 'A', value: '1', inline: true },
                { name: 'B', value: '2', inline: true },
            ],
        };
        expect(richContentToHtml(rc)).toBe('<b>A:</b> 1 | <b>B:</b> 2');
    });

    it('separates inline and non-inline fields correctly', () => {
        const rc: RichContent = {
            fields: [
                { name: 'Inline1', value: 'a', inline: true },
                { name: 'Inline2', value: 'b', inline: true },
                { name: 'Block', value: 'c', inline: false },
            ],
        };
        const result = richContentToHtml(rc);
        expect(result).toBe(
            '<b>Inline1:</b> a | <b>Inline2:</b> b\n<b>Block:</b> c',
        );
    });

    it('renders footer as italic', () => {
        const rc: RichContent = { title: 'T', footer: 'foot' };
        expect(richContentToHtml(rc)).toBe('<b>T</b>\n\n<i>foot</i>');
    });

    it('escapes HTML in footer', () => {
        const rc: RichContent = { footer: '<b>not bold</b>' };
        expect(richContentToHtml(rc)).toBe('\n\n<i>&lt;b&gt;not bold&lt;/b&gt;</i>');
    });

    it('renders a complete RichContent', () => {
        const rc: RichContent = {
            title: 'Report',
            description: 'All **good**',
            fields: [{ name: 'Score', value: '100', inline: false }],
            footer: 'Generated',
        };
        const expected = [
            '<b>Report</b>',
            '<b>good</b>',  // part of description line
            '<b>Score:</b> 100',
        ].join('\n\n');
        const result = richContentToHtml(rc);
        expect(result).toContain('<b>Report</b>');
        expect(result).toContain('All <b>good</b>');
        expect(result).toContain('<b>Score:</b> 100');
        expect(result).toContain('<i>Generated</i>');
    });

    it('renders empty RichContent as empty string', () => {
        expect(richContentToHtml({})).toBe('');
    });
});
