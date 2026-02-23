import { logger } from '../utils/logger';
import { CdpService } from './cdpService';
import {
    classifyAssistantSegments,
    extractAssistantSegmentsPayloadScript,
} from './assistantDomExtractor';

/** Antigravity UIのDOMセレクター定数（レスポンス抽出用） */
export const RESPONSE_SELECTORS = {
    /** DOM構造で assistant/thinking/tool/feedback を抽出する */
    RESPONSE_TEXT: extractAssistantSegmentsPayloadScript(),
    /** 先頭側（DOM順）からテキストを取得する補助セレクタ（baseline回避用） */
    RESPONSE_TEXT_FROM_START: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scopes = [panel, document].filter(Boolean);

        const looksLikeActivityLog = (text) => {
            const normalized = (text || '').trim().toLowerCase();
            if (!normalized) return false;
            const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran|処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中)/i;
            return activityPattern.test(normalized) && normalized.length <= 220;
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
        for (const scope of scopes) {
            for (const selector of candidateSelectors) {
                const nodes = scope.querySelectorAll(selector);
                for (const node of nodes) {
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    candidates.push(node);
                }
            }
        }

        for (let i = 0; i < candidates.length; i++) {
            const text = (candidates[i].innerText || candidates[i].textContent || '').replace(/\\r/g, '').trim();
            if (!text || text.length < 8) continue;
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
        const diagnostics = {
            panelFound: !!panel,
            scopeCount: scopes.length,
            decision: 'none',
            matchedSelector: null,
            composerCandidateCount: 0,
            composerKnownStopCount: 0,
            composerKnownSendCount: 0,
            fallbackStopKeywordHits: 0,
        };

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
            if (!inputCandidate) return [];

            const inputEl = inputCandidate.input;
            const inputRect = inputCandidate.rect;
            const scopedButtons = [];

            let node = inputEl;
            for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const buttons = node.querySelectorAll('button, [role="button"]');
                for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if (!isVisible(btn)) continue;
                    const rect = getRect(btn);
                    if (rect.width < 12 || rect.height < 12) continue;
                    scopedButtons.push({ btn, rect });
                }
                if (scopedButtons.length > 0) break;
            }

            const allButtons = scopedButtons.length > 0
                ? scopedButtons
                : (() => {
                    const candidates = [];
                    for (const scope of scopes) {
                        const buttons = scope.querySelectorAll('button, [role="button"]');
                        for (let i = 0; i < buttons.length; i++) {
                            const btn = buttons[i];
                            if (!isVisible(btn)) continue;
                            const rect = getRect(btn);
                            if (rect.width < 12 || rect.height < 12) continue;
                            const nearComposer = rect.top >= (inputRect.top - 120);
                            if (!nearComposer) continue;
                            candidates.push({ btn, rect });
                        }
                    }
                    return candidates;
                })();

            const unique = uniqueElements(allButtons);
            if (unique.length === 0) return [];
            unique.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            const result = [];
            for (let i = 0; i < unique.length; i++) {
                result.push(unique[i].btn);
            }
            return result;
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
            const hasSvgPath = !!button.querySelector('svg path');
            const hasRectIcon = (hasDirectRectIcon && !hasSvgPath) || (!!button.querySelector('svg rect') && !hasArrowLikeIcon);
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
                if (isVisible(el)) {
                    diagnostics.decision = 'explicit-selector';
                    diagnostics.matchedSelector = sel;
                    return { isGenerating: true, diagnostics };
                }
            }
        }

        const composerButtons = pickComposerActionButton();
        diagnostics.composerCandidateCount = composerButtons.length;
        for (let i = 0; i < composerButtons.length; i++) {
            const btn = composerButtons[i];
            const state = classifyComposerAction(btn);
            if (state.known && state.isGenerating) {
                diagnostics.composerKnownStopCount += 1;
                diagnostics.decision = 'composer-action';
                return { isGenerating: true, diagnostics };
            }
            if (state.known && !state.isGenerating) {
                diagnostics.composerKnownSendCount += 1;
            }
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
                diagnostics.fallbackStopKeywordHits += 1;
                diagnostics.decision = 'keyword-fallback';
                return { isGenerating: true, diagnostics };
            }
        }

        return { isGenerating: false, diagnostics };
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
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (!el) continue;
                const key = el.btn || el;
                if (seen.has(key)) continue;
                seen.add(key);
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
            if (!inputCandidate) return [];

            const inputEl = inputCandidate.input;
            const inputRect = inputCandidate.rect;
            const scopedButtons = [];

            let node = inputEl;
            for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const buttons = node.querySelectorAll('button, [role="button"]');
                for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if (!isVisible(btn)) continue;
                    const rect = getRect(btn);
                    if (rect.width < 12 || rect.height < 12) continue;
                    scopedButtons.push({ btn, rect });
                }
                if (scopedButtons.length > 0) break;
            }

            const allButtons = scopedButtons.length > 0
                ? scopedButtons
                : (() => {
                    const candidates = [];
                    for (const scope of scopes) {
                        const buttons = scope.querySelectorAll('button, [role="button"]');
                        for (let i = 0; i < buttons.length; i++) {
                            const btn = buttons[i];
                            if (!isVisible(btn)) continue;
                            const rect = getRect(btn);
                            if (rect.width < 12 || rect.height < 12) continue;
                            const nearComposer = rect.top >= (inputRect.top - 120);
                            if (!nearComposer) continue;
                            candidates.push({ btn, rect });
                        }
                    }
                    return candidates;
                })();

            const unique = uniqueElements(allButtons);
            if (unique.length === 0) return [];
            unique.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) > 2) return b.rect.top - a.rect.top;
                return b.rect.left - a.rect.left;
            });
            const result = [];
            for (let i = 0; i < unique.length; i++) {
                result.push(unique[i].btn);
            }
            return result;
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
            const hasSvgPath = !!button.querySelector('svg path');
            const hasRectIcon = (hasDirectRectIcon && !hasSvgPath) || (!!button.querySelector('svg rect') && !hasArrowLikeIcon);
            const looksStop = hasKeyword(blob, STOP_KEYWORDS) || hasKeyword(blob, STOP_ICON_KEYWORDS) || hasRectIcon;
            const looksSend = hasKeyword(blob, SEND_KEYWORDS) || (hasArrowLikeIcon && !hasRectIcon);

            if (looksStop) return { known: true, isGenerating: true };
            if (looksSend) return { known: true, isGenerating: false };
            return { known: false, isGenerating: false };
        };

        const composerButtons = pickComposerActionButton();
        for (let i = 0; i < composerButtons.length; i++) {
            const btn = composerButtons[i];
            const state = classifyComposerAction(btn);
            if (state.known && state.isGenerating && clickControl(btn)) {
                return { ok: true, method: 'composer-action' };
            }
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
                const hasSvgPath = !!control.querySelector('svg path');
                const hasRectIcon = (hasDirectRectIcon && !hasSvgPath) || (!!control.querySelector('svg rect') && !hasArrowLikeIcon);
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
            if (/^(Analy[sz]|Read|Writ|Ran |Creat|Edit|Search|Generat|Execut|Check|Install|Build|Deploy|Fix|Updat|Delet|Modif|Refactor|Test|Debug|Compil|Fetch|Download|Upload|Commit|Push|Pull|Merg|Thought|Think|Look|Open|Clos|Connect|Send|Receiv|Pars|Process|Load|Sav|Scan|Validat|Compar|Comput|Evaluat|Launch)/i.test(text)) {
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
    /** モデルのクォータ上限到達エラーを検出する（エラーバナー/トースト要素のみ） */
    QUOTA_ERROR: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;

        // エラーバナー、トースト、アラート要素のみを対象にする
        const errorSelectors = [
            '[role="alert"]',
            '[class*="error"]',
            '[class*="warning"]',
            '[class*="toast"]',
            '[class*="banner"]',
            '[class*="notification"]',
            '[class*="alert"]',
            '[class*="quota"]',
            '[class*="rate-limit"]',
        ];
        const errorElements = scope.querySelectorAll(errorSelectors.join(', '));
        for (const el of errorElements) {
            // アシスタントメッセージ内やコードブロック内の要素は除外
            if (el.closest('.rendered-markdown, .prose, pre, code, [data-message-author-role="assistant"], [data-message-role="assistant"], [class*="message-content"]')) {
                continue;
            }
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('model quota reached') || text.includes('rate limit') || text.includes('quota exceeded')
                || text.includes('クォータ') || text.includes('レート制限')) {
                return true;
            }
        }
        return false;
    })()`,
    /** 待機が長引いた時の診断情報（デバッグ用） */
    RESPONSE_DIAGNOSTICS: `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        const scope = panel || document;
        const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();

        const selectors = {
            renderedMarkdown: '.rendered-markdown',
            assistantRole: '[data-message-author-role="assistant"], [data-message-role="assistant"]',
            messageContent: '[class*="assistant-message"], [class*="message-content"], [class*="markdown-body"], .prose',
            activityLike: '[class*="tool-"], [class*="activity"], [class*="status-message"], [class*="tool_call"], [class*="thinking"], [class*="loading"]',
            input: 'div[role="textbox"]:not(.xterm-helper-textarea), textarea, [contenteditable="true"]',
        };

        const counts = {};
        for (const [key, selector] of Object.entries(selectors)) {
            counts[key] = scope.querySelectorAll(selector).length;
        }

        const sampleTexts = [];
        const sampleNodes = scope.querySelectorAll('.rendered-markdown, [data-message-author-role="assistant"], [data-message-role="assistant"], .prose, [class*="message-content"]');
        for (let i = sampleNodes.length - 1; i >= 0 && sampleTexts.length < 3; i--) {
            const txt = clean(sampleNodes[i]?.innerText || sampleNodes[i]?.textContent || '');
            if (!txt) continue;
            sampleTexts.push(txt.slice(0, 180));
        }

        return {
            panelFound: !!panel,
            counts,
            sampleTexts,
        };
    })()`,
};

/** レスポンス生成のフェーズ */
export type ResponsePhase = 'waiting' | 'thinking' | 'generating' | 'complete' | 'timeout' | 'quotaReached';

type StopDetectionDiagnostics = {
    panelFound?: boolean;
    scopeCount?: number;
    decision?: string;
    matchedSelector?: string | null;
    composerCandidateCount?: number;
    composerKnownStopCount?: number;
    composerKnownSendCount?: number;
    fallbackStopKeywordHits?: number;
};

type StopDetectionResult = {
    isGenerating: boolean;
    diagnostics?: StopDetectionDiagnostics;
};

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
    /**
     * テキスト安定性のみで完了判定する独立パスの待機時間（ミリ秒）。
     * ストップボタン検出に依存せず、テキストがこの時間変化しなければ完了。
     * デフォルト: 15000ms（15秒）。0で無効。
     */
    textStabilityCompleteMs?: number;
    /**
     * ネットワーク完了検知後のテキスト安定待ち時間（ミリ秒）。
     * Network.loadingFinished 発火後、この時間テキストが安定していれば完了。
     * デフォルト: 3000ms（3秒）。
     */
    networkCompleteDelayMs?: number;
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
 * 完了判定（3段構え）:
 *   1. (最速) Network.loadingFinished — ストリーミングAPI終了を検知 → 3秒安定待ち → 完了
 *   2. (安定) テキスト安定 — テキストが15秒変化しなければ完了（ストップボタン非依存）
 *   3. (フォールバック) 更新停止 — 30秒間テキスト更新なしで完了
 *   既存のストップボタン検出もそのまま維持（動く環境では高速検知に貢献）
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
    private textStabilityCompleteMs: number;
    private networkCompleteDelayMs: number;
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
    /** ストップボタン（生成中UI）を1度でも検出したか */
    private stopButtonSeenOnce: boolean = false;
    /** クォータエラーが検出されたがテキスト取得済みのためフラグのみ */
    private quotaDetected: boolean = false;
    /** 現在のフェーズ */
    private currentPhase: ResponsePhase = 'waiting';
    /** ストップボタン消失の連続確認カウント */
    private stopGoneCount: number = 0;
    /** 最後に検出したアクティビティ（重複通知防止） */
    private lastActivities: string = '';
    /** 直近の抽出ソース（DOM成功時のみ dom-structured） */
    private lastExtractionSource: 'dom-structured' | 'legacy-fallback' = 'legacy-fallback';
    /** 直近DOM抽出で得たアクティビティ行 */
    private lastDomActivityLines: string[] = [];
    /** 最後にテキスト更新を検出した時刻 */
    private lastTextChangeAt: number = 0;
    /** 最後に「進捗シグナル」を検出した時刻（テキスト/アクティビティ変化/ネットワーク完了など） */
    private lastSignalAt: number = 0;
    /** アクティビティを一度でも検出したか（ストップ/本文が取れない環境向け） */
    private activitySeen: boolean = false;
    /** ポーリング実行回数（デバッグ用） */
    private pollCount: number = 0;
    /** ベースライン抑制が有効か（前回応答の再取得を避ける） */
    private baselineSuppressionActive: boolean = false;

    // --- ネットワークベース完了検知 ---
    /** 追跡中のストリーミングリクエストID集合 */
    private trackedRequestIds: Set<string> = new Set();
    /** ネットワーク完了シグナルが発火した時刻（0 = 未発火） */
    private networkFinishedAt: number = 0;
    /** CDP イベントリスナーの参照（stop時に解除用） */
    private networkRequestHandler: ((params: any) => void) | null = null;
    private networkFinishedHandler: ((params: any) => void) | null = null;

    constructor(options: ResponseMonitorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxDurationMs = options.maxDurationMs ?? 300000;
        this.stopButtonGoneConfirmCount = options.stopButtonGoneConfirmCount ?? 1;
        this.completionStabilityMs = options.completionStabilityMs ?? 1500;
        this.noUpdateTimeoutMs = options.noUpdateTimeoutMs ?? options.generatingStallMs ?? 30000;
        this.noTextCompletionDelayMs = options.noTextCompletionDelayMs ?? Math.min(15000, this.noUpdateTimeoutMs);
        this.textStabilityCompleteMs = options.textStabilityCompleteMs ?? 15000;
        this.networkCompleteDelayMs = options.networkCompleteDelayMs ?? 3000;
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
     * ネットワークイベント購読も開始する。
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastText = null;
        this.generationStarted = false;
        this.stopButtonSeenOnce = false;
        this.currentPhase = 'waiting';
        this.stopGoneCount = 0;
        this.lastActivities = '';
        this.startTime = Date.now();
        this.lastTextChangeAt = this.startTime;
        this.lastSignalAt = this.startTime;
        this.activitySeen = false;
        this.pollCount = 0;
        this.baselineSuppressionActive = false;
        this.lastExtractionSource = 'legacy-fallback';
        this.lastDomActivityLines = [];
        this.trackedRequestIds.clear();
        this.networkFinishedAt = 0;

        logger.info(
            `[ResponseMonitor] start: pollInterval=${this.pollIntervalMs}ms maxDuration=${this.maxDurationMs}ms ` +
            `stopGoneConfirm=${this.stopButtonGoneConfirmCount} completionStability=${this.completionStabilityMs}ms ` +
            `textStability=${this.textStabilityCompleteMs}ms noTextDelay=${this.noTextCompletionDelayMs}ms ` +
            `noUpdateTimeout=${this.noUpdateTimeoutMs}ms ` +
            `networkDelay=${this.networkCompleteDelayMs}ms`,
        );

        // 初期フェーズ通知
        this.setPhase('waiting', null);

        // ベースライン取得: 送信前の既存テキストを記録して除外対象にする
        try {
            const baseResult = await this.cdpService.call(
                'Runtime.evaluate',
                this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_TEXT, true),
            );
            const baseline = this.parseResponseSnapshot(baseResult?.result?.value);
            this.baselineText = baseline.currentText;
            this.baselineSuppressionActive = !!(this.baselineText && this.baselineText.trim().length > 0);
            logger.debug(
                `[ResponseMonitor] baseline captured (len=${this.baselineText?.length ?? 0}, source=${baseline.source})`,
            );
        } catch {
            this.baselineText = null;
            this.baselineSuppressionActive = false;
            logger.debug('[ResponseMonitor] baseline capture failed');
        }

        // ネットワークイベント購読を開始
        this.subscribeNetworkEvents();

        // タイムアウトタイマーの設定
        if (this.maxDurationMs > 0) {
            this.timeoutTimer = setTimeout(async () => {
                const lastText = this.lastText ?? '';
                this.setPhase('timeout', lastText);
                await this.stop();
                await this.invokeTimeoutCallback(lastText);
            }, this.maxDurationMs);
        }

        // ポーリングの開始
        this.schedulePoll();
    }

    /**
     * Network CDP イベントを購読し、ストリーミングAPIリクエストの完了を追跡する。
     */
    private subscribeNetworkEvents(): void {
        const STREAMING_URL_PATTERN = /\/api\/|stream|chat|generate|completions|messages/i;
        const STATIC_ASSET_PATTERN = /\.(?:json|js|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|otf)(?:\?|#|$)/i;
        const IGNORE_HOST_PATTERN = /(?:^|\/\/)(?:main\.)?vscode-cdn\.net(?:\/|$)/i;
        const TRACKABLE_TYPES = new Set(['Fetch', 'XHR', 'EventSource', 'Other']);

        this.networkRequestHandler = (params: any) => {
            if (!this.isRunning) return;
            const url = params?.request?.url || '';
            const type = params?.type as string | undefined;
            const isStreamingLikeUrl = STREAMING_URL_PATTERN.test(url);
            const isStaticAsset = STATIC_ASSET_PATTERN.test(url);
            const isIgnoredHost = IGNORE_HOST_PATTERN.test(url);
            const isTrackableType = !type || TRACKABLE_TYPES.has(type);

            if (!isStreamingLikeUrl || isStaticAsset || isIgnoredHost || !isTrackableType) {
                logger.debug(
                    `[ResponseMonitor] Network request ignored: ${params?.requestId ?? 'unknown'} ` +
                    `type=${type ?? 'unknown'} url=${url}`,
                );
                return;
            }

            this.trackedRequestIds.add(params.requestId);
            if (!this.generationStarted) {
                this.generationStarted = true;
                this.setPhase('thinking', null);
            }
            this.lastSignalAt = Date.now();
            logger.info(`[ResponseMonitor] Network request tracked: ${params.requestId} type=${type ?? 'unknown'} url=${url}`);
        };

        this.networkFinishedHandler = (params: any) => {
            if (!this.isRunning) return;
            if (this.trackedRequestIds.has(params?.requestId)) {
                this.trackedRequestIds.delete(params.requestId);
                logger.info(`[ResponseMonitor] Network request finished: ${params.requestId} (remaining: ${this.trackedRequestIds.size})`);
                // 全ストリーミングリクエストが完了 → 完了シグナル発火
                if (this.trackedRequestIds.size === 0) {
                    this.networkFinishedAt = Date.now();
                    this.lastSignalAt = this.networkFinishedAt;
                    logger.info('[ResponseMonitor] All tracked network requests finished — completion signal set');
                }
            }
        };

        this.cdpService.on('Network.requestWillBeSent', this.networkRequestHandler);
        this.cdpService.on('Network.loadingFinished', this.networkFinishedHandler);
    }

    /**
     * ネットワークイベントリスナーを解除する。
     */
    private unsubscribeNetworkEvents(): void {
        if (this.networkRequestHandler) {
            this.cdpService.removeListener('Network.requestWillBeSent', this.networkRequestHandler);
            this.networkRequestHandler = null;
        }
        if (this.networkFinishedHandler) {
            this.cdpService.removeListener('Network.loadingFinished', this.networkFinishedHandler);
            this.networkFinishedHandler = null;
        }
    }

    /**
     * 監視を停止する（外部から呼び出し可能）。
     */
    async stop(): Promise<void> {
        logger.debug(`[ResponseMonitor] stop called (phase=${this.currentPhase}, running=${this.isRunning})`);
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        this.unsubscribeNetworkEvents();
    }

    private async invokeCompleteCallback(finalText: string, reason: string): Promise<void> {
        logger.info(
            `[ResponseMonitor] complete callback start: reason=${reason} ` +
            `textLen=${finalText.length} phase=${this.currentPhase}`,
        );
        try {
            await Promise.resolve(this.onComplete?.(finalText));
            logger.info(`[ResponseMonitor] complete callback finished: reason=${reason}`);
        } catch (error) {
            logger.error(`[ResponseMonitor] complete callback failed: reason=${reason}`, error);
        }
    }

    private async invokeTimeoutCallback(lastText: string): Promise<void> {
        logger.info(`[ResponseMonitor] timeout callback start: textLen=${lastText.length}`);
        try {
            await Promise.resolve(this.onTimeout?.(lastText));
            logger.info('[ResponseMonitor] timeout callback finished');
        } catch (error) {
            logger.error('[ResponseMonitor] timeout callback failed:', error);
        }
    }

    private async emitWaitingDiagnostics(pollId: number): Promise<void> {
        try {
            const result = await this.cdpService.call(
                'Runtime.evaluate',
                this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_DIAGNOSTICS, true),
            );
            const value = result?.result?.value;
            logger.warn(`[ResponseMonitor] waiting diagnostics poll#${pollId}: ${JSON.stringify(value)}`);
        } catch (error) {
            logger.debug(`[ResponseMonitor] waiting diagnostics failed poll#${pollId}`);
        }
    }

    private parseResponseSnapshot(rawValue: unknown): {
        currentText: string | null;
        activityLines: string[];
        source: 'dom-structured' | 'legacy-fallback';
    } {
        if (typeof rawValue === 'string') {
            const text = rawValue.trim();
            return {
                currentText: text.length > 0 ? text : null,
                activityLines: [],
                source: 'legacy-fallback',
            };
        }

        if (rawValue && typeof rawValue === 'object') {
            const classified = classifyAssistantSegments(rawValue as any);
            return {
                currentText: classified.finalOutputText || null,
                activityLines: classified.activityLines,
                source: classified.diagnostics.source,
            };
        }

        return {
            currentText: null,
            activityLines: [],
            source: 'legacy-fallback',
        };
    }

    private buildEvaluateParams(expression: string, awaitPromise: boolean = true): Record<string, unknown> {
        const params: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise,
        };
        const contextId = this.cdpService.getPrimaryContextId?.();
        if (contextId !== null && contextId !== undefined) {
            params.contextId = contextId;
        }
        return params;
    }

    private normalizeStopDetectionResult(rawValue: unknown): StopDetectionResult {
        if (typeof rawValue === 'boolean') {
            return { isGenerating: rawValue };
        }

        if (rawValue && typeof rawValue === 'object') {
            const value = rawValue as Record<string, unknown>;
            if (typeof value.isGenerating === 'boolean') {
                const rawDiagnostics = value.diagnostics;
                const diagnostics = rawDiagnostics && typeof rawDiagnostics === 'object'
                    ? rawDiagnostics as StopDetectionDiagnostics
                    : undefined;
                return {
                    isGenerating: value.isGenerating,
                    diagnostics,
                };
            }
        }

        return { isGenerating: false };
    }

    private formatStopDiagnostics(diagnostics?: StopDetectionDiagnostics): string {
        if (!diagnostics) {
            return 'diag=none';
        }
        return [
            `decision=${diagnostics.decision ?? 'unknown'}`,
            `selector=${diagnostics.matchedSelector ?? 'none'}`,
            `composerCandidates=${diagnostics.composerCandidateCount ?? 0}`,
            `composerStop=${diagnostics.composerKnownStopCount ?? 0}`,
            `composerSend=${diagnostics.composerKnownSendCount ?? 0}`,
            `fallbackHits=${diagnostics.fallbackStopKeywordHits ?? 0}`,
            `panel=${diagnostics.panelFound === true ? 'yes' : 'no'}`,
        ].join(' ');
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

    /** クォータエラーが検出されたがテキスト取得済みだったかどうか */
    getQuotaDetected(): boolean {
        return this.quotaDetected;
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
            this.pollCount += 1;
            const pollId = this.pollCount;
            // ストップボタンの存在チェック（生成中かどうか）
            const evaluateContextId = this.cdpService.getPrimaryContextId?.();
            const stopResult = await this.cdpService.call(
                'Runtime.evaluate',
                this.buildEvaluateParams(RESPONSE_SELECTORS.STOP_BUTTON, true),
            );
            const stopDetection = this.normalizeStopDetectionResult(stopResult?.result?.value);
            const isGenerating: boolean = stopDetection.isGenerating;
            const stopDiagnostics = stopDetection.diagnostics;
            const contextLabel = (evaluateContextId === null || evaluateContextId === undefined)
                ? 'none'
                : String(evaluateContextId);
            logger.debug(
                `[ResponseMonitor] poll#${pollId} stop=${isGenerating} phase=${this.currentPhase} ` +
                `started=${this.generationStarted} stopGoneCount=${this.stopGoneCount} ctx=${contextLabel}`,
            );
            if (!isGenerating && (this.generationStarted || this.activitySeen)) {
                logger.debug(
                    `[ResponseMonitor] poll#${pollId} stop=false diagnostics ctx=${contextLabel} ` +
                    this.formatStopDiagnostics(stopDiagnostics),
                );
            }

            // ストップボタンが出現したら生成開始を記録
            if (isGenerating) {
                if (!this.generationStarted) {
                    this.generationStarted = true;
                    this.setPhase('thinking', null);
                }
                this.stopButtonSeenOnce = true;
                // ストップボタンが再度出現 → カウンターリセット
                this.stopGoneCount = 0;
            }

            // クォータ上限到達チェック
            // TODO: "Our servers are experiencing high traffic right now" エラー発生時の対応を追加する（リトライやフォールバック等）
            try {
                const quotaResult = await this.cdpService.call(
                    'Runtime.evaluate',
                    this.buildEvaluateParams(RESPONSE_SELECTORS.QUOTA_ERROR, true),
                );
                if (quotaResult?.result?.value === true) {
                    const hasText = !!this.lastText && this.lastText.trim().length > 0;
                    if (hasText) {
                        // テキストが取得済みの場合はクォータ状態をフラグし、通常の完了フローに任せる
                        logger.warn('[ResponseMonitor] クォータ上限到達を検出（テキスト取得済み — 通常完了フローで処理）');
                        this.quotaDetected = true;
                    } else {
                        // テキスト未取得の場合のみ即時中断
                        logger.warn('[ResponseMonitor] クォータ上限到達を検出（テキスト未取得 — 即時中断）');
                        this.setPhase('quotaReached', '');
                        await this.stop();
                        await this.invokeCompleteCallback('', 'quota-reached');
                        return;
                    }
                }
            } catch {
                // クォータチェック失敗は無視
            }

            // アクティビティ情報の取得（legacy fallback用）
            let polledActivities: string[] = [];
            try {
                const actResult = await this.cdpService.call(
                    'Runtime.evaluate',
                    this.buildEvaluateParams(RESPONSE_SELECTORS.ACTIVITY_STATUS, true),
                );
                const rawActivities: string[] = actResult?.result?.value ?? [];
                polledActivities = rawActivities
                    .map((line) => (line || '').trim())
                    .filter((line) => line.length > 0);
            } catch {
                // アクティビティ取得失敗は無視
            }

            // テキスト取得
            const textResult = await this.cdpService.call(
                'Runtime.evaluate',
                this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_TEXT, true),
            );
            const snapshot = this.parseResponseSnapshot(textResult?.result?.value);
            this.lastExtractionSource = snapshot.source;
            this.lastDomActivityLines = snapshot.source === 'dom-structured'
                ? [...snapshot.activityLines]
                : [];
            const currentText = snapshot.currentText;
            const activities = snapshot.source === 'dom-structured' && snapshot.activityLines.length > 0
                ? snapshot.activityLines
                : polledActivities;

            if (activities.length > 0) {
                this.activitySeen = true;
                if (!this.generationStarted) {
                    this.generationStarted = true;
                    this.setPhase('thinking', null);
                    logger.info('[ResponseMonitor] generation start inferred from activity');
                }
                const actStr = JSON.stringify(activities);
                if (actStr !== this.lastActivities) {
                    this.lastActivities = actStr;
                    this.lastSignalAt = Date.now();
                    this.onActivity?.(activities);
                }
            }

            // ベースライン（送信前の古い応答）と同じテキストは送信直後のみ無視
            // 生成開始後も同一テキストが返るケースがあるため、恒久的には除外しない。
            if (currentText !== null && this.lastText === null && this.baselineSuppressionActive && currentText === this.baselineText) {
                const elapsed = Date.now() - this.startTime;
                // 逆順DOM（新規応答が先頭側）対策: 先頭側抽出を試す
                if (pollId % 2 === 0) {
                    try {
                        const altResult = await this.cdpService.call(
                            'Runtime.evaluate',
                            this.buildEvaluateParams(RESPONSE_SELECTORS.RESPONSE_TEXT_FROM_START, true),
                        );
                        const altText: string | null = altResult?.result?.value ?? null;
                        if (
                            altText !== null &&
                            altText.trim().length > 0 &&
                            altText !== this.baselineText &&
                            altText !== this.lastText
                        ) {
                            this.lastText = altText;
                            this.baselineSuppressionActive = false;
                            logger.info(`[ResponseMonitor] poll#${pollId} baseline bypass by start-side extractor (len=${altText.length})`);
                            if (this.currentPhase === 'waiting' || this.currentPhase === 'thinking') {
                                this.setPhase('generating', altText);
                                if (!this.generationStarted) {
                                    this.generationStarted = true;
                                }
                            }
                            this.onProgress?.(altText);
                            this.stopGoneCount = 0;
                            this.lastTextChangeAt = Date.now();
                            this.lastSignalAt = this.lastTextChangeAt;
                        }
                    } catch {
                        // no-op
                    }
                }

                if (this.lastText !== null) {
                    // 先頭側抽出で更新できたため、通常処理へ
                } else if (elapsed < 20000) {
                    if (pollId % 5 === 0) {
                        logger.debug(`[ResponseMonitor] poll#${pollId} baseline text suppressed elapsed=${elapsed}ms`);
                    }
                    return;
                }
                if (pollId % 5 === 0) {
                    logger.warn(
                        `[ResponseMonitor] baseline suppression timeout (${elapsed}ms): ` +
                        'baselineと同一テキストのため採用を継続抑止（旧回答誤採用防止）',
                    );
                }
                return;
            }

            // テキストが変化した場合のみ通知
            if (currentText !== null && currentText !== this.lastText) {
                this.lastText = currentText;
                if (currentText !== this.baselineText) {
                    this.baselineSuppressionActive = false;
                }
                logger.debug(`[ResponseMonitor] poll#${pollId} text updated (len=${currentText.length})`);

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
                this.lastSignalAt = this.lastTextChangeAt;
            }

            const hasAnyText = !!(this.lastText && this.lastText.trim().length > 0);
            const now = Date.now();
            const stalledFor = now - this.lastTextChangeAt;
            const signalStalledFor = now - this.lastSignalAt;
            logger.debug(
                `[ResponseMonitor] poll#${pollId} state hasText=${hasAnyText} stalledFor=${stalledFor}ms ` +
                `signalStalledFor=${signalStalledFor}ms started=${this.generationStarted} activitySeen=${this.activitySeen} ` +
                `trackedReq=${this.trackedRequestIds.size} networkFinishedAt=${this.networkFinishedAt}`,
            );

            if (!hasAnyText && (this.currentPhase === 'waiting' || this.currentPhase === 'thinking' || this.currentPhase === 'generating') && this.pollCount % 5 === 0) {
                await this.emitWaitingDiagnostics(pollId);
            }

            // ───────────────────────────────────────────────────
            // 完了判定パス 1 (最速): ネットワーク完了シグナル
            // Network.loadingFinished でストリーミングAPIの終了を検知済み
            // かつテキストが networkCompleteDelayMs 安定していれば完了
            // ───────────────────────────────────────────────────
            if (this.networkFinishedAt > 0 && (this.generationStarted || hasAnyText)) {
                const sinceNetworkFinished = now - this.networkFinishedAt;
                if (sinceNetworkFinished >= this.networkCompleteDelayMs && stalledFor >= this.networkCompleteDelayMs) {
                    logger.info(`[ResponseMonitor] ネットワーク完了 + ${sinceNetworkFinished}ms安定 → 完了と判定`);
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    await this.invokeCompleteCallback(finalText, 'network-finished');
                    return;
                }
            }

            // ───────────────────────────────────────────────────
            // 完了判定パス (既存): ストップボタン消失検知
            // ストップボタンが消失し、連続N回確認で完了
            // ───────────────────────────────────────────────────
            if (!isGenerating && (this.generationStarted || hasAnyText)) {
                if (!this.stopButtonSeenOnce) {
                    this.stopGoneCount = 0;
                    if (pollId % 5 === 0) {
                        logger.debug(`[ResponseMonitor] poll#${pollId} stop-gone blocked: stop button was never observed`);
                    }
                } else if (!hasAnyText) {
                    this.stopGoneCount = 0;
                    if (pollId % 5 === 0) {
                        logger.debug(`[ResponseMonitor] poll#${pollId} stop-gone blocked: no output text yet (delegate to no-update-timeout)`);
                    }
                } else {
                    const signalQuietMs = Math.max(500, Math.floor(this.pollIntervalMs * 0.8));
                    if (signalStalledFor < signalQuietMs) {
                        this.stopGoneCount = 0;
                        if (pollId % 5 === 0) {
                            logger.debug(
                                `[ResponseMonitor] poll#${pollId} stop-gone blocked by active-signal ` +
                                `signalStalled=${signalStalledFor}ms need=${signalQuietMs}ms`,
                            );
                        }
                    } else {
                        this.stopGoneCount++;
                        if (this.stopGoneCount >= this.stopButtonGoneConfirmCount) {
                            const requiredStabilityMs = this.completionStabilityMs;
                            if (stalledFor < requiredStabilityMs) {
                                if (pollId % 5 === 0) {
                                    logger.debug(
                                        `[ResponseMonitor] poll#${pollId} stop-gone pending ` +
                                        `stalled=${stalledFor}ms need=${requiredStabilityMs}ms hasText=${hasAnyText} ` +
                                        `stopSeen=${this.stopButtonSeenOnce}`,
                                    );
                                }
                                return;
                            }
                            logger.info(`[ResponseMonitor] ストップボタン消失を${this.stopGoneCount}回連続確認。完了と判定。`);
                            const finalText = this.lastText ?? '';
                            this.setPhase('complete', finalText);
                            await this.stop();
                            await this.invokeCompleteCallback(finalText, 'stop-button-gone');
                            return;
                        }
                    }
                }
            }

            // ───────────────────────────────────────────────────
            // 完了判定パス 2 (安定): テキスト安定性のみで完了判定
            // ストップボタン検出に依存しない独立パス
            // 生成が開始済み AND テキストあり AND テキストが一定時間変化なし → 完了
            // ───────────────────────────────────────────────────
            if (this.textStabilityCompleteMs > 0 && this.generationStarted && hasAnyText) {
                if (stalledFor >= this.textStabilityCompleteMs) {
                    logger.info(`[ResponseMonitor] テキスト安定 ${stalledFor}ms（閾値 ${this.textStabilityCompleteMs}ms）→ 完了と判定`);
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    await this.invokeCompleteCallback(finalText, 'text-stability');
                    return;
                }
            }

            // ───────────────────────────────────────────────────
            // 完了判定パス 2b (本文未取得フォールバック): noTextCompletionDelay
            // 本文抽出に失敗しているが、生成開始シグナルは観測済みで、
            // 活動表示も消えて進捗シグナルが一定時間静穏なら完了とみなす。
            // ───────────────────────────────────────────────────
            const noTextQuietThresholdMs = Math.max(this.noTextCompletionDelayMs, this.pollIntervalMs * 2);
            if (
                this.noTextCompletionDelayMs > 0 &&
                this.generationStarted &&
                this.activitySeen &&
                !hasAnyText &&
                !isGenerating &&
                signalStalledFor >= noTextQuietThresholdMs
            ) {
                logger.info(
                    `[ResponseMonitor] 本文未取得のまま進捗静穏 ${signalStalledFor}ms ` +
                    `（閾値 ${noTextQuietThresholdMs}ms）→ 完了と判定`,
                );
                const finalText = this.lastText ?? '';
                this.setPhase('complete', finalText);
                await this.stop();
                await this.invokeCompleteCallback(finalText, 'no-text-stability');
                return;
            }

            // ───────────────────────────────────────────────────
            // 完了判定パス 3 (フォールバック): 更新停止タイムアウト
            // ストップボタン誤検知で isGenerating=true が張り付いても、
            // テキスト更新が長時間止まっていれば完了扱いにする
            // ───────────────────────────────────────────────────
            if (this.noUpdateTimeoutMs > 0 && (this.generationStarted || hasAnyText)) {
                if (signalStalledFor >= this.noUpdateTimeoutMs) {
                    logger.warn(`[ResponseMonitor] 生成中判定が継続していますが、${signalStalledFor}ms進捗更新が無いため完了扱いにします。`);
                    const finalText = this.lastText ?? '';
                    this.setPhase('complete', finalText);
                    await this.stop();
                    await this.invokeCompleteCallback(finalText, 'no-update-timeout');
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

    getLastExtractionSource(): 'dom-structured' | 'legacy-fallback' {
        return this.lastExtractionSource;
    }

    getLastDomActivityLines(): string[] {
        return [...this.lastDomActivityLines];
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
