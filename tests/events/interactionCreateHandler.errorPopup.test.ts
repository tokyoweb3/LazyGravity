/**
 * Error popup button interaction handler tests
 *
 * Tests the Dismiss, Copy debug info, and Retry button interactions
 * for the error popup feature in the interactionCreateHandler.
 */

import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';

describe('interactionCreateHandler - error popup buttons', () => {
    function createBaseDeps(overrides: Record<string, any> = {}) {
        return {
            config: { allowedUserIds: ['allowed'] },
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn(),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
                autoAccept: { handle: jest.fn(), isEnabled: jest.fn().mockReturnValue(false) },
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
            parseApprovalCustomId: jest.fn().mockReturnValue(null),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
            ...overrides,
        };
    }

    it('rejects error popup actions from a different channel than the bound session', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_dismiss_action:ws-a:channel-a',
            channelId: 'channel-b',
            reply,
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'dismiss',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
        }));

        await handler(interaction);

        expect(reply).toHaveBeenCalled();
    });

    it('replies with error when error popup detector is not found', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_dismiss_action:ws-a:channel-a',
            channelId: 'channel-a',
            reply,
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'dismiss',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(undefined),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.any(String),
                flags: 64,
            }),
        );
    });

    it('handles Dismiss button: clicks Dismiss, updates embed and disables buttons', async () => {
        const update = jest.fn().mockResolvedValue(undefined);

        const errorDetector = {
            clickDismissButton: jest.fn().mockResolvedValue(true),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_dismiss_action:ws-a:channel-a',
            channelId: 'channel-a',
            update,
            channel: { send: jest.fn() },
            message: {
                embeds: [{
                    title: 'Agent terminated due to error',
                    description: 'The agent encountered an error.',
                    color: 0xE74C3C,
                }],
                components: [{
                    components: [
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 2,
                                label: 'Dismiss',
                                custom_id: 'error_popup_dismiss_action:ws-a:channel-a',
                            }),
                        },
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 1,
                                label: 'Copy debug info',
                                custom_id: 'error_popup_copy_debug_action:ws-a:channel-a',
                            }),
                        },
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 3,
                                label: 'Retry',
                                custom_id: 'error_popup_retry_action:ws-a:channel-a',
                            }),
                        },
                    ],
                }],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'dismiss',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(errorDetector),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(errorDetector.clickDismissButton).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            color: 0x95A5A6, // Grey for dismissed
                        }),
                    }),
                ]),
            }),
        );
    });

    it('handles Copy debug info button: clicks button, reads clipboard, sends debug embed', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);
        const channelSend = jest.fn().mockResolvedValue(undefined);

        const errorDetector = {
            clickCopyDebugInfoButton: jest.fn().mockResolvedValue(true),
            readClipboard: jest.fn().mockResolvedValue('Error: Agent terminated\nStack: at line 42\nVersion: 1.0.0'),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_copy_debug_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            editReply,
            followUp,
            channel: { send: channelSend },
            message: {
                embeds: [{
                    title: 'Agent terminated due to error',
                    description: 'The agent encountered an error.',
                    color: 0xE74C3C,
                }],
                components: [],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'copy_debug',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(errorDetector),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(deferUpdate).toHaveBeenCalled();
        expect(errorDetector.clickCopyDebugInfoButton).toHaveBeenCalled();
        expect(errorDetector.readClipboard).toHaveBeenCalled();
        expect(channelSend).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            title: expect.any(String),
                            description: expect.stringContaining('Error: Agent terminated'),
                        }),
                    }),
                ]),
            }),
        );
    });

    it('handles Copy debug info button: sends ephemeral when button click fails', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);

        const errorDetector = {
            clickCopyDebugInfoButton: jest.fn().mockResolvedValue(false),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_copy_debug_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            followUp,
            channel: { send: jest.fn() },
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'copy_debug',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(errorDetector),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(deferUpdate).toHaveBeenCalled();
        expect(followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                flags: 64,
            }),
        );
    });

    it('handles Copy debug info button: sends ephemeral when clipboard is empty', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);

        const errorDetector = {
            clickCopyDebugInfoButton: jest.fn().mockResolvedValue(true),
            readClipboard: jest.fn().mockResolvedValue(null),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_copy_debug_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            editReply,
            followUp,
            channel: { send: jest.fn() },
            message: {
                embeds: [{
                    title: 'Agent Error',
                    description: 'Test',
                    color: 0xE74C3C,
                }],
                components: [],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'copy_debug',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(errorDetector),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                flags: 64,
            }),
        );
    });

    it('handles Retry button: clicks Retry, updates embed with green and disables buttons', async () => {
        const update = jest.fn().mockResolvedValue(undefined);

        const errorDetector = {
            clickRetryButton: jest.fn().mockResolvedValue(true),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'error_popup_retry_action:ws-a:channel-a',
            channelId: 'channel-a',
            update,
            channel: { send: jest.fn() },
            message: {
                embeds: [{
                    title: 'Agent terminated due to error',
                    description: 'The agent encountered an error.',
                    color: 0xE74C3C,
                }],
                components: [{
                    components: [
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 2,
                                label: 'Dismiss',
                                custom_id: 'error_popup_dismiss_action:ws-a:channel-a',
                            }),
                        },
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 1,
                                label: 'Copy debug info',
                                custom_id: 'error_popup_copy_debug_action:ws-a:channel-a',
                            }),
                        },
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 3,
                                label: 'Retry',
                                custom_id: 'error_popup_retry_action:ws-a:channel-a',
                            }),
                        },
                    ],
                }],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parseErrorPopupCustomId: jest.fn().mockReturnValue({
                action: 'retry',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getErrorPopupDetector: jest.fn().mockReturnValue(errorDetector),
                    getPlanningDetector: jest.fn(),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(errorDetector.clickRetryButton).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            color: 0x2ECC71, // Green for retry success
                        }),
                    }),
                ]),
            }),
        );
    });
});
