import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';
import { CdpService } from '../../src/services/cdpService';
import { ApprovalDetector } from '../../src/services/approvalDetector';

// CdpService をモック
jest.mock('../../src/services/cdpService');

describe('CdpConnectionPool', () => {
    let pool: CdpConnectionPool;

    beforeEach(() => {
        pool = new CdpConnectionPool({ cdpCallTimeout: 5000 });
    });

    afterEach(() => {
        pool.disconnectAll();
    });

    describe('extractDirName()', () => {
        it('フルパスからディレクトリ名を抽出すること', () => {
            expect(pool.extractDirName('/home/user/Code/MyProject')).toBe('MyProject');
        });

        it('末尾スラッシュを処理すること', () => {
            expect(pool.extractDirName('/home/user/Code/MyProject/')).toBe('MyProject');
        });

        it('単純な名前をそのまま返すこと', () => {
            expect(pool.extractDirName('MyProject')).toBe('MyProject');
        });
    });

    describe('getOrConnect()', () => {
        it('新しい CdpService を作成して接続すること', async () => {
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

        it('同じワークスペースへの二度目の呼び出しではキャッシュを返すこと', async () => {
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
            // discoverAndConnectForWorkspace は1回だけ呼ばれる
            expect(mockCdp.discoverAndConnectForWorkspace).toHaveBeenCalledTimes(1);
        });

        it('異なるワークスペースには別のインスタンスを作成すること', async () => {
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

        it('同時接続をPromiseロックで防止すること', async () => {
            // このテスト用にモックカウンターをリセット
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

            // 新しいプールで同時接続テスト
            const freshPool = new CdpConnectionPool({ cdpCallTimeout: 5000 });

            const p1 = freshPool.getOrConnect('/path/to/ProjectX');
            const p2 = freshPool.getOrConnect('/path/to/ProjectX');

            // まだ解決していないのでCdpServiceは1つだけ作られているはず
            expect(CdpService).toHaveBeenCalledTimes(1);

            resolveConnect!();
            const [cdp1, cdp2] = await Promise.all([p1, p2]);

            expect(cdp1).toBe(cdp2);

            freshPool.disconnectAll();
        });
    });

    describe('getConnected()', () => {
        it('接続済みの場合 CdpService を返すこと', async () => {
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

        it('未接続の場合 null を返すこと', () => {
            const result = pool.getConnected('NonExistent');
            expect(result).toBeNull();
        });
    });

    describe('disconnectWorkspace()', () => {
        it('指定ワークスペースの接続を切断しMapから削除すること', async () => {
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

        it('承認検出器も停止すること', async () => {
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
        it('全てのワークスペース接続を切断すること', async () => {
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

    describe('ApprovalDetector管理', () => {
        it('registerApprovalDetector で登録し getApprovalDetector で取得できること', () => {
            const mockDetector = {
                isActive: jest.fn().mockReturnValue(true),
                stop: jest.fn(),
                start: jest.fn(),
            } as any;

            pool.registerApprovalDetector('ProjectA', mockDetector);

            expect(pool.getApprovalDetector('ProjectA')).toBe(mockDetector);
        });

        it('既存の検出器を置換する場合、古い検出器を停止すること', () => {
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
        it('接続中のワークスペース名のみを返すこと', async () => {
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
