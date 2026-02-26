import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';
import { CdpService } from '../../src/services/cdpService';
import { ApprovalDetector } from '../../src/services/approvalDetector';

// Mock CdpService
jest.mock('../../src/services/cdpService');

describe('CdpConnectionPool', () => {
    let pool: CdpConnectionPool;

    beforeEach(() => {
        pool = new CdpConnectionPool({ cdpCallTimeout: 5000 });
    });

    afterEach(() => {
        pool.disconnectAll();
    });

    describe('extractProjectName()', () => {
        it('extracts the directory name from a full path', () => {
            expect(pool.extractProjectName('/home/user/Code/MyProject')).toBe('MyProject');
        });

        it('handles trailing slashes', () => {
            expect(pool.extractProjectName('/home/user/Code/MyProject/')).toBe('MyProject');
        });

        it('returns a simple name as-is', () => {
            expect(pool.extractProjectName('MyProject')).toBe('MyProject');
        });
    });

    describe('getOrConnect()', () => {
        it('creates a new CdpService and connects', async () => {
            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            const cdp = await pool.getOrConnect('/path/to/ProjectA');

            expect(cdp).toBe(mockCdp);
            expect(mockCdp.discoverAndConnectForWorkspace).toHaveBeenCalledWith('/path/to/ProjectA');
            expect(pool.getActiveWorkspaceNames()).toContain('ProjectA');
        });

        it('returns the cached instance on the second call to the same workspace', async () => {
            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            const cdp1 = await pool.getOrConnect('/path/to/ProjectA');
            const cdp2 = await pool.getOrConnect('/path/to/ProjectA');

            expect(cdp1).toBe(cdp2);
            // Existing connection is also revalidated against the requested workspace.
            expect(mockCdp.discoverAndConnectForWorkspace).toHaveBeenCalledTimes(2);
        });

        it('creates separate instances for different workspaces', async () => {
            let callCount = 0;
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => {
                callCount++;
                return {
                    isConnected: jest.fn().mockReturnValue(true),
                    discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                    on: jest.fn(),
                    disconnect: jest.fn().mockResolvedValue(undefined),
                    _id: callCount,
                } as any;
            });

            const cdpA = await pool.getOrConnect('/path/to/ProjectA');
            const cdpB = await pool.getOrConnect('/path/to/ProjectB');

            expect(cdpA).not.toBe(cdpB);
            expect(pool.getActiveWorkspaceNames()).toEqual(expect.arrayContaining(['ProjectA', 'ProjectB']));
        });

        it('prevents concurrent connections with a Promise lock', async () => {
            // Reset mock counter for this test
            (CdpService as jest.MockedClass<typeof CdpService>).mockReset();

            let resolveConnect: () => void;
            const connectPromise = new Promise<void>(r => { resolveConnect = r; });

            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockImplementation(async () => {
                    await connectPromise;
                    return true;
                }),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            // Concurrent connection test with a new pool
            const freshPool = new CdpConnectionPool({ cdpCallTimeout: 5000 });

            const p1 = freshPool.getOrConnect('/path/to/ProjectX');
            const p2 = freshPool.getOrConnect('/path/to/ProjectX');

            // Only one CdpService should have been created since it hasn't resolved yet
            expect(CdpService).toHaveBeenCalledTimes(1);

            resolveConnect!();
            const [cdp1, cdp2] = await Promise.all([p1, p2]);

            expect(cdp1).toBe(cdp2);

            freshPool.disconnectAll();
        });
    });

    describe('getConnected()', () => {
        it('returns the CdpService when connected', async () => {
            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            await pool.getOrConnect('/path/to/ProjectA');
            const result = pool.getConnected('ProjectA');

            expect(result).toBe(mockCdp);
        });

        it('returns null when not connected', () => {
            const result = pool.getConnected('NonExistent');
            expect(result).toBeNull();
        });
    });

    describe('disconnectWorkspace()', () => {
        it('disconnects the specified workspace and removes it from the map', async () => {
            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            await pool.getOrConnect('/path/to/ProjectA');
            expect(pool.getActiveWorkspaceNames()).toContain('ProjectA');

            pool.disconnectWorkspace('ProjectA');

            expect(mockCdp.disconnect).toHaveBeenCalled();
            expect(pool.getConnected('ProjectA')).toBeNull();
        });

        it('also stops the approval detector', async () => {
            const mockCdp = {
                isConnected: jest.fn().mockReturnValue(true),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
            };
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => mockCdp as any);

            await pool.getOrConnect('/path/to/ProjectA');

            const mockDetector = {
                isActive: jest.fn().mockReturnValue(true),
                stop: jest.fn().mockResolvedValue(undefined),
                start: jest.fn(),
            } as any;
            pool.registerApprovalDetector('ProjectA', mockDetector);

            pool.disconnectWorkspace('ProjectA');

            expect(mockDetector.stop).toHaveBeenCalled();
            expect(pool.getApprovalDetector('ProjectA')).toBeUndefined();
        });
    });

    describe('disconnectAll()', () => {
        it('disconnects all workspace connections', async () => {
            let callCount = 0;
            const mocks: any[] = [];
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => {
                callCount++;
                const mock = {
                    isConnected: jest.fn().mockReturnValue(true),
                    discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                    on: jest.fn(),
                    disconnect: jest.fn().mockResolvedValue(undefined),
                };
                mocks.push(mock);
                return mock as any;
            });

            await pool.getOrConnect('/path/to/A');
            await pool.getOrConnect('/path/to/B');

            pool.disconnectAll();

            expect(mocks[0].disconnect).toHaveBeenCalled();
            expect(mocks[1].disconnect).toHaveBeenCalled();
            expect(pool.getActiveWorkspaceNames()).toHaveLength(0);
        });
    });

    describe('ApprovalDetector management', () => {
        it('can register with registerApprovalDetector and retrieve with getApprovalDetector', () => {
            const mockDetector = {
                isActive: jest.fn().mockReturnValue(true),
                stop: jest.fn(),
                start: jest.fn(),
            } as any;

            pool.registerApprovalDetector('ProjectA', mockDetector);

            expect(pool.getApprovalDetector('ProjectA')).toBe(mockDetector);
        });

        it('stops the old detector when replacing an existing one', () => {
            const oldDetector = {
                isActive: jest.fn().mockReturnValue(true),
                stop: jest.fn().mockResolvedValue(undefined),
                start: jest.fn(),
            } as any;
            const newDetector = {
                isActive: jest.fn().mockReturnValue(false),
                stop: jest.fn(),
                start: jest.fn(),
            } as any;

            pool.registerApprovalDetector('ProjectA', oldDetector);
            pool.registerApprovalDetector('ProjectA', newDetector);

            expect(oldDetector.stop).toHaveBeenCalled();
            expect(pool.getApprovalDetector('ProjectA')).toBe(newDetector);
        });
    });

    describe('getActiveWorkspaceNames()', () => {
        it('returns only connected workspace names', async () => {
            let callCount = 0;
            (CdpService as jest.MockedClass<typeof CdpService>).mockImplementation(() => {
                callCount++;
                const isFirst = callCount === 1;
                return {
                    isConnected: jest.fn().mockReturnValue(isFirst), // 最初のみ接続中
                    discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(true),
                    on: jest.fn(),
                    disconnect: jest.fn().mockResolvedValue(undefined),
                } as any;
            });

            await pool.getOrConnect('/path/to/A');
            await pool.getOrConnect('/path/to/B');

            const active = pool.getActiveWorkspaceNames();
            expect(active).toContain('A');
            expect(active).not.toContain('B');
        });
    });
});
