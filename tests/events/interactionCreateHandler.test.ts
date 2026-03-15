import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';

describe('interactionCreateHandler', () => {
    it('responds with an ephemeral rejection for unauthorized users', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);
        const interaction = {
            isButton: () => true,
            user: { id: 'forbidden' },
            reply,
        } as any;

        const handler = createInteractionCreateHandler({
            config: { allowedUserIds: ['allowed'] },
            bridge: {} as any,
            cleanupHandler: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: {} as any,
            wsHandler: {} as any,
            chatHandler: {} as any,
            client: {} as any,
            sendModeUI: jest.fn(),
            sendModelsUI: jest.fn(),
            sendAutoAcceptUI: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn(),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            parseRunCommandCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
        });

        await handler(interaction);

        expect(reply).toHaveBeenCalled();
    });

    it('rejects approval actions clicked from a different channel than the bound session', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);
        const detector = {
            approveButton: jest.fn().mockResolvedValue(true),
            alwaysAllowButton: jest.fn().mockResolvedValue(true),
            denyButton: jest.fn().mockResolvedValue(true),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'approve_action:ws-a:channel-a',
            channelId: 'channel-b',
            reply,
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler({
            config: { allowedUserIds: ['allowed'] },
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn().mockReturnValue(detector),
                },
                lastActiveWorkspace: null,
            } as any,
            cleanupHandler: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: {} as any,
            wsHandler: {} as any,
            chatHandler: {} as any,
            client: {} as any,
            sendModeUI: jest.fn(),
            sendModelsUI: jest.fn(),
            sendAutoAcceptUI: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn().mockReturnValue({
                action: 'approve',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            parseRunCommandCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
        });

        await handler(interaction);

        expect(reply).toHaveBeenCalled();
        expect(detector.approveButton).not.toHaveBeenCalled();
    });

    it('handles autoaccept ON button and refreshes UI', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);
        const handle = jest.fn().mockReturnValue({
            success: true,
            enabled: true,
            changed: true,
            message: 'ok',
        });
        const sendAutoAcceptUI = jest.fn().mockResolvedValue(undefined);

        const interaction = {
            isButton: () => true,
            customId: 'autoaccept_btn_on',
            user: { id: 'allowed' },
            deferUpdate,
            editReply,
            followUp,
        } as any;

        const handler = createInteractionCreateHandler({
            config: { allowedUserIds: ['allowed'] },
            bridge: { autoAccept: { handle } } as any,
            cleanupHandler: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: {} as any,
            wsHandler: {} as any,
            chatHandler: {} as any,
            client: {} as any,
            sendModeUI: jest.fn(),
            sendModelsUI: jest.fn(),
            sendAutoAcceptUI,
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn().mockReturnValue(null),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            parseRunCommandCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
        });

        await handler(interaction);

        expect(deferUpdate).toHaveBeenCalled();
        expect(handle).toHaveBeenCalledWith('on');
        expect(sendAutoAcceptUI).toHaveBeenCalled();
        expect(followUp).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'ok', flags: 64 }),
        );
    });

    it('handles account dropdown selection and persists account choice', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);
        const accountPrefRepo = { setAccountName: jest.fn() };
        const channelPrefRepo = { setAccountName: jest.fn() };
        const setPreferredAccountForWorkspace = jest.fn();
        const wsHandler = { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') };

        const interaction = {
            isButton: () => false,
            isStringSelectMenu: () => true,
            isChatInputCommand: () => false,
            customId: 'account_select',
            values: ['work1'],
            channelId: 'channel-a',
            user: { id: 'allowed' },
            deferUpdate,
            editReply,
            followUp,
        } as any;

        const handler = createInteractionCreateHandler({
            config: { allowedUserIds: ['allowed'] },
            bridge: {
                selectedAccountByChannel: new Map<string, string>(),
                pool: {
                    setPreferredAccountForWorkspace,
                },
            } as any,
            cleanupHandler: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: {} as any,
            wsHandler: wsHandler as any,
            chatHandler: {} as any,
            client: {} as any,
            sendModeUI: jest.fn(),
            sendModelsUI: jest.fn(),
            sendAutoAcceptUI: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn().mockReturnValue(null),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            parseRunCommandCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
            accountPrefRepo: accountPrefRepo as any,
            channelPrefRepo: channelPrefRepo as any,
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        });

        await handler(interaction);

        expect(deferUpdate).toHaveBeenCalled();
        expect(accountPrefRepo.setAccountName).toHaveBeenCalledWith('allowed', 'work1');
        expect(channelPrefRepo.setAccountName).toHaveBeenCalledWith('channel-a', 'work1');
        expect(setPreferredAccountForWorkspace).toHaveBeenCalledWith('/tmp/demo-project', 'work1');
        expect(editReply).toHaveBeenCalled();
        expect(followUp).toHaveBeenCalledWith(
            expect.objectContaining({ content: '✅ Switched account to **work1**.', flags: 64 }),
        );
    });
});
