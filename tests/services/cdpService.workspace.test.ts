import { CdpService } from '../../src/services/cdpService';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import * as pathUtils from '../../src/utils/pathUtils';

// Mock logger to avoid printing during tests
jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    }
}));

// Mock child_process for spawn
jest.mock('child_process');

describe('CdpService - Cross-Platform Workspace Launching', () => {
    let service: CdpService;
    let originalPlatform: NodeJS.Platform;
    let originalEnv: NodeJS.ProcessEnv;
    let mockRunCommand: jest.SpyInstance;
    let mockGetJson: jest.SpyInstance;

    beforeEach(() => {
        originalPlatform = process.platform;
        originalEnv = { ...process.env };

        service = new CdpService({ portsToScan: [9999], maxReconnectAttempts: 0 });

        // Mock internal implementation to avoid actual CDP port scanning and connection
        mockGetJson = jest.spyOn(service as any, 'getJson').mockRejectedValue(new Error('Connection refused'));
        jest.spyOn(service as any, 'connect').mockResolvedValue(undefined);

        // We want to spy on runCommand, but let it resolve immediately so we don't have to wait 30s
        mockRunCommand = jest.spyOn(service as any, 'runCommand').mockResolvedValue(undefined);

        // Mock probeWorkbenchPages to return false so it forces a launch if ports somehow matched
        jest.spyOn(service as any, 'probeWorkbenchPages').mockResolvedValue(false);
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env = originalEnv;
        jest.resetAllMocks();
    });

    // Helper to mock the platform
    const setPlatform = (platform: NodeJS.Platform) => {
        Object.defineProperty(process, 'platform', { value: platform });
    };

    describe('launchAndConnectWorkspace (Mac)', () => {
        it('should launch Antigravity using the Mac application path', async () => {
            setPlatform('darwin');

            // To prevent hanging on the 30-second poll loop in launchAndConnectWorkspace
            // we will make the second call to getJson return a fake new workbench page
            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/Users/test/Documents/MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledWith(
                '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
                ['--new-window', workspacePath]
            );
        });

        it('should fallback to `open -a Antigravity` if the CLI launch fails on Mac', async () => {
            setPlatform('darwin');

            // First runCommand fails, second succeeds
            mockRunCommand
                .mockRejectedValueOnce(new Error('Command not found'))
                .mockResolvedValueOnce(undefined);

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/Users/test/Documents/MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledTimes(2);
            expect(mockRunCommand).toHaveBeenNthCalledWith(1,
                '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
                ['--new-window', workspacePath]
            );
            expect(mockRunCommand).toHaveBeenNthCalledWith(2,
                'open',
                ['-a', 'Antigravity', workspacePath]
            );
        });
    });

    describe('launchAndConnectWorkspace (Windows)', () => {
        it('should launch Antigravity using LOCALAPPDATA environment variable', async () => {
            setPlatform('win32');
            process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = 'C:\\Source\\MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledWith(
                'C:\\Users\\TestUser\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
                ['--new-window', workspacePath]
            );
        });

        it('should fallback to Antigravity.exe if LOCALAPPDATA is missing on Windows', async () => {
            setPlatform('win32');
            delete process.env.LOCALAPPDATA;

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = 'C:\\Source\\MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledWith(
                'Antigravity.exe',
                ['--new-window', workspacePath]
            );
        });
    });

    describe('launchAndConnectWorkspace (Linux / Unknown)', () => {
        it('should default to `antigravity` command if ANTIGRAVITY_PATH is not set', async () => {
            setPlatform('linux');
            delete process.env.ANTIGRAVITY_PATH;

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/home/user/MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledWith(
                'antigravity',
                ['--new-window', workspacePath]
            );
        });

        it('should use ANTIGRAVITY_PATH if it is set', async () => {
            setPlatform('linux');
            process.env.ANTIGRAVITY_PATH = '/opt/custom/antigravity.AppImage';

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'MyProject',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/home/user/MyProject';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(mockRunCommand).toHaveBeenCalledWith(
                '/opt/custom/antigravity.AppImage',
                ['--new-window', workspacePath]
            );
        });
    });

    describe('Project Name Extraction', () => {
        it('should extract the project name from a Windows path with backslashes', async () => {
            setPlatform('win32');
            process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'LazyGravity',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = 'C:\\Source\\LazyGravity';
            await service.discoverAndConnectForWorkspace(workspacePath);

            // Access the private property workspaceName to see if it correctly parsed LazyGravity
            expect(service.getCurrentWorkspaceName()).toBe('LazyGravity');
        });

        it('should extract the project name from a Mac/Linux path with forward slashes', async () => {
            setPlatform('darwin');

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'my-cool-project',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/Users/test/Documents/my-cool-project';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(service.getCurrentWorkspaceName()).toBe('my-cool-project');
        });

        it('should extract the project name from a path with trailing slashes', async () => {
            setPlatform('linux');

            mockGetJson
                .mockRejectedValueOnce(new Error('Initial pre-launch port scan fails'))
                .mockResolvedValue([{
                    id: 'new-id',
                    type: 'page',
                    title: 'trailing-slash-proj',
                    webSocketDebuggerUrl: 'ws://debug',
                    url: 'file:///workbench'
                }]);

            const workspacePath = '/home/user/trailing-slash-proj/';
            await service.discoverAndConnectForWorkspace(workspacePath);

            expect(service.getCurrentWorkspaceName()).toBe('trailing-slash-proj');
        });
    });
});
