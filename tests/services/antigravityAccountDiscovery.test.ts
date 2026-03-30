import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DiscoveryResult } from '../../src/services/antigravityAccountDiscovery';

describe('antigravityAccountDiscovery', () => {
    let tempHome: string;

    beforeEach(() => {
        jest.resetModules();
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-discovery-'));
    });

    afterEach(() => {
        fs.rmSync(tempHome, { recursive: true, force: true });
        jest.dontMock('os');
        jest.dontMock('child_process');
    });

    async function loadDiscovery(): Promise<(
        existingAccounts?: readonly { name: string; cdpPort: number; userDataDir?: string }[]
    ) => Promise<DiscoveryResult>> {
        jest.doMock('os', () => {
            const actual = jest.requireActual('os');
            return {
                ...actual,
                homedir: () => tempHome,
            };
        });

        jest.doMock('child_process', () => ({
            execFile: jest.fn((
                _command: string,
                _args: string[],
                _options: unknown,
                callback: (error: Error | null, stdout: string) => void,
            ) => {
                callback(null, '');
            }),
        }));

        const mod = await import('../../src/services/antigravityAccountDiscovery');
        return mod.discoverAntigravityAccounts;
    }

    it('prefers cockpit instances.json names over folder ids', async () => {
        const cockpitDir = path.join(tempHome, '.antigravity_cockpit');
        fs.mkdirSync(cockpitDir, { recursive: true });
        fs.writeFileSync(path.join(cockpitDir, 'instances.json'), JSON.stringify({
            instances: [
                {
                    name: 'work1',
                    userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'abc123'),
                    extraArgs: '--remote-debugging-port=9333',
                },
                {
                    name: 'default',
                    userDataDir: path.join(tempHome, 'Library', 'Application Support', 'Antigravity'),
                    extraArgs: '--remote-debugging-port=9222',
                },
            ],
        }), 'utf-8');

        const discoverAntigravityAccounts = await loadDiscovery();
        const result = await discoverAntigravityAccounts();

        expect(result.accounts).toEqual([
            {
                name: 'default',
                cdpPort: 9222,
                userDataDir: path.join(tempHome, 'Library', 'Application Support', 'Antigravity'),
                source: `file:${path.join(tempHome, '.antigravity_cockpit', 'instances.json')}`,
            },
            {
                name: 'work1',
                cdpPort: 9333,
                userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'abc123'),
                source: `file:${path.join(tempHome, '.antigravity_cockpit', 'instances.json')}`,
            },
        ]);
        expect(result.warnings).toEqual([]);
    });

    it('auto-assigns a unique port and warns when default profile is missing', async () => {
        const cockpitDir = path.join(tempHome, '.antigravity_cockpit');
        fs.mkdirSync(cockpitDir, { recursive: true });
        fs.writeFileSync(path.join(cockpitDir, 'instances.json'), JSON.stringify({
            instances: [
                {
                    name: 'work1',
                    userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'abc123'),
                    extraArgs: '--remote-debugging-port=9333',
                },
                {
                    name: 'work2',
                    userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'def456'),
                    extraArgs: '--new-window',
                },
            ],
        }), 'utf-8');

        const discoverAntigravityAccounts = await loadDiscovery();
        const result = await discoverAntigravityAccounts([{ name: 'existing', cdpPort: 9222 }]);

        expect(result.accounts).toEqual([
            {
                name: 'work1',
                cdpPort: 9333,
                userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'abc123'),
                source: `file:${path.join(tempHome, '.antigravity_cockpit', 'instances.json')}`,
            },
            {
                name: 'work2',
                cdpPort: 9223,
                userDataDir: path.join(tempHome, '.antigravity_cockpit', 'instances', 'antigravity', 'def456'),
                source: `file:${path.join(tempHome, '.antigravity_cockpit', 'instances.json')}`,
            },
        ]);
        expect(result.warnings).toEqual(expect.arrayContaining([
            'Auto-assigned CDP port 9223 for "work2" because cockpit extraArgs did not set --remote-debugging-port.',
            expect.stringContaining('No cockpit instance explicitly uses the default Antigravity profile directory'),
        ]));
    });

    it('does not truncate running-process user-data-dir values that contain spaces', async () => {
        jest.doMock('os', () => {
            const actual = jest.requireActual('os');
            return {
                ...actual,
                homedir: () => tempHome,
            };
        });

        jest.doMock('child_process', () => ({
            execFile: jest.fn((
                _command: string,
                _args: string[],
                _options: unknown,
                callback: (error: Error | null, stdout: string) => void,
            ) => {
                callback(
                    null,
                    '/Applications/Antigravity.app/Contents/MacOS/Antigravity --user-data-dir /Users/test/Library/Application Support/Antigravity --remote-debugging-port=9222\n',
                );
            }),
        }));

        const mod = await import('../../src/services/antigravityAccountDiscovery');
        const result = await mod.discoverAntigravityAccounts();

        expect(result.accounts).toEqual([
            {
                name: 'antigravity',
                cdpPort: 9222,
                userDataDir: '/Users/test/Library/Application Support/Antigravity',
                source: 'running-process',
            },
        ]);
    });

    it('ignores json files reached through symlinks', async () => {
        const cockpitDir = path.join(tempHome, '.antigravity_cockpit');
        const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-discovery-outside-'));
        fs.mkdirSync(cockpitDir, { recursive: true });
        fs.writeFileSync(
            path.join(externalDir, 'linked.json'),
            JSON.stringify({
                instances: [
                    {
                        name: 'linked',
                        userDataDir: '/tmp/linked',
                        extraArgs: '--remote-debugging-port=9555',
                    },
                ],
            }),
            'utf8',
        );
        fs.symlinkSync(externalDir, path.join(cockpitDir, 'linked-dir'));

        const discoverAntigravityAccounts = await loadDiscovery();
        const result = await discoverAntigravityAccounts();

        expect(result.accounts).toEqual([]);
        fs.rmSync(externalDir, { recursive: true, force: true });
    });
});
