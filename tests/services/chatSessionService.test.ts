import { ChatSessionService } from '../../src/services/chatSessionService';
import { CdpService } from '../../src/services/cdpService';

jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ChatSessionService', () => {
    let service: ChatSessionService;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        mockCdpService.getContexts = jest.fn().mockReturnValue([
            { id: 42, name: 'Electron Isolated Context', url: '' },
        ]);
        mockCdpService.waitForCascadePanelReady = jest.fn().mockResolvedValue(false);
        service = new ChatSessionService();
    });

    describe('startNewChat()', () => {
        it('opens a new chat via coordinate click when the button is enabled', async () => {
            // 1st call: button enabled (cursor:pointer), 2nd call: button disabled (cursor:not-allowed)
            let callCount = 0;
            mockCdpService.call.mockImplementation(async (method: string) => {
                if (method === 'Runtime.evaluate') {
                    callCount++;
                    if (callCount === 1) {
                        // Get button state: enabled
                        return { result: { value: { found: true, enabled: true, x: 100, y: 50 } } };
                    }
                    // Verification after click: changed to disabled
                    return { result: { value: { found: true, enabled: false, x: 100, y: 50 } } };
                }
                // Input.dispatchMouseEvent succeeds
                return {};
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(true);
            expect(mockCdpService.call).toHaveBeenCalledWith(
                'Input.dispatchMouseEvent',
                expect.objectContaining({ type: 'mousePressed', x: 100, y: 50 })
            );
        });

        it('returns success without action when the button is disabled (already empty chat)', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { found: true, enabled: false, cursor: 'not-allowed', x: 100, y: 50 } }
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(true);
            // Verify Input.dispatchMouseEvent was not called
            expect(mockCdpService.call).not.toHaveBeenCalledWith(
                'Input.dispatchMouseEvent',
                expect.anything()
            );
        });

        it('returns ok: false when the button is not found', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { found: false } }
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('not found');
        }, 15000);

        it('returns ok: false when contexts are empty', async () => {
            mockCdpService.getContexts = jest.fn().mockReturnValue([]);
            mockCdpService.waitForCascadePanelReady = jest.fn().mockResolvedValue(false);

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('No contexts available');
        });

        it('returns ok: false when a CDP call throws an exception', async () => {
            mockCdpService.call.mockRejectedValue(new Error('WebSocket切断'));

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        }, 15000);

        it('returns ok: false when button state does not change after click', async () => {
            // Button remains enabled throughout
            mockCdpService.call.mockImplementation(async (method: string) => {
                if (method === 'Runtime.evaluate') {
                    return { result: { value: { found: true, enabled: true, x: 100, y: 50 } } };
                }
                return {};
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('state did not change');
        });
    });

    describe('getCurrentSessionInfo()', () => {
        it('retrieves the chat title from the Cascade panel header', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'テストチャット', hasActiveChat: true } }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('テストチャット');
            expect(info.hasActiveChat).toBe(true);
        });

        it('returns hasActiveChat: false when the title is "Agent" (default)', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'Agent', hasActiveChat: false } }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('Agent');
            expect(info.hasActiveChat).toBe(false);
        });

        it('returns fallback values when a CDP call throws an exception', async () => {
            mockCdpService.call.mockRejectedValue(new Error('CDPエラー'));

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('(Failed to retrieve)');
            expect(info.hasActiveChat).toBe(false);
        });

        it('returns fallback values when the result is null', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: null }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('(Failed to retrieve)');
            expect(info.hasActiveChat).toBe(false);
        });
    });

    describe('activateSessionByTitle()', () => {
        it('returns ok when already on the target session title', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'target-session', hasActiveChat: true } }
            });

            const result = await service.activateSessionByTitle(mockCdpService, 'target-session');
            expect(result).toEqual({ ok: true });
        });

        it('returns ok:false when switching succeeded but verification title mismatches', async () => {
            let evaluateCallCount = 0;
            mockCdpService.call.mockImplementation(async (method: string, params: any) => {
                if (method !== 'Runtime.evaluate') return {};
                evaluateCallCount++;
                if (evaluateCallCount === 1) {
                    return { result: { value: { title: 'old-session', hasActiveChat: true } } };
                }
                if (params?.expression?.includes('Chat title not found in side panel')) {
                    return { result: { value: { ok: true } } };
                }
                return { result: { value: { title: 'different-session', hasActiveChat: true } } };
            });

            const result = await service.activateSessionByTitle(mockCdpService, 'target-session');
            expect(result.ok).toBe(false);
            expect(result.error).toContain('did not match target title');
        });

        it('falls back to Past Conversations flow when direct side-panel search cannot find the chat', async () => {
            let infoCallCount = 0;
            mockCdpService.call.mockImplementation(async (_method: string, params: any) => {
                const expression = String(params?.expression || '');

                if (expression.includes('const panel = document.querySelector(\'.antigravity-agent-side-panel\')')) {
                    infoCallCount += 1;
                    if (infoCallCount === 1) {
                        return { result: { value: { title: 'current-session', hasActiveChat: true } } };
                    }
                    return { result: { value: { title: 'target-session', hasActiveChat: true } } };
                }

                if (expression.includes('Chat title not found in side panel')) {
                    return { result: { value: { ok: false, error: 'not found in side panel' } } };
                }

                if (expression.includes('Past Conversations button not found')) {
                    return { result: { value: { ok: true } } };
                }

                return { result: { value: null } };
            });

            const result = await service.activateSessionByTitle(mockCdpService, 'target-session');
            expect(result).toEqual({ ok: true });
        });
    });
});
