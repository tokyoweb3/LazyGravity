import { ModeService } from '../../src/services/modeService';
import { sendModeUI } from '../../src/ui/modeUi';

describe('modeUi', () => {
    it('passes a UI containing the current mode to editReply', async () => {
        const modeService = new ModeService();
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService);

        expect(target.editReply).toHaveBeenCalledTimes(1);
        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });

    it('syncs mode from CDP when deps.getCurrentCdp is provided', async () => {
        const modeService = new ModeService();
        // Default mode is 'fast', CDP returns 'plan'
        const mockCdp = { getCurrentMode: jest.fn().mockResolvedValue('plan') };
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService, { getCurrentCdp: () => mockCdp as any });

        expect(mockCdp.getCurrentMode).toHaveBeenCalled();
        // modeService should now be synced to 'plan'
        expect(modeService.getCurrentMode()).toBe('plan');
    });

    it('does not sync mode when CDP returns null', async () => {
        const modeService = new ModeService();
        const mockCdp = { getCurrentMode: jest.fn().mockResolvedValue(null) };
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService, { getCurrentCdp: () => mockCdp as any });

        expect(mockCdp.getCurrentMode).toHaveBeenCalled();
        // mode should remain 'fast' (default)
        expect(modeService.getCurrentMode()).toBe('fast');
    });

    it('works without deps parameter (backward compatible)', async () => {
        const modeService = new ModeService();
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService, undefined);

        expect(target.editReply).toHaveBeenCalledTimes(1);
    });

    it('works when getCurrentCdp returns null', async () => {
        const modeService = new ModeService();
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendModeUI(target, modeService, { getCurrentCdp: () => null });

        expect(target.editReply).toHaveBeenCalledTimes(1);
        expect(modeService.getCurrentMode()).toBe('fast');
    });
});
