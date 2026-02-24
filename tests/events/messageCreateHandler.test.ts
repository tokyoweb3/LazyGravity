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

    it('stops prompt delivery when a renamed session cannot be re-activated', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const handler = createMessageCreateHandler({
            config: { allowedUserIds: ['u1'] },
            bridge: {
                autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                pool: {
                    getOrConnect: jest.fn().mockResolvedValue({}),
                    extractDirName: jest.fn().mockReturnValue('proj-a'),
                },
            } as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: { handleCommand: jest.fn() } as any,
            wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'not found' }),
            } as any,
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'legacy-session',
                }),
            } as any,
            channelManager: {} as any,
            titleGenerator: {} as any,
            client: {} as any,
            sendPromptToAntigravity,
            autoRenameChannel: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            ensureApprovalDetector: jest.fn(),
            downloadInboundImageAttachments: jest.fn().mockResolvedValue([]),
            cleanupInboundImageAttachments: jest.fn().mockResolvedValue(undefined),
            isImageAttachment: jest.fn().mockReturnValue(false),
        });

        await handler({
            author: { bot: false, id: 'u1' },
            content: 'hello',
            channelId: 'ch-1',
            channel: { id: 'ch-1', send: jest.fn().mockResolvedValue(undefined) },
            attachments: { values: () => [] },
            reply,
        } as any);

        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });
});
