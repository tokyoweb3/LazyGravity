import { ProgressSender } from '../../src/services/progressSender';

describe('ProgressSender', () => {
    let mockMessage: any;
    let mockEdit: jest.Mock;
    let mockReply: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();

        mockEdit = jest.fn().mockResolvedValue(true);
        mockReply = jest.fn().mockResolvedValue(true);

        mockMessage = {
            edit: mockEdit,
            reply: mockReply,
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('should throttle edit calls', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.append('chunk 2\n');
        sender.append('chunk 3\n');

        // 呼ばれていないことを確認
        expect(mockEdit).not.toHaveBeenCalled();

        // 3000ms 進める
        jest.advanceTimersByTime(3000);

        // 1度だけ呼ばれ、バッファされた内容が一気に送られることを確認
        expect(mockEdit).toHaveBeenCalledTimes(1);
        expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\nchunk 2\nchunk 3\n')
        }));
    });

    it('should send immediately if forced', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000 });

        sender.append('chunk 1\n');
        sender.forceEmit();

        expect(mockEdit).toHaveBeenCalledTimes(1);
        expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('chunk 1\n')
        }));
    });

    it('should fallback to reply or split if max length is exceeded', () => {
        const sender = new ProgressSender({ message: mockMessage, throttleMs: 3000, maxLength: 50 });

        // 50文字以上の長文をバッファに追加
        const longString = 'This is a very long string that will definitely exceed the fifty character limit for this test case.';

        sender.append(longString);

        jest.advanceTimersByTime(3000);

        // 最大文字数を超えた場合、元のメッセージは「長すぎるため分割・ファイル化します」などで編集 or 別対応される想定
        // ここでは単純に reply 等で分割して飛ばされる挙動を期待するか、テキストファイルになるかを検証
        // 簡単のため「新しいメッセージを reply として送信する」動作を期待
        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining(longString) // 分割されて送られたり、または添付ファイルで送られたりする
        }));
    });
});
