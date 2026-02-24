import { TitleGeneratorService } from '../../src/services/titleGeneratorService';

describe('TitleGeneratorService', () => {
    describe('generateTitle - fallback (without CDP)', () => {
        let service: TitleGeneratorService;

        beforeEach(() => {
            service = new TitleGeneratorService();
        });

        it('generates a short title from the prompt', async () => {
            const title = await service.generateTitle('React認証バグを修正したい');
            expect(title).toBeTruthy();
            expect(title.length).toBeGreaterThan(0);
            expect(title.length).toBeLessThanOrEqual(80);
        });

        it('removes workspace prefix', async () => {
            const title = await service.generateTitle('[ワークスペース: /Users/test/Code/project]\nReactの認証バグ');
            expect(title).not.toContain('ワークスペース');
            expect(title).toBeTruthy();
        });

        it('returns untitled for an empty prompt', async () => {
            const title = await service.generateTitle('');
            expect(title).toBe('untitled');
        });

        it('returns untitled for a prompt containing only special characters', async () => {
            const title = await service.generateTitle('!!!@@@###');
            expect(title).toBe('untitled');
        });

        it('truncates a long prompt to 80 characters or less', async () => {
            const longPrompt = 'a'.repeat(200);
            const title = await service.generateTitle(longPrompt);
            expect(title.length).toBeLessThanOrEqual(80);
        });
    });

    describe('sanitizeForChannelName', () => {
        let service: TitleGeneratorService;

        beforeEach(() => {
            service = new TitleGeneratorService();
        });

        it('converts spaces to hyphens', () => {
            expect(service.sanitizeForChannelName('hello world')).toBe('hello-world');
        });

        it('converts uppercase to lowercase', () => {
            expect(service.sanitizeForChannelName('Hello World')).toBe('hello-world');
        });

        it('preserves Japanese characters', () => {
            const result = service.sanitizeForChannelName('認証バグ修正');
            expect(result).toBe('認証バグ修正');
        });

        it('converts characters not allowed in Discord to hyphens', () => {
            const result = service.sanitizeForChannelName('test@#$%ing');
            expect(result).not.toContain('@');
            expect(result).not.toContain('#');
        });

        it('collapses consecutive hyphens into one', () => {
            expect(service.sanitizeForChannelName('a---b')).toBe('a-b');
        });

        it('removes leading and trailing hyphens', () => {
            expect(service.sanitizeForChannelName('-test-')).toBe('test');
        });

        it('returns untitled for an empty string', () => {
            expect(service.sanitizeForChannelName('')).toBe('untitled');
        });
    });

    describe('generateTitle - via CDP', () => {
        it('falls back when CDP call fails', async () => {
            const mockCdp = {
                getPrimaryContextId: jest.fn().mockReturnValue(null),
                call: jest.fn().mockRejectedValue(new Error('CDP error')),
            } as any;

            const service = new TitleGeneratorService();
            const title = await service.generateTitle('テスト用プロンプト', mockCdp);
            expect(title).toBeTruthy();
            expect(title).not.toBe('untitled');
        });

        it('falls back when CDP returns a null value', async () => {
            const mockCdp = {
                getPrimaryContextId: jest.fn().mockReturnValue(null),
                call: jest.fn().mockResolvedValue({ result: { value: { ok: false } } }),
            } as any;

            const service = new TitleGeneratorService();
            const title = await service.generateTitle('テスト用プロンプト', mockCdp);
            expect(title).toBeTruthy();
        });
    });
});
