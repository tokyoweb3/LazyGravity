import { createMessageCreateHandler } from '../../src/events/messageCreateHandler';

/** Helper: create a sendPromptToAntigravity mock that calls onFullCompletion synchronously */
function mockSendPromptImmediate() {
    return jest.fn().mockImplementation(
        (_bridge: any, _msg: any, _prompt: any, _cdp: any, _mode: any, _model: any, _imgs: any, opts: any) => {
            opts?.onFullCompletion?.();
            return Promise.resolve();
        },
    );
}

/** Helper: build minimal deps with overrides */
function buildDeps(overrides: Record<string, any> = {}) {
    return {
        config: { allowedUserIds: ['u1'] },
        bridge: {
            autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
            pool: {
                getOrConnect: jest.fn().mockResolvedValue({}),
                extractProjectName: jest.fn().mockReturnValue('proj-a'),
                getPreferredAccountForWorkspace: jest.fn().mockReturnValue(null),
                setPreferredAccountForWorkspace: jest.fn(),
            },
        } as any,
        modeService: {} as any,
        modelService: {} as any,
        slashCommandHandler: { handleCommand: jest.fn() } as any,
        wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/proj-a') } as any,
        chatSessionService: {
            startNewChat: jest.fn().mockResolvedValue({ ok: true }),
        } as any,
        chatSessionRepo: { findByChannelId: jest.fn().mockReturnValue(null) } as any,
        channelManager: {} as any,
        titleGenerator: {} as any,
        client: { user: { id: 'bot-1' } } as any,
        sendPromptToAntigravity: mockSendPromptImmediate(),
        autoRenameChannel: jest.fn().mockResolvedValue(undefined),
        handleScreenshot: jest.fn(),
        getCurrentCdp: jest.fn(),
        ensureApprovalDetector: jest.fn(),
        ensureErrorPopupDetector: jest.fn(),
        ensurePlanningDetector: jest.fn(),
        ensureRunCommandDetector: jest.fn(),
        registerApprovalWorkspaceChannel: jest.fn(),
        registerApprovalSessionChannel: jest.fn(),
        downloadInboundImageAttachments: jest.fn().mockResolvedValue([]),
        cleanupInboundImageAttachments: jest.fn().mockResolvedValue(undefined),
        isImageAttachment: jest.fn().mockReturnValue(false),
        ...overrides,
    };
}

function buildMessage(overrides: Record<string, any> = {}) {
    return {
        author: { bot: false, id: 'u1' },
        content: 'hello',
        channelId: 'ch-1',
        channel: { id: 'ch-1', send: jest.fn().mockResolvedValue(undefined) },
        attachments: { values: () => [] },
        reply: jest.fn().mockResolvedValue(undefined),
        react: jest.fn().mockResolvedValue(undefined),
        reactions: { resolve: jest.fn().mockReturnValue({ users: { remove: jest.fn().mockResolvedValue(undefined) } }) },
        client: { user: { id: 'bot-1' } },
        ...overrides,
    } as any;
}

describe('messageCreateHandler', () => {
    it('ignores messages from the bot itself', async () => {
        const sendPromptToAntigravity = jest.fn();
        const handler = createMessageCreateHandler(buildDeps({ sendPromptToAntigravity }));

        await handler({ author: { bot: true, id: 'u1' } } as any);

        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
    });

    it('shows active account, original account, and conversation title in text status', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);
        const handler = createMessageCreateHandler(buildDeps({
            modeService: { getCurrentMode: jest.fn().mockReturnValue('normal') },
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work4', cdpPort: 9444 },
            ],
            bridge: {
                autoAccept: { handle: jest.fn(), isEnabled: jest.fn().mockReturnValue(false) },
                selectedAccountByChannel: new Map<string, string>([['ch-1', 'work4']]),
                pool: {
                    getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
                    getConnected: jest.fn().mockReturnValue(null),
                    getApprovalDetector: jest.fn().mockReturnValue(undefined),
                    extractProjectName: jest.fn().mockReturnValue('proj-a'),
                },
            } as any,
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    channelId: 'ch-1',
                    activeAccountName: 'work4',
                    originAccountName: 'default',
                    displayName: 'Imported Session',
                }),
            } as any,
        }));

        await handler(buildMessage({ content: '/status', reply }));

        const payload = reply.mock.calls[0][0];
        const embed = payload.embeds[0].data;
        expect(embed.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'Active Account', value: 'work4' }),
            expect.objectContaining({ name: 'Original Account', value: 'default' }),
            expect.objectContaining({ name: 'Conversation Title', value: 'Imported Session' }),
        ]));
    });

    it('re-registers session channel after autoRenameChannel sets displayName', async () => {
        const sendPromptToAntigravity = mockSendPromptImmediate();
        const registerApprovalSessionChannel = jest.fn();
        const findByChannelId = jest.fn()
            .mockReturnValueOnce({ isRenamed: false, displayName: null, activeAccountName: null })
            .mockReturnValueOnce({ isRenamed: false, displayName: null, activeAccountName: null })
            .mockReturnValueOnce({ isRenamed: true, displayName: 'New Session Title' });

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            registerApprovalSessionChannel,
            chatSessionRepo: { findByChannelId },
            chatSessionService: {
                startNewChat: jest.fn().mockResolvedValue({ ok: true }),
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: true }),
            },
        }));

        await handler(buildMessage());

        expect(findByChannelId).toHaveBeenCalledTimes(3);
        const sessionCalls = registerApprovalSessionChannel.mock.calls;
        const lastCall = sessionCalls[sessionCalls.length - 1];
        expect(lastCall[2]).toBe('New Session Title');
        expect(sendPromptToAntigravity).toHaveBeenCalled();
    });

    it('stops prompt delivery when a renamed session cannot be re-activated and recovery fails', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'not found' }),
                getCurrentSessionInfo: jest.fn().mockResolvedValue({ title: '', hasActiveChat: false }),
            },
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'legacy-session',
                    categoryId: 'cat-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([]),
            },
        }));

        await handler(buildMessage({ reply }));

        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });

    it('recovers from session title change by adopting the new title', async () => {
        const sendPromptToAntigravity = mockSendPromptImmediate();
        const updateDisplayName = jest.fn().mockReturnValue(true);
        const activateSessionByTitle = jest.fn()
            .mockResolvedValueOnce({ ok: false, error: 'Activated chat did not match target title (expected="Original Title", actual="New Title")' })
            .mockResolvedValueOnce({ ok: true });

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle,
                getCurrentSessionInfo: jest.fn().mockResolvedValue({
                    title: 'New Title',
                    hasActiveChat: true,
                }),
            },
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'Original Title',
                    categoryId: 'cat-1',
                    channelId: 'ch-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([]),
                updateDisplayName,
            },
        }));

        await handler(buildMessage());

        expect(updateDisplayName).toHaveBeenCalledWith('ch-1', 'New Title');
        expect(activateSessionByTitle).toHaveBeenCalledTimes(2);
        expect(sendPromptToAntigravity).toHaveBeenCalled();
    });

    it('resets stale renamed session state when the channel is reopened under a different account', async () => {
        const sendPromptToAntigravity = mockSendPromptImmediate();
        const activateSessionByTitle = jest.fn();
        const startNewChat = jest.fn().mockResolvedValue({ ok: true });
        const setActiveAccountName = jest.fn().mockReturnValue(true);
        const initializeOriginAccountName = jest.fn().mockReturnValue(true);
        const findByChannelId = jest.fn()
            .mockReturnValueOnce({
                isRenamed: true,
                displayName: 'Legacy Session',
                activeAccountName: 'default',
                categoryId: 'cat-1',
                channelId: 'ch-1',
            })
            .mockReturnValueOnce({
                isRenamed: true,
                displayName: 'Legacy Session',
                activeAccountName: 'default',
                categoryId: 'cat-1',
                channelId: 'ch-1',
            })
            .mockReturnValueOnce({
                isRenamed: false,
                displayName: null,
                activeAccountName: 'work4',
                categoryId: 'cat-1',
                channelId: 'ch-1',
            })
            .mockReturnValueOnce({
                isRenamed: false,
                displayName: null,
                activeAccountName: 'work4',
                categoryId: 'cat-1',
                channelId: 'ch-1',
            });

        const handler = createMessageCreateHandler(buildDeps({
            antigravityAccounts: [{ name: 'work4', cdpPort: 9321 }],
            bridge: {
                autoAccept: { handle: jest.fn(), isEnabled: jest.fn() },
                selectedAccountByChannel: new Map<string, string>([['ch-1', 'work4']]),
                pool: {
                    getOrConnect: jest.fn().mockResolvedValue({}),
                    extractProjectName: jest.fn().mockReturnValue('proj-a'),
                    getPreferredAccountForWorkspace: jest.fn().mockReturnValue('default'),
                    setPreferredAccountForWorkspace: jest.fn(),
                },
            } as any,
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle,
                startNewChat,
            },
            chatSessionRepo: {
                findByChannelId,
                setActiveAccountName,
                initializeOriginAccountName,
            },
        }));

        await handler(buildMessage());

        expect(setActiveAccountName).toHaveBeenCalledWith('ch-1', 'work4');
        expect(activateSessionByTitle).not.toHaveBeenCalled();
        expect(startNewChat).toHaveBeenCalled();
        expect(initializeOriginAccountName).toHaveBeenCalledWith('ch-1', 'work4');
        expect(sendPromptToAntigravity).toHaveBeenCalled();
    });

    it('does not adopt new title if it belongs to a sibling channel', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const updateDisplayName = jest.fn();

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'title mismatch' }),
                getCurrentSessionInfo: jest.fn().mockResolvedValue({
                    title: 'Sibling Session',
                    hasActiveChat: true,
                }),
            },
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'Original Title',
                    categoryId: 'cat-1',
                    channelId: 'ch-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([
                    { channelId: 'ch-2', displayName: 'Sibling Session' },
                ]),
                updateDisplayName,
            },
        }));

        await handler(buildMessage({ reply }));

        expect(updateDisplayName).not.toHaveBeenCalled();
        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });

    it('does not persist title when retry activation also fails', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const updateDisplayName = jest.fn();

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'still fails' }),
                getCurrentSessionInfo: jest.fn().mockResolvedValue({
                    title: 'Renamed Title',
                    hasActiveChat: true,
                }),
            },
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'Original Title',
                    categoryId: 'cat-1',
                    channelId: 'ch-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([]),
                updateDisplayName,
            },
        }));

        await handler(buildMessage({ reply }));

        expect(updateDisplayName).not.toHaveBeenCalled();
        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });

    it('does not adopt title when no active chat exists during recovery', async () => {
        const sendPromptToAntigravity = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const updateDisplayName = jest.fn();

        const handler = createMessageCreateHandler(buildDeps({
            sendPromptToAntigravity,
            chatSessionService: {
                activateSessionByTitle: jest.fn().mockResolvedValue({ ok: false, error: 'not found' }),
                getCurrentSessionInfo: jest.fn().mockResolvedValue({
                    title: 'Agent',
                    hasActiveChat: false,
                }),
            },
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({
                    isRenamed: true,
                    displayName: 'Original Title',
                    categoryId: 'cat-1',
                    channelId: 'ch-1',
                }),
                findByCategoryId: jest.fn().mockReturnValue([]),
                updateDisplayName,
            },
        }));

        await handler(buildMessage({ reply }));

        expect(updateDisplayName).not.toHaveBeenCalled();
        expect(sendPromptToAntigravity).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });

    describe('workspace prompt queue', () => {
        it('serializes prompts for the same workspace', async () => {
            const callOrder: string[] = [];
            let resolveFirst: (() => void) | undefined;

            const sendPromptToAntigravity = jest.fn().mockImplementation(
                (_b: any, msg: any, _p: any, _c: any, _m: any, _mo: any, _i: any, opts: any) => {
                    const label = msg.content;
                    callOrder.push(`start:${label}`);
                    if (label === 'first') {
                        // First prompt: delay onFullCompletion until we resolve manually
                        resolveFirst = () => {
                            callOrder.push(`complete:${label}`);
                            opts?.onFullCompletion?.();
                        };
                    } else {
                        callOrder.push(`complete:${label}`);
                        opts?.onFullCompletion?.();
                    }
                    return Promise.resolve();
                },
            );

            const handler = createMessageCreateHandler(buildDeps({ sendPromptToAntigravity }));

            const msg1 = buildMessage({ content: 'first' });
            const msg2 = buildMessage({ content: 'second', channelId: 'ch-2' });

            // Dispatch both — second should be enqueued behind first
            const p1 = handler(msg1);
            const p2 = handler(msg2);

            // Give microtasks a chance to run
            await new Promise((r) => setTimeout(r, 10));

            // At this point, only first should have started
            expect(callOrder).toEqual(['start:first']);

            // Complete the first prompt
            resolveFirst!();
            await Promise.all([p1, p2]);

            expect(callOrder).toEqual([
                'start:first',
                'complete:first',
                'start:second',
                'complete:second',
            ]);
        });

        it('processes different workspaces independently', async () => {
            const callOrder: string[] = [];
            const resolvers: Record<string, () => void> = {};

            const sendPromptToAntigravity = jest.fn().mockImplementation(
                (_b: any, msg: any, _p: any, _c: any, _m: any, _mo: any, _i: any, opts: any) => {
                    const label = msg.content;
                    callOrder.push(`start:${label}`);
                    resolvers[label] = () => {
                        callOrder.push(`complete:${label}`);
                        opts?.onFullCompletion?.();
                    };
                    return Promise.resolve();
                },
            );

            const wsHandler = {
                getWorkspaceForChannel: jest.fn().mockImplementation((channelId: string) => {
                    if (channelId === 'ch-ws-a') return '/tmp/ws-a';
                    if (channelId === 'ch-ws-b') return '/tmp/ws-b';
                    return null;
                }),
            };

            const handler = createMessageCreateHandler(buildDeps({
                sendPromptToAntigravity,
                wsHandler,
            }));

            const msgA = buildMessage({ content: 'msg-a', channelId: 'ch-ws-a' });
            const msgB = buildMessage({ content: 'msg-b', channelId: 'ch-ws-b' });

            const pA = handler(msgA);
            const pB = handler(msgB);

            await new Promise((r) => setTimeout(r, 10));

            // Both should have started (different workspaces)
            expect(callOrder).toContain('start:msg-a');
            expect(callOrder).toContain('start:msg-b');

            resolvers['msg-a']();
            resolvers['msg-b']();
            await Promise.all([pA, pB]);
        });

        it('isolates errors: second task runs even if first fails', async () => {
            let callCount = 0;
            const sendPromptToAntigravity = jest.fn().mockImplementation(
                (_b: any, _msg: any, _p: any, _c: any, _m: any, _mo: any, _i: any, opts: any) => {
                    callCount++;
                    if (callCount === 1) {
                        // First call throws after signaling completion
                        opts?.onFullCompletion?.();
                        throw new Error('simulated failure');
                    }
                    opts?.onFullCompletion?.();
                    return Promise.resolve();
                },
            );

            const handler = createMessageCreateHandler(buildDeps({ sendPromptToAntigravity }));

            const msg1 = buildMessage({ content: 'fail' });
            const msg2 = buildMessage({ content: 'succeed', channelId: 'ch-2' });

            await handler(msg1);
            await handler(msg2);

            expect(sendPromptToAntigravity).toHaveBeenCalledTimes(2);
        });

        it('adds hourglass reaction to queued messages and removes it when processing starts', async () => {
            let resolveFirst: (() => void) | undefined;

            const sendPromptToAntigravity = jest.fn().mockImplementation(
                (_b: any, msg: any, _p: any, _c: any, _m: any, _mo: any, _i: any, opts: any) => {
                    if (msg.content === 'first') {
                        resolveFirst = () => opts?.onFullCompletion?.();
                    } else {
                        opts?.onFullCompletion?.();
                    }
                    return Promise.resolve();
                },
            );

            const handler = createMessageCreateHandler(buildDeps({ sendPromptToAntigravity }));

            const msg1 = buildMessage({ content: 'first' });
            const removeHourglass = jest.fn().mockResolvedValue(undefined);
            const msg2 = buildMessage({
                content: 'second',
                channelId: 'ch-2',
                reactions: {
                    resolve: jest.fn().mockReturnValue({
                        users: { remove: removeHourglass },
                    }),
                },
            });

            const p1 = handler(msg1);
            const p2 = handler(msg2);

            await new Promise((r) => setTimeout(r, 10));

            // Second message should have received hourglass (queue depth > 0)
            expect(msg2.react).toHaveBeenCalledWith('⏳');
            // First message should NOT have hourglass (it was first in queue)
            expect(msg1.react).not.toHaveBeenCalledWith('⏳');

            resolveFirst!();
            await Promise.all([p1, p2]);

            // Hourglass should have been removed from msg2 when it started processing
            expect(removeHourglass).toHaveBeenCalledWith('bot-1');
        });
    });
});
