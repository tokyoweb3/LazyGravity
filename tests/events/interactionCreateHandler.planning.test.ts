/**
 * Planning button interaction handler tests
 *
 * Tests the Open and Proceed button interactions for the planning mode feature
 * in the interactionCreateHandler.
 */

import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';

describe('interactionCreateHandler - planning buttons', () => {
    function createBaseDeps(overrides: Record<string, any> = {}) {
        return {
            config: { allowedUserIds: ['allowed'] },
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
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

    it('rejects planning actions from a different channel than the bound session', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_open_action:ws-a:channel-a',
            channelId: 'channel-b',
            reply,
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'open',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
        }));

        await handler(interaction);

        expect(reply).toHaveBeenCalled();
    });

    it('replies with error when planning detector is not found', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_open_action:ws-a:channel-a',
            channelId: 'channel-a',
            reply,
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'open',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getPlanningDetector: jest.fn().mockReturnValue(undefined),
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

    it('handles Open button: clicks Open, extracts plan content, and sends embed', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);
        const channelSend = jest.fn().mockResolvedValue(undefined);

        const planDetector = {
            clickOpenButton: jest.fn().mockResolvedValue(true),
            extractPlanContent: jest.fn().mockResolvedValue('# Plan\n\n## Step 1\nDo something'),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_open_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            editReply,
            followUp,
            channel: { send: channelSend },
            message: {
                embeds: [{
                    title: 'Planning Mode',
                    description: 'Test',
                    color: 0x3498DB,
                }],
                components: [],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'open',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getPlanningDetector: jest.fn().mockReturnValue(planDetector),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(deferUpdate).toHaveBeenCalled();
        expect(planDetector.clickOpenButton).toHaveBeenCalled();
        expect(planDetector.extractPlanContent).toHaveBeenCalled();
        expect(channelSend).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            title: expect.any(String),
                        }),
                    }),
                ]),
            }),
        );
    });

    it('handles Proceed button: clicks Proceed, updates embed and disables buttons', async () => {
        const update = jest.fn().mockResolvedValue(undefined);

        const planDetector = {
            clickProceedButton: jest.fn().mockResolvedValue(true),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_proceed_action:ws-a:channel-a',
            channelId: 'channel-a',
            update,
            channel: { send: jest.fn() },
            message: {
                embeds: [{
                    title: 'Planning Mode',
                    description: 'Test',
                    color: 0x3498DB,
                }],
                components: [{
                    components: [
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 2,
                                label: 'Open',
                                custom_id: 'planning_open_action:ws-a:channel-a',
                            }),
                        },
                        {
                            type: 2,
                            data: { type: 2 },
                            toJSON: () => ({
                                type: 2,
                                style: 1,
                                label: 'Proceed',
                                custom_id: 'planning_proceed_action:ws-a:channel-a',
                            }),
                        },
                    ],
                }],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'proceed',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getPlanningDetector: jest.fn().mockReturnValue(planDetector),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(planDetector.clickProceedButton).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            color: 0x2ECC71,
                        }),
                    }),
                ]),
            }),
        );
    });

    it('handles Open button: sends plan content as markdown (not code block)', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const editReply = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);
        const channelSend = jest.fn().mockResolvedValue(undefined);

        const planDetector = {
            clickOpenButton: jest.fn().mockResolvedValue(true),
            extractPlanContent: jest.fn().mockResolvedValue('## Step 1\n\nImplement **authentication**\n\n- Add login\n- Add logout'),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_open_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            editReply,
            followUp,
            channel: { send: channelSend },
            message: {
                embeds: [{
                    title: 'Planning Mode',
                    description: 'Test',
                    color: 0x3498DB,
                }],
                components: [],
            },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'open',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getPlanningDetector: jest.fn().mockReturnValue(planDetector),
                },
                lastActiveWorkspace: null,
            } as any,
        }));

        await handler(interaction);

        expect(channelSend).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            description: expect.not.stringContaining('```'),
                        }),
                    }),
                ]),
            }),
        );

        // Verify it contains markdown formatting directly
        const sentEmbed = channelSend.mock.calls[0][0].embeds[0];
        expect(sentEmbed.data.description).toContain('**authentication**');
    });

    it('handles Open button: sends ephemeral message when Open click fails', async () => {
        const deferUpdate = jest.fn().mockResolvedValue(undefined);
        const followUp = jest.fn().mockResolvedValue(undefined);

        const planDetector = {
            clickOpenButton: jest.fn().mockResolvedValue(false),
        };

        const interaction = {
            isButton: () => true,
            user: { id: 'allowed' },
            customId: 'planning_open_action:ws-a:channel-a',
            channelId: 'channel-a',
            deferUpdate,
            followUp,
            channel: { send: jest.fn() },
            message: { embeds: [], components: [] },
        } as any;

        const handler = createInteractionCreateHandler(createBaseDeps({
            parsePlanningCustomId: jest.fn().mockReturnValue({
                action: 'open',
                projectName: 'ws-a',
                channelId: 'channel-a',
            }),
            bridge: {
                pool: {
                    getApprovalDetector: jest.fn(),
                    getPlanningDetector: jest.fn().mockReturnValue(planDetector),
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
});
