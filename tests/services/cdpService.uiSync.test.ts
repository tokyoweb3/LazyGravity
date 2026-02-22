/**
 * Step 9: モデル・モード切替のUI同期 テスト
 * TDD Red フェーズ: CdpServiceのUI操作メソッドのテスト
 *
 * 検証項目:
 * - setUiMode() でAntigravity UIのモードドロップダウンを操作できるか
 * - setUiModel() でAntigravity UIのモデルドロップダウンを操作できるか
 * - 未接続時に適切なエラーをスローするか
 * - DOM操作が失敗した場合のフォールバック処理
 */

import WebSocket from 'ws';
import { CdpService } from '../../src/services/cdpService';

// WebSocketをモック化
jest.mock('ws');
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

// httpモジュールをモック化（discoverTargetで使用）
jest.mock('http', () => ({
    get: jest.fn(),
}));

describe('CdpService - UI同期 (Step 9)', () => {
    let cdpService: CdpService;
    let mockWsInstance: jest.Mocked<WebSocket>;
    let callSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        // WebSocketインスタンスのモック設定
        mockWsInstance = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            on: jest.fn(),
            close: jest.fn(),
        } as unknown as jest.Mocked<WebSocket>;

        MockWebSocket.mockImplementation(() => mockWsInstance);

        cdpService = new CdpService({ cdpCallTimeout: 1000 });

        // 接続済み状態を模倣するためにcallメソッドをスパイ
        callSpy = jest.spyOn(cdpService, 'call');
    });

    afterEach(async () => {
        jest.restoreAllMocks();
    });

    // ========== setUiMode テスト ==========

    describe('setUiMode - UIのモードドロップダウン操作', () => {

        it('未接続時にエラーをスローすること', async () => {
            // isConnected() が false の状態でテスト
            await expect(cdpService.setUiMode('architect')).rejects.toThrow(
                'CDPに接続されていません'
            );
        });

        it('接続済みの場合、CDPでUI操作スクリプトを実行すること', async () => {
            // 接続済み状態にする
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            // callが成功を返すようにスタブ化
            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'architect' } }
            });

            const result = await cdpService.setUiMode('architect');

            // callが呼ばれたことを確認
            expect(callSpy).toHaveBeenCalledWith(
                'Runtime.evaluate',
                expect.objectContaining({
                    expression: expect.stringContaining('architect'),
                    returnByValue: true,
                    awaitPromise: true,
                })
            );
            expect(result.ok).toBe(true);
        });

        it('UI操作成功時にmode名を返すこと', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, mode: 'ask' } }
            });

            const result = await cdpService.setUiMode('ask');

            expect(result.ok).toBe(true);
            expect(result.mode).toBe('ask');
        });

        it('DOM要素が見つからない場合、ok: falseを返すこと', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: false, error: 'モードセレクターが見つかりませんでした' } }
            });

            const result = await cdpService.setUiMode('code');

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('CDPエラーが発生した場合、ok: falseを返すこと（クラッシュしない）', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockRejectedValue(new Error('CDP通信エラー'));

            const result = await cdpService.setUiMode('code');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('CDP通信エラー');
        });
    });

    // ========== setUiModel テスト ==========

    describe('setUiModel - UIのモデルドロップダウン操作', () => {

        it('未接続時にエラーをスローすること', async () => {
            await expect(cdpService.setUiModel('gpt-4o')).rejects.toThrow(
                'CDPに接続されていません'
            );
        });

        it('接続済みの場合、CDPでUI操作スクリプトを実行すること', async () => {
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

        it('UI操作成功時にmodel名を返すこと', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: true, model: 'claude-3-opus' } }
            });

            const result = await cdpService.setUiModel('claude-3-opus');

            expect(result.ok).toBe(true);
            expect(result.model).toBe('claude-3-opus');
        });

        it('DOM要素が見つからない場合、ok: falseを返すこと', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockResolvedValue({
                result: { value: { ok: false, error: 'モデルセレクターが見つかりませんでした' } }
            });

            const result = await cdpService.setUiModel('gpt-4o');

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('CDPエラーが発生した場合、ok: falseを返すこと（クラッシュしない）', async () => {
            (cdpService as any).isConnectedFlag = true;
            (cdpService as any).ws = mockWsInstance;

            callSpy.mockRejectedValue(new Error('タイムアウト'));

            const result = await cdpService.setUiModel('gpt-4o');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('タイムアウト');
        });

        it('コンテキストが存在する場合、プライマリコンテキストIDを使用すること', async () => {
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
