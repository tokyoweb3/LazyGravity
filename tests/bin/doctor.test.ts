import { EventEmitter } from 'events';
import * as http from 'http';
import { ConfigLoader } from '../../src/utils/configLoader';
import { doctorAction } from '../../src/bin/commands/doctor';

jest.mock('http', () => ({ get: jest.fn() }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => true) }));
jest.mock('../../src/services/artifactService', () => ({
    ArtifactService: jest.fn().mockImplementation(() => ({ getBrainBasePath: () => '/test/brain' })),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('doctor persisted credentials', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
        originalEnv = { ...process.env };
        originalExitCode = process.exitCode;
        for (const key of ['PLATFORMS', 'DISCORD_BOT_TOKEN', 'CLIENT_ID', 'ALLOWED_USER_IDS',
            'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS']) delete process.env[key];
        process.exitCode = 0;
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(ConfigLoader, 'configExists').mockReturnValue(true);
        (http.get as jest.Mock).mockImplementation((_url: string, callback: Function) => {
            const request = new EventEmitter() as any;
            request.setTimeout = jest.fn();
            const response = new EventEmitter();
            callback(response);
            process.nextTick(() => { response.emit('data', '[]'); response.emit('end'); });
            return request;
        });
    });

    afterEach(() => {
        process.env = originalEnv;
        process.exitCode = originalExitCode;
        jest.restoreAllMocks();
    });

    it('accepts Discord credentials in config.json and never prints the token', async () => {
        jest.spyOn(ConfigLoader, 'readPersisted').mockReturnValue({
            discordToken: 'secret-test-token', clientId: '123', allowedUserIds: ['456'],
        });
        await doctorAction();
        const output = (console.log as jest.Mock).mock.calls.flat().join('\n');
        expect(output).toContain('All checks passed!');
        expect(output).not.toContain('secret-test-token');
        expect(output).not.toContain('is NOT set');
        expect(process.exitCode).toBe(0);
    });

    it('checks the platform selected in config.json', async () => {
        jest.spyOn(ConfigLoader, 'readPersisted').mockReturnValue({
            platforms: ['telegram'], telegramToken: 'telegram-test-token', telegramAllowedUserIds: ['456'],
        });
        await doctorAction();
        const output = (console.log as jest.Mock).mock.calls.flat().join('\n');
        expect(output).toContain('Active platforms: telegram');
        expect(output).not.toContain('DISCORD_BOT_TOKEN');
        expect(output).toContain('All checks passed!');
    });
});
