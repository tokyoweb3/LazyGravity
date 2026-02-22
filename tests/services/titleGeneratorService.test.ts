import { TitleGeneratorService } from '../../src/services/titleGeneratorService';

describe('TitleGeneratorService', () => {
    describe('generateTitle - フォールバック（CDP無し）', () => {
        let service: TitleGeneratorService;

        beforeEach(() => {
            service = new TitleGeneratorService(null);
        });

        it('プロンプトから短いタイトルを生成すること', async () => {
            const title = await service.generateTitle('React認証バグを修正したい');
            expect(title).toBeTruthy();
            expect(title.length).toBeGreaterThan(0);
            expect(title.length).toBeLessThanOrEqual(80);
        });

        it('ワークスペースプレフィックスを除去すること', async () => {
            const title = await service.generateTitle('[ワークスペース: /Users/test/Code/project]\nReactの認証バグ');
            expect(title).not.toContain('ワークスペース');
            expect(title).toBeTruthy();
        });

        it('空のプロンプトの場合はuntitledを返すこと', async () => {
            const title = await service.generateTitle('');
            expect(title).toBe('untitled');
        });

        it('特殊文字のみのプロンプトの場合はuntitledを返すこと', async () => {
            const title = await service.generateTitle('!!!@@@###');
            expect(title).toBe('untitled');
        });

        it('長いプロンプトは80文字以内に切り詰めること', async () => {
            const longPrompt = 'a'.repeat(200);
            const title = await service.generateTitle(longPrompt);
            expect(title.length).toBeLessThanOrEqual(80);
        });
    });

    describe('sanitizeForChannelName', () => {
        let service: TitleGeneratorService;

        beforeEach(() => {
            service = new TitleGeneratorService(null);
        });

        it('スペースをハイフンに変換すること', () => {
            expect(service.sanitizeForChannelName('hello world')).toBe('hello-world');
        });

        it('大文字を小文字に変換すること', () => {
            expect(service.sanitizeForChannelName('Hello World')).toBe('hello-world');
        });

        it('日本語文字を保持すること', () => {
            const result = service.sanitizeForChannelName('認証バグ修正');
            expect(result).toBe('認証バグ修正');
        });

        it('Discordで使えない文字をハイフンに変換すること', () => {
            const result = service.sanitizeForChannelName('test@#$%ing');
            expect(result).not.toContain('@');
            expect(result).not.toContain('#');
        });

        it('連続するハイフンを1つにまとめること', () => {
            expect(service.sanitizeForChannelName('a---b')).toBe('a-b');
        });

        it('先頭・末尾のハイフンを除去すること', () => {
            expect(service.sanitizeForChannelName('-test-')).toBe('test');
        });

        it('空文字の場合はuntitledを返すこと', () => {
            expect(service.sanitizeForChannelName('')).toBe('untitled');
        });
    });

    describe('generateTitle - CDP経由', () => {
        it('CDP呼び出しが失敗した場合フォールバックすること', async () => {
            const mockCdp = {
                getPrimaryContextId: jest.fn().mockReturnValue(null),
                call: jest.fn().mockRejectedValue(new Error('CDP error')),
            } as any;

            const service = new TitleGeneratorService(mockCdp);
            const title = await service.generateTitle('テスト用プロンプト');
            expect(title).toBeTruthy();
            expect(title).not.toBe('untitled');
        });

        it('CDPがnull値を返した場合フォールバックすること', async () => {
            const mockCdp = {
                getPrimaryContextId: jest.fn().mockReturnValue(null),
                call: jest.fn().mockResolvedValue({ result: { value: { ok: false } } }),
            } as any;

            const service = new TitleGeneratorService(mockCdp);
            const title = await service.generateTitle('テスト用プロンプト');
            expect(title).toBeTruthy();
        });
    });
});
