import { handleMirror, startResponseMirror } from '../../src/bot/telegramJoinCommand';
import { ensureUserMessageDetector } from '../../src/services/cdpBridgeManager';
import { ResponseMonitor } from '../../src/services/responseMonitor';

jest.mock('../../src/services/cdpBridgeManager', () => ({
    ...jest.requireActual('../../src/services/cdpBridgeManager'),
    ensureUserMessageDetector: jest.fn(),
    getCurrentChatTitle: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/services/responseMonitor', () => ({
    ResponseMonitor: jest.fn().mockImplementation(() => ({
        startPassive: jest.fn().mockResolvedValue(undefined),
        isActive: jest.fn().mockReturnValue(false),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
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

describe('telegramJoinCommand.startResponseMirror', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function createDeps(activeMonitors?: Map<string, any>) {
        return {
            bridge: {
                pool: {
                    extractProjectName: jest.fn().mockImplementation(
                        (workspacePath: string) => workspacePath.split('/').pop(),
                    ),
                },
            },
            activeMonitors,
        } as any;
    }

    it('skips the passive mirror when a primary monitor is active for the project', () => {
        const activeMonitors = new Map([['project-a', {} as any]]);
        const channel = { send: jest.fn() };

        startResponseMirror(createDeps(activeMonitors), {} as any, '/ws/project-a', channel, 'Chat');

        expect(ResponseMonitor).not.toHaveBeenCalled();
    });

    it('starts a passive mirror when no primary monitor is active', () => {
        const channel = { send: jest.fn() };

        startResponseMirror(createDeps(new Map()), {} as any, '/ws/project-b', channel, 'Chat');

        expect(ResponseMonitor).toHaveBeenCalledTimes(1);
    });

    it('starts a passive mirror when activeMonitors is not provided (legacy callers)', () => {
        const channel = { send: jest.fn() };

        startResponseMirror(createDeps(undefined), {} as any, '/ws/project-c', channel, 'Chat');

        expect(ResponseMonitor).toHaveBeenCalledTimes(1);
    });
});
