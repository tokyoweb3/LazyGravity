import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';

describe('interactionCreateHandler', () => {
    it('権限のないユーザーにはephemeralで拒否応答する', async () => {
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
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn(),
            handleSlashInteraction: jest.fn(),
        });

        await handler(interaction);

        expect(reply).toHaveBeenCalled();
    });
});
