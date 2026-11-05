import { EventEmitter } from 'events';
import * as http from 'http';
import { ConfigLoader } from '../../src/utils/configLoader';
import { doctorAction } from '../../src/bin/commands/doctor';
import { CDP_PORTS } from '../../src/utils/cdpPorts';

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

    it('reports malformed configuration without leaking credentials and continues diagnostics', async () => {
        const read = jest.spyOn(ConfigLoader, 'readPersisted').mockImplementation(() => {
            throw new SyntaxError('Invalid JSON near secret-test-token');
        });
        process.env.DISCORD_BOT_TOKEN = 'environment-token';
        process.env.CLIENT_ID = '123';
        process.env.ALLOWED_USER_IDS = '456';
        await doctorAction();
        const output = (console.log as jest.Mock).mock.calls.flat().join('\n');
        expect(read).toHaveBeenCalledTimes(1);
        expect(output).toContain('Config file could not be read or contains invalid JSON:');
        expect(output).toContain('Checking brain path alignment');
        expect(output).not.toContain('is NOT set');
        expect(output).not.toContain('secret-test-token');
        expect(output).not.toContain('environment-token');
        for (const port of CDP_PORTS) {
            expect(http.get).toHaveBeenCalledWith(`http://127.0.0.1:${port}/json/list`, expect.any(Function));
        }
        expect(process.exitCode).toBe(1);
    });
});
