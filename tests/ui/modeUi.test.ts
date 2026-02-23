import { ModeService } from '../../src/services/modeService';
import { sendModeUI } from '../../src/ui/modeUi';

describe('modeUi', () => {
    it('現在モードを含むUIを editReply に渡す', async () => {
        const modeService = new ModeService();
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService);

        expect(target.editReply).toHaveBeenCalledTimes(1);
        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });
});
