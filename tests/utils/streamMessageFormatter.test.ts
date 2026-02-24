import {
    buildModeModelLines,
    shouldSkipActivityLog,
    splitForEmbedDescription,
    fitForSingleEmbedDescription,
} from '../../src/utils/streamMessageFormatter';

describe('streamMessageFormatter', () => {
    describe('buildModeModelLines', () => {
        it('consolidates into a single line when both models are the same', () => {
            const lines = buildModeModelLines('Fast', 'Gemini 3.1 Pro (High)', 'Gemini 3.1 Pro (High)');
            expect(lines).toEqual([
                'Current Mode: Fast',
                'Model: Gemini 3.1 Pro (High)',
            ]);
        });

        it('shows both Fast and Plan models when they differ', () => {
            const lines = buildModeModelLines('Planning', 'Claude Opus 4.6', 'Gemini 3.1 Pro');
            expect(lines).toEqual([
                'Current Mode: Planning',
                'Fast Model: Claude Opus 4.6',
                'Plan Model: Gemini 3.1 Pro',
            ]);
        });
    });

    describe('shouldSkipActivityLog', () => {
        it('filters out duplicate logs that only contain mode/model names', () => {
            expect(shouldSkipActivityLog('Fast', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Gemini 3.1 Pro', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('filters out generic status logs like Generating', () => {
            expect(shouldSkipActivityLog('Generating.', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Thinking...', 'Planning', 'Claude')).toBe(true);
        });

        it('filters out ambiguous single-word activity logs', () => {
            expect(shouldSkipActivityLog('create', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('ready', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('pull.', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('filters out analyzed-type scan logs', () => {
            expect(shouldSkipActivityLog('Analyzed.gemini/antigravity/global_skills', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
            expect(shouldSkipActivityLog('Analyzedantigravity_claw_development.md#L1-49', 'Fast', 'Gemini 3.1 Pro')).toBe(true);
        });

        it('does not filter out logs describing actual execution', () => {
            expect(shouldSkipActivityLog('Analyzing Name Preference', 'Fast', 'Gemini 3.1 Pro')).toBe(false);
        });
    });

    describe('splitForEmbedDescription', () => {
        it('splits long text at the limit while preserving content', () => {
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
        it('returns text as-is when within the limit', () => {
            const text = '短いテキスト';
            expect(fitForSingleEmbedDescription(text, 50)).toBe(text);
        });

        it('truncates the beginning to fit within the limit when exceeded', () => {
            const text = `${'a'.repeat(200)}\n${'b'.repeat(200)}`;
            const fitted = fitForSingleEmbedDescription(text, 120);

            expect(fitted.length).toBeLessThanOrEqual(120);
            expect(fitted.startsWith('... (beginning truncated)')).toBe(true);
            expect(fitted).toContain('b'.repeat(40));
        });
    });
});
