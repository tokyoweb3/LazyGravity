import * as fs from 'fs';
import * as path from 'path';

describe('ConfigLoader persistence', () => {
    const originalEnv = process.env;
    let tmpHome: string;

    beforeEach(() => {
        jest.resetModules();
        tmpHome = fs.mkdtempSync(path.join('/tmp', 'lazy-gravity-config-loader-'));
        process.env = { ...originalEnv };
        delete process.env.ANTIGRAVITY_ACCOUNTS;
        delete process.env.DISCORD_BOT_TOKEN;
        delete process.env.CLIENT_ID;
        delete process.env.ALLOWED_USER_IDS;
        jest.doMock('os', () => {
            const actual = jest.requireActual('os');
            return {
                ...actual,
                homedir: () => tmpHome,
            };
        });
    });

    afterEach(() => {
        jest.dontMock('os');
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('saves antigravityAccounts as structured JSON in config.json', () => {
        const { ConfigLoader } = require('../src/utils/configLoader');

        ConfigLoader.save({
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default' },
                { name: 'work4', cdpPort: 9666, userDataDir: '/tmp/work4' },
            ],
        });

        const saved = JSON.parse(
            fs.readFileSync(path.join(tmpHome, '.lazy-gravity', 'config.json'), 'utf-8'),
        );

        expect(saved.antigravityAccounts).toEqual([
            { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default' },
            { name: 'work4', cdpPort: 9666, userDataDir: '/tmp/work4' },
        ]);
    });

    it('still reads legacy string antigravityAccounts from persisted config', () => {
        const configDir = path.join(tmpHome, '.lazy-gravity');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'config.json'),
            JSON.stringify({
                discordToken: 'token',
                clientId: 'client123',
                allowedUserIds: ['user1'],
                antigravityAccounts: 'default:9222@/tmp/default,work4:9666@/tmp/work4',
            }, null, 2),
        );

        const { ConfigLoader } = require('../src/utils/configLoader');
        const config = ConfigLoader.load();

        expect(config.antigravityAccounts).toEqual([
            { name: 'default', cdpPort: 9222, userDataDir: '/tmp/default' },
            { name: 'work4', cdpPort: 9666, userDataDir: '/tmp/work4' },
        ]);
    });
});
