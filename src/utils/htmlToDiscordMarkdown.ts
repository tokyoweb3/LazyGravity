/**
 * Lightweight HTML-to-Discord-Markdown converter.
 * Runs on Node.js (no browser DOM required).
 * Converts common HTML tags to Discord-compatible Markdown.
 */

/**
 * Convert an HTML string to Discord-compatible Markdown.
 *
 * Supported conversions:
 * - <h1>-<h3> → # - ###
 * - <strong>/<b> → **...**
 * - <em>/<i> → *...*
 * - <code> → `...`
 * - <pre><code> → ```\n...\n```
 * - <ol><li> → 1. item
 * - <ul><li> → - item
 * - <p> → \n\n
 * - <br> → \n
 * - <span class="context-scope-mention"> → `text`
 * - Elements with file-path title attribute → title + text
 * - <style> → removed entirely
 * - All other tags → stripped, text preserved
 */
export function htmlToDiscordMarkdown(html: string): string {
    if (!html) return '';

    let result = html;

    // Remove <style> tags and their content
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Handle <br> and <br/>
    result = result.replace(/<br\s*\/?>/gi, '\n');

    // Handle <hr>
    result = result.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Handle headings (h1-h3)
    result = result.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, content) =>
        `\n# ${stripTags(content).trim()}\n`,
    );
    result = result.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, content) =>
        `\n## ${stripTags(content).trim()}\n`,
    );
    result = result.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, content) =>
        `\n### ${stripTags(content).trim()}\n`,
    );

    // Handle <pre><code> blocks (must come before inline <code>)
    // Do NOT decode entities here — let the final decodeEntities() handle them
    // after stripTags() has run, to avoid decoded < > being stripped as tags.
    result = result.replace(
        /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
        '\n```\n$1\n```\n',
    );

    // Handle inline <code>
    result = result.replace(
        /<code[^>]*>([\s\S]*?)<\/code>/gi,
        '`$1`',
    );

    // Handle <strong> and <b>
    result = result.replace(
        /<(?:strong|b)(?:\s[^>]*)?>((?: |\s|[^<]|<(?!\/(?:strong|b)>))*)<\/(?:strong|b)>/gi,
        '**$1**',
    );

    // Handle <em> and <i>
    result = result.replace(
        /<(?:em|i)(?:\s[^>]*)?>((?: |\s|[^<]|<(?!\/(?:em|i)>))*)<\/(?:em|i)>/gi,
        '*$1*',
    );

    // Handle ordered lists: <ol> with <li> children
    result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, content) => {
        let counter = 0;
        const items = content.replace(
            /<li[^>]*>([\s\S]*?)<\/li>/gi,
            (_lm: string, text: string) => {
                counter++;
                return `${counter}. ${stripTags(text).trim()}\n`;
            },
        );
        return `\n${items}`;
    });

    // Handle unordered lists: <ul> with <li> children
    result = result.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, content) => {
        const items = content.replace(
            /<li[^>]*>([\s\S]*?)<\/li>/gi,
            (_lm: string, text: string) => `- ${stripTags(text).trim()}\n`,
        );
        return `\n${items}`;
    });

    // Handle <span class="context-scope-mention"> → `text`
    result = result.replace(
        /<span[^>]*class="[^"]*context-scope-mention[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        (_m, text) => `\`${stripTags(text).trim()}\``,
    );

    // Handle elements with title attribute containing file paths
    // e.g. <div title="src/bot/index.ts">:54</div> → src/bot/index.ts:54
    result = result.replace(
        /<(?:div|span|a)[^>]*\btitle="([^"]*)"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/gi,
        (_m, title, text) => {
            if (looksLikeFilePath(title)) {
                return `${title}${stripTags(text).trim()}`;
            }
            return stripTags(text);
        },
    );

    // Handle <p> tags → content with trailing double newline
    result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

    // Handle <div> tags → content with newline (block element)
    result = result.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

    // Strip remaining HTML tags
    result = stripTags(result);

    // Decode HTML entities
    result = decodeEntities(result);

    // Clean up excessive whitespace
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.trim();

    return result;
}

/** Check if a string looks like a file path */
function looksLikeFilePath(value: string): boolean {
    if (!value) return false;
    // Must contain at least one / and end with an extension-like pattern
    return /^[a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]+$/.test(value) && value.includes('/');
}

/** Strip all HTML tags from a string */
function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

/** Decode common HTML entities and generic numeric entities */
function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
}
