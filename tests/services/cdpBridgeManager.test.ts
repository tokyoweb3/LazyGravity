import {
    buildApprovalCustomId,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
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
        const customId = buildApprovalCustomId('approve', 'my-workspace');
        const parsed = parseApprovalCustomId(customId);
        expect(parsed).toEqual({ action: 'approve', workspaceDirName: 'my-workspace' });
    });
});
