import { loadConfig } from '../src/utils/config';

describe('Config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('throws an error if DISCORD_TOKEN is missing', () => {
        delete process.env.DISCORD_TOKEN;
        process.env.ALLOWED_USER_IDS = '123456';
        process.env.CLIENT_ID = 'client123';
        expect(() => loadConfig()).toThrow('Missing required environment variable: DISCORD_TOKEN');
    });

    it('throws an error if CLIENT_ID is missing', () => {
        process.env.DISCORD_TOKEN = 'token';
        process.env.ALLOWED_USER_IDS = '123456';
        delete process.env.CLIENT_ID;
        expect(() => loadConfig()).toThrow('Missing required environment variable: CLIENT_ID');
    });

    it('throws an error if ALLOWED_USER_IDS is missing', () => {
        process.env.DISCORD_TOKEN = 'token';
        process.env.CLIENT_ID = 'client123';
        delete process.env.ALLOWED_USER_IDS;
        expect(() => loadConfig()).toThrow('Missing required environment variable: ALLOWED_USER_IDS');
    });

    it('returns valid config if all required variables are set', () => {
        process.env.DISCORD_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1,user2';
        process.env.WORKSPACE_BASE_DIR = '/custom/dir';

        const config = loadConfig();
        expect(config.discordToken).toEqual('secret_token');
        expect(config.clientId).toEqual('client123');
        expect(config.allowedUserIds).toEqual(['user1', 'user2']);
        expect(config.workspaceBaseDir).toEqual('/custom/dir');
    });

    it('returns default workspace base dir if not set', () => {
        process.env.DISCORD_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        delete process.env.WORKSPACE_BASE_DIR;

        const config = loadConfig();
        expect(config.workspaceBaseDir).toBeDefined();
        expect(typeof config.workspaceBaseDir).toBe('string');
    });

    it('GUILD_IDは省略可能であること', () => {
        process.env.DISCORD_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        delete process.env.GUILD_ID;

        const config = loadConfig();
        expect(config.guildId).toBeUndefined();
    });

    it('GUILD_IDが設定されている場合は取得できること', () => {
        process.env.DISCORD_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        process.env.GUILD_ID = 'guild123';

        const config = loadConfig();
        expect(config.guildId).toEqual('guild123');
    });
});
