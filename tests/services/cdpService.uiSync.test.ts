/**
 * Step 9: Model/mode switching UI sync tests
 * TDD Red phase: Tests for CdpService UI manipulation methods
 *
 * Verification items:
 * - Can setUiMode() operate the Antigravity UI mode dropdown?
 * - Can setUiModel() operate the Antigravity UI model dropdown?
 * - Does it throw appropriate errors when not connected?
 * - Fallback handling when DOM manipulation fails
 */

import WebSocket from 'ws';
import { CdpService } from '../../src/services/cdpService';

// Mock WebSocket
jest.mock('ws');
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

// Mock http module (used by discoverTarget)
jest.mock('http', () => ({
    get: jest.fn(),
}));

describe('CdpService - UI sync (Step 9)', () => {
    let cdpService: CdpService;
    let mockWsInstance: jest.Mocked<WebSocket>;
    let callSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock WebSocket instance setup
        mockWsInstance = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            on: jest.fn(),
            close: jest.fn(),
        } as unknown as jest.Mocked<WebSocket>;

        MockWebSocket.mockImplementation(() => mockWsInstance);

        cdpService = new CdpService({ cdpCallTimeout: 1000 });

        // Spy on the call method to simulate connected state
        callSpy = jest.spyOn(cdpService, 'call');
    });

    afterEach(async () => {
        jest.restoreAllMocks();
    });

    // ========== setUiMode tests ==========

    describe('setUiMode - UI mode dropdown operation', () => {

        it('throws an error when not connected', async () => {
            // Test when isConnected() returns false
            await expect(cdpService.setUiMode('plan')).rejects.toThrow(
                'Not connected to CDP'
            );
        });

        it('executes a UI manipulation script via CDP when connected', async () => {
            // Set to connected state
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // Stub call to return success
            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'Planning' } }
            });

            const result = await cdpService.setUiMode('plan');

            // Verify call was invoked
            expect(callSpy).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.objectContaining({
                    expression: expect.stringContaining('plan'),
                    returnByValue: true,
                    awaitPromise: true,
                })
            );
            expect(result.ok).toBe(true);
        });

        it('maps internal mode names to UI display names', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'Planning' } }
            });

            const result = await cdpService.setUiMode('plan');

            // Verify expression contains UI name mapping
            const callArgs = callSpy.mock.calls[0][1];
            expect(callArgs.expression).toContain('Planning');
            expect(callArgs.expression).toContain('Fast');
            expect(result.ok).toBe(true);
            expect(result.mode).toBe('Planning');
        });

        it('returns the mode name on successful UI operation', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'Fast' } }
            });

            const result = await cdpService.setUiMode('fast');

            expect(result.ok).toBe(true);
            expect(result.mode).toBe('Fast');
        });

        it('uses dialog-based selectors in the expression', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'Planning' } }
            });

            await cdpService.setUiMode('plan');

            const callArgs = callSpy.mock.calls[0][1];
            // Verify dialog-based search is used
            expect(callArgs.expression).toContain('role=\\"dialog\\"');
            expect(callArgs.expression).toContain('.font-medium');
            expect(callArgs.expression).toContain('cursor-pointer');
        });

        it('returns ok: false when DOM elements are not found', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: false, error: 'Mode toggle button not found' } }
            });

            const result = await cdpService.setUiMode('plan');

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('returns ok: false without crashing when a CDP error occurs', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockRejectedValue(new Error('CDP通信エラー'));

            const result = await cdpService.setUiMode('plan');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('CDP通信エラー');
        });
    });

    // ========== setUiModel tests ==========

    describe('setUiModel - UI model dropdown operation', () => {

        it('throws an error when not connected', async () => {
            await expect(cdpService.setUiModel('gpt-4o')).rejects.toThrow(
                'Not connected to CDP'
            );
        });

        it('executes a UI manipulation script via CDP when connected', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, model: 'gpt-4o' } }
            });

            const result = await cdpService.setUiModel('gpt-4o');

            expect(callSpy).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.objectContaining({
                    expression: expect.stringContaining('gpt-4o'),
                    returnByValue: true,
                    awaitPromise: true,
                })
            );
            expect(result.ok).toBe(true);
        });

        it('returns the model name on successful UI operation', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, model: 'claude-3-opus' } }
            });

            const result = await cdpService.setUiModel('claude-3-opus');

            expect(result.ok).toBe(true);
            expect(result.model).toBe('claude-3-opus');
        });

        it('returns ok: false when DOM elements are not found', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: false, error: 'モデルセレクターが見つかりませんでした' } }
            });

            const result = await cdpService.setUiModel('gpt-4o');

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('returns ok: false without crashing when a CDP error occurs', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockRejectedValue(new Error('タイムアウト'));

            const result = await cdpService.setUiModel('gpt-4o');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('タイムアウト');
        });

        it('uses the primary context ID when a context exists', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;
            (cdpService as any).contexts = [
                { id: 42, name: 'cascade-panel', url: 'vscode-webview://cascade-panel' }
            ];

            callSpy.mockResolvedValue({
                result: { value: { ok: true, model: 'gemini-1.5-pro' } }
            });

            await cdpService.setUiModel('gemini-1.5-pro');

            expect(callSpy).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.objectContaining({
                    contextId: 42,
                })
            );
        });
    });
});
