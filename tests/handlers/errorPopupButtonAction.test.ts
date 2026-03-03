import { createErrorPopupButtonAction } from '../../src/handlers/errorPopupButtonAction';
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
            getErrorPopupDetector: jest.fn(),
            getApprovalDetector: jest.fn(),
            getPlanningDetector: jest.fn(),
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

describe('createErrorPopupButtonAction', () => {
    describe('match', () => {
        it('matches error_popup_dismiss_action customId', () => {
            const bridge = makeBridge();
            const action = createErrorPopupButtonAction({ bridge });
            const result = action.match('error_popup_dismiss_action:proj:ch-1');
            expect(result).toEqual({
                action: 'dismiss',
                projectName: 'proj',
                channelId: 'ch-1',
            });
        });

        it('matches error_popup_copy_debug_action customId', () => {
            const bridge = makeBridge();
            const action = createErrorPopupButtonAction({ bridge });
            const result = action.match('error_popup_copy_debug_action:proj');
            expect(result).toEqual({
                action: 'copy_debug',
                projectName: 'proj',
                channelId: '',
            });
        });

        it('matches error_popup_retry_action customId', () => {
            const bridge = makeBridge();
            const action = createErrorPopupButtonAction({ bridge });
            const result = action.match('error_popup_retry_action:proj:ch-2');
            expect(result).toEqual({
                action: 'retry',
                projectName: 'proj',
                channelId: 'ch-2',
            });
        });

        it('returns null for unrelated customId', () => {
            const bridge = makeBridge();
            const action = createErrorPopupButtonAction({ bridge });
            expect(action.match('approve_action:proj')).toBeNull();
            expect(action.match('random')).toBeNull();
        });
    });

    describe('execute - dismiss', () => {
        it('clicks dismiss button and updates message', async () => {
            const mockDetector = { clickDismissButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'dismiss',
                projectName: 'proj',
                channelId: '',
            });

            expect(mockDetector.clickDismissButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '🗑️ Dismissed',
                components: [],
            });
        });

        it('replies with error when dismiss button not found', async () => {
            const mockDetector = { clickDismissButton: jest.fn().mockResolvedValue(false) };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'dismiss',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Dismiss button not found.',
            });
        });
    });

    describe('execute - copy_debug', () => {
        it('clicks copy debug button, reads clipboard, and sends followUp', async () => {
            const mockDetector = {
                clickCopyDebugInfoButton: jest.fn().mockResolvedValue(true),
                readClipboard: jest.fn().mockResolvedValue('Error stack trace here'),
            };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'copy_debug',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.deferUpdate).toHaveBeenCalled();
            expect(mockDetector.clickCopyDebugInfoButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '📋 Debug info copied',
                components: [],
            });
            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Error stack trace here',
            });
        });

        it('truncates debug content over 4096 chars', async () => {
            const longContent = 'y'.repeat(5000);
            const mockDetector = {
                clickCopyDebugInfoButton: jest.fn().mockResolvedValue(true),
                readClipboard: jest.fn().mockResolvedValue(longContent),
            };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'copy_debug',
                projectName: 'proj',
                channelId: '',
            });

            const followUpCall = (interaction.followUp as jest.Mock).mock.calls[0][0];
            expect(followUpCall.text.length).toBeLessThanOrEqual(4096);
            expect(followUpCall.text).toContain('(truncated)');
        });

        it('replies with error when copy button not found', async () => {
            const mockDetector = {
                clickCopyDebugInfoButton: jest.fn().mockResolvedValue(false),
            };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'copy_debug',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Copy debug info button not found.',
            });
        });

        it('sends fallback message when clipboard is empty', async () => {
            const mockDetector = {
                clickCopyDebugInfoButton: jest.fn().mockResolvedValue(true),
                readClipboard: jest.fn().mockResolvedValue(null),
            };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'copy_debug',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.followUp).toHaveBeenCalledWith({
                text: 'Could not read debug info from clipboard.',
            });
        });
    });

    describe('execute - retry', () => {
        it('clicks retry button and updates message', async () => {
            const mockDetector = { clickRetryButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'retry',
                projectName: 'proj',
                channelId: '',
            });

            expect(mockDetector.clickRetryButton).toHaveBeenCalled();
            expect(interaction.update).toHaveBeenCalledWith({
                text: '🔄 Retry initiated',
                components: [],
            });
        });

        it('replies with error when retry button not found', async () => {
            const mockDetector = { clickRetryButton: jest.fn().mockResolvedValue(false) };
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'retry',
                projectName: 'proj',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Retry button not found.',
            });
        });
    });

    describe('execute - shared', () => {
        it('replies with error when detector not found', async () => {
            const bridge = makeBridge();
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(undefined);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'dismiss',
                projectName: 'nonexistent',
                channelId: '',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'Error popup detector not found.',
            });
        });

        it('rejects interaction from wrong channel', async () => {
            const bridge = makeBridge();
            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction({
                channel: makeChannel({ id: 'ch-other' }),
            });

            await action.execute(interaction, {
                action: 'dismiss',
                projectName: 'proj',
                channelId: 'ch-1',
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                text: 'This error popup action is linked to a different session channel.',
            });
        });

        it('falls back to lastActiveWorkspace when projectName is empty', async () => {
            const mockDetector = { clickRetryButton: jest.fn().mockResolvedValue(true) };
            const bridge = makeBridge({ lastActiveWorkspace: 'fallbackWs' });
            (bridge.pool.getErrorPopupDetector as jest.Mock).mockReturnValue(mockDetector);

            const action = createErrorPopupButtonAction({ bridge });
            const interaction = makeInteraction();

            await action.execute(interaction, {
                action: 'retry',
                projectName: '',
                channelId: '',
            });

            expect(bridge.pool.getErrorPopupDetector).toHaveBeenCalledWith('fallbackWs');
        });
    });
});
