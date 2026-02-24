import {
    AUTOACCEPT_BTN_OFF,
    AUTOACCEPT_BTN_ON,
    AUTOACCEPT_BTN_REFRESH,
    sendAutoAcceptUI,
} from '../../src/ui/autoAcceptUi';
import { AutoAcceptService } from '../../src/services/autoAcceptService';

describe('autoAcceptUi', () => {
    it('shows OFF status and control buttons when disabled', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const service = new AutoAcceptService(false);

        await sendAutoAcceptUI(target, service);

        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds).toHaveLength(1);
        expect(payload.components).toHaveLength(1);

        const embedJson = payload.embeds[0].toJSON();
        expect(embedJson.title).toBe('Auto-accept Management');
        expect(embedJson.description).toContain('OFF');

        const buttons = payload.components[0].toJSON().components;
        expect(buttons).toHaveLength(3);
        expect(buttons[0].custom_id).toBe(AUTOACCEPT_BTN_ON);
        expect(buttons[1].custom_id).toBe(AUTOACCEPT_BTN_OFF);
        expect(buttons[2].custom_id).toBe(AUTOACCEPT_BTN_REFRESH);
    });

    it('shows ON status when enabled', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const service = new AutoAcceptService(true);

        await sendAutoAcceptUI(target, service);

        const embedJson = target.editReply.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.description).toContain('ON');
    });
});
