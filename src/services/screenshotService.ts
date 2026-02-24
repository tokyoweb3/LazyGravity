import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** Screenshot capture options */
export interface CaptureOptions {
    /** Image format (default: 'png') */
    format?: 'png' | 'jpeg' | 'webp';
    /** JPEG quality (0-100, JPEG only) */
    quality?: number;
    /** Clip region to capture */
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    };
    /** Full width capture (including scroll) */
    captureBeyondViewport?: boolean;
}

/** Screenshot result */
export interface CaptureResult {
    /** Whether the capture succeeded */
    success: boolean;
    /** Image data buffer (on success) */
    buffer?: Buffer;
    /** Error message (on failure) */
    error?: string;
}

export interface ScreenshotServiceOptions {
    /** CDP service instance */
    cdpService: CdpService;
}

/**
 * Service for capturing Antigravity UI screenshots
 *
 * Uses the Chrome DevTools Protocol Page.captureScreenshot command
 * to capture the current browser screen and return it as a Buffer sendable to Discord.
 */
export class ScreenshotService {
    private cdpService: CdpService;

    constructor(options: ScreenshotServiceOptions) {
        this.cdpService = options.cdpService;
    }

    /**
     * Capture the current screen.
     *
     * @param options Capture options
     * @returns Capture result (Buffer on success, error message on failure)
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
                    error: 'Screenshot data was empty.',
                };
            }

            const buffer = Buffer.from(base64Data, 'base64');

            return {
                success: true,
                buffer,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('[ScreenshotService] Error during capture:', error);
            return {
                success: false,
                error: message,
            };
        }
    }

    /**
     * Return a Base64-encoded image string (for use in Discord embeds).
     *
     * @param options Capture options
     * @returns Base64-encoded image string (null on failure)
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
            logger.error('[ScreenshotService] Error while getting Base64:', error);
            return null;
        }
    }
}
