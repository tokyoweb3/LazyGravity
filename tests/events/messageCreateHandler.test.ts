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

    it('re-registers session channel after autoRenameChannel sets displayName', async () => {
        const sendPromptToAntigravity = jest.fn().mockResolvedValue(undefined);
        const registerApprovalSessionChannel = jest.fn();
        const findByChannelId = jest.fn()
            // First call (L188): new session, no displayName yet
            .mockReturnValueOnce({ isRenamed: false, displayName: null })
            // Second call (after autoRenameChannel): displayName is now set
            .mockReturnValueOnce({ isRenamed: true, displayName: 'New Session Title' });
        const autoRenameChannel = jest.fn().mockResolvedValue(undefined);

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
                startNewChat: jest.fn().mockResolvedValue({ ok: true }),
            } as any,
            chatSessionRepo: { findByChannelId } as any,
            channelManager: {} as any,
            titleGenerator: {} as any,
            client: {} as any,
            sendPromptToAntigravity,
            autoRenameChannel,
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            ensureApprovalDetector: jest.fn(),
            ensureErrorPopupDetector: jest.fn(),
            ensurePlanningDetector: jest.fn(),
            registerApprovalWorkspaceChannel: jest.fn(),
            registerApprovalSessionChannel,
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
            reply: jest.fn().mockResolvedValue(undefined),
        } as any);

        expect(findByChannelId).toHaveBeenCalledTimes(2);
        // The second registerApprovalSessionChannel call (after autoRenameChannel)
        // should use the updated displayName
        const sessionCalls = registerApprovalSessionChannel.mock.calls;
        const lastCall = sessionCalls[sessionCalls.length - 1];
        expect(lastCall[2]).toBe('New Session Title');
        expect(sendPromptToAntigravity).toHaveBeenCalled();
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
