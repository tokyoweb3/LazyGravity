import {
    OUTPUT_BTN_EMBED,
    OUTPUT_BTN_PLAIN,
    sendOutputUI,
} from '../../src/ui/outputUi';

describe('outputUi', () => {
    it('shows Embed status and control buttons when format is embed', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendOutputUI(target, 'embed');

        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds).toHaveLength(1);
        expect(payload.components).toHaveLength(1);

        const embedJson = payload.embeds[0].toJSON();
        expect(embedJson.title).toBe('Output Format');
        expect(embedJson.description).toContain('Embed');

        const buttons = payload.components[0].toJSON().components;
        expect(buttons).toHaveLength(2);
        expect(buttons[0].custom_id).toBe(OUTPUT_BTN_EMBED);
        expect(buttons[1].custom_id).toBe(OUTPUT_BTN_PLAIN);
    });

    it('shows Plain Text status when format is plain', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendOutputUI(target, 'plain');

        const embedJson = target.editReply.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.description).toContain('Plain Text');
    });
});
