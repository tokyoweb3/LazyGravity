/**
 * Step 12: エラーハンドリングとタイムアウト処理 テスト
 * TDD Red フェーズ
 *
 * 検証項目:
 * - CDPがクラッシュ/切断した際に自動再接続を試みるか
 * - 再接続試行回数の上限を超えたらエラーイベントを発火するか
 * - 再接続中に同時に複数回接続しようとしても安全か
 * - CdpServiceのpendingCallsが切断時に全てrejectされること（メモリリーク防止）
 * - 最大再試行回数に達した際に 'reconnectFailed' イベントを発火すること
 */

import { CdpService } from '../../src/services/cdpService';
import WebSocket from 'ws';

jest.mock('ws');
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

jest.mock('http', () => ({
    get: jest.fn(),
}));

describe('CdpService - エラーハンドリングとタイムアウト処理 (Step 12)', () => {
    let cdpService: CdpService;
    let mockWsInstance: jest.Mocked<WebSocket>;

    // 切断イベントのハンドラーをシミュレートするための関数
    let wsEventHandlers: Record<string, Function> = {};

    beforeEach(() => {
        jest.clearAllMocks();
        wsEventHandlers = {};

        mockWsInstance = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn((event: string, handler: Function) => {
                wsEventHandlers[event] = handler;
                return mockWsInstance;
            }),
        } as unknown as jest.Mocked<WebSocket>;

        MockWebSocket.mockImplementation(() => mockWsInstance);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ========== pendingCallsのクリーンアップ ==========

    describe('切断時のpendingCallsクリーンアップ', () => {
        it('WebSocket切断時に未解決のpendingCallsが全てrejectされること', async () => {
            cdpService = new CdpService({ cdpCallTimeout: 5000, maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // pendingCallsに未解決のPromiseを追加
            const pendingPromise = new Promise<void>((_, reject) => {
                (cdpService as any).pendingCalls.set(999, {
                    resolve: jest.fn(),
                    reject,
                    timeoutId: setTimeout(() => { }, 999999),
                });
            });

            // CDP切断をシミュレート
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            // clearPendingCallsメソッドを呼ぶ
            (cdpService as any).clearPendingCalls(new Error('WebSocket切断'));

            // pendingCallsのrejectが呼ばれること
            await expect(pendingPromise).rejects.toThrow('WebSocket切断');
        });

        it('切断後はpendingCallsが空になること', () => {
            cdpService = new CdpService({ cdpCallTimeout: 5000, maxReconnectAttempts: 0 });
            (cdpService as any).pendingCalls.set(1, {
                resolve: jest.fn(),
                reject: jest.fn(),
                timeoutId: setTimeout(() => { }, 999999),
            });
            (cdpService as any).pendingCalls.set(2, {
                resolve: jest.fn(),
                reject: jest.fn(),
                timeoutId: setTimeout(() => { }, 999999),
            });

            expect((cdpService as any).pendingCalls.size).toBe(2);

            (cdpService as any).clearPendingCalls(new Error('切断'));

            expect((cdpService as any).pendingCalls.size).toBe(0);
        });
    });

    // ========== 自動再接続 ==========

    describe('自動再接続機能', () => {
        it('maxReconnectAttemptsが0の場合、再接続しないこと', (done) => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 0,
            });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            const reconnectSpy = jest.spyOn(cdpService as any, 'tryReconnect');

            // disconnectedイベントを発火させる
            cdpService.on('disconnected', () => {
                // 少し待ってから再接続試行が行われないことを確認
                setTimeout(() => {
                    expect(reconnectSpy).not.toHaveBeenCalled();
                    done();
                }, 100);
            });

            // 切断をシミュレート
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            cdpService.emit('disconnected');
        });

        it('maxReconnectAttemptsが設定されている場合、reconnectFailed後にイベントを発火すること', (done) => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 2,
                reconnectDelayMs: 10, // テスト高速化のため短く設定
            });

            // discoverTargetを必ず失敗させる
            jest.spyOn(cdpService, 'discoverTarget').mockRejectedValue(new Error('ターゲットが見つかりません'));

            cdpService.on('reconnectFailed', (err: Error) => {
                expect(err).toBeDefined();
                expect(err.message).toBeDefined();
                done();
            });

            // tryReconnectを直接呼び出してテスト
            (cdpService as any).tryReconnect();
        }, 10000);

        it('再接続試行回数がmaxReconnectAttemptsを超えないこと', async () => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 2,
                reconnectDelayMs: 10,
            });

            let connectCallCount = 0;
            jest.spyOn(cdpService, 'discoverTarget').mockImplementation(async () => {
                connectCallCount++;
                throw new Error('接続失敗');
            });

            // reconnectFailedイベントを待つ
            await new Promise<void>((resolve) => {
                cdpService.on('reconnectFailed', () => resolve());
                (cdpService as any).tryReconnect();
            });

            // maxReconnectAttempts回数分だけ試みること
            expect(connectCallCount).toBeLessThanOrEqual(2);
        }, 10000);
    });

    // ========== CdpServiceオプション ==========

    describe('CdpServiceOptions の拡張', () => {
        it('maxReconnectAttemptsオプションを受け付けること', () => {
            cdpService = new CdpService({ maxReconnectAttempts: 5 });
            expect((cdpService as any).maxReconnectAttempts).toBe(5);
        });

        it('reconnectDelayMsオプションを受け付けること', () => {
            cdpService = new CdpService({ reconnectDelayMs: 3000 });
            expect((cdpService as any).reconnectDelayMs).toBe(3000);
        });

        it('デフォルトのmaxReconnectAttemptsは3であること', () => {
            cdpService = new CdpService();
            expect((cdpService as any).maxReconnectAttempts).toBe(3);
        });

        it('デフォルトのreconnectDelayMsは2000であること', () => {
            cdpService = new CdpService();
            expect((cdpService as any).reconnectDelayMs).toBe(2000);
        });
    });
});
