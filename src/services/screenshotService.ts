import { CdpService } from './cdpService';

/** スクリーンショットのキャプチャオプション */
export interface CaptureOptions {
    /** 画像フォーマット（デフォルト: 'png'） */
    format?: 'png' | 'jpeg' | 'webp';
    /** JPEG品質 (0-100、JPEGのみ有効) */
    quality?: number;
    /** キャプチャするクリップ領域 */
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    };
    /** フル幅キャプチャ（スクロール含む） */
    captureBeyondViewport?: boolean;
}

/** スクリーンショットの結果 */
export interface CaptureResult {
    /** 成功したかどうか */
    success: boolean;
    /** 画像データのBuffer（成功時） */
    buffer?: Buffer;
    /** エラーメッセージ（失敗時） */
    error?: string;
}

export interface ScreenshotServiceOptions {
    /** CDPサービスインスタンス */
    cdpService: CdpService;
}

/**
 * AntigravityのUIスクリーンショットを取得するサービス
 *
 * Chrome DevTools Protocol の Page.captureScreenshot コマンドを使用して
 * 現在のブラウザ画面をキャプチャし、Discordに送信可能なBufferとして返す。
 */
export class ScreenshotService {
    private cdpService: CdpService;

    constructor(options: ScreenshotServiceOptions) {
        this.cdpService = options.cdpService;
    }

    /**
     * 現在の画面をキャプチャする。
     *
     * @param options キャプチャオプション
     * @returns キャプチャ結果（成功時はBuffer、失敗時はエラーメッセージ）
     */
    async capture(options: CaptureOptions = {}): Promise<CaptureResult> {
        try {
            const params: Record<string, any> = {
                format: options.format ?? 'png',
            };

            if (options.quality !== undefined) {
                params.quality = options.quality;
            }

            if (options.clip) {
                params.clip = options.clip;
            }

            if (options.captureBeyondViewport !== undefined) {
                params.captureBeyondViewport = options.captureBeyondViewport;
            }

            const result = await this.cdpService.call('Page.captureScreenshot', params);

            const base64Data: string = result?.data ?? '';

            if (!base64Data) {
                return {
                    success: false,
                    error: 'スクリーンショットデータが空でした。',
                };
            }

            const buffer = Buffer.from(base64Data, 'base64');

            return {
                success: true,
                buffer,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ScreenshotService] キャプチャ中にエラーが発生しました:', error);
            return {
                success: false,
                error: message,
            };
        }
    }

    /**
     * Base64エンコードされた画像文字列を返す（Discordのembedに使用）。
     *
     * @param options キャプチャオプション
     * @returns Base64エンコードされた画像文字列（失敗時はnull）
     */
    async getBase64(options: CaptureOptions = {}): Promise<string | null> {
        try {
            const params: Record<string, any> = {
                format: options.format ?? 'png',
            };

            if (options.quality !== undefined) {
                params.quality = options.quality;
            }

            if (options.clip) {
                params.clip = options.clip;
            }

            const result = await this.cdpService.call('Page.captureScreenshot', params);
            return result?.data ?? null;
        } catch (error) {
            console.error('[ScreenshotService] Base64取得中にエラーが発生しました:', error);
            return null;
        }
    }
}
