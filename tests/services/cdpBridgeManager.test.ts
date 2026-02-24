import {
    buildApprovalCustomId,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
    registerApprovalSessionChannel,
    resolveApprovalChannelForCurrentChat,
} from '../../src/services/cdpBridgeManager';

describe('cdpBridgeManager', () => {
    it('initCdpBridge builds the initial state', () => {
        const bridge = initCdpBridge(false);
        expect(bridge.lastActiveWorkspace).toBeNull();
        expect(bridge.lastActiveChannel).toBeNull();
        expect(bridge.autoAccept.isEnabled()).toBe(false);
    });

    it('getCurrentCdp returns null when not connected', () => {
        const bridge = initCdpBridge(false);
        expect(getCurrentCdp(bridge)).toBeNull();
    });

    it('round-trips build/parse of approval action ID', () => {
        const customId = buildApprovalCustomId('approve', 'my-workspace', '123456');
        const parsed = parseApprovalCustomId(customId);
        expect(parsed).toEqual({ action: 'approve', workspaceDirName: 'my-workspace', channelId: '123456' });
    });

    it('supports legacy approval action IDs without channelId', () => {
        const parsed = parseApprovalCustomId('approve_action:legacy-workspace');
        expect(parsed).toEqual({ action: 'approve', workspaceDirName: 'legacy-workspace', channelId: null });
    });

    it('routes approval notifications only when session title is explicitly linked', () => {
        const bridge = initCdpBridge(false);
        const channel = { id: 'ch-1', send: jest.fn() } as any;
        registerApprovalSessionChannel(bridge, 'ws-a', 'Session Alpha', channel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', 'Session Alpha')).toBe(channel);
        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', 'Unknown Session')).toBeNull();
    });
});
