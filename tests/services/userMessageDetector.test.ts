import { UserMessageDetector, UserMessageInfo } from '../../src/services/userMessageDetector';
import { CdpService } from '../../src/services/cdpService';

jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

/** Advance fake timers and flush microtasks */
async function tick(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
}

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

    it('first poll primes existing DOM state without firing callback', async () => {
        const onUserMessage = jest.fn();
        mockCdpService.call.mockResolvedValue({
            result: { value: { text: 'Existing message' } },
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // First poll — priming, should NOT fire callback
        await tick(100);
        expect(onUserMessage).not.toHaveBeenCalled();

        // Second poll — same message, still no callback (duplicate)
        await tick(100);
        expect(onUserMessage).not.toHaveBeenCalled();

        await detector.stop();
    });

    it('detects a new user message after priming', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                // Priming poll: existing message in DOM
                return { result: { value: { text: 'Old message' } } };
            }
            return { result: { value: { text: 'Hello from PC' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();
        expect(detector.isActive()).toBe(true);

        // First poll — priming
        await tick(100);
        expect(onUserMessage).not.toHaveBeenCalled();

        // Second poll — new message detected
        await tick(100);
        expect(onUserMessage).toHaveBeenCalledWith({ text: 'Hello from PC' });

        await detector.stop();
        expect(detector.isActive()).toBe(false);
    });

    it('primes with empty DOM and detects first real message', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // empty DOM
            }
            return { result: { value: { text: 'First message' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // First poll — priming with empty DOM
        await tick(100);
        expect(onUserMessage).not.toHaveBeenCalled();

        // Second poll — first real message
        await tick(100);
        expect(onUserMessage).toHaveBeenCalledWith({ text: 'First message' });

        await detector.stop();
    });

    it('does not call onUserMessage for duplicate messages', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // priming: empty
            }
            return { result: { value: { text: 'Same message' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // Priming poll
        await tick(100);

        // First real poll
        await tick(100);

        // Second real poll — same message
        await tick(100);

        expect(onUserMessage).toHaveBeenCalledTimes(1);

        await detector.stop();
    });

    it('skips messages matching echo hashes', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // priming: empty
            }
            return { result: { value: { text: 'Echoed message' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        // Register the echo hash before starting
        detector.addEchoHash('Echoed message');
        detector.start();

        // Priming poll
        await tick(100);

        // Real poll — echo, should be skipped
        await tick(100);

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

        await tick(100);

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

        await tick(100);

        expect(onUserMessage).not.toHaveBeenCalled();

        await detector.stop();
    });

    it('detects new message after different message', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // priming: empty
            }
            if (callCount === 2) {
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

        // Priming poll
        await tick(100);

        // First real message
        await tick(100);

        // Second real message — different
        await tick(100);

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

    it('seenHashes prevents re-detection of old messages after a different message appears', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // priming: empty
            }
            if (callCount === 2) {
                return { result: { value: { text: 'Message A' } } };
            }
            if (callCount === 3) {
                return { result: { value: { text: 'Message B' } } };
            }
            // Poll 4: DOM reverts back to Message A (e.g., transient DOM state)
            return { result: { value: { text: 'Message A' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        detector.start();

        // Priming poll
        await tick(100);

        // Poll: Message A — detected
        await tick(100);

        // Poll: Message B — detected
        await tick(100);

        // Poll: Message A again — should be skipped by seenHashes
        await tick(100);

        expect(onUserMessage).toHaveBeenCalledTimes(2);
        expect(onUserMessage).toHaveBeenNthCalledWith(1, { text: 'Message A' });
        expect(onUserMessage).toHaveBeenNthCalledWith(2, { text: 'Message B' });

        await detector.stop();
    });

    it('seenHashes are cleared on restart', async () => {
        const onUserMessage = jest.fn();
        let callCount = 0;
        mockCdpService.call.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { result: { value: null } }; // priming: empty (session 1)
            }
            if (callCount === 2) {
                return { result: { value: { text: 'Restart message' } } };
            }
            if (callCount === 3) {
                return { result: { value: null } }; // priming: empty (session 2)
            }
            return { result: { value: { text: 'Restart message' } } };
        });

        const detector = new UserMessageDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 100,
            onUserMessage,
        });

        // First session
        detector.start();
        await tick(100); // priming
        await tick(100); // detect
        expect(onUserMessage).toHaveBeenCalledTimes(1);
        detector.stop();

        // Second session — same message should be detected again after restart
        detector.start();
        await tick(100); // priming
        await tick(100); // detect
        expect(onUserMessage).toHaveBeenCalledTimes(2);

        await detector.stop();
    });
});
