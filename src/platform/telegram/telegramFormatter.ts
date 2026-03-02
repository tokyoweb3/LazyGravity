/**
 * Telegram HTML formatter.
 *
 * Converts markdown-like text and RichContent to Telegram-compatible HTML.
 * Telegram supports a subset of HTML tags: <b>, <i>, <code>, <pre>, <s>,
 * <a href="...">, and a few others.
 */

import type { RichContent, RichContentField } from '../types';

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

/** Escape characters that are special in HTML. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// Markdown -> Telegram HTML
// ---------------------------------------------------------------------------

/**
 * Convert a limited subset of Markdown to Telegram HTML.
 *
 * Supported conversions:
 *  - `**bold**`       -> `<b>bold</b>`
 *  - `*italic*`       -> `<i>italic</i>` (only outside ** pairs)
 *  - `` `code` ``     -> `<code>code</code>`
 *  - ` ```block``` `  -> `<pre>block</pre>`
 *  - `~~strike~~`     -> `<s>strike</s>`
 *  - `[text](url)`    -> `<a href="url">text</a>`
 *
 * Text outside these patterns is HTML-escaped.
 */
export function markdownToTelegramHtml(text: string): string {
    // Process code blocks first (``` ... ```) to avoid inner transformations
    let result = text.replace(
        /```(?:\w*\n)?([\s\S]*?)```/g,
        (_match, code: string) => `<pre>${escapeHtml(code.trim())}</pre>`,
    );

    // Inline code (`...`)
    result = result.replace(
        /`([^`]+)`/g,
        (_match, code: string) => `<code>${escapeHtml(code)}</code>`,
    );

    // Links [text](url) - must be processed before other inline markup
    result = result.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_match, linkText: string, url: string) =>
            `<a href="${escapeHtml(url)}">${escapeHtml(linkText)}</a>`,
    );

    // Bold **text** (must come before italic)
    result = result.replace(
        /\*\*(.+?)\*\*/g,
        (_match, content: string) => `<b>${content}</b>`,
    );

    // Italic *text* (single asterisk, not inside bold)
    result = result.replace(
        /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
        (_match, content: string) => `<i>${content}</i>`,
    );

    // Strikethrough ~~text~~
    result = result.replace(
        /~~(.+?)~~/g,
        (_match, content: string) => `<s>${content}</s>`,
    );

    return result;
}

// ---------------------------------------------------------------------------
// RichContent -> Telegram HTML
// ---------------------------------------------------------------------------

/**
 * Format a single field for Telegram display.
 */
function formatField(field: RichContentField): string {
    const escapedName = escapeHtml(field.name);
    const convertedValue = markdownToTelegramHtml(field.value);
    return `<b>${escapedName}:</b> ${convertedValue}`;
}

/**
 * Group fields into inline groups and standalone fields.
 * Consecutive inline fields are joined with " | ".
 */
function formatFields(fields: readonly RichContentField[]): string {
    const parts: string[] = [];
    let inlineGroup: string[] = [];

    for (const field of fields) {
        if (field.inline) {
            inlineGroup = [...inlineGroup, formatField(field)];
        } else {
            if (inlineGroup.length > 0) {
                parts.push(inlineGroup.join(' | '));
                inlineGroup = [];
            }
            parts.push(formatField(field));
        }
    }

    // Flush any remaining inline group
    if (inlineGroup.length > 0) {
        parts.push(inlineGroup.join(' | '));
    }

    return parts.join('\n');
}

/**
 * Convert a RichContent object to a single Telegram HTML string.
 *
 * Layout:
 *   <b>title</b>\n\n
 *   description (markdown-converted)
 *   \n<b>fieldName:</b> fieldValue  (inline fields separated by " | ")
 *   \n\n<i>footer</i>
 */
export function richContentToHtml(rc: RichContent): string {
    const sections: string[] = [];

    if (rc.title) {
        sections.push(`<b>${escapeHtml(rc.title)}</b>`);
    }

    if (rc.description) {
        sections.push(markdownToTelegramHtml(rc.description));
    }

    if (rc.fields && rc.fields.length > 0) {
        sections.push(formatFields(rc.fields));
    }

    // Join title/description/fields with double newline, then append footer
    let html = sections.join('\n\n');

    if (rc.footer) {
        html += `\n\n<i>${escapeHtml(rc.footer)}</i>`;
    }

    return html;
}
