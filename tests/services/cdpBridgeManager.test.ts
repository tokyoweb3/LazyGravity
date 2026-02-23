import {
    buildApprovalCustomId,
    getCurrentCdp,
    initCdpBridge,
    parseApprovalCustomId,
} from '../../src/services/cdpBridgeManager';

describe('cdpBridgeManager', () => {
    it('initCdpBridge は初期状態を構築する', () => {
        const bridge = initCdpBridge(false);
        expect(bridge.lastActiveWorkspace).toBeNull();
        expect(bridge.lastActiveChannel).toBeNull();
        expect(bridge.autoAccept.isEnabled()).toBe(false);
    });

    it('未接続状態では getCurrentCdp が null を返す', () => {
        const bridge = initCdpBridge(false);
        expect(getCurrentCdp(bridge)).toBeNull();
    });

    it('承認アクションIDのbuild/parseが往復できる', () => {
        const customId = buildApprovalCustomId('approve', 'my-workspace');
        const parsed = parseApprovalCustomId(customId);
        expect(parsed).toEqual({ action: 'approve', workspaceDirName: 'my-workspace' });
    });
});
