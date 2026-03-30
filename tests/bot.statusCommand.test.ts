import { handleSlashInteraction } from '../src/bot';

describe('/status command', () => {
    it('shows active account, original account, and conversation title', async () => {
        const interaction = {
            commandName: 'status',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: { getString: jest.fn().mockReturnValue(null), getSubcommand: jest.fn().mockReturnValue(null) },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;
        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'work1']]),
            lastActiveWorkspace: null,
            pool: {
                getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
                getConnected: jest.fn().mockReturnValue(null),
                getUserMessageDetector: jest.fn().mockReturnValue(undefined),
                getApprovalDetector: jest.fn().mockReturnValue(undefined),
                extractProjectName: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;
        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({
                channelId: 'channel-1',
                activeAccountName: 'work1',
                originAccountName: 'default',
                displayName: 'Imported Session',
            }),
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any,
            {} as any,
            {} as any,
            { getCurrentMode: jest.fn().mockReturnValue('normal') } as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            undefined,
            { getAccountName: jest.fn().mockReturnValue(null) } as any,
            [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
            chatSessionRepo,
        );

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        fields: expect.arrayContaining([
                            expect.objectContaining({ name: 'Active Account', value: 'work1' }),
                            expect.objectContaining({ name: 'Original Account', value: 'default' }),
                            expect.objectContaining({ name: 'Conversation Title', value: 'Imported Session' }),
                        ]),
                    }),
                }),
            ]),
        }));
    });
});
