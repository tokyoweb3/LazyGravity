import { UserMessageDetector, UserMessageInfo } from '../../src/services/userMessageDetector';
import { CdpService } from '../../src/services/cdpService';

jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('UserMessageDetector', () => {
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(42);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('detects a new user message and calls onUserMessage', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockResolvedValue({
            result: { value: { text: 'Hello from PC' } },
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();
        expect(detector.isActive()).toBe(true);

        // Advance timer to trigger first poll
        jest.advanceTimersByTime(100);
        await Promise.resolve(); // flush microtasks
        await Promise.resolve();

        expect(onUserMessage).toHaveBeenCalledWith({ text: 'Hello from PC' });

        await detector.stop();
        expect(detector.isActive()).toBe(false);
    });

    it('does not call onUserMessage for duplicate messages', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockResolvedValue({
            result: { value: { text: 'Same message' } },
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // First poll
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        // Second poll — same message
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        expect(onUserMessage).toHaveBeenCalledTimes(1);

        await detector.stop();
    });

    it('skips messages matching echo hashes', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockResolvedValue({
            result: { value: { text: 'Echoed message' } },
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        // Register the echo hash before starting
        detector.addEchoHash('Echoed message');
        detector.start();

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        expect(onUserMessage).not.toHaveBeenCalled();

        await detector.stop();
    });

    it('handles CDP errors gracefully', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockRejectedValue(new Error('CDP timeout'));

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        // Should not throw, detector should remain active
        expect(detector.isActive()).toBe(true);
        expect(onUserMessage).not.toHaveBeenCalled();

        await detector.stop();
    });

    it('handles null result from CDP', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockResolvedValue({
            result: { value: null },
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        expect(onUserMessage).not.toHaveBeenCalled();

        await detector.stop();
    });

    it('detects new message after different message', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: { text: 'First message' } } };
            }
            return { result: { value: { text: 'Second message' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // First poll
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        // Second poll — different message
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        expect(onUserMessage).toHaveBeenCalledTimes(2);
        expect(onUserMessage).toHaveBeenNthCalledWith(1, { text: 'First message' });
        expect(onUserMessage).toHaveBeenNthCalledWith(2, { text: 'Second message' });

        await detector.stop();
    });

    it('start() is idempotent', () => {
        const onUserMessage = jest.fn();
        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();
        detector.start(); // should not throw or create double polling

        expect(detector.isActive()).toBe(true);

        detector.stop();
    });
});
