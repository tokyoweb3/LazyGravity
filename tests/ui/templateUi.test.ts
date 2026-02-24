import { sendTemplateUI, TEMPLATE_BTN_PREFIX, parseTemplateButtonId } from '../../src/ui/templateUi';
import { TemplateRecord } from '../../src/database/templateRepository';

function makeTemplate(id: number, name: string, prompt: string): TemplateRecord {
    return { id, name, prompt, createdAt: '2026-01-01T00:00:00Z' };
}

describe('templateUi', () => {
    describe('sendTemplateUI', () => {
        it('shows empty state when no templates exist', async () => {
            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, []);

            const payload = target.editReply.mock.calls[0][0];
            expect(payload.embeds).toHaveLength(1);
            expect(payload.components).toEqual([]);

            const embedJson = payload.embeds[0].toJSON();
            expect(embedJson.description).toContain('No templates registered');
            expect(embedJson.description).toContain('/template add');
        });

        it('shows template list with buttons', async () => {
            const templates = [
                makeTemplate(1, 'daily-report', 'Write a daily report'),
                makeTemplate(2, 'code-review', 'Review the latest code changes'),
            ];

            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, templates);

            const payload = target.editReply.mock.calls[0][0];
            expect(payload.embeds).toHaveLength(1);
            expect(payload.components.length).toBeGreaterThan(0);

            const embedJson = payload.embeds[0].toJSON();
            expect(embedJson.title).toBe('Template Management');
            expect(embedJson.color).toBe(0x57F287);
            expect(embedJson.description).toContain('daily-report');
            expect(embedJson.description).toContain('code-review');
            expect(embedJson.description).toContain('(2)');

            // Verify buttons use ID-based customIds
            const row = payload.components[0];
            const buttons = row.toJSON().components;
            expect(buttons).toHaveLength(2);
            expect(buttons[0].custom_id).toBe(`${TEMPLATE_BTN_PREFIX}1`);
            expect(buttons[0].label).toBe('daily-report');
            expect(buttons[1].custom_id).toBe(`${TEMPLATE_BTN_PREFIX}2`);
            expect(buttons[1].label).toBe('code-review');
        });

        it('truncates long prompts in description', async () => {
            const longPrompt = 'A'.repeat(100);
            const templates = [makeTemplate(1, 'long', longPrompt)];

            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, templates);

            const embedJson = target.editReply.mock.calls[0][0].embeds[0].toJSON();
            expect(embedJson.description).toContain('...');
            expect(embedJson.description).not.toContain('A'.repeat(100));
        });

        it('caps at 25 buttons and shows overflow message', async () => {
            const templates = Array.from({ length: 30 }, (_, i) =>
                makeTemplate(i + 1, `tpl-${i + 1}`, `prompt ${i + 1}`),
            );

            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, templates);

            const payload = target.editReply.mock.calls[0][0];
            const allButtons = payload.components.flatMap(
                (row: any) => row.toJSON().components,
            );
            expect(allButtons).toHaveLength(25);

            const embedJson = payload.embeds[0].toJSON();
            expect(embedJson.footer.text).toContain('5 templates are hidden');
        });

        it('creates correct number of rows (5 buttons per row)', async () => {
            const templates = Array.from({ length: 12 }, (_, i) =>
                makeTemplate(i + 1, `tpl-${i + 1}`, `prompt ${i + 1}`),
            );

            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, templates);

            const payload = target.editReply.mock.calls[0][0];
            // 12 buttons -> 3 rows (5, 5, 2)
            expect(payload.components).toHaveLength(3);
            expect(payload.components[0].toJSON().components).toHaveLength(5);
            expect(payload.components[1].toJSON().components).toHaveLength(5);
            expect(payload.components[2].toJSON().components).toHaveLength(2);
        });

        it('truncates long template names in button labels', async () => {
            const longName = 'A'.repeat(100);
            const templates = [makeTemplate(1, longName, 'prompt')];

            const target = { editReply: jest.fn().mockResolvedValue(undefined) };
            await sendTemplateUI(target, templates);

            const buttons = target.editReply.mock.calls[0][0].components[0].toJSON().components;
            expect(buttons[0].label.length).toBeLessThanOrEqual(80);
            expect(buttons[0].label).toContain('...');
        });
    });

    describe('parseTemplateButtonId', () => {
        it('parses valid template button customId', () => {
            expect(parseTemplateButtonId('template_btn_42')).toBe(42);
        });

        it('returns NaN for non-template customId', () => {
            expect(parseTemplateButtonId('model_btn_foo')).toBeNaN();
        });

        it('returns NaN for invalid number', () => {
            expect(parseTemplateButtonId('template_btn_abc')).toBeNaN();
        });
    });
});
