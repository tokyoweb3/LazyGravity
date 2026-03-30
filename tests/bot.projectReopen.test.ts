jest.mock('../src/services/conversationTransferService', () => ({
    findTrajectoryEntriesByTitle: jest.fn().mockReturnValue([]),
    findLatestTrajectoryEntryByTitle: jest.fn(),
    transferConversationByConversationId: jest.fn(),
    transferConversationByTitle: jest.fn(),
    waitForConversationPersistence: jest.fn(),
    waitForConversationPersistenceByConversationId: jest.fn(),
}));

jest.mock('../src/services/antigravityProcessService', () => ({
    quitAntigravityProfile: jest.fn(),
}));

jest.mock('../src/services/cdpService', () => ({
    CdpService: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleSlashInteraction } from '../src/bot';
import { ChatSessionService } from '../src/services/chatSessionService';
import {
    findLatestTrajectoryEntryByTitle,
    findTrajectoryEntriesByTitle,
    transferConversationByConversationId,
    transferConversationByTitle,
    waitForConversationPersistence,
    waitForConversationPersistenceByConversationId,
} from '../src/services/conversationTransferService';
import { quitAntigravityProfile } from '../src/services/antigravityProcessService';
import { CdpService } from '../src/services/cdpService';

describe('/project reopen', () => {
    const mockedFindTrajectoryEntriesByTitle = findTrajectoryEntriesByTitle as jest.MockedFunction<typeof findTrajectoryEntriesByTitle>;
    const mockedFindLatestTrajectoryEntryByTitle = findLatestTrajectoryEntryByTitle as jest.MockedFunction<typeof findLatestTrajectoryEntryByTitle>;
    const mockedTransferConversationByConversationId = transferConversationByConversationId as jest.MockedFunction<typeof transferConversationByConversationId>;
    const mockedTransferConversationByTitle = transferConversationByTitle as jest.MockedFunction<typeof transferConversationByTitle>;
    const mockedWaitForConversationPersistence = waitForConversationPersistence as jest.MockedFunction<typeof waitForConversationPersistence>;
    const mockedWaitForConversationPersistenceByConversationId = waitForConversationPersistenceByConversationId as jest.MockedFunction<typeof waitForConversationPersistenceByConversationId>;
    const mockedQuitAntigravityProfile = quitAntigravityProfile as jest.MockedFunction<typeof quitAntigravityProfile>;
    const mockedCdpService = CdpService as unknown as jest.Mock;

    let workspacePath: string;
    let activateSessionSpy: jest.SpyInstance;

    beforeEach(() => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-gravity-project-reopen-'));
        activateSessionSpy = jest.spyOn(ChatSessionService.prototype, 'activateSessionByTitle').mockResolvedValue({ ok: true });
        mockedFindTrajectoryEntriesByTitle.mockReset();
        mockedFindLatestTrajectoryEntryByTitle.mockReset();
        mockedTransferConversationByConversationId.mockReset();
        mockedTransferConversationByTitle.mockReset();
        mockedWaitForConversationPersistence.mockReset();
        mockedWaitForConversationPersistenceByConversationId.mockReset();
        mockedQuitAntigravityProfile.mockReset();
        mockedCdpService.mockReset();
        mockedFindTrajectoryEntriesByTitle.mockReturnValue([]);
        mockedFindLatestTrajectoryEntryByTitle.mockReturnValue(undefined);
        mockedTransferConversationByConversationId.mockReturnValue({
            conversationId: 'conv-123',
            bundleDir: '/tmp/unused-bundle',
            dbBackupPath: '/tmp/work3-state.vscdb.bak',
        });
        mockedTransferConversationByTitle.mockReturnValue({
            conversationId: 'conv-123',
            bundleDir: '/tmp/unused-bundle',
            dbBackupPath: '/tmp/work3-state.vscdb.bak',
        });
        mockedWaitForConversationPersistence.mockResolvedValue({
            conversationId: 'conv-123',
            title: 'Listing DevTools Directory',
            outerEntryBytes: Buffer.from('entry'),
            rawDataBase64: 'raw',
        });
        mockedWaitForConversationPersistenceByConversationId.mockResolvedValue({
            conversationId: 'conv-123',
            title: 'Listing DevTools Directory',
            outerEntryBytes: Buffer.from('entry'),
            rawDataBase64: 'raw',
        });
        mockedQuitAntigravityProfile.mockResolvedValue(true);
        mockedCdpService.mockImplementation(() => ({
            discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
            inspectWorkspaceRuntimeState: jest.fn().mockResolvedValue({
                isGenerating: false,
                sessionTitle: 'Listing DevTools Directory',
                hasActiveChat: true,
                contextId: 1,
            }),
            closeCurrentTargetGracefully: jest.fn().mockResolvedValue(true),
            openWorkspace: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
        }));
    });

    afterEach(() => {
        activateSessionSpy.mockRestore();
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    it('imports the saved conversation into the selected account before reopening the workspace', async () => {
        const interaction = {
            commandName: 'project',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: {
                getSubcommand: jest.fn().mockReturnValue('reopen'),
                getString: jest.fn().mockReturnValue(null),
            },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;

        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'work3']]),
            lastActiveWorkspace: null,
            pool: {
                extractProjectName: jest.fn().mockReturnValue('DevTools'),
                getPreferredAccountForWorkspace: jest.fn().mockReturnValue('default'),
                setPreferredAccountForWorkspace: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;

        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({
                channelId: 'channel-1',
                conversationId: 'conv-123',
                activeAccountName: 'work3',
                originAccountName: 'default',
                displayName: 'Listing DevTools Directory',
            }),
            setActiveAccountName: jest.fn(),
            setConversationId: jest.fn(),
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue(workspacePath) } as any,
            {} as any,
            {} as any,
            { getCurrentMode: jest.fn().mockReturnValue('normal') } as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            { getAccountName: jest.fn().mockReturnValue(null) } as any,
            { getAccountName: jest.fn().mockReturnValue(null), setAccountName: jest.fn() } as any,
            [
                { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default-profile' },
                { name: 'work3', cdpPort: 9444, userDataDir: '/tmp/work3-profile' },
            ],
            chatSessionRepo,
        );

        expect(mockedTransferConversationByConversationId).toHaveBeenCalledWith(
            'default',
            'work3',
            'conv-123',
        );
        expect(mockedWaitForConversationPersistenceByConversationId).toHaveBeenCalledWith(
            'default',
            'conv-123',
            expect.objectContaining({ timeoutMs: 20000, pollIntervalMs: 500 }),
        );
        expect(activateSessionSpy).toHaveBeenCalled();
        expect(mockedQuitAntigravityProfile).toHaveBeenNthCalledWith(1, 'default');
        expect(mockedQuitAntigravityProfile).toHaveBeenNthCalledWith(2, 'work3');
        expect(mockedCdpService).toHaveBeenCalledWith(expect.objectContaining({
            accountName: 'default',
            accountPorts: { default: 9222, work3: 9444 },
        }));
        expect(mockedCdpService).toHaveBeenCalledWith(expect.objectContaining({
            accountName: 'work3',
            accountPorts: { default: 9222, work3: 9444 },
        }));
        expect(chatSessionRepo.setActiveAccountName).toHaveBeenCalledWith('channel-1', 'work3');
        expect(chatSessionRepo.setConversationId).toHaveBeenCalledWith('channel-1', 'conv-123');
        expect(bridge.pool.setPreferredAccountForWorkspace).toHaveBeenCalledWith(workspacePath, 'work3');
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: [
                '✅ Reopened **DevTools** in account **work3** (CDP 9444).',
                'Active Account: **work3**',
                'Origin Account: **default**',
                'Conversation Title: **Listing DevTools Directory**',
            ].join('\n'),
        });
    });

    it('falls back to the latest matching conversation when the session has no saved conversation id yet', async () => {
        const interaction = {
            commandName: 'project',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: {
                getSubcommand: jest.fn().mockReturnValue('reopen'),
                getString: jest.fn().mockReturnValue(null),
            },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;

        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'default']]),
            lastActiveWorkspace: null,
            pool: {
                extractProjectName: jest.fn().mockReturnValue('DevTools'),
                getPreferredAccountForWorkspace: jest.fn().mockReturnValue('work4'),
                setPreferredAccountForWorkspace: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;

        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({
                channelId: 'channel-1',
                conversationId: null,
                activeAccountName: 'default',
                originAccountName: 'work4',
                displayName: 'Analyzing Project Directory',
            }),
            setActiveAccountName: jest.fn(),
            setConversationId: jest.fn(),
        } as any;

        mockedWaitForConversationPersistence.mockResolvedValue({
            conversationId: 'older-conv',
            title: 'Analyzing Project Directory',
            outerEntryBytes: Buffer.from('entry'),
            rawDataBase64: 'raw',
        });
        mockedFindLatestTrajectoryEntryByTitle.mockReturnValue({
            conversationId: 'latest-conv',
            title: 'Analyzing Project Directory',
            outerEntryBytes: Buffer.from('entry'),
            rawDataBase64: 'raw',
        });
        mockedTransferConversationByConversationId.mockReturnValue({
            conversationId: 'latest-conv',
            bundleDir: '/tmp/unused-bundle',
            dbBackupPath: '/tmp/default-state.vscdb.bak',
        });

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue(workspacePath) } as any,
            {} as any,
            {} as any,
            { getCurrentMode: jest.fn().mockReturnValue('normal') } as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            { getAccountName: jest.fn().mockReturnValue(null) } as any,
            { getAccountName: jest.fn().mockReturnValue(null), setAccountName: jest.fn() } as any,
            [
                { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default-profile' },
                { name: 'work4', cdpPort: 9444, userDataDir: '/tmp/work4-profile' },
            ],
            chatSessionRepo,
        );

        expect(mockedWaitForConversationPersistence).toHaveBeenCalledWith(
            'work4',
            'Analyzing Project Directory',
            expect.objectContaining({ timeoutMs: 20000, pollIntervalMs: 500 }),
        );
        expect(mockedFindLatestTrajectoryEntryByTitle).toHaveBeenCalledWith('work4', 'Analyzing Project Directory');
        expect(chatSessionRepo.setConversationId).toHaveBeenNthCalledWith(1, 'channel-1', 'latest-conv');
        expect(mockedTransferConversationByConversationId).toHaveBeenCalledWith('work4', 'default', 'latest-conv');
        expect(chatSessionRepo.setConversationId).toHaveBeenNthCalledWith(2, 'channel-1', 'latest-conv');
        expect(mockedTransferConversationByTitle).not.toHaveBeenCalled();
    });

    it('accepts an explicit reopen account override from the slash command option', async () => {
        const interaction = {
            commandName: 'project',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: {
                getSubcommand: jest.fn().mockReturnValue('reopen'),
                getString: jest.fn((name: string) => (name === 'account' ? 'work3' : null)),
            },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;

        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'default']]),
            lastActiveWorkspace: null,
            pool: {
                extractProjectName: jest.fn().mockReturnValue('DevTools'),
                getPreferredAccountForWorkspace: jest.fn().mockReturnValue('default'),
                setPreferredAccountForWorkspace: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;

        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({
                channelId: 'channel-1',
                conversationId: 'conv-123',
                activeAccountName: 'default',
                originAccountName: 'default',
                displayName: 'Listing DevTools Directory',
            }),
            setActiveAccountName: jest.fn(),
            setConversationId: jest.fn(),
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue(workspacePath) } as any,
            {} as any,
            {} as any,
            { getCurrentMode: jest.fn().mockReturnValue('normal') } as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            { getAccountName: jest.fn().mockReturnValue(null) } as any,
            { getAccountName: jest.fn().mockReturnValue(null), setAccountName: jest.fn() } as any,
            [
                { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default-profile' },
                { name: 'work3', cdpPort: 9444, userDataDir: '/tmp/work3-profile' },
            ],
            chatSessionRepo,
        );

        expect(mockedTransferConversationByConversationId).toHaveBeenCalledWith('default', 'work3', 'conv-123');
        expect(chatSessionRepo.setActiveAccountName).toHaveBeenCalledWith('channel-1', 'work3');
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: [
                '✅ Reopened **DevTools** in account **work3** (CDP 9444).',
                'Active Account: **work3**',
                'Origin Account: **default**',
                'Conversation Title: **Listing DevTools Directory**',
            ].join('\n'),
        });
    });

    it('refuses to reopen when either source or target account still has an active task', async () => {
        const interaction = {
            commandName: 'project',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: {
                getSubcommand: jest.fn().mockReturnValue('reopen'),
                getString: jest.fn().mockReturnValue(null),
            },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;

        const inspectMock = jest
            .fn()
            .mockResolvedValueOnce({
                isGenerating: false,
                sessionTitle: 'Target Idle Session',
                hasActiveChat: true,
                contextId: 1,
            })
            .mockResolvedValueOnce({
                isGenerating: true,
                sessionTitle: 'Listing DevTools Directory',
                hasActiveChat: true,
                contextId: 1,
            });
        mockedCdpService.mockImplementation(() => {
            return {
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                inspectWorkspaceRuntimeState: inspectMock,
                closeCurrentTargetGracefully: jest.fn().mockResolvedValue(true),
                openWorkspace: jest.fn().mockResolvedValue(undefined),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
        });

        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'work3']]),
            lastActiveWorkspace: null,
            pool: {
                extractProjectName: jest.fn().mockReturnValue('DevTools'),
                getPreferredAccountForWorkspace: jest.fn().mockReturnValue('default'),
                setPreferredAccountForWorkspace: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;

        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({
                channelId: 'channel-1',
                conversationId: null,
                activeAccountName: 'work3',
                originAccountName: 'default',
                displayName: 'Listing DevTools Directory',
            }),
            setActiveAccountName: jest.fn(),
            setConversationId: jest.fn(),
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue(workspacePath) } as any,
            {} as any,
            {} as any,
            { getCurrentMode: jest.fn().mockReturnValue('normal') } as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            { getAccountName: jest.fn().mockReturnValue(null) } as any,
            { getAccountName: jest.fn().mockReturnValue(null), setAccountName: jest.fn() } as any,
            [
                { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default-profile' },
                { name: 'work3', cdpPort: 9444, userDataDir: '/tmp/work3-profile' },
            ],
            chatSessionRepo,
        );

        expect(mockedTransferConversationByConversationId).not.toHaveBeenCalled();
        expect(mockedTransferConversationByTitle).not.toHaveBeenCalled();
        expect(mockedWaitForConversationPersistenceByConversationId).not.toHaveBeenCalled();
        expect(mockedWaitForConversationPersistence).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Failed to reopen project in account **work3**: origin account **default** is still running session **Listing DevTools Directory**. Use `/stop` in that session, close the workspace, then rerun `/project reopen`.',
        });
    });
});
