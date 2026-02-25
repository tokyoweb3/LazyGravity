import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';
import {
    RETRY_BTN_PREFIX,
    RetryInfo,
} from '../../src/bot/index';

jest.mock('../../src/utils/logger', () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Mock the retry store functions so we can control them in tests
const mockGetRetryInfo = jest.fn<RetryInfo | undefined, [string]>();
const mockDeleteRetryInfo = jest.fn();

jest.mock('../../src/bot/index', () => {
    const actual = jest.requireActual('../../src/bot/index');
    return {
        ...actual,
        getRetryInfo: (key: string) => mockGetRetryInfo(key),
        deleteRetryInfo: (key: string) => mockDeleteRetryInfo(key),
    };
});

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

    // ---------------------------------------------------------------
    // Retry button tests
    // ---------------------------------------------------------------
    describe('retry button', () => {
        const RETRY_ID = 'msg123';

        function makeRetryInteraction(customId: string) {
            return {
                isButton: () => true,
                customId,
                user: { id: 'allowed' },
                channelId: 'ch-1',
                deferUpdate: jest.fn().mockResolvedValue(undefined),
                editReply: jest.fn().mockResolvedValue(undefined),
                followUp: jest.fn().mockResolvedValue(undefined),
                message: {
                    components: [
                        {
                            components: [
                                {
                                    type: 2,
                                    toJSON: () => ({
                                        type: 2,
                                        custom_id: `${RETRY_BTN_PREFIX}${RETRY_ID}`,
                                        label: 'Retry',
                                        style: 1,
                                    }),
                                },
                            ],
                        },
                    ],
                },
            } as any;
        }

        function makeHandler(handleRetry?: jest.Mock) {
            return createInteractionCreateHandler({
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
                parseApprovalCustomId: jest.fn().mockReturnValue(null),
                handleSlashInteraction: jest.fn(),
                handleRetry,
            });
        }

        beforeEach(() => {
            mockGetRetryInfo.mockReset();
            mockDeleteRetryInfo.mockReset();
        });

        it('shows ephemeral error when RetryInfo is not found (expired)', async () => {
            mockGetRetryInfo.mockReturnValue(undefined);

            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler();

            await handler(interaction);

            expect(interaction.deferUpdate).toHaveBeenCalled();
            expect(mockGetRetryInfo).toHaveBeenCalledWith(RETRY_ID);
            expect(interaction.followUp).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('expired'),
                    flags: 64,
                }),
            );
        });

        it('deletes RetryInfo from store after successful lookup', async () => {
            const retryInfo: RetryInfo = { type: 'resend', prompt: 'hello' };
            mockGetRetryInfo.mockReturnValue(retryInfo);

            const handleRetry = jest.fn().mockResolvedValue(undefined);
            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler(handleRetry);

            await handler(interaction);

            expect(mockDeleteRetryInfo).toHaveBeenCalledWith(RETRY_ID);
        });

        it('disables the retry button after click', async () => {
            const retryInfo: RetryInfo = { type: 'click-retry' };
            mockGetRetryInfo.mockReturnValue(retryInfo);

            const handleRetry = jest.fn().mockResolvedValue(undefined);
            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler(handleRetry);

            await handler(interaction);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    components: expect.any(Array),
                }),
            );
        });

        it('calls handleRetry with RetryInfo { type: "resend" } for pre-injection errors', async () => {
            const retryInfo: RetryInfo = { type: 'resend', prompt: 'my prompt' };
            mockGetRetryInfo.mockReturnValue(retryInfo);

            const handleRetry = jest.fn().mockResolvedValue(undefined);
            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler(handleRetry);

            await handler(interaction);

            expect(handleRetry).toHaveBeenCalledWith(interaction, retryInfo);
            expect(retryInfo.type).toBe('resend');
            expect(retryInfo.prompt).toBe('my prompt');
        });

        it('calls handleRetry with RetryInfo { type: "click-retry" } for post-injection errors', async () => {
            const retryInfo: RetryInfo = { type: 'click-retry' };
            mockGetRetryInfo.mockReturnValue(retryInfo);

            const handleRetry = jest.fn().mockResolvedValue(undefined);
            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler(handleRetry);

            await handler(interaction);

            expect(handleRetry).toHaveBeenCalledWith(interaction, retryInfo);
            expect(retryInfo.type).toBe('click-retry');
            expect(retryInfo.prompt).toBeUndefined();
        });

        it('does NOT call handleRetry when RetryInfo is expired', async () => {
            mockGetRetryInfo.mockReturnValue(undefined);

            const handleRetry = jest.fn().mockResolvedValue(undefined);
            const interaction = makeRetryInteraction(`${RETRY_BTN_PREFIX}${RETRY_ID}`);
            const handler = makeHandler(handleRetry);

            await handler(interaction);

            expect(handleRetry).not.toHaveBeenCalled();
        });
    });
});
