import { ChatSessionService } from '../../src/services/chatSessionService';
import { CdpService } from '../../src/services/cdpService';

jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ChatSessionService', () => {
    let service: ChatSessionService;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(42);
        service = new ChatSessionService({ cdpService: mockCdpService });
    });

    describe('startNewChat()', () => {
        it('新規チャットボタンのクリックに成功した場合 ok: true を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { ok: true, method: 'aria-label' } }
            });

            const result = await service.startNewChat();

            expect(result.ok).toBe(true);
            expect(mockCdpService.call).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.objectContaining({
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: 42,
                })
            );
        });

        it('新規チャットボタンが見つからない場合 ok: false を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { ok: false, error: '新規チャットボタンが見つかりませんでした' } }
            });

            const result = await service.startNewChat();

            expect(result.ok).toBe(false);
            expect(result.error).toContain('新規チャットボタン');
        });

        it('CDP呼び出しが例外を投げた場合 ok: false とエラーメッセージを返すこと', async () => {
            mockCdpService.call.mockRejectedValue(new Error('WebSocket切断'));

            const result = await service.startNewChat();

            expect(result.ok).toBe(false);
            expect(result.error).toBe('WebSocket切断');
        });

        it('contextIdがnullの場合でも動作すること', async () => {
            mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(null);
            mockCdpService.call.mockResolvedValue({
                result: { value: { ok: true } }
            });

            const result = await service.startNewChat();

            expect(result.ok).toBe(true);
            expect(mockCdpService.call).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.not.objectContaining({ contextId: expect.anything() })
            );
        });
    });

    describe('getCurrentSessionInfo()', () => {
        it('チャット情報を正常に取得できること', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: 'テストチャット', hasActiveChat: true } }
            });

            const info = await service.getCurrentSessionInfo();

            expect(info.title).toBe('テストチャット');
            expect(info.hasActiveChat).toBe(true);
        });

        it('タイトルが空の場合は「(無題)」を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: { title: '', hasActiveChat: false } }
            });

            const info = await service.getCurrentSessionInfo();

            expect(info.title).toBe('(無題)');
            expect(info.hasActiveChat).toBe(false);
        });

        it('CDP呼び出しが例外を投げた場合はフォールバック値を返すこと', async () => {
            mockCdpService.call.mockRejectedValue(new Error('CDPエラー'));

            const info = await service.getCurrentSessionInfo();

            expect(info.title).toBe('(取得失敗)');
            expect(info.hasActiveChat).toBe(false);
        });

        it('結果がnullの場合はフォールバック値を返すこと', async () => {
            mockCdpService.call.mockResolvedValue({
                result: { value: null }
            });

            const info = await service.getCurrentSessionInfo();

            expect(info.title).toBe('(取得失敗)');
            expect(info.hasActiveChat).toBe(false);
        });
    });
});
