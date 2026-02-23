import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** Antigravity UIのDOMセレクター定数（レスポンス抽出用） */
export const RESPONSE_SELECTORS = {
    /** AIの最新応答テキストを取得する（HTML→Markdown変換） */
    RESPONSE_TEXT: `(() => {
        /**
         * DOM要素をDiscord互換のMarkdownに変換する再帰関数
         */
        function htmlToMarkdown(node, context) {
            context = context || { listDepth: 0, orderedIndex: 0, inPre: false };

            // テキストノード
            if (node.nodeType === 3) {
                let text = node.textContent || '';
                if (!context.inPre) {
                    // 連続空白を正規化（ただし改行は維持）
                    text = text.replace(/[ \\t]+/g, ' ');
                }
                return text;
            }

            // 要素ノード以外はスキップ
            if (node.nodeType !== 1) return '';

            const tag = node.tagName.toLowerCase();

            // 非表示要素をスキップ
            if (['style', 'script', 'svg', 'link', 'meta', 'noscript'].includes(tag)) return '';

            // CSS定義を含むコードブロックをスキップ
            if (tag === 'pre' || tag === 'code') {
                const content = node.textContent || '';
                if (/@media/.test(content) && /\\{[\\s\\S]*--[\\w-]+:/.test(content)) return '';
                if (/\\.markdown-alert/.test(content) && content.length > 500) return '';
            }

            // 子ノードのMarkdownを再帰的に取得するヘルパー
            function childrenMd(ctx) {
                let result = '';
                for (const child of node.childNodes) {
                    result += htmlToMarkdown(child, ctx || context);
                }
                return result;
            }

            switch (tag) {
                // 見出し
                case 'h1': return '\\n# ' + childrenMd().trim() + '\\n';
                case 'h2': return '\\n## ' + childrenMd().trim() + '\\n';
                case 'h3': return '\\n### ' + childrenMd().trim() + '\\n';
                case 'h4': return '\\n#### ' + childrenMd().trim() + '\\n';
                case 'h5': return '\\n##### ' + childrenMd().trim() + '\\n';
                case 'h6': return '\\n###### ' + childrenMd().trim() + '\\n';

                // 太字・斜体
                case 'strong':
                case 'b':
                    return '**' + childrenMd().trim() + '**';
                case 'em':
                case 'i':
                    return '*' + childrenMd().trim() + '*';

                // 取り消し線
                case 's':
                case 'del':
                case 'strike':
                    return '~~' + childrenMd().trim() + '~~';

                // インラインコード
                case 'code': {
                    // pre > code の場合は pre 側で処理するのでスキップ
                    if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
                        return node.textContent || '';
                    }
                    const code = node.textContent || '';
                    return code.includes('\\x60') ? '\\x60\\x60' + code + '\\x60\\x60' : '\\x60' + code + '\\x60';
                }

                // コードブロック
                case 'pre': {
                    const codeEl = node.querySelector('code');
                    const codeText = codeEl ? codeEl.textContent : node.textContent;
                    // 言語クラスの検出
                    let lang = '';
                    if (codeEl) {
                        const cls = codeEl.className || '';
                        const langMatch = cls.match(/language-(\\w+)/);
                        if (langMatch) lang = langMatch[1];
                    }
                    return '\\n\\x60\\x60\\x60' + lang + '\\n' + (codeText || '').trimEnd() + '\\n\\x60\\x60\\x60\\n';
                }

                // 順序なしリスト
                case 'ul': {
                    let result = '\\n';
                    const items = node.children;
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].tagName.toLowerCase() === 'li') {
                            const indent = '  '.repeat(context.listDepth);
                            const content = htmlToMarkdown(items[i], {
                                ...context,
                                listDepth: context.listDepth + 1,
                                orderedIndex: 0
                            }).trim();
                            result += indent + '- ' + content + '\\n';
                        }
                    }
                    return result;
                }

                // 順序ありリスト
                case 'ol': {
                    let result = '\\n';
                    const items = node.children;
                    let idx = parseInt(node.getAttribute('start') || '1', 10);
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].tagName.toLowerCase() === 'li') {
                            const indent = '  '.repeat(context.listDepth);
                            const content = htmlToMarkdown(items[i], {
                                ...context,
                                listDepth: context.listDepth + 1,
                                orderedIndex: idx
                            }).trim();
                            result += indent + idx + '. ' + content + '\\n';
                            idx++;
                        }
                    }
                    return result;
                }

                // リストアイテム
                case 'li':
                    return childrenMd();

                // テーブル
                case 'table': {
                    let result = '\\n';
                    const rows = node.querySelectorAll('tr');
                    for (let r = 0; r < rows.length; r++) {
                        const cells = rows[r].querySelectorAll('th, td');
                        const cellTexts = [];
                        for (const cell of cells) {
                            cellTexts.push(htmlToMarkdown(cell, context).trim().replace(/\\|/g, '\\\\|'));
                        }
                        result += '| ' + cellTexts.join(' | ') + ' |\\n';
                        // ヘッダー行の後にセパレーターを追加
                        if (r === 0 && rows[r].querySelector('th')) {
                            result += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\\n';
                        }
                    }
                    return result;
                }

                // 改行
                case 'br':
                    return '\\n';

                // 段落
                case 'p':
                    return '\\n' + childrenMd().trim() + '\\n';

                // リンク
                case 'a': {
                    const href = node.getAttribute('href') || '';
                    const linkText = childrenMd().trim();
                    if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
                        return linkText;
                    }
                    return '[' + linkText + '](' + href + ')';
                }

                // ブロック引用
                case 'blockquote': {
                    const content = childrenMd().trim();
                    return '\\n' + content.split('\\n').map(line => '> ' + line).join('\\n') + '\\n';
                }

                // 水平線
                case 'hr':
                    return '\\n---\\n';

                // div, span等 — 子要素を再帰処理
                case 'div': {
                    const md = childrenMd();
                    // divは前後に改行を含める（ブロック要素として）
                    return md.endsWith('\\n') ? md : md + '\\n';
                }

                // details/summary
                case 'details':
                    return childrenMd();
                case 'summary': {
                    const text = childrenMd().trim();
                    return text ? '\\n**' + text + '**\\n' : '';
                }

                // img
                case 'img': {
                    const alt = node.getAttribute('alt') || '';
                    return alt ? '[' + alt + ']' : '';
                }

                // その他の要素 — 子要素をそのまま処理
                default:
                    return childrenMd();
            }
        }

        /**
         * 変換後のテキストをクリーンアップ
         */
        function cleanMarkdown(text) {
            return text
                // 3行以上の連続空行を2行に
                .replace(/\\n{3,}/g, '\\n\\n')
                // 先頭末尾のトリム
                .trim();
        }

        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;

            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran|処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中)/i;
            if (activityPattern.test(normalized) && normalized.length <= 220) {
                return true;
            }

            // 箇条書き状の短い活動ログ塊は除外
            const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
            if (lines.length > 0 && lines.length <= 6) {
                const allActivity = lines.every((line) => activityPattern.test(line));
                if (allActivity) return true;
            }

            return false;
        };

        const looksLikeFeedbackFooter = (text) => {
            const normalized = (text || '').trim().toLowerCase().replace(/\\s+/g, ' ');
            if (!normalized) return false;
            return normalized === 'good bad' || normalized === 'good' || normalized === 'bad';
        };

        const candidateSelectors = [
            '.rendered-markdown',
            '.leading-relaxed.select-text',
            '.flex.flex-col.gap-y-3',
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[class*="assistant-message"]',
            '[class*="message-content"]',
            '[class*="markdown-body"]',
            '.prose',
        ];

        const candidates = [];
        const seen = new Set();
        for (const selector of candidateSelectors) {
            const nodes = scope.querySelectorAll(selector);
            for (const node of nodes) {
                if (!node || seen.has(node)) continue;
                seen.add(node);
                candidates.push(node);
            }
        }

        for (let i = candidates.length - 1; i >= 0; i--) {
            const node = candidates[i];
            const md = cleanMarkdown(htmlToMarkdown(node, { listDepth: 0, orderedIndex: 0, inPre: false }));
            if (!md) continue;
            if (looksLikeActivityLog(md)) continue;
            if (looksLikeFeedbackFooter(md)) continue;
            return md;
        }

        // 最終フォールバック: 可視テキストをそのまま抽出（Markdown変換が合わないUI向け）
        for (let i = candidates.length - 1; i >= 0; i--) {
            const text = (candidates[i].innerText || '').trim();
            if (!text) continue;
            if (looksLikeActivityLog(text)) continue;
            if (looksLikeFeedbackFooter(text)) continue;
            return text;
        }

        // 汎用フォールバック: よく使われるテキストブロックから最後の有効テキストを拾う
        const genericBlocks = scope.querySelectorAll('article, section, div, p, li, pre, blockquote');
        for (let i = genericBlocks.length - 1; i >= 0; i--) {
            const node = genericBlocks[i];
            if (!node) continue;
            if (node.closest('button, [role="button"], nav, header, footer, textarea, [contenteditable="true"], form')) {
                continue;
            }
            const text = (node.innerText || '').trim();
            if (!text || text.length < 20) continue;
            if (looksLikeActivityLog(text)) continue;
            if (looksLikeFeedbackFooter(text)) continue;
            return text;
        }

        return null;
    })()`,
    /** ストップボタンの存在チェック（生成中かどうかを判定） */
    STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const STOP_KEYWORDS = ['stop', 'interrupt', 'halt', '停止', '中断'];
        const SEND_KEYWORDS = ['send', 'submit', 'arrow-right', 'arrow-up', 'paper-plane', '送信'];
        const STOP_ICON_KEYWORDS = ['stop', 'halt', 'interrupt', 'circle-stop', 'square'];
        const CHAT_INPUT_SELECTOR = 'div[role="textbox"]:not(.xterm-helper-textarea), textarea, [contenteditable="true"]';

        const getRect = (el) => {
            const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
            return {
                top: Number(rect?.top) || 0,
                left: Number(rect?.left) || 0,
                width: Number(rect?.width) || 0,
                height: Number(rect?.height) || 0,
            };
        };

        const isVisible = (el) => {
            if (!el) return false;
            if (el.offsetParent !== null) return true;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = getRect(el);
            return rect.width > 0 && rect.height > 0;
        };

        const hasKeyword = (text, keywords) => {
            const normalized = (text || '').toLowerCase();
            return keywords.some((keyword) => normalized.includes(keyword));
        };

        const uniqueElements = (elements) => {
            const unique = [];
            const seen = new Set();
            for (const el of elements) {
                if (!el || seen.has(el)) continue;
                seen.add(el);
                unique.push(el);
            }
            return unique;
        };

        const pickLatestInput = () => {
            const inputs = [];
            for (const scope of scopes) {
                for (const input of Array.from(scope.querySelectorAll(CHAT_INPUT_SELECTOR))) {
                    if (!isVisible(input)) continue;
                    const rect = getRect(input);
                    if (rect.width < 80 || rect.height < 20) continue;
                    inputs.push({ input, rect });
                }
            }
            if (inputs.length === 0) return null;
            inputs.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            return inputs[0];
        };

        const pickComposerActionButton = () => {
            const inputCandidate = pickLatestInput();
            if (!inputCandidate) return null;

            const inputEl = inputCandidate.input;
            const inputRect = inputCandidate.rect;
            const scopedButtons = [];

            let node = inputEl;
            for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const buttons = Array.from(node.querySelectorAll('button, [role="button"]'));
                for (const btn of buttons) {
                    if (!isVisible(btn)) continue;
                    const rect = getRect(btn);
                    if (rect.width < 20 || rect.height < 20) continue;
                    scopedButtons.push({ btn, rect });
                }
                if (scopedButtons.length > 0) break;
            }

            const allButtons = scopedButtons.length > 0
                ? scopedButtons
                : (() => {
                    const candidates = [];
                    for (const scope of scopes) {
                        const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));
                        for (const btn of buttons) {
                            if (!isVisible(btn)) continue;
                            const rect = getRect(btn);
                            if (rect.width < 20 || rect.height < 20) continue;
                            const nearComposer = rect.top >= (inputRect.top - 120);
                            if (!nearComposer) continue;
                            candidates.push({ btn, rect });
                        }
                    }
                    return candidates;
                })();

            const unique = uniqueElements(allButtons);
            if (unique.length === 0) return null;
            unique.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            return unique[0].btn;
        };

        const classifyComposerAction = (button) => {
            if (!button) return { known: false, isGenerating: false };

            const blob = [
                button.textContent || '',
                button.getAttribute('aria-label') || '',
                button.getAttribute('title') || '',
                button.getAttribute('data-testid') || '',
                button.getAttribute('class') || '',
                (button.querySelector('svg')?.getAttribute('class')) || '',
            ].join(' ').toLowerCase();

            const hasArrowLikeIcon = !!button.querySelector('svg path, svg polyline, svg line');
            const hasDirectRectIcon = !!button.querySelector('svg > rect');
            const hasRectIcon = hasDirectRectIcon || (!!button.querySelector('svg rect') && !hasArrowLikeIcon);
            const looksStop = hasKeyword(blob, STOP_KEYWORDS) || hasKeyword(blob, STOP_ICON_KEYWORDS) || hasRectIcon;
            const looksSend = hasKeyword(blob, SEND_KEYWORDS) || (hasArrowLikeIcon && !hasRectIcon);

            if (looksStop) return { known: true, isGenerating: true };
            if (looksSend) return { known: true, isGenerating: false };
            return { known: false, isGenerating: false };
        };

        const stopSelectors = [
            'button[aria-label="Stop generating"]',
            'button[aria-label*="Stop" i]',
            '[role="button"][aria-label*="Stop" i]',
            'button[aria-label*="Interrupt" i]',
            '[role="button"][aria-label*="Interrupt" i]',
            'button[title*="Stop" i]',
            'button[title*="Interrupt" i]',
            'button[data-testid*="stop" i]',
            '[role="button"][data-testid*="stop" i]',
            'button.stop-button',
            '.stop-generating-button',
        ];

        for (const scope of scopes) {
            for (const sel of stopSelectors) {
                const el = scope.querySelector(sel);
                if (isVisible(el)) return true;
            }
        }

        const composerButton = pickComposerActionButton();
        const composerState = classifyComposerAction(composerButton);
        if (composerState.known) {
            return composerState.isGenerating;
        }

        for (const scope of scopes) {
            const controls = uniqueElements(scope.querySelectorAll('button, [role="button"]'));
            for (const control of controls) {
                if (!isVisible(control)) continue;
                const rawText = [
                    control.textContent || '',
                    control.getAttribute('aria-label') || '',
                    control.getAttribute('title') || '',
                    control.getAttribute('data-testid') || '',
                    control.getAttribute('class') || '',
                ].join(' ');
                if (!hasKeyword(rawText, STOP_KEYWORDS)) continue;
                return true;
            }
        }

        return false;
    })()`,
    /** ストップボタンをクリックしてLLM生成を中断する */
    CLICK_STOP_BUTTON: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const STOP_KEYWORDS = ['stop', 'interrupt', 'halt', '停止', '中断'];
        const SEND_KEYWORDS = ['send', 'submit', 'arrow-right', 'arrow-up', 'paper-plane', '送信'];
        const STOP_ICON_KEYWORDS = ['square', 'stop', 'halt', 'interrupt', 'circle-stop'];
        const CHAT_INPUT_SELECTOR = 'div[role="textbox"]:not(.xterm-helper-textarea), textarea, [contenteditable="true"]';

        const getRect = (el) => {
            const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
            return {
                top: Number(rect?.top) || 0,
                left: Number(rect?.left) || 0,
                width: Number(rect?.width) || 0,
                height: Number(rect?.height) || 0,
            };
        };

        const isVisible = (el) => {
            if (!el) return false;
            if (el.offsetParent !== null) return true;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = getRect(el);
            return rect.width > 0 && rect.height > 0;
        };

        const hasKeyword = (text, keywords) => {
            const normalized = (text || '').toLowerCase();
            return keywords.some((keyword) => normalized.includes(keyword));
        };

        const uniqueElements = (elements) => {
            const unique = [];
            const seen = new Set();
            for (const el of elements) {
                if (!el || seen.has(el)) continue;
                seen.add(el);
                unique.push(el);
            }
            return unique;
        };

        const clickControl = (control) => {
            if (!control || typeof control.click !== 'function') return false;
            control.click();
            return true;
        };

        const pickLatestInput = () => {
            const inputs = [];
            for (const scope of scopes) {
                for (const input of Array.from(scope.querySelectorAll(CHAT_INPUT_SELECTOR))) {
                    if (!isVisible(input)) continue;
                    const rect = getRect(input);
                    if (rect.width < 80 || rect.height < 20) continue;
                    inputs.push({ input, rect });
                }
            }
            if (inputs.length === 0) return null;
            inputs.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            return inputs[0];
        };

        const pickComposerActionButton = () => {
            const inputCandidate = pickLatestInput();
            if (!inputCandidate) return null;

            const inputEl = inputCandidate.input;
            const inputRect = inputCandidate.rect;
            const scopedButtons = [];

            let node = inputEl;
            for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const buttons = Array.from(node.querySelectorAll('button, [role="button"]'));
                for (const btn of buttons) {
                    if (!isVisible(btn)) continue;
                    const rect = getRect(btn);
                    if (rect.width < 20 || rect.height < 20) continue;
                    scopedButtons.push({ btn, rect });
                }
                if (scopedButtons.length > 0) break;
            }

            const allButtons = scopedButtons.length > 0
                ? scopedButtons
                : (() => {
                    const candidates = [];
                    for (const scope of scopes) {
                        const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));
                        for (const btn of buttons) {
                            if (!isVisible(btn)) continue;
                            const rect = getRect(btn);
                            if (rect.width < 20 || rect.height < 20) continue;
                            const nearComposer = rect.top >= (inputRect.top - 120);
                            if (!nearComposer) continue;
                            candidates.push({ btn, rect });
                        }
                    }
                    return candidates;
                })();

            const unique = uniqueElements(allButtons);
            if (unique.length === 0) return null;
            unique.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            return unique[0].btn;
        };

        const classifyComposerAction = (button) => {
            if (!button) return { known: false, isGenerating: false };

            const blob = [
                button.textContent || '',
                button.getAttribute('aria-label') || '',
                button.getAttribute('title') || '',
                button.getAttribute('data-testid') || '',
                button.getAttribute('class') || '',
                (button.querySelector('svg')?.getAttribute('class')) || '',
            ].join(' ').toLowerCase();

            const hasArrowLikeIcon = !!button.querySelector('svg path, svg polyline, svg line');
            const hasDirectRectIcon = !!button.querySelector('svg > rect');
            const hasRectIcon = hasDirectRectIcon || (!!button.querySelector('svg rect') && !hasArrowLikeIcon);
            const looksStop = hasKeyword(blob, STOP_KEYWORDS) || hasKeyword(blob, STOP_ICON_KEYWORDS) || hasRectIcon;
            const looksSend = hasKeyword(blob, SEND_KEYWORDS) || (hasArrowLikeIcon && !hasRectIcon);

            if (looksStop) return { known: true, isGenerating: true };
            if (looksSend) return { known: true, isGenerating: false };
            return { known: false, isGenerating: false };
        };

        const composerButton = pickComposerActionButton();
        const composerState = classifyComposerAction(composerButton);
        if (composerState.known && composerState.isGenerating && clickControl(composerButton)) {
            return { ok: true, method: 'composer-action' };
        }

        const stopSelectors = [
            'button[aria-label="Stop generating"]',
            'button[aria-label*="Stop" i]',
            '[role="button"][aria-label*="Stop" i]',
            'button[aria-label*="Interrupt" i]',
            '[role="button"][aria-label*="Interrupt" i]',
            'button[title*="Stop" i]',
            'button[title*="Interrupt" i]',
            'button[data-testid*="stop" i]',
            '[role="button"][data-testid*="stop" i]',
            'button.stop-button',
            '.stop-generating-button',
        ];

        for (const scope of scopes) {
            for (const sel of stopSelectors) {
                const el = scope.querySelector(sel);
                if (!isVisible(el)) continue;
                if (clickControl(el)) {
                    return { ok: true, method: 'selector', selector: sel };
                }
            }

            const controls = uniqueElements(scope.querySelectorAll('button, [role="button"], [class*="cursor-pointer"], [tabindex]'));
            for (const control of controls) {
                if (!isVisible(control)) continue;
                const rawText = [
                    control.textContent || '',
                    control.getAttribute('aria-label') || '',
                    control.getAttribute('title') || '',
                    control.getAttribute('data-testid') || '',
                    control.getAttribute('class') || '',
                ].join(' ');

                const svg = control.querySelector('svg');
                const hasArrowLikeIcon = !!control.querySelector('svg path, svg polyline, svg line');
                const hasDirectRectIcon = !!control.querySelector('svg > rect');
                const hasRectIcon = hasDirectRectIcon || (!!control.querySelector('svg rect') && !hasArrowLikeIcon);
                const svgText = svg
                    ? [
                        svg.getAttribute('class') || '',
                        svg.getAttribute('data-testid') || '',
                        svg.getAttribute('aria-label') || '',
                    ].join(' ')
                    : '';

                const looksLikeRedStop = hasKeyword(rawText, ['red', 'danger', 'destructive']) && hasRectIcon;
                if (hasKeyword(rawText, STOP_KEYWORDS) || hasKeyword(svgText, STOP_ICON_KEYWORDS) || looksLikeRedStop) {
                    if (clickControl(control)) {
                        return { ok: true, method: 'heuristic' };
                    }
                }
            }
        }

        return { ok: false, error: 'ストップボタンが見つかりません。LLMが動作中でない可能性があります。' };
    })()`,
    /** LLMのアクティビティ/ツール使用情報を取得する（"Analyzed ~", "Reading ~" など） */
    ACTIVITY_STATUS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;
        const activities = [];

        // 1. ツール使用インジケーター（Analyzed, Read, Wrote, Ran, etc.）
        //    通常は小さなテキストやバッジとして表示される
        const toolIndicators = scope.querySelectorAll(
            '[class*="tool-"], [class*="activity"], [class*="status-message"], ' +
            '[class*="tool_call"], [class*="thinking"], [class*="loading"]'
        );
        for (const el of toolIndicators) {
            const text = (el.textContent || '').trim();
            if (text && text.length < 200 && text.length > 2) {
                activities.push(text);
            }
        }

        // 2. Cascade特有のステータスバッジ（"Analyzing...", "Writing...", etc.）
        const badges = scope.querySelectorAll(
            '.inline-flex, .badge, [class*="chip"], [class*="tag"]'
        );
        for (const el of badges) {
            const text = (el.textContent || '').trim();
            if (text && /^(Analy|Read|Writ|Ran |Creat|Edit|Search|Generat|Think|Plan)/i.test(text)) {
                activities.push(text);
            }
        }

        // 3. 折りたたまれたセクション（"Analyzed 3 files", "Read 2 files" 等）
        const collapsibles = scope.querySelectorAll(
            'details summary, [role="button"][aria-expanded], ' +
            '[class*="collapsible"] > :first-child, [class*="accordion"] > :first-child'
        );
        for (const el of collapsibles) {
            const text = (el.textContent || '').trim();
            if (text && text.length < 200 && text.length > 2) {
                activities.push(text);
            }
        }

        // 4. スピナー/ローディング隣接テキスト
        const spinners = scope.querySelectorAll(
            '[class*="spinner"], [class*="loading"], [class*="animate-spin"]'
        );
        for (const spinner of spinners) {
            const parent = spinner.parentElement;
            if (parent) {
                const text = (parent.textContent || '').trim();
                if (text && text.length < 200 && text.length > 2) {
                    activities.push(text);
                }
            }
        }

        // 5. 最新の短い非応答テキスト（AIの状況報告ライン）
        //    「〜を分析しました」「〜を読み込んでいます」のようなアクティビティ行
        const allDivs = scope.querySelectorAll('div, span, p');
        for (const el of allDivs) {
            if (el.children.length > 3) continue; // 多数の子要素はスキップ
            const text = (el.textContent || '').trim();
            if (!text || text.length > 150 || text.length < 5) continue;
            // アクティビティパターンにマッチ
            if (/^(Analy[sz]|Read|Writ|Ran |Creat|Edit|Search|Generat|Execut|Check|Install|Build|Deploy|Fix|Updat|Delet|Modif|Refactor|Test|Debug|Compil|Fetch|Download|Upload|Commit|Push|Pull|Merg)/i.test(text)) {
                activities.push(text);
            }
            // 日本語パターン
            if (/^(分析|読み|書き|実行|作成|編集|検索|生成|確認|インストール|ビルド|デプロイ|修正|更新|削除|リファクタ|テスト|デバッグ|コンパイル)/i.test(text)) {
                activities.push(text);
            }
        }

        // 重複を除去して最後の6件を返す
        const unique = [...new Set(activities)];
        return unique.slice(-6);
    })()`,
};

/** レスポンス生成のフェーズ */
export type ResponsePhase = 'waiting' | 'thinking' | 'generating' | 'complete' | 'timeout';

export interface ResponseMonitorOptions {
    /** CDPサービスインスタンス */
    cdpService: CdpService;
    /** ポーリング間隔（ミリ秒）デフォルト: 1000ms */
    pollIntervalMs?: number;
    /** 最大監視時間（ミリ秒）デフォルト: 300000ms（5分） */
    maxDurationMs?: number;
    /** ストップボタン消失を何回連続で確認したら完了とするか デフォルト: 1 */
    stopButtonGoneConfirmCount?: number;
    /** 完了判定前に、テキスト更新が止まっている必要がある安定時間（ミリ秒）デフォルト: 10000 */
    completionStabilityMs?: number;
    /** 生成開始後、テキスト更新がこの時間を超えて止まったら完了扱いにする（ミリ秒、0で無効） */
    generatingStallMs?: number;
    /** 生成開始後、テキスト更新がこの時間を超えて止まったら完了扱いにする（ミリ秒、generatingStallMsより優先） */
    noUpdateTimeoutMs?: number;
    /** ストップ消失後、本文未取得のままcompleteにしてよい最短待機時間（ミリ秒） */
    noTextCompletionDelayMs?: number;
    /** テキスト更新時のコールバック */
    onProgress?: (text: string) => void;
    /** 生成完了時のコールバック */
    onComplete?: (finalText: string) => void;
    /** タイムアウト時のコールバック */
    onTimeout?: (lastText: string) => void;
    /** フェーズ変更時のコールバック */
    onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    /** アクティビティ更新時のコールバック（"Analyzed ~" 等） */
    onActivity?: (activities: string[]) => void;
}

/**
 * AIレスポンスの抽出とプログレス監視クラス
 *
 * ポーリングによりAntigravityのDOMからAIの応答テキストを定期的に取得し、
 * テキストの変化・生成完了・タイムアウトを検知してコールバックで通知する。
 *
 * 完了判定:
 *   - ストップボタンが一度出現した後、連続N回（デフォルト1回）消失を確認
 *   - かつテキストが安定時間（デフォルト10秒）変化しなければ完了
 *   - 生成開始後、テキスト更新が一定時間（デフォルト60秒）止まったらフォールバック完了
 *   - 5分経過でタイムアウト
 */
export class ResponseMonitor {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private maxDurationMs: number;
    private stopButtonGoneConfirmCount: number;
    private completionStabilityMs: number;
    private noUpdateTimeoutMs: number;
    private noTextCompletionDelayMs: number;
    private onProgress?: (text: string) => void;
    private onComplete?: (finalText: string) => void;
    private onTimeout?: (lastText: string) => void;
    private onPhaseChange?: (phase: ResponsePhase, text: string | null) => void;
    private onActivity?: (activities: string[]) => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private timeoutTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastText: string | null = null;
    private startTime: number = 0;

    /** 送信前の既存テキスト（古い応答を除外するため） */
    private baselineText: string | null = null;
    /** ストップボタンが一度でも出現したか（生成開始を検知済みか） */
    private generationStarted: boolean = false;
    /** 現在のフェーズ */
    private currentPhase: ResponsePhase = 'waiting';
    /** ストップボタン消失の連続確認カウント */
    private stopGoneCount: number = 0;
    /** 最後に検出したアクティビティ（重複通知防止） */
    private lastActivities: string = '';
    /** 最後にテキスト更新を検出した時刻 */
    private lastTextChangeAt: number = 0;

    constructor(options: ResponseMonitorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxDurationMs = options.maxDurationMs ?? 300000;
        this.stopButtonGoneConfirmCount = options.stopButtonGoneConfirmCount ?? 1;
        this.completionStabilityMs = options.completionStabilityMs ?? 10000;
        this.noUpdateTimeoutMs = options.noUpdateTimeoutMs ?? options.generatingStallMs ?? 60000;
        this.noTextCompletionDelayMs = options.noTextCompletionDelayMs ?? Math.min(15000, this.noUpdateTimeoutMs);
        this.onProgress = options.onProgress;
        this.onComplete = options.onComplete;
        this.onTimeout = options.onTimeout;
        this.onPhaseChange = options.onPhaseChange;
        this.onActivity = options.onActivity;
    }

    /**
     * 監視を開始する。
     * まず現在のテキストをベースラインとして記録し、
     * 内部でポーリングタイマーとタイムアウトタイマーを設定する。
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastText = null;
        this.generationStarted = false;
        this.currentPhase = 'waiting';
        this.stopGoneCount = 0;
        this.lastActivities = '';
        this.startTime = Date.now();
        this.lastTextChangeAt = this.startTime;

        // 初期フェーズ通知
        this.setPhase('waiting', null);

        // ベースライン取得: 送信前の既存テキストを記録して除外対象にする
        try {
            const baseResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.RESPONSE_TEXT,
                returnByValue: true,
                awaitPromise: true,
            });
            this.baselineText = baseResult?.result?.value ?? null;
        } catch {
            this.baselineText = null;
        }

        // タイムアウトタイマーの設定
        if (this.maxDurationMs > 0) {
            this.timeoutTimer = setTimeout(async () => {
                const lastText = this.lastText ?? '';
                this.setPhase('timeout', lastText);
                await this.stop();
                this.onTimeout?.(lastText);
            }, this.maxDurationMs);
        }

        // ポーリングの開始
        this.schedulePoll();
    }

    /**
     * 監視を停止する（外部から呼び出し可能）。
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    /** フェーズを変更し、コールバックを呼ぶ */
    private setPhase(phase: ResponsePhase, text: string | null): void {
        if (this.currentPhase !== phase) {
            this.currentPhase = phase;
            this.onPhaseChange?.(phase, text);
        }
    }

    /** 現在のフェーズを取得 */
    getPhase(): ResponsePhase {
        return this.currentPhase;
    }

    /** 次のポーリングをスケジュールする */
    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    /**
     * 1回のポーリング処理:
     *   1. ストップボタンの存在チェック（生成中かどうか）
     *   2. アクティビティ情報の取得
     *   3. 最新テキストの取得
     *   4. テキスト変化があれば onProgress コールバック
     *   5. 生成完了なら onComplete コールバックを呼んで停止
     */
    private async poll(): Promise<void> {
        try {
            // ストップボタンの存在チェック（生成中かどうか）
            const stopResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.STOP_BUTTON,
                returnByValue: true,
                awaitPromise: true,
            });
            const isGenerating: boolean = stopResult?.result?.value ?? false;

            // ストップボタンが出現したら生成開始を記録
            if (isGenerating) {
                if (!this.generationStarted) {
                    this.generationStarted = true;
                    this.setPhase('thinking', null);
                }
                // ストップボタンが再度出現 → カウンターリセット
                this.stopGoneCount = 0;
            }

            // アクティビティ情報の取得
            try {
                const actResult = await this.cdpService.call('Runtime.evaluate', {
                    expression: RESPONSE_SELECTORS.ACTIVITY_STATUS,
                    returnByValue: true,
                    awaitPromise: true,
                });
                const rawActivities: string[] = actResult?.result?.value ?? [];
                const activities = rawActivities;
                if (activities.length > 0) {
                    const actStr = JSON.stringify(activities);
                    if (actStr !== this.lastActivities) {
                        this.lastActivities = actStr;
                        this.onActivity?.(activities);
                    }
                }
            } catch {
                // アクティビティ取得失敗は無視
            }

            // テキスト取得
            const textResult = await this.cdpService.call('Runtime.evaluate', {
                expression: RESPONSE_SELECTORS.RESPONSE_TEXT,
                returnByValue: true,
                awaitPromise: true,
            });
            const currentText: string | null = textResult?.result?.value ?? null;

            // ベースライン（送信前の古い応答）と同じテキストは送信直後のみ無視
            // 生成開始後も同一テキストが返るケースがあるため、恒久的には除外しない。
            if (
                currentText !== null &&
                currentText === this.baselineText &&
                this.lastText === null &&
                (Date.now() - this.startTime) < 5000
            ) {
                return;
            }

            // テキストが変化した場合のみ通知
            if (currentText !== null && currentText !== this.lastText) {
                this.lastText = currentText;

                // テキストが来たらgeneratingフェーズに移行
                if (this.currentPhase === 'waiting' || this.currentPhase === 'thinking') {
                    this.setPhase('generating', currentText);
                    if (!this.generationStarted) {
                        this.generationStarted = true;
                    }
                }

                this.onProgress?.(currentText);

                // テキストが変化した = まだ生成中
                this.stopGoneCount = 0;
                this.lastTextChangeAt = Date.now();
            }

            const hasAnyText = !!(this.lastText && this.lastText.trim().length > 0);

            // 完了判定: ストップボタンが消失し、連続N回確認で完了
            if (!isGenerating && (this.generationStarted || hasAnyText)) {
                // 本文未取得の状態では、Stop消失直後の誤完了を避けるため少し待つ
                if (!hasAnyText) {
                    const elapsedFromStart = Date.now() - this.startTime;
                    if (elapsedFromStart < this.noTextCompletionDelayMs) {
                        return;
                    }
                }
                this.stopGoneCount++;
                if (this.stopGoneCount >= this.stopButtonGoneConfirmCount) {
                    const stableFor = Date.now() - this.lastTextChangeAt;
                    if (stableFor < this.completionStabilityMs) {
                        return;
                    }
                    logger.info(`[ResponseMonitor] ストップボタン消失を${this.stopGoneCount}回連続確認。完了と判定。`);
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    this.onComplete?.(finalText);
                    return;
                }
            }

            // フォールバック完了判定:
            // ストップボタン誤検知で isGenerating=true が張り付いても、
            // テキスト更新が長時間止まっていれば完了扱いにする
            if (this.noUpdateTimeoutMs > 0 && (this.generationStarted || hasAnyText)) {
                const stalledFor = Date.now() - this.lastTextChangeAt;
                if (stalledFor >= this.noUpdateTimeoutMs) {
                    logger.warn(`[ResponseMonitor] 生成中判定が継続していますが、${stalledFor}ms更新が無いため完了扱いにします。`);
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    this.onComplete?.(finalText);
                    return;
                }
            }
        } catch (error) {
            // CDPエラーは無視して監視を継続（クラッシュさせない）
            logger.error('[ResponseMonitor] ポーリング中にエラーが発生しました:', error);
        }
    }

    /** 現在監視中かどうかを返す */
    isActive(): boolean {
        return this.isRunning;
    }

    /** 最後に取得したテキストを返す */
    getLastText(): string | null {
        return this.lastText;
    }

    /**
     * ストップボタンをクリックしてLLM生成を中断する。
     * 監視中の場合は監視も停止する。
     * @returns クリック結果
     */
    async clickStopButton(): Promise<{ ok: boolean; method?: string; error?: string }> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: RESPONSE_SELECTORS.CLICK_STOP_BUTTON,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const value = result?.result?.value;

            // 監視中なら停止する
            if (this.isRunning) {
                await this.stop();
            }

            return value ?? { ok: false, error: 'CDP評価結果が空です' };
        } catch (error: any) {
            return { ok: false, error: error.message || 'ストップボタンのクリックに失敗しました' };
        }
    }
}
