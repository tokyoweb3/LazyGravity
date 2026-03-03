import { createApprovalButtonAction } from '../../src/handlers/approvalButtonAction';
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
        ...overrides,
    };
}

function makeBridge(overrides: Partial<CdpBridge> = {}): CdpBridge {
    return {
        pool: {
            getApprovalDetector: jest.fn(),
            getPlanningDetector: jest.fn(),
            getErrorPopupDetector: jest.fn(),
        } as any,
        quota: {} as any,
        autoAccept: {} as any,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createApprovalButtonAction', () => {
    describe('match', () => {
        it('matches approve_action customId', () => {
            const bridge = makeBridge();
            const action = createApprovalButtonAction({ bridge });
            const result = action.match('approve_action:myProject:ch-1');
            expect(result).toEqual({
                action: 'approve',
                projectName: 'myProject',
                channelId: 'ch-1',
            });
        });

        it('matches always_allow_action customId', () => {
            const bridge = makeBridge();
            const action = createApprovalButtonAction({ bridge });
            const result = action.match('always_allow_action:proj');
            expect(result).toEqual({
                action: 'always_allow',
                projectName: 'proj',
                channelId: '',
            });
        });

        it('matches deny_action customId', () => {
            const bridge = makeBridge();
            const action = createApprovalButtonAction({ bridge });
            const result = action.match('deny_action:proj:ch-2');
            expect(result).toEqual({
                action: 'deny',
                projectName: 'proj',
                channelId: 'ch-2',
            });
        });

        it('returns null for unrelated customId', () => {
            const bridge = makeBridge();
            const action = createApprovalButtonAction({ bridge });
            expect(action.match('planning_open_action:proj')).toBeNull();
            expect(action.match('random_button')).toBeNull();
        });
    });

    describe('execute', () => {
        it('calls detector.approveButton() and updates message on success', async () => {
            const mockDetector = { approveButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge();
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction({ customId: 'approve_action:myProject:ch-1' });

            await action.execute(interaction, {
                action: 'approve',
                projectName: 'myProject',
                channelId: 'ch-1',
            });

            expect(mockDetector.approveButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '✅ Allow completed',
                components: [],
            });
        });

        it('calls detector.denyButton() on deny action', async () => {
            const mockDetector = { denyButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge();
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'deny',
                projectName: 'myProject',
                channelId: '',
            });

            expect(mockDetector.denyButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '✅ Deny completed',
                components: [],
            });
        });

        it('calls detector.alwaysAllowButton() on always_allow action', async () => {
            const mockDetector = { alwaysAllowButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge();
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'always_allow',
                projectName: 'myProject',
                channelId: '',
            });

            expect(mockDetector.alwaysAllowButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '✅ Allow Chat completed',
                components: [],
            });
        });

        it('replies with error when detector is not found', async () => {
            const bridge = makeBridge();
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(undefined);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'approve',
                projectName: 'nonexistent',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Approval detector not found.',
            });
        });

        it('replies with error when button click fails', async () => {
            const mockDetector = { approveButton: jest.fn().mockResolvedValue(false) };
            const bridge = makeBridge();
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'approve',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Approval button not found.',
            });
        });

        it('rejects interaction from wrong channel', async () => {
            const bridge = makeBridge();
            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction({
                channel: makeChannel({ id: 'ch-other' }),
            });

            await action.execute(interaction, {
                action: 'approve',
                projectName: 'proj',
                channelId: 'ch-1',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'This approval action is linked to a different session channel.',
            });
        });

        it('falls back to lastActiveWorkspace when projectName is empty', async () => {
            const mockDetector = { approveButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge({ lastActiveWorkspace: 'fallbackProject' });
            (bridge.pool.getApprovalDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createApprovalButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'approve',
                projectName: '',
                channelId: '',
            });

            expect(bridge.pool.getApprovalDetector).toHaveBeenCalledWith('fallbackProject');
        });
    });
});
