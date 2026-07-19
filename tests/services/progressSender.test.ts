import { ProgressSender } from '../../src/services/progressSender';

describe('ProgressSender', () => {
    let mockMessage: any;
    let mockReply: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();

        mockReply = jest.fn().mockResolvedValue(true);

        mockMessage = {
            reply: mockReply,
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('should throttle reply calls', async () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.append('chunk 2\n');
        sender.append('chunk 3\n');

        // Verify it has not been called yet
        expect(mockReply).not.toHaveBeenCalled();

        // Advance by 3000ms
        jest.advanceTimersByTime(3000);
        await (sender as any).promiseChain;

        // Verify it was called once, and the buffered content was sent all at once
        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\nchunk 2\nchunk 3\n')
        }));
    });

    it('should send immediately if forced', async () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.forceEmit();
        await (sender as any).promiseChain;

        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\n')
        }));
    });

    it('should fallback to reply or split if max length is exceeded', async () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000, maxLength: 50 });

        // Add a string longer than 50 characters to the buffer
        const longString = 'This is a very long string that will definitely exceed the fifty character limit for this test case.';

        sender.append(longString);

        jest.advanceTimersByTime(3000);
        await (sender as any).promiseChain;

        const expectedChunks = Math.ceil(longString.length / 50);
        expect(mockReply).toHaveBeenCalledTimes(expectedChunks);

        const sentBody = mockReply.mock.calls
            .map((call) => String(call[0]?.content ?? ''))
            .join('')
            .replace(/```/g, '')
            .replace(/\n/g, '');
        expect(sentBody).toContain(longString);
    });

    it('should use custom send function when provided', async () => {
        const mockSend = jest.fn().mockResolvedValue(undefined);
        const sender = new ProgressSender({
            send: mockSend,
            throttleMs: 1000,
            wrapInCodeBlock: false,
        });

        sender.append('line 1\n');
        jest.advanceTimersByTime(1000);
        await (sender as any).promiseChain;

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith('line 1\n');
        expect(mockReply).not.toHaveBeenCalled();
    });

    it('should send chunks sequentially in order and tolerate individual send failures', async () => {
        const sentChunks: string[] = [];
        const mockSend = jest.fn().mockImplementation(async (content: string) => {
            if (content.includes('fail')) {
                throw new Error('Send failed');
            }
            sentChunks.push(content);
        });

        const sender = new ProgressSender({
            send: mockSend,
            throttleMs: 1000,
            maxLength: 5,
            wrapInCodeBlock: false,
        });

        sender.append('12345fail7890');
        jest.advanceTimersByTime(1000);

        // Wait for all promises in the chain to resolve
        await (sender as any).promiseChain;

        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(sentChunks).toEqual(['12345', '890']);
    });
});
