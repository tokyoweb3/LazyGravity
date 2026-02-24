import { loadConfig, resolveResponseDeliveryMode } from '../src/utils/config';

// Prevent ~/.lazy-gravity/config.json from leaking real credentials into tests.
// Override ConfigLoader.load to pass empty persisted config.
jest.mock('../src/utils/configLoader', () => {
    const actual = jest.requireActual('../src/utils/configLoader');
    return {
        ...actual,
        ConfigLoader: {
            ...actual.ConfigLoader,
            load: () => actual.ConfigLoader.load({}),
        },
    };
});

describe('Config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('throws an error if DISCORD_BOT_TOKEN is missing', () => {
        delete process.env.DISCORD_BOT_TOKEN;
        process.env.ALLOWED_USER_IDS = '123456';
        process.env.CLIENT_ID = 'client123';
        expect(() => loadConfig()).toThrow('Missing required environment variable: DISCORD_BOT_TOKEN');
    });

    it('throws an error if CLIENT_ID is missing', () => {
        process.env.DISCORD_BOT_TOKEN = 'token';
        process.env.ALLOWED_USER_IDS = '123456';
        delete process.env.CLIENT_ID;
        expect(() => loadConfig()).toThrow('Missing required environment variable: CLIENT_ID');
    });

    it('throws an error if ALLOWED_USER_IDS is missing', () => {
        process.env.DISCORD_BOT_TOKEN = 'token';
        process.env.CLIENT_ID = 'client123';
        delete process.env.ALLOWED_USER_IDS;
        expect(() => loadConfig()).toThrow('Missing required environment variable: ALLOWED_USER_IDS');
    });

    it('returns valid config if all required variables are set', () => {
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
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
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        delete process.env.WORKSPACE_BASE_DIR;

        const config = loadConfig();
        expect(config.workspaceBaseDir).toBeDefined();
        expect(typeof config.workspaceBaseDir).toBe('string');
    });

    it('GUILD_ID is optional', () => {
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        delete process.env.GUILD_ID;

        const config = loadConfig();
        expect(config.guildId).toBeUndefined();
    });

    it('returns GUILD_ID when it is set', () => {
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        process.env.GUILD_ID = 'guild123';

        const config = loadConfig();
        expect(config.guildId).toEqual('guild123');
    });

    it('defaults AUTO_APPROVE_FILE_EDITS to false when not set', () => {
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        delete process.env.AUTO_APPROVE_FILE_EDITS;

        const config = loadConfig();
        expect(config.autoApproveFileEdits).toBe(false);
    });

    it('enables AUTO_APPROVE_FILE_EDITS when set to true', () => {
        process.env.DISCORD_BOT_TOKEN = 'secret_token';
        process.env.CLIENT_ID = 'client123';
        process.env.ALLOWED_USER_IDS = 'user1';
        process.env.AUTO_APPROVE_FILE_EDITS = 'true';

        const config = loadConfig();
        expect(config.autoApproveFileEdits).toBe(true);
    });

    it('normalizes response delivery mode to stream even when set to final-only', () => {
        process.env.LAZYGRAVITY_RESPONSE_DELIVERY = 'final-only';
        expect(resolveResponseDeliveryMode()).toBe('stream');

        process.env.LAZYGRAVITY_RESPONSE_DELIVERY = 'stream';
        expect(resolveResponseDeliveryMode()).toBe('stream');

        delete process.env.LAZYGRAVITY_RESPONSE_DELIVERY;
        process.env.LAZYGRAVITY_RESPONSE_MODE = 'final-only';
        expect(resolveResponseDeliveryMode()).toBe('stream');
    });
});
