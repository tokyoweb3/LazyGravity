jest.mock('../src/services/cdpService', () => ({
    CdpService: jest.fn(),
}));

import { handleSlashInteraction } from '../src/bot';

describe('/model command', () => {
    it('connects through the current channel workspace when no cached channel CDP exists', async () => {
        const setUiModel = jest.fn().mockResolvedValue({ ok: true, model: 'gemini-3-flash' });
        const cdp = { setUiModel };
        const interaction = {
            commandName: 'model',
            channelId: 'channel-1',
            channel: {},
            user: { id: 'user-1' },
            options: { getString: jest.fn().mockReturnValue('gemini-3-flash'), getSubcommand: jest.fn() },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;
        const bridge = {
            selectedAccountByChannel: new Map<string, string>(),
            pool: {
                getConnected: jest.fn().mockReturnValue(null),
                getOrConnect: jest.fn().mockResolvedValue(cdp),
                extractProjectName: jest.fn().mockReturnValue('demo-project'),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
            quota: { fetchQuota: jest.fn().mockResolvedValue([]) },
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
        );

        expect(bridge.pool.getOrConnect).toHaveBeenCalledWith('/tmp/demo-project', { name: 'default' });
        expect(setUiModel).toHaveBeenCalledWith('gemini-3-flash');
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Model changed to **gemini-3-flash**.' });
    });
});
