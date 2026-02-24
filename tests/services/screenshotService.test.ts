/**
 * Step 8: Self-screenshot feature (`/screenshot`) TDD test
 *
 * Test strategy:
 *   - ScreenshotService class is the test target
 *   - Mock CdpService to simulate Page.captureScreenshot
 *   - Verify base64-encoded image data retrieval and Buffer conversion
 */

import { ScreenshotService } from '../../src/services/screenshotService';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('ScreenshotService - screenshot feature (Step 8)', () => {
    let screenshotService: ScreenshotService;
    let mockCdpService: jest.Mocked<CdpService>;

    // Dummy Base64 image data for testing (small 1x1 pixel PNG)
    const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    beforeEach(() => {
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────────────
    // Test 1: Capture a screenshot and return a Buffer
    // ──────────────────────────────────────────────────────
    it('captures a screenshot and returns a Buffer', async () => {
        // Mock Page.captureScreenshot to return base64 data
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
    // Test 2: Page.captureScreenshot is called with correct parameters
    // ──────────────────────────────────────────────────────
    it('calls captureScreenshot with the correct CDP command and parameters', async () => {
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
    // Test 3: JPEG format can be specified
    // ──────────────────────────────────────────────────────
    it('captures with JPEG format specified', async () => {
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
    // Test 4: Returns error information on CDP error
    // ──────────────────────────────────────────────────────
    it('returns success:false with error message on CDP error', async () => {
        mockCdpService.call.mockRejectedValue(new Error('CDP接続エラー'));

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.capture();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('CDP接続エラー');
    });

    // ──────────────────────────────────────────────────────
    // Test 5: Returns error information when data is empty
    // ──────────────────────────────────────────────────────
    it('returns success:false when CDP returns empty data', async () => {
        mockCdpService.call.mockResolvedValue({ data: '' });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.capture();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    // ──────────────────────────────────────────────────────
    // Test 6: getBase64() can directly retrieve Base64 string
    // ──────────────────────────────────────────────────────
    it('retrieves base64-encoded image string via getBase64()', async () => {
        mockCdpService.call.mockResolvedValue({ data: dummyBase64 });

        screenshotService = new ScreenshotService({ cdpService: mockCdpService });
        const result = await screenshotService.getBase64();

        expect(result).toBe(dummyBase64);
    });

    // ──────────────────────────────────────────────────────
    // Test 7: Capture with a specified clip region
    // ──────────────────────────────────────────────────────
    it('captures with a specified clip region', async () => {
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
