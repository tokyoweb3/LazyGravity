import {
    buildModeModelLines,
    shouldSkipActivityLog,
    splitForEmbedDescription,
    fitForSingleEmbedDescription,
} from '../../src/utils/streamMessageFormatter';

describe('streamMessageFormatter', () => {
    describe('buildModeModelLines', () => {
        it('同一モデルの場合は1行に集約する', () => {
            const lines = buildModeModelLines('Fast', 'Gemini 3.1 Pro (High)', 'Gemini 3.1 Pro (High)');
            expect(lines).toEqual([
                '現在モード: Fast',
                'モデル: Gemini 3.1 Pro (High)',
            ]);
        });

        it('異なるモデルの場合はFast/Plan両方を表示する', () => {
            const lines = buildModeModelLines('Planning', 'Claude Opus 4.6', 'Gemini 3.1 Pro');
            expect(lines).toEqual([
                '現在モード: Planning',
                'Fastモデル: Claude Opus 4.6',
                'Planモデル: Gemini 3.1 Pro',
            ]);
        });
    });

    describe('shouldSkipActivityLog', () => {
        it('モード/モデル名のみの重複ログは除外する', () => {
            expect(shouldSkipActivityLog('Fast', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Gemini 3.1 Pro', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('Generatingなどの汎用状態ログは除外する', () => {
            expect(shouldSkipActivityLog('Generating.', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Thinking...', 'Planning', 'Claude')).toBe(true);
        });

        it('1語だけの曖昧な活動ログは除外する', () => {
            expect(shouldSkipActivityLog('create', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('ready', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('pull.', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('analyzed系のスキャンログは除外する', () => {
            expect(shouldSkipActivityLog('Analyzed.gemini/antigravity/global_skills', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Analyzedantigravity_claw_development.md#L1-49', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('実行内容のログは除外しない', () => {
            expect(shouldSkipActivityLog('Analyzing Name Preference', 'Fast', 'Gemini 3.1 Pro')).toBe(false);
        });
    });

    describe('splitForEmbedDescription', () => {
        it('長文を上限で分割し、内容を保持する', () => {
            const text = 'a'.repeat(1200) + '\n' + 'b'.repeat(1200) + '\n' + 'c'.repeat(1200);
            const parts = splitForEmbedDescription(text, 1000);

            expect(parts.length).toBeGreaterThan(1);
            expect(parts.every((part) => part.length <= 1000)).toBe(true);
            expect(parts.join('')).toContain('a'.repeat(500));
            expect(parts.join('')).toContain('b'.repeat(500));
            expect(parts.join('')).toContain('c'.repeat(500));
        });
    });

    describe('fitForSingleEmbedDescription', () => {
        it('上限以内ならそのまま返す', () => {
            const text = '短いテキスト';
            expect(fitForSingleEmbedDescription(text, 50)).toBe(text);
        });

        it('上限を超える場合は先頭を省略して上限内に収める', () => {
            const text = `${'a'.repeat(200)}\n${'b'.repeat(200)}`;
            const fitted = fitForSingleEmbedDescription(text, 120);

            expect(fitted.length).toBeLessThanOrEqual(120);
            expect(fitted.startsWith('… (先頭を省略)')).toBe(true);
            expect(fitted).toContain('b'.repeat(40));
        });
    });
});
