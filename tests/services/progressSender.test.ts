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

    it('should throttle reply calls', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.append('chunk 2\n');
        sender.append('chunk 3\n');

        // 呼ばれていないことを確認
        expect(mockReply).not.toHaveBeenCalled();

        // 3000ms 進める
        jest.advanceTimersByTime(3000);

        // 1度だけ呼ばれ、バッファされた内容が一気に送られることを確認
        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\nchunk 2\nchunk 3\n')
        }));
    });

    it('should send immediately if forced', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.forceEmit();

        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\n')
        }));
    });

    it('should fallback to reply or split if max length is exceeded', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000, maxLength: 50 });

        // 50文字以上の長文をバッファに追加
        const longString = 'This is a very long string that will definitely exceed the fifty character limit for this test case.';

        sender.append(longString);

        jest.advanceTimersByTime(3000);

        const expectedChunks = Math.ceil(longString.length / 50);
        expect(mockReply).toHaveBeenCalledTimes(expectedChunks);

        const sentBody = mockReply.mock.calls
            .map((call) => String(call[0]?.content ?? ''))
            .join('')
            .replace(/```/g, '')
            .replace(/\n/g, '');
        expect(sentBody).toContain(longString);
    });

    it('should use custom send function when provided', () => {
        const mockSend = jest.fn().mockResolvedValue(undefined);
        const sender = new ProgressSender({
            send: mockSend,
            throttleMs: 1000,
            wrapInCodeBlock: false,
        });

        sender.append('line 1\n');
        jest.advanceTimersByTime(1000);

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith('line 1\n');
        expect(mockReply).not.toHaveBeenCalled();
    });
});
