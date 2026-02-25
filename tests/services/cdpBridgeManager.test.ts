import {
    buildApprovalCustomId,
    buildPlanningCustomId,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
    parsePlanningCustomId,
    registerApprovalSessionChannel,
    registerApprovalWorkspaceChannel,
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

    it('routes approval notifications by session title when linked', () => {
        const bridge = initCdpBridge(false);
        const channel = { id: 'ch-1', send: jest.fn() } as any;
        registerApprovalSessionChannel(bridge, 'ws-a', 'Session Alpha', channel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', 'Session Alpha')).toBe(channel);
    });

    it('falls back to workspace channel when session title does not match', () => {
        const bridge = initCdpBridge(false);
        const wsChannel = { id: 'ch-ws', send: jest.fn() } as any;
        registerApprovalWorkspaceChannel(bridge, 'ws-a', wsChannel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', 'Unknown Session')).toBe(wsChannel);
    });

    it('falls back to workspace channel when currentChatTitle is null', () => {
        const bridge = initCdpBridge(false);
        const wsChannel = { id: 'ch-ws', send: jest.fn() } as any;
        registerApprovalWorkspaceChannel(bridge, 'ws-a', wsChannel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', null)).toBe(wsChannel);
    });

    it('falls back to workspace channel when currentChatTitle is empty', () => {
        const bridge = initCdpBridge(false);
        const wsChannel = { id: 'ch-ws', send: jest.fn() } as any;
        registerApprovalWorkspaceChannel(bridge, 'ws-a', wsChannel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', '')).toBe(wsChannel);
    });

    it('prefers session channel over workspace channel', () => {
        const bridge = initCdpBridge(false);
        const wsChannel = { id: 'ch-ws', send: jest.fn() } as any;
        const sessionChannel = { id: 'ch-session', send: jest.fn() } as any;
        registerApprovalWorkspaceChannel(bridge, 'ws-a', wsChannel);
        registerApprovalSessionChannel(bridge, 'ws-a', 'Session Alpha', sessionChannel);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-a', 'Session Alpha')).toBe(sessionChannel);
    });

    it('returns null when neither session nor workspace is registered', () => {
        const bridge = initCdpBridge(false);

        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-unknown', 'Some Title')).toBeNull();
        expect(resolveApprovalChannelForCurrentChat(bridge, 'ws-unknown', null)).toBeNull();
    });

    it('round-trips build/parse of planning open action ID', () => {
        const customId = buildPlanningCustomId('open', 'my-workspace', '123456');
        const parsed = parsePlanningCustomId(customId);
        expect(parsed).toEqual({ action: 'open', workspaceDirName: 'my-workspace', channelId: '123456' });
    });

    it('round-trips build/parse of planning proceed action ID', () => {
        const customId = buildPlanningCustomId('proceed', 'my-workspace', '789');
        const parsed = parsePlanningCustomId(customId);
        expect(parsed).toEqual({ action: 'proceed', workspaceDirName: 'my-workspace', channelId: '789' });
    });

    it('supports planning action IDs without channelId', () => {
        const parsed = parsePlanningCustomId('planning_open_action:legacy-workspace');
        expect(parsed).toEqual({ action: 'open', workspaceDirName: 'legacy-workspace', channelId: null });
    });

    it('parsePlanningCustomId returns null for non-planning IDs', () => {
        expect(parsePlanningCustomId('approve_action:ws-a')).toBeNull();
        expect(parsePlanningCustomId('random_string')).toBeNull();
    });
});
