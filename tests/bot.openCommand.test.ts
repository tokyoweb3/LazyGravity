import fs from 'fs';

jest.mock('../src/services/cdpService', () => ({
    CdpService: jest.fn().mockImplementation(() => ({
        openWorkspace: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(undefined),
    })),
}));

import { CdpService } from '../src/services/cdpService';
import { handleSlashInteraction } from '../src/bot';

describe('/open command', () => {
    const makeInteraction = () => ({
        commandName: 'open',
        channelId: 'channel-1',
        user: { id: 'user-1' },
        options: { getString: jest.fn(), getSubcommand: jest.fn() },
        editReply: jest.fn().mockResolvedValue(undefined),
    }) as any;

    const makeBridge = () => ({
        selectedAccountByChannel: new Map<string, string>(),
        pool: {
            extractProjectName: jest.fn().mockImplementation((workspacePath: string) => workspacePath.split('/').pop()),
            setPreferredAccountForWorkspace: jest.fn(),
        },
        autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
    }) as any;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns an error when the bound folder does not exist', async () => {
        const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        const statSpy = jest.spyOn(fs, 'statSync');

        const interaction = makeInteraction();
        const bridge = makeBridge();
        const wsHandler = { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/missing-project') } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            wsHandler,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
        );

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Project folder does not exist: `/tmp/missing-project`',
        });
        expect(CdpService).not.toHaveBeenCalled();

        existsSpy.mockRestore();
        statSpy.mockRestore();
    });

    it('opens the bound project in the selected account', async () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);

        const interaction = makeInteraction();
        const bridge = makeBridge();
        const wsHandler = { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any;
        const channelPrefRepo = { getAccountName: jest.fn().mockReturnValue('work1') } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            wsHandler,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            undefined,
            channelPrefRepo,
            [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        );

        expect(CdpService).toHaveBeenCalledWith(expect.objectContaining({
            activeAccountName: 'work1',
            accountPorts: { default: 9222, work1: 9333 },
        }));

        const instance = (CdpService as unknown as jest.Mock).mock.results[0].value;
        expect(instance.openWorkspace).toHaveBeenCalledWith('/tmp/demo-project');
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '✅ Opened **demo-project** in account **work1** (CDP 9333).',
        });
    });
});

describe('/account command', () => {
    const makeInteraction = () => ({
        commandName: 'account',
        channelId: 'channel-1',
        user: { id: 'user-1' },
        options: { getString: jest.fn().mockReturnValue(null), getSubcommand: jest.fn() },
        editReply: jest.fn().mockResolvedValue(undefined),
    }) as any;

    it('shows selectable account dropdown when no name is provided', async () => {
        const interaction = makeInteraction();
        const bridge = {
            selectedAccountByChannel: new Map<string, string>([['channel-1', 'work1']]),
            pool: {
                setPreferredAccountForWorkspace: jest.fn(),
            },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;
        const accountPrefRepo = { getAccountName: jest.fn().mockReturnValue('default') } as any;
        const channelPrefRepo = { getAccountName: jest.fn().mockReturnValue('work1') } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            accountPrefRepo,
            channelPrefRepo,
            [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        );

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });

    it('stores session account without mutating channel or user defaults for session channels', async () => {
        const interaction = {
            commandName: 'account',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: { getString: jest.fn().mockReturnValue('work1'), getSubcommand: jest.fn() },
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;
        const bridge = {
            selectedAccountByChannel: new Map<string, string>(),
            pool: { setPreferredAccountForWorkspace: jest.fn() },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;
        const accountPrefRepo = { setAccountName: jest.fn() } as any;
        const channelPrefRepo = { setAccountName: jest.fn() } as any;
        const chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue({ channelId: 'channel-1', activeAccountName: 'default' }),
            setActiveAccountName: jest.fn(),
        } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            accountPrefRepo,
            channelPrefRepo,
            [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
            chatSessionRepo,
        );

        expect(chatSessionRepo.setActiveAccountName).toHaveBeenCalledWith('channel-1', 'work1');
        expect(accountPrefRepo.setAccountName).not.toHaveBeenCalled();
        expect(channelPrefRepo.setAccountName).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({ content: '✅ Switched session account to **work1**.' });
    });
});

describe('/project account subcommand', () => {
    it('stores the channel-scoped project account binding', async () => {
        const interaction = {
            commandName: 'project',
            channelId: 'channel-1',
            user: { id: 'user-1' },
            options: {
                getString: jest.fn().mockReturnValue('work1'),
                getSubcommand: jest.fn().mockReturnValue('account'),
            },
            channel: {},
            editReply: jest.fn().mockResolvedValue(undefined),
        } as any;
        const bridge = {
            selectedAccountByChannel: new Map<string, string>(),
            pool: { setPreferredAccountForWorkspace: jest.fn(), extractProjectName: jest.fn() },
            autoAccept: { isEnabled: jest.fn().mockReturnValue(false), handle: jest.fn() },
        } as any;
        const channelPrefRepo = { setAccountName: jest.fn(), getAccountName: jest.fn().mockReturnValue(null) } as any;

        await handleSlashInteraction(
            interaction,
            {} as any,
            bridge,
            { getWorkspaceForChannel: jest.fn().mockReturnValue('/tmp/demo-project') } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            bridge.autoAccept,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            undefined,
            channelPrefRepo,
            [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
            ],
        );

        expect(channelPrefRepo.setAccountName).toHaveBeenCalledWith('channel-1', 'work1');
        expect(interaction.editReply).toHaveBeenCalledWith({ content: '✅ Bound this project channel to account **work1**.' });
    });
});
