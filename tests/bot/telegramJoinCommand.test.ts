import { handleMirror } from '../../src/bot/telegramJoinCommand';
import { ensureUserMessageDetector } from '../../src/services/cdpBridgeManager';

jest.mock('../../src/services/cdpBridgeManager', () => ({
    ...jest.requireActual('../../src/services/cdpBridgeManager'),
    ensureUserMessageDetector: jest.fn(),
    getCurrentChatTitle: jest.fn().mockResolvedValue(null),
}));

describe('telegramJoinCommand.handleMirror', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('looks up and registers mirror detectors by project name', async () => {
        const getUserMessageDetector = jest.fn().mockReturnValue(undefined);
        const getOrConnect = jest.fn().mockResolvedValue({} as any);
        const bridge = {
            selectedAccountByChannel: new Map<string, string>(),
            pool: {
                extractProjectName: jest.fn().mockReturnValue('project-a'),
                getUserMessageDetector,
                getUserMessageDetectorsForProject: jest.fn().mockReturnValue([]),
                getOrConnect,
            },
        } as any;
        const telegramBindingRepo = {
            findByChatIdWithParentFallback: jest.fn().mockReturnValue({
                chatId: 'chat-123',
                workspacePath: 'project-a',
            }),
        } as any;
        const workspaceService = {
            getWorkspacePath: jest.fn().mockReturnValue('/workspace/project-a'),
        } as any;
        const message = {
            channel: { id: 'chat-123', send: jest.fn() },
            author: { id: 'user-1' },
            reply: jest.fn().mockResolvedValue(undefined),
        } as any;

        await handleMirror({
            bridge,
            telegramBindingRepo,
            workspaceService,
            channelPrefRepo: { getAccountName: jest.fn().mockReturnValue('work1') } as any,
            accountPrefRepo: { getAccountName: jest.fn().mockReturnValue('default') } as any,
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        }, message);

        expect(getUserMessageDetector).toHaveBeenCalledWith('project-a', 'work1');
        expect(ensureUserMessageDetector).toHaveBeenCalledWith(
            bridge,
            expect.anything(),
            'project-a',
            expect.any(Function),
            'work1',
        );
    });
});
