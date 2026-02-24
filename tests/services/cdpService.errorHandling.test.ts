/**
 * Step 12: Error handling and timeout processing tests
 * TDD Red phase
 *
 * Verification items:
 * - Does it attempt automatic reconnection when CDP crashes/disconnects?
 * - Does it fire an error event when max reconnection attempts are exceeded?
 * - Is it safe when multiple concurrent connection attempts occur during reconnection?
 * - Are all pendingCalls rejected on disconnection (memory leak prevention)?
 * - Does it fire a 'reconnectFailed' event when max retry count is reached?
 */

import { CdpService } from '../../src/services/cdpService';
import WebSocket from 'ws';

jest.mock('ws');
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

jest.mock('http', () => ({
    get: jest.fn(),
}));

describe('CdpService - error handling and timeout processing (Step 12)', () => {
    let cdpService: CdpService;
    let mockWsInstance: jest.Mocked<WebSocket>;

    // Function to simulate disconnect event handlers
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

    // ========== pendingCalls cleanup ==========

    describe('pendingCalls cleanup on disconnection', () => {
        it('rejects all unresolved pendingCalls when WebSocket disconnects', async () => {
            cdpService = new CdpService({ cdpCallTimeout: 5000, maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // Add unresolved Promises to pendingCalls
            const pendingPromise = new Promise<void>((_, reject) => {
                (cdpService as any).pendingCalls.set(999, {
                    resolve: jest.fn(),
                    reject,
                    timeoutId: setTimeout(() => { }, 999999),
                });
            });

            // Simulate CDP disconnection
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            // Call the clearPendingCalls method
            (cdpService as any).clearPendingCalls(new Error('WebSocket切断'));

            // Verify pendingCalls reject is called
            await expect(pendingPromise).rejects.toThrow('WebSocket切断');
        });

        it('pendingCalls is empty after disconnection', () => {
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

    // ========== Auto-reconnection ==========

    describe('auto-reconnection feature', () => {
        it('reconnects to the same workspace when workspace path is known', async () => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 1,
                reconnectDelayMs: 10,
            });

            (cdpService as any).currentWorkspacePath = '/tmp/my-workspace';

            const connectWorkspaceSpy = jest
                .spyOn(cdpService, 'discoverAndConnectForWorkspace')
                .mockResolvedValue(true);
            const discoverTargetSpy = jest
                .spyOn(cdpService, 'discoverTarget')
                .mockResolvedValue('ws://dummy-target');
            const connectSpy = jest
                .spyOn(cdpService, 'connect')
                .mockResolvedValue(undefined);

            await new Promise<void>((resolve) => {
                cdpService.on('reconnected', () => resolve());
                (cdpService as any).tryReconnect();
            });

            expect(connectWorkspaceSpy).toHaveBeenCalledWith('/tmp/my-workspace');
            expect(discoverTargetSpy).not.toHaveBeenCalled();
            expect(connectSpy).not.toHaveBeenCalled();
        });

        it('does not reconnect when maxReconnectAttempts is 0', (done) => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 0,
            });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            const reconnectSpy = jest.spyOn(cdpService as any, 'tryReconnect');

            // Fire the disconnected event
            cdpService.on('disconnected', () => {
                // Wait briefly and verify no reconnection attempt was made
                setTimeout(() => {
                    expect(reconnectSpy).not.toHaveBeenCalled();
                    done();
                }, 100);
            });

            // Simulate disconnection
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            cdpService.emit('disconnected');
        });

        it('fires a reconnectFailed event after exhausting maxReconnectAttempts', (done) => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 2,
                reconnectDelayMs: 10, // Set short for faster tests
            });

            // Force discoverTarget to always fail
            jest.spyOn(cdpService, 'discoverTarget').mockRejectedValue(new Error('Target not found'));

            cdpService.on('reconnectFailed', (err: Error) => {
                expect(err).toBeDefined();
                expect(err.message).toBeDefined();
                done();
            });

            // Directly call tryReconnect for testing
            (cdpService as any).tryReconnect();
        }, 10000);

        it('does not exceed maxReconnectAttempts for reconnection attempts', async () => {
            cdpService = new CdpService({
                cdpCallTimeout: 1000,
                maxReconnectAttempts: 2,
                reconnectDelayMs: 10,
            });

            let connectCallCount = 0;
            jest.spyOn(cdpService, 'discoverTarget').mockImplementation(async () => {
                connectCallCount++;
                throw new Error('Connection failed');
            });

            // Wait for the reconnectFailed event
            await new Promise<void>((resolve) => {
                cdpService.on('reconnectFailed', () => resolve());
                (cdpService as any).tryReconnect();
            });

            // Verify only maxReconnectAttempts attempts were made
            expect(connectCallCount).toBeLessThanOrEqual(2);
        }, 10000);
    });

    // ========== CdpService options ==========

    describe('CdpServiceOptions extension', () => {
        it('accepts the maxReconnectAttempts option', () => {
            cdpService = new CdpService({ maxReconnectAttempts: 5 });
            expect((cdpService as any).maxReconnectAttempts).toBe(5);
        });

        it('accepts the reconnectDelayMs option', () => {
            cdpService = new CdpService({ reconnectDelayMs: 3000 });
            expect((cdpService as any).reconnectDelayMs).toBe(3000);
        });

        it('defaults maxReconnectAttempts to 3', () => {
            cdpService = new CdpService();
            expect((cdpService as any).maxReconnectAttempts).toBe(3);
        });

        it('defaults reconnectDelayMs to 2000', () => {
            cdpService = new CdpService();
            expect((cdpService as any).reconnectDelayMs).toBe(2000);
        });
    });
});
