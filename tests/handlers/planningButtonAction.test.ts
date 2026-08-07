import { createPlanningButtonAction } from '../../src/handlers/planningButtonAction';
import type { PlatformButtonInteraction, PlatformChannel, PlatformUser, PlatformSentMessage } from '../../src/platform/types';
import type { CdpBridge } from '../../src/services/cdpBridgeManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(overrides: Partial<PlatformChannel> = {}): PlatformChannel {
    return {
        id: 'ch-1',
        platform: 'telegram',
        name: 'test-channel',
        send: jest.fn(),
        ...overrides,
    };
}

function makeUser(overrides: Partial<PlatformUser> = {}): PlatformUser {
    return {
        id: 'user-1',
        platform: 'telegram',
        username: 'testuser',
        isBot: false,
        ...overrides,
    };
}

function makeInteraction(overrides: Partial<PlatformButtonInteraction> = {}): PlatformButtonInteraction {
    return {
        id: 'int-1',
        platform: 'telegram',
        customId: '',
        user: makeUser(),
        channel: makeChannel(),
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({
            id: 'sent-1', platform: 'telegram', channelId: 'ch-1',
            edit: jest.fn(), delete: jest.fn(),
        } as PlatformSentMessage),
        showModal: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeBridge(overrides: Partial<CdpBridge> = {}): CdpBridge {
    return {
        pool: {
            getPlanningDetector: jest.fn(),
            getApprovalDetector: jest.fn(),
            getErrorPopupDetector: jest.fn(),
        } as any,
        quota: {} as any,
        autoAccept: {} as any,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        cdpHost: 'localhost',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPlanningButtonAction', () => {
    describe('match', () => {
        it('matches planning_open_action customId', () => {
            const bridge = makeBridge();
            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const result = action.match('planning_open_action:proj:ch-1');
            expect(result).toEqual({
                action: 'open',
                projectName: 'proj',
                channelId: 'ch-1',
            });
        });

        it('matches planning_proceed_action customId', () => {
            const bridge = makeBridge();
            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const result = action.match('planning_proceed_action:proj');
            expect(result).toEqual({
                action: 'proceed',
                projectName: 'proj',
                channelId: '',
            });
        });

        it('returns null for unrelated customId', () => {
            const bridge = makeBridge();
            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            expect(action.match('approve_action:proj')).toBeNull();
            expect(action.match('random')).toBeNull();
        });
    });

    describe('execute - open', () => {
        it('clicks open button, extracts plan, and sends followUp', async () => {
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(true),
                extractPlanContent: jest.fn().mockResolvedValue('Plan details here'),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.deferUpdate).toHaveBeenCalled();
            expect(mockDetector.clickOpenButton).toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith({
                text: '📋 Plan opened',
                components: [],
            });
            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Plan details here',
            });
        });

        it('truncates plan content over 4096 chars', async () => {
            const longContent = 'x'.repeat(5000);
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(true),
                extractPlanContent: jest.fn().mockResolvedValue(longContent),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            const followUpCall = (interaction.followUp as jest.Mock).mock.calls[0][0];
            expect(followUpCall.text.length).toBeLessThanOrEqual(4096);
            expect(followUpCall.text).toContain('(truncated)');
        });

        it('replies with error when open button not found', async () => {
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(false),
                extractPlanContent: jest.fn().mockResolvedValue(null),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Plan content could not be extracted from the IDE or workspace.',
            });
        });

        it('sends fallback message when plan content is null', async () => {
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(true),
                extractPlanContent: jest.fn().mockResolvedValue(null),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Plan opened in IDE, but content could not be extracted.',
            });
        });

        it('shows comment modal if isReview is true and showModal is supported', async () => {
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(true),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true, openText: 'Review plan' }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.showModal).toHaveBeenCalled();
            expect(mockDetector.clickOpenButton).not.toHaveBeenCalled();
        });

        it('falls back to normal open flow if showModal throws/fails', async () => {
            const mockDetector = {
                clickOpenButton: jest.fn().mockResolvedValue(true),
                extractPlanContent: jest.fn().mockResolvedValue('Plan details here'),
                getLastDetectedInfo: jest.fn().mockReturnValue({ hasOpenButton: true, openText: 'Review plan' }),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction({
                showModal: jest.fn().mockRejectedValue(new Error('Modal display rejected')),
            });

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.showModal).toHaveBeenCalled();
            expect(mockDetector.clickOpenButton).toHaveBeenCalled();
            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Plan details here',
            });
        });
    });

    describe('execute - proceed', () => {
        it('clicks proceed button and updates message', async () => {
            const mockDetector = {
                clickProceedButton: jest.fn().mockResolvedValue(true),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'proceed',
                projectName: 'proj',
                channelId: '',
            });

            expect(mockDetector.clickProceedButton).toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith({
                text: '▶️ Proceed started.\n\n⏳ IDE is working on the response...',
                components: [],
            });
        });

        it('replies with error when proceed button not found', async () => {
            const mockDetector = {
                clickProceedButton: jest.fn().mockResolvedValue(false),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'proceed',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Proceed button not found.',
                ephemeral: true,
            });
        });
    });

    describe('execute - reject', () => {
        it('does not allow plan rejection and replies with error message', async () => {
            const mockDetector = {
                clickRejectButton: jest.fn().mockResolvedValue(true),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'reject',
                projectName: 'proj',
                channelId: '',
            });

            expect(mockDetector.clickRejectButton).not.toHaveBeenCalled();
            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Rejection of the plan is not allowed.',
                ephemeral: true,
            });
        });
    });

    describe('execute - shared', () => {
        it('replies with error when detector not found', async () => {
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(undefined);

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'open',
                projectName: 'nonexistent',
                channelId: '',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Planning detector not found.',
                ephemeral: true,
            });
        });

        it('rejects interaction from wrong channel', async () => {
            const bridge = makeBridge();
            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn() } as any });
            const interaction = makeInteraction({
                channel: makeChannel({ id: 'ch-other' }),
            });

            await action.execute(interaction, {
                action: 'open',
                projectName: 'proj',
                channelId: 'ch-1',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'This planning action is linked to a different session channel.',
                ephemeral: true,
            });
        });

        it('falls back to wsHandler when projectName is empty', async () => {
            const mockDetector = {
                clickProceedButton: jest.fn().mockResolvedValue(true),
            };
            const bridge = makeBridge();
            (bridge.pool.getPlanningDetector as jest.Mock).mockReturnValue(mockDetector);
            bridge.pool.extractProjectName = jest.fn().mockReturnValue('fallbackWs');

            const action = createPlanningButtonAction({ bridge, wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue('/path/to/ws') } as any });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'proceed',
                projectName: '',
                channelId: '',
            });

            expect(bridge.pool.getPlanningDetector).toHaveBeenCalledWith('fallbackWs');
        });
    });
});
