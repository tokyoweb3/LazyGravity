import { createModeSelectAction } from '../../src/handlers/modeSelectAction';

jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    getCurrentCdp: jest.fn(),
}));

jest.mock('../../src/ui/modeUi', () => ({
    buildModePayload: jest.fn().mockReturnValue({ richContent: { title: 'Mode' }, components: [] }),
}));

import { getCurrentCdp } from '../../src/services/cdpBridgeManager';
import { buildModePayload } from '../../src/ui/modeUi';

function createMockInteraction() {
    return {
        id: 'int-1',
        platform: 'telegram' as const,
        customId: 'mode_select',
        user: { id: 'user-1', platform: 'telegram' as const, username: 'test', isBot: false },
        channel: { id: 'ch-1', platform: 'telegram' as const, send: jest.fn() },
        values: ['plan'],
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({ id: '2', platform: 'telegram', channelId: 'ch-1', edit: jest.fn(), delete: jest.fn() }),
    };
}

describe('createModeSelectAction', () => {
    let modeService: any;
    let bridge: any;

    beforeEach(() => {
        jest.clearAllMocks();
        modeService = {
            getCurrentMode: jest.fn().mockReturnValue('fast'),
            setMode: jest.fn().mockReturnValue({ success: true, mode: 'plan' }),
            isPendingSync: jest.fn().mockReturnValue(false),
            markSynced: jest.fn(),
        };
        bridge = {
            lastActiveWorkspace: null,
            pool: { getConnected: jest.fn().mockReturnValue(null) },
            cdpHost: '127.0.0.1',
        };
    });

    it('matches mode_select customId', () => {
        const action = createModeSelectAction({ bridge, modeService });
        expect(action.match('mode_select')).toBe(true);
    });

    it('does not match other customIds', () => {
        const action = createModeSelectAction({ bridge, modeService });
        expect(action.match('other_select')).toBe(false);
    });

    it('sets mode as pending and shows sync message when CDP is not connected', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['plan']);

        expect(interaction.deferUpdate).toHaveBeenCalled();
        expect(modeService.setMode).toHaveBeenCalledWith('plan', false);
        expect(buildModePayload).toHaveBeenCalledWith('fast', true);
        expect(interaction.update).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('Will sync when connected to Antigravity'),
            }),
        );
    });

    it('syncs mode to CDP when available and sets as synced', async () => {
        const mockCdp = { setUiMode: jest.fn().mockResolvedValue({ ok: true }) };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['plan']);

        expect(mockCdp.setUiMode).toHaveBeenCalledWith('plan');
        expect(modeService.setMode).toHaveBeenCalledWith('plan', true);
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                text: 'Mode changed to \u{1F4CB} Plan.',
            }),
        );
    });

    it('shows error and does not set mode when CDP sync fails', async () => {
        const mockCdp = { setUiMode: jest.fn().mockResolvedValue({ ok: false, error: 'timeout' }) };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['plan']);

        expect(modeService.setMode).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('Failed to switch mode in Antigravity'),
            }),
        );
    });

    it('does nothing when values array is empty', async () => {
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, []);

        expect(interaction.deferUpdate).not.toHaveBeenCalled();
        expect(modeService.setMode).not.toHaveBeenCalled();
    });
});
