/**
 * Step 8: セルフ・スクリーンショット機能 (`/screenshot`) TDDテスト
 *
 * テスト方針:
 *   - ScreenshotService クラスをテスト対象とする
 *   - CdpService をモック化してPage.captureScreenshotをシュミレート
 *   - base64エンコードされた画像データの取得とBuffer変換を検証
 */

import { ScreenshotService } from '../../src/services/screenshotService';
import { CdpService } from '../../src/services/cdpService';

// CdpService をモック化
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ScreenshotService - スクリーンショット機能 (Step 8)', () => {
    let screenshotService: ScreenshotService;
    let mockCdpService: jest.Mocked<CdpService>;

    // テスト用のダミーBase64画像データ (小さな1x1ピクセルPNG)
    const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    beforeEach(() => {
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────────────
    // テスト 1: スクリーンショットを取得してBufferを返す
    // ──────────────────────────────────────────────────────
    it('screenshotを取得してBufferを返すこと', async () => {
        // Page.captureScreenshot が base64 データを返すモック
        mockCdpService.call.mockResolvedValue({
            data: dummyBase64
        });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.capture();

        expect(result.success).toBe(true);
        expect(result.buffer).toBeInstanceOf(Buffer);
        expect(result.buffer!.length).toBeGreaterThan(0);
    });

    // ──────────────────────────────────────────────────────
    // テスト 2: Page.captureScreenshot が正しいパラメータで呼ばれること
    // ──────────────────────────────────────────────────────
    it('captureScreenshotが正しいCDPコマンドとパラメータで呼ばれること', async () => {
        mockCdpService.call.mockResolvedValue({ data: dummyBase64 });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        await screenshotService.capture();

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Page.captureScreenshot',
            expect.objectContaining({
                format: 'png',
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 3: JPEGフォーマットを指定できること
    // ──────────────────────────────────────────────────────
    it('JPEGフォーマットを指定してキャプチャできること', async () => {
        mockCdpService.call.mockResolvedValue({ data: dummyBase64 });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        await screenshotService.capture({ format: 'jpeg', quality: 80 });

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Page.captureScreenshot',
            expect.objectContaining({
                format: 'jpeg',
                quality: 80,
            })
        );
    });

    // ──────────────────────────────────────────────────────
    // テスト 4: CDPエラー時にエラー情報を返すこと
    // ──────────────────────────────────────────────────────
    it('CDPエラー時にsuccess:falseとエラーメッセージを返すこと', async () => {
        mockCdpService.call.mockRejectedValue(new Error('CDP接続エラー'));

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.capture();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('CDP接続エラー');
    });

    // ──────────────────────────────────────────────────────
    // テスト 5: データが空の場合にエラー情報を返すこと
    // ──────────────────────────────────────────────────────
    it('CDPが空データを返した場合にsuccess:falseを返すこと', async () => {
        mockCdpService.call.mockResolvedValue({ data: '' });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.capture();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    // ──────────────────────────────────────────────────────
    // テスト 6: getBase64()でBase64文字列を直接取得できること
    // ──────────────────────────────────────────────────────
    it('getBase64()でBase64エンコードされた画像文字列を取得できること', async () => {
        mockCdpService.call.mockResolvedValue({ data: dummyBase64 });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.getBase64();

        expect(result).toBe(dummyBase64);
    });

    // ──────────────────────────────────────────────────────
    // テスト 7: クリップ領域を指定してキャプチャできること
    // ──────────────────────────────────────────────────────
    it('クリップ領域を指定してキャプチャできること', async () => {
        mockCdpService.call.mockResolvedValue({ data: dummyBase64 });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const clip = { x: 0, y: 0, width: 800, height: 600, scale: 1 };
        await screenshotService.capture({ clip });

        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Page.captureScreenshot',
            expect.objectContaining({
                clip,
            })
        );
    });
});
