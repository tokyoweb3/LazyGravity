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
        it('ボタンが有効な場合、座標クリックで新チャットを開くこと', async () => {
            // 1回目: ボタン有効(cursor:pointer)、2回目: ボタン無効(cursor:not-allowed)
            let callCount = 0;
            mockCdpService.call.mockImplementation(async (method: string) => {
                if (method === 'Runtime.evaluate') {
                    callCount++;
                    if (callCount === 1) {
                        // ボタン状態取得: 有効
                        return { result: { value: { found: true, enabled: true, x: 100, y: 50 } } };
                    }
                    // クリック後の確認: 無効に変化
                    return { result: { value: { found: true, enabled: false, x: 100, y: 50 } } };
                }
                // Input.dispatchMouseEvent は成功
                return {};
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(true);
            expect(mockCdpService.call).toHaveBeenCalledWith(
                'Input.dispatchMouseEvent',
                expect.objectContaining({ type: 'mousePressed', x: 100, y: 50 })
            );
        });

        it('ボタンが無効の場合（既に空チャット）、何もせず成功を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { found: true, enabled: false, cursor: 'not-allowed', x: 100, y: 50 } }
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(true);
            // Input.dispatchMouseEvent が呼ばれないことを確認
            expect(mockCdpService.call).not.toHaveBeenCalledWith(
                'Input.dispatchMouseEvent',
                expect.anything()
            );
        });

        it('ボタンが見つからない場合 ok: false を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { found: false } }
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('見つかりませんでした');
        }, 15000);

        it('コンテキストが空の場合 ok: false を返すこと', async () => {
            mockCdpService.getContexts = jest.fn().mockReturnValue([]);
            mockCdpService.waitForCascadePanelReady = jest.fn().mockResolvedValue(false);

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('コンテキストがありません');
        });

        it('CDP呼び出しが例外を投げた場合 ok: false を返すこと', async () => {
            mockCdpService.call.mockRejectedValue(new Error('WebSocket切断'));

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        }, 15000);

        it('クリック後にボタン状態が変化しない場合 ok: false を返すこと', async () => {
            // ボタンはずっと enabled のまま
            mockCdpService.call.mockImplementation(async (method: string) => {
                if (method === 'Runtime.evaluate') {
                    return { result: { value: { found: true, enabled: true, x: 100, y: 50 } } };
                }
                return {};
            });

            const result = await service.startNewChat(mockCdpService);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('状態が変化しませんでした');
        });
    });

    describe('getCurrentSessionInfo()', () => {
        it('Cascade panelヘッダーからチャットタイトルを取得できること', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'テストチャット', hasActiveChat: true } }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('テストチャット');
            expect(info.hasActiveChat).toBe(true);
        });

        it('タイトルが "Agent"（デフォルト）の場合 hasActiveChat: false を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'Agent', hasActiveChat: false } }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('Agent');
            expect(info.hasActiveChat).toBe(false);
        });

        it('CDP呼び出しが例外を投げた場合はフォールバック値を返すこと', async () => {
            mockCdpService.call.mockRejectedValue(new Error('CDPエラー'));

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('(取得失敗)');
            expect(info.hasActiveChat).toBe(false);
        });

        it('結果がnullの場合はフォールバック値を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: null }
            });

            const info = await service.getCurrentSessionInfo(mockCdpService);

            expect(info.title).toBe('(取得失敗)');
            expect(info.hasActiveChat).toBe(false);
        });
    });
});
