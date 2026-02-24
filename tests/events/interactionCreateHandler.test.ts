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
                workspaceDirName: 'ws-a',
                channelId: 'channel-a',
            }),
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
});
