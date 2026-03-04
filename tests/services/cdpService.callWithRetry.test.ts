/**
 * Tests for callWithRetry(), waitForReconnection(), and reconnectOnDemand()
 *
 * Verification items:
 * - callWithRetry passes through on successful call
 * - callWithRetry reconnects on-demand and retries on WebSocket disconnection
 * - callWithRetry throws immediately for non-connection errors (no retry)
 * - reconnectOnDemand throws when no workspace path is available
 * - reconnectOnDemand delegates to waitForReconnection when already reconnecting
 * - reconnectOnDemand coalesces concurrent calls via shared promise
 * - waitForReconnection resolves on 'reconnected' event
 * - waitForReconnection rejects on 'reconnectFailed' event
 * - waitForReconnection rejects on timeout
 */

import { CdpService } from '../../src/services/cdpService';
import WebSocket from 'ws';

jest.mock('ws');
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

jest.mock('http', () => ({
    get: jest.fn(),
}));

describe('CdpService - callWithRetry (Issue #55)', () => {
    let cdpService: CdpService;
    let mockWsInstance: jest.Mocked<WebSocket>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockWsInstance = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn().mockReturnThis(),
        } as unknown as jest.Mocked<WebSocket>;

        MockWebSocket.mockImplementation(() => mockWsInstance);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ========== callWithRetry ==========

    describe('callWithRetry()', () => {
        it('passes through when call() succeeds', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // Simulate immediate response
            mockWsInstance.send.mockImplementation((data: any) => {
                const msg = JSON.parse(data);
                const pending = (cdpService as any).pendingCalls.get(msg.id);
                if (pending) {
                    clearTimeout(pending.timeoutId);
                    (cdpService as any).pendingCalls.delete(msg.id);
                    pending.resolve({ result: { value: 'ok' } });
                }
            });

            const result = await cdpService.callWithRetry('Runtime.evaluate', { expression: '1+1' });
            expect(result).toEqual({ result: { value: 'ok' } });
        });

        it('reconnects on-demand and retries when WebSocket is disconnected', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            (cdpService as any).currentWorkspacePath = '/tmp/my-workspace';

            // After reconnect, simulate connected state
            jest.spyOn(cdpService, 'discoverAndConnectForWorkspace').mockImplementation(async () => {
                (cdpService as any).isConnectedFlag = true;
                (cdpService as any).ws = mockWsInstance;
                mockWsInstance.send.mockImplementation((data: any) => {
                    const msg = JSON.parse(data);
                    const pending = (cdpService as any).pendingCalls.get(msg.id);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        (cdpService as any).pendingCalls.delete(msg.id);
                        pending.resolve({ data: 'screenshot-data' });
                    }
                });
                return true;
            });

            const result = await cdpService.callWithRetry('Page.captureScreenshot', {});
            expect(result).toEqual({ data: 'screenshot-data' });
            expect(cdpService.discoverAndConnectForWorkspace).toHaveBeenCalledWith('/tmp/my-workspace');
        });

        it('throws immediately for non-connection errors (no retry)', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // Simulate timeout error
            jest.spyOn(cdpService, 'call').mockRejectedValue(
                new Error('Timeout calling CDP method Page.captureScreenshot')
            );

            await expect(
                cdpService.callWithRetry('Page.captureScreenshot', {})
            ).rejects.toThrow('Timeout calling CDP method Page.captureScreenshot');
        });

        it('retries on in-flight WebSocket disconnected error', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).currentWorkspacePath = '/tmp/my-workspace';

            jest.spyOn(cdpService, 'discoverAndConnectForWorkspace').mockResolvedValue(true);
            jest.spyOn(cdpService, 'call')
                .mockRejectedValueOnce(new Error('WebSocket disconnected'))
                .mockResolvedValueOnce({ data: 'screenshot-data' });

            const result = await cdpService.callWithRetry('Page.captureScreenshot', {});
            expect(result).toEqual({ data: 'screenshot-data' });
            expect(cdpService.discoverAndConnectForWorkspace).toHaveBeenCalledWith('/tmp/my-workspace');
        });

        it('throws when reconnect fails', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).isConnectedFlag = false;
            (cdpService as any).ws = null;
            (cdpService as any).currentWorkspacePath = '/tmp/my-workspace';

            jest.spyOn(cdpService, 'discoverAndConnectForWorkspace').mockRejectedValue(
                new Error('No target found')
            );

            await expect(
                cdpService.callWithRetry('Page.captureScreenshot', {})
            ).rejects.toThrow('WebSocket is not connected');
        });
    });

    // ========== reconnectOnDemand ==========

    describe('reconnectOnDemand()', () => {
        it('throws when no currentWorkspacePath is available', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).currentWorkspacePath = null;

            await expect(
                (cdpService as any).reconnectOnDemand()
            ).rejects.toThrow('WebSocket is not connected');
        });

        it('delegates to waitForReconnection when already reconnecting', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).isReconnecting = true;

            const reconnectPromise = (cdpService as any).reconnectOnDemand();

            // Simulate reconnect success
            cdpService.emit('reconnected');

            await expect(reconnectPromise).resolves.toBeUndefined();
        });

        it('coalesces concurrent calls via shared promise', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });
            (cdpService as any).currentWorkspacePath = '/tmp/ws';

            let resolveConnect: () => void;
            const connectPromise = new Promise<void>(r => { resolveConnect = r; });

            jest.spyOn(cdpService, 'discoverAndConnectForWorkspace').mockImplementation(async () => {
                await connectPromise;
                return true;
            });

            // Fire two concurrent calls
            const p1 = (cdpService as any).reconnectOnDemand();
            const p2 = (cdpService as any).reconnectOnDemand();

            // Resolve the connection
            resolveConnect!();

            await Promise.all([p1, p2]);

            // discoverAndConnectForWorkspace should only be called once
            expect(cdpService.discoverAndConnectForWorkspace).toHaveBeenCalledTimes(1);
        });
    });

    // ========== waitForReconnection ==========

    describe('waitForReconnection()', () => {
        it('resolves on reconnected event', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });

            const promise = (cdpService as any).waitForReconnection(5000);
            cdpService.emit('reconnected');

            await expect(promise).resolves.toBeUndefined();
        });

        it('rejects on reconnectFailed event', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });

            const promise = (cdpService as any).waitForReconnection(5000);
            cdpService.emit('reconnectFailed', new Error('Max attempts'));

            await expect(promise).rejects.toThrow('WebSocket is not connected');
        });

        it('rejects on timeout', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });

            const promise = (cdpService as any).waitForReconnection(50);

            await expect(promise).rejects.toThrow('WebSocket is not connected');
        }, 5000);

        it('cleans up event listeners after resolution', async () => {
            cdpService = new CdpService({ maxReconnectAttempts: 0 });

            const listenersBefore = cdpService.listenerCount('reconnected');
            const promise = (cdpService as any).waitForReconnection(5000);
            cdpService.emit('reconnected');
            await promise;
            const listenersAfter = cdpService.listenerCount('reconnected');

            expect(listenersAfter).toBe(listenersBefore);
        });
    });
});
