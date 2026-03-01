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
                    extractProjectName: jest.fn().mockReturnValue('proj-a'),
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

    it('stops prompt delivery when a renamed session cannot be re-activated and no active chat', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const handler = createMessageCreateHandler({
            config: { allowedUserIds: ['u1'] },
            bridge: {
                autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                pool: {
                    getOrConnect: jest.fn().mockResolvedValue({}),
                    extractProjectName: jest.fn().mockReturnValue('proj-a'),
                },
            } as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: { handleCommand: jest.fn() } as any,
            wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'not found' }),
                getCurrentSessionInfo: jest.fn().mockResolvedValue({ hasActiveChat: false, title: '' }),
            } as any,
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'legacy-session',
                    categoryId: 'cat-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([]),
            } as any,
            channelManager: {} as any,
            titleGenerator: {} as any,
            client: {} as any,
            sendPromptToAntigravity,
            autoRenameChannel: jest.fn(),
            handleScreenshot: jest.fn(),
            getCurrentCdp: jest.fn(),
            ensureApprovalDetector: jest.fn(),
            ensureErrorPopupDetector: jest.fn(),
            ensurePlanningDetector: jest.fn(),
            registerApprovalWorkspaceChannel: jest.fn(),
            registerApprovalSessionChannel: jest.fn(),
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

    describe('session title recovery', () => {
        it('recovers when session was renamed and no sibling owns the new title', async () => {
            const sendPromptToAntigravity = jest.fn().mockResolvedValue(undefined);
            const registerApprovalSessionChannel = jest.fn();
            const updateDisplayName = jest.fn().mockReturnValue(true);
            const renameChannel = jest.fn().mockResolvedValue(undefined);
            const findByChannelId = jest.fn()
                // First call: session with old title
                .mockReturnValueOnce({
                    isRenamed: true,
                    displayName: 'Old Title',
                    categoryId: 'cat-1',
                    sessionNumber: 3,
                })
                // Second call after autoRenameChannel
                .mockReturnValueOnce({
                    isRenamed: true,
                    displayName: 'Renamed By Recovery',
                });

            const handler = createMessageCreateHandler({
                config: { allowedUserIds: ['u1'] },
                bridge: {
                    autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                    pool: {
                        getOrConnect: jest.fn().mockResolvedValue({}),
                        extractProjectName: jest.fn().mockReturnValue('proj-a'),
                    },
                } as any,
                modeService: {} as any,
                modelService: {} as any,
                slashCommandHandler: { handleCommand: jest.fn() } as any,
                wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
                chatSessionService: {
                    activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'title mismatch' }),
                    getCurrentSessionInfo: jest.fn().mockResolvedValue({
                        hasActiveChat: true,
                        title: 'New Title From Antigravity',
                    }),
                } as any,
                chatSessionRepo: {
                    findByChannelId,
                    findByCategoryId: jest.fn().mockReturnValue([
                        { channelId: 'ch-1', displayName: 'Old Title' },
                    ]),
                    updateDisplayName,
                } as any,
                channelManager: { renameChannel } as any,
                titleGenerator: { sanitizeForChannelName: jest.fn().mockReturnValue('new-title-from-antigravity') } as any,
                client: {} as any,
                sendPromptToAntigravity,
                autoRenameChannel: jest.fn().mockResolvedValue(undefined),
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
                guild: { id: 'guild-1' },
                attachments: { values: () => [] },
                reply: jest.fn().mockResolvedValue(undefined),
            } as any);

            // Should have updated the display name in DB
            expect(updateDisplayName).toHaveBeenCalledWith('ch-1', 'New Title From Antigravity');
            // Should have re-registered approval channel with old title cleanup
            expect(registerApprovalSessionChannel).toHaveBeenCalledWith(
                expect.anything(), 'proj-a', 'New Title From Antigravity', expect.anything(), 'Old Title',
            );
            // Should have renamed the Discord channel
            expect(renameChannel).toHaveBeenCalledWith(
                { id: 'guild-1' }, 'ch-1', '3-new-title-from-antigravity',
            );
            // Should have continued to send the prompt
            expect(sendPromptToAntigravity).toHaveBeenCalled();
        });

        it('recovers with warning when title collides with another channel', async () => {
            const sendPromptToAntigravity = jest.fn().mockResolvedValue(undefined);
            const updateDisplayName = jest.fn().mockReturnValue(true);
            const findByChannelId = jest.fn()
                .mockReturnValueOnce({
                    isRenamed: true,
                    displayName: 'My Session',
                    categoryId: 'cat-1',
                    sessionNumber: 1,
                })
                .mockReturnValueOnce({
                    isRenamed: true,
                    displayName: 'Colliding Title',
                });

            const handler = createMessageCreateHandler({
                config: { allowedUserIds: ['u1'] },
                bridge: {
                    autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                    pool: {
                        getOrConnect: jest.fn().mockResolvedValue({}),
                        extractProjectName: jest.fn().mockReturnValue('proj-a'),
                    },
                } as any,
                modeService: {} as any,
                modelService: {} as any,
                slashCommandHandler: { handleCommand: jest.fn() } as any,
                wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
                chatSessionService: {
                    activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'not found' }),
                    getCurrentSessionInfo: jest.fn().mockResolvedValue({
                        hasActiveChat: true,
                        title: 'Colliding Title',
                    }),
                } as any,
                chatSessionRepo: {
                    findByChannelId,
                    findByCategoryId: jest.fn().mockReturnValue([
                        { channelId: 'ch-1', displayName: 'My Session' },
                        { channelId: 'ch-2', displayName: 'Colliding Title' },
                    ]),
                    updateDisplayName,
                } as any,
                channelManager: { renameChannel: jest.fn().mockResolvedValue(undefined) } as any,
                titleGenerator: { sanitizeForChannelName: jest.fn().mockReturnValue('colliding-title') } as any,
                client: {} as any,
                sendPromptToAntigravity,
                autoRenameChannel: jest.fn().mockResolvedValue(undefined),
                handleScreenshot: jest.fn(),
                getCurrentCdp: jest.fn(),
                ensureApprovalDetector: jest.fn(),
                ensureErrorPopupDetector: jest.fn(),
                ensurePlanningDetector: jest.fn(),
                registerApprovalWorkspaceChannel: jest.fn(),
                registerApprovalSessionChannel: jest.fn(),
                downloadInboundImageAttachments: jest.fn().mockResolvedValue([]),
                cleanupInboundImageAttachments: jest.fn().mockResolvedValue(undefined),
                isImageAttachment: jest.fn().mockReturnValue(false),
            });

            await handler({
                author: { bot: false, id: 'u1' },
                content: 'hello',
                channelId: 'ch-1',
                channel: { id: 'ch-1', send: jest.fn().mockResolvedValue(undefined) },
                guild: { id: 'guild-1' },
                attachments: { values: () => [] },
                reply: jest.fn().mockResolvedValue(undefined),
            } as any);

            // Should still adopt the title despite collision
            expect(updateDisplayName).toHaveBeenCalledWith('ch-1', 'Colliding Title');
            // Should still send the prompt
            expect(sendPromptToAntigravity).toHaveBeenCalled();
        });

        it('does not recover when hasActiveChat is false', async () => {
            const sendPromptToAntigravity = jest.fn();
            const reply = jest.fn().mockResolvedValue(undefined);

            const handler = createMessageCreateHandler({
                config: { allowedUserIds: ['u1'] },
                bridge: {
                    autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                    pool: {
                        getOrConnect: jest.fn().mockResolvedValue({}),
                        extractProjectName: jest.fn().mockReturnValue('proj-a'),
                    },
                } as any,
                modeService: {} as any,
                modelService: {} as any,
                slashCommandHandler: { handleCommand: jest.fn() } as any,
                wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
                chatSessionService: {
                    activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false }),
                    getCurrentSessionInfo: jest.fn().mockResolvedValue({
                        hasActiveChat: false,
                        title: '',
                    }),
                } as any,
                chatSessionRepo: {
                    findByChannelId: jest.fn().mockReturnValue({
                        isRenamed: true,
                        displayName: 'My Session',
                        categoryId: 'cat-1',
                    }),
                    findByCategoryId: jest.fn().mockReturnValue([]),
                } as any,
                channelManager: {} as any,
                titleGenerator: {} as any,
                client: {} as any,
                sendPromptToAntigravity,
                autoRenameChannel: jest.fn(),
                handleScreenshot: jest.fn(),
                getCurrentCdp: jest.fn(),
                ensureApprovalDetector: jest.fn(),
                ensureErrorPopupDetector: jest.fn(),
                ensurePlanningDetector: jest.fn(),
                registerApprovalWorkspaceChannel: jest.fn(),
                registerApprovalSessionChannel: jest.fn(),
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

        it('does not recover when current title matches the stored displayName (Untitled)', async () => {
            const sendPromptToAntigravity = jest.fn();
            const reply = jest.fn().mockResolvedValue(undefined);

            const handler = createMessageCreateHandler({
                config: { allowedUserIds: ['u1'] },
                bridge: {
                    autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                    pool: {
                        getOrConnect: jest.fn().mockResolvedValue({}),
                        extractProjectName: jest.fn().mockReturnValue('proj-a'),
                    },
                } as any,
                modeService: {} as any,
                modelService: {} as any,
                slashCommandHandler: { handleCommand: jest.fn() } as any,
                wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
                chatSessionService: {
                    activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false }),
                    getCurrentSessionInfo: jest.fn().mockResolvedValue({
                        hasActiveChat: true,
                        title: '(Untitled)',
                    }),
                } as any,
                chatSessionRepo: {
                    findByChannelId: jest.fn().mockReturnValue({
                        isRenamed: true,
                        displayName: 'My Session',
                        categoryId: 'cat-1',
                    }),
                    findByCategoryId: jest.fn().mockReturnValue([]),
                } as any,
                channelManager: {} as any,
                titleGenerator: {} as any,
                client: {} as any,
                sendPromptToAntigravity,
                autoRenameChannel: jest.fn(),
                handleScreenshot: jest.fn(),
                getCurrentCdp: jest.fn(),
                ensureApprovalDetector: jest.fn(),
                ensureErrorPopupDetector: jest.fn(),
                ensurePlanningDetector: jest.fn(),
                registerApprovalWorkspaceChannel: jest.fn(),
                registerApprovalSessionChannel: jest.fn(),
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
});
