import { createMessageCreateHandler } from '../../src/events/messageCreateHandler';

describe('messageCreateHandler', () => {
    it('ignores messages from the bot itself', async () => {
        const sendPromptToAntigravity = jest.fn();
        const handler = createMessageCreateHandler({
            config: { allowedUserIds: ['u1'] },
            bridge: { autoAccept: { handle: jest.fn(), isEnabled: jest.fn() } } as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: { handleCommand: jest.fn() } as any,
            wsHandler: { getWorkspaceForChannel: jest.fn() } as any,
            chatSessionService: {} as any,
            chatSessionRepo: { findByChannelId: jest.fn() } as any,
            channelManager: {} as any,
            titleGenerator: {} as any,
            client: {} as any,
            sendPromptToAntigravity,
            autoRenameChannel: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            ensureApprovalDetector: jest.fn(),
            downloadInboundImageAttachments: jest.fn(),
            cleanupInboundImageAttachments: jest.fn(),
            isImageAttachment: jest.fn(),
        });

        await handler({
            author: { bot: true, id: 'u1' },
        } as any);

        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
    });
});
