import { renderDiscordResponse } from '../../../src/platform/discord/discordResponseRenderer';
import type { ClassifyResult } from '../../../src/services/assistantDomExtractor';

describe('discordResponseRenderer', () => {
    it('renders final output as a primary embed', () => {
        const result: ClassifyResult = {
            finalOutputText: 'This is the final answer.',
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: [],
            fileChanges: [],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: {
                source: 'dom-structured',
                segmentCounts: {},
                allFingerprints: [],
                totalSegments: 1,
            },
        };

        const output = renderDiscordResponse(result);
        expect(output.embeds).toBeDefined();
        expect(output.embeds!.length).toBe(1);
        expect((output.embeds![0] as any).data.description).toBe('This is the final answer.');
        expect(output.components).toBeUndefined();
    });

    it('renders plan cards as a separate embed', () => {
        const result: ClassifyResult = {
            finalOutputText: 'Done.',
            activityLines: [],
            feedback: [],
            planCards: ['Plan: Do A then B.'],
            actionButtons: [],
            fileChanges: [],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        expect(output.embeds!.length).toBe(2);
        expect((output.embeds![0] as any).data.description).toBe('Done.');
        expect((output.embeds![1] as any).data.title).toBe('Plan');
        expect((output.embeds![1] as any).data.description).toBe('Plan: Do A then B.');
    });

    it('renders action buttons in a component row and formats customIds correctly', () => {
        const result: ClassifyResult = {
            finalOutputText: 'Ready.',
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: ['Proceed', 'Open File', 'Review Code'],
            fileChanges: [],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        expect(output.components).toBeDefined();
        expect((output.components![0] as any).components.length).toBe(3);
        
        const btn1 = (output.components![0] as any).components[0].data;
        expect(btn1.label).toBe('Proceed');
        expect(btn1.custom_id).toBe('action_btn_proceed');
        
        const btn2 = (output.components![0] as any).components[1].data;
        expect(btn2.label).toBe('Open File');
        expect(btn2.custom_id).toBe('action_btn_open_file');

        const btn3 = (output.components![0] as any).components[2].data;
        expect(btn3.label).toBe('Review Code');
        expect(btn3.custom_id).toBe('action_btn_review_code');
    });

    it('chunks very long descriptions', () => {
        const longText = 'A'.repeat(5000);
        const result: ClassifyResult = {
            finalOutputText: longText,
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: [],
            fileChanges: [],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        // 5000 chars should be split into 2 embeds of 4000 and 1000 roughly
        expect(output.embeds!.length).toBe(2);
        expect((output.embeds![0] as any).data.description?.length).toBeLessThanOrEqual(4000);
        expect((output.embeds![1] as any).data.description?.length).toBeGreaterThan(0);
    });

    it('renders file changes into embed fields', () => {
        const result: ClassifyResult = {
            finalOutputText: 'Edited files.',
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: [],
            fileChanges: [
                { path: 'src/a.ts', type: 'Modified' },
                { path: 'src/b.ts', type: 'Modified' },
            ],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        const fileEmbed = output.embeds!.find(e => (e as any).data.title === 'File Changes');
        expect(fileEmbed).toBeDefined();
        expect((fileEmbed as any).data.fields).toBeDefined();
        expect((fileEmbed as any).data.fields![0].value).toContain('src/a.ts');
        expect((fileEmbed as any).data.fields![0].value).toContain('src/b.ts');
    });

    it('chunks file changes if there are too many for one field', () => {
        const fileChanges = Array.from({ length: 50 }, (_, i) => ({
            path: `src/file_${i}.ts`,
            type: 'Modified',
        }));
        
        const result: ClassifyResult = {
            finalOutputText: 'Lots of files.',
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: [],
            fileChanges,
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        const fileEmbed = output.embeds!.find(e => (e as any).data.title === 'File Changes');
        expect(fileEmbed).toBeDefined();
        // 50 files * ~30 chars each = 1500 chars -> should be split into 2 fields
        expect((fileEmbed as any).data.fields!.length).toBeGreaterThan(1);
    });

    it('chunks very long plan cards into multiple embeds', () => {
        const longPlan = 'A'.repeat(5000);
        const result: ClassifyResult = {
            finalOutputText: 'Plan follows.',
            activityLines: [],
            feedback: [],
            planCards: [longPlan],
            actionButtons: [],
            fileChanges: [],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        const planEmbeds = output.embeds!.filter(e => (e as any).data.color === 0x5865f2);
        expect(planEmbeds.length).toBe(2);
        expect((planEmbeds[0] as any).data.title).toBe('Plan');
        expect((planEmbeds[1] as any).data.title).toBeUndefined(); // Second part has no title
        expect((planEmbeds[0] as any).data.description?.length).toBeLessThanOrEqual(4000);
    });

    it('handles a single oversized file change path', () => {
        const longPath = 'src/' + 'a/'.repeat(500) + 'file.ts'; // ~1000+ chars
        const result: ClassifyResult = {
            finalOutputText: 'Long file.',
            activityLines: [],
            feedback: [],
            planCards: [],
            actionButtons: [],
            fileChanges: [
                { path: longPath, type: 'Modified' },
            ],
            citations: [],
            fileChangesTexts: [],
            citedFiles: [],
            diagnostics: { source: 'dom-structured', segmentCounts: {}, allFingerprints: [], totalSegments: 1 },
        };

        const output = renderDiscordResponse(result);
        const fileEmbed = output.embeds!.find(e => (e as any).data.title === 'File Changes');
        expect(fileEmbed).toBeDefined();
        // The oversized line should be split across multiple fields
        expect((fileEmbed as any).data.fields!.length).toBeGreaterThan(1);
        expect((fileEmbed as any).data.fields![0].value.length).toBeLessThanOrEqual(1000);
    });
});
