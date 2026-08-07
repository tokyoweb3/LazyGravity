import { EventEmitter } from 'events';

jest.mock('http', () => ({
    get: jest.fn(),
}));
jest.mock('child_process', () => ({
    execFile: jest.fn(),
    spawn: jest.fn(),
}));
jest.mock('../../src/utils/pathUtils', () => ({
    ...jest.requireActual('../../src/utils/pathUtils'),
    getAntigravityCliPath: jest.fn(() => '/mock/antigravity'),
}));

import * as http from 'http';
import { execFile, spawn } from 'child_process';
import {
    ensureAntigravityRunning,
    startAntigravity,
    stopAntigravity,
} from '../../src/services/antigravityLauncher';
import { logger } from '../../src/utils/logger';

function mockHttpSuccessOnce(port: number, payload: unknown = []): void {
    (http.get as unknown as jest.Mock).mockImplementationOnce((url: string, cb: (res: EventEmitter) => void) => {
        expect(url).toMatch(new RegExp(`http://127\\.0\\.0\\.1:${port}/json/(list|version)`));

        const req = new EventEmitter() as EventEmitter & {
            setTimeout: (ms: number, handler: () => void) => void;
            destroy: jest.Mock;
        };
        req.setTimeout = (_ms: number, _handler: () => void) => { };
        req.destroy = jest.fn();

        const res = new EventEmitter();
        cb(res);
        process.nextTick(() => {
            res.emit('data', JSON.stringify(payload));
            res.emit('end');
        });

        return req;
    });
}

function mockHttpErrorOnce(port: number): void {
    (http.get as unknown as jest.Mock).mockImplementationOnce((url: string) => {
        expect(url).toMatch(new RegExp(`http://127\\.0\\.0\\.1:${port}/json/(list|version)`));
        const req = new EventEmitter() as EventEmitter & {
            setTimeout: (ms: number, handler: () => void) => void;
            destroy: jest.Mock;
        };
        req.setTimeout = () => {};
        req.destroy = jest.fn();
        process.nextTick(() => req.emit('error', new Error('connect failed')));
        return req;
    });
}

function mockHttpErrorAlways(): void {
    (http.get as unknown as jest.Mock).mockImplementation((url: string, _cb: (res: EventEmitter) => void) => {
        expect(url).toMatch(/http:\/\/127\.0\.0\.1:\d+\/json\/(list|version)/);

        const req = new EventEmitter() as EventEmitter & {
            setTimeout: (ms: number, handler: () => void) => void;
            destroy: jest.Mock;
        };
        req.setTimeout = (_ms: number, _handler: () => void) => { };
        req.destroy = jest.fn();

        process.nextTick(() => {
            req.emit('error', new Error('connect failed'));
        });
        return req;
    });
}

describe('ensureAntigravityRunning', () => {
    let consoleDebugSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        logger.setLogLevel('debug');
        consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => { });
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        logger.setLogLevel('info');
        consoleDebugSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('stops scanning when the first port responds', async () => {
        mockHttpSuccessOnce(9222);

        await ensureAntigravityRunning();

        expect(http.get).toHaveBeenCalledTimes(1);
        expect(consoleDebugSpy).toHaveBeenCalledWith(
            expect.stringContaining('\x1b[2m[DEBUG]\x1b[0m'),
            expect.stringContaining('[AntigravityLauncher] OK — Port 9222 responding')
        );
    });

    it('outputs a warning log when all ports fail', async () => {
        mockHttpErrorAlways();

        await ensureAntigravityRunning();

        expect(http.get).toHaveBeenCalledTimes(6);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('\x1b[33m[WARN]\x1b[0m'),
            expect.stringContaining('  Antigravity CDP ports are not responding')
        );
    });
});

describe('Antigravity lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not launch when the requested CDP port is already running', async () => {
        mockHttpSuccessOnce(9222);

        await expect(startAntigravity(9222)).resolves.toBe('already-running');

        expect(spawn).not.toHaveBeenCalled();
    });

    it('launches with the platform resolver when no path override is configured', async () => {
        const originalPath = process.env.ANTIGRAVITY_PATH;
        delete process.env.ANTIGRAVITY_PATH;

        mockHttpErrorOnce(9222);
        mockHttpSuccessOnce(9222);
        (spawn as unknown as jest.Mock).mockReturnValue({ unref: jest.fn(), on: jest.fn() });

        try {
            await expect(startAntigravity(9222)).resolves.toBe('started');
            expect(spawn).toHaveBeenCalledWith(
                '/mock/antigravity',
                ['--remote-debugging-port=9222'],
                expect.objectContaining({ detached: true }),
            );
        } finally {
            if (originalPath === undefined) delete process.env.ANTIGRAVITY_PATH;
            else process.env.ANTIGRAVITY_PATH = originalPath;
        }
    });

    function mockStopExecFile() {
        (execFile as unknown as jest.Mock).mockImplementation(
            (file: string, _args: string[], optionsOrCallback: unknown, callback?: Function) => {
                const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
                if (file === 'lsof') {
                    cb!(null, '12345\n');
                } else {
                    cb!();
                }
            }
        );
    }
    it('reports already stopped when the requested CDP port is unavailable', async () => {
        mockHttpErrorAlways();

        await expect(stopAntigravity(9222)).resolves.toBe('already-stopped');

        expect(execFile).not.toHaveBeenCalled();
    });

    it('stops the process owning the requested CDP port', async () => {
        mockHttpSuccessOnce(9222);
        mockHttpSuccessOnce(9222, { Browser: 'Antigravity IDE' });
        mockStopExecFile();

        await expect(stopAntigravity(9222)).resolves.toBe('stopped');

        const isWindows = process.platform === 'win32';
        if (isWindows) {
            expect(execFile).toHaveBeenCalledWith(
                'powershell.exe',
                expect.arrayContaining(['-Command', expect.stringContaining('LocalPort 9222')]),
                expect.objectContaining({ windowsHide: true }),
                expect.any(Function),
            );
        } else {
            expect(execFile).toHaveBeenCalledWith(
                'lsof',
                ['-tiTCP:9222', '-sTCP:LISTEN'],
                expect.any(Function),
            );
            expect(execFile).toHaveBeenCalledWith(
                'kill',
                ['-TERM', '12345'],
                expect.any(Function),
            );
        }
    });

    it('refuses to stop a non-Antigravity CDP listener', async () => {
        mockHttpSuccessOnce(9222);
        mockHttpSuccessOnce(9222, { Browser: 'Google Chrome' });

        await expect(stopAntigravity(9222)).rejects.toThrow('Refusing to stop non-Antigravity');
        expect(execFile).not.toHaveBeenCalled();
    });
    it('stops the process when only User-Agent contains Antigravity', async () => {
        mockHttpSuccessOnce(9222);
        mockHttpSuccessOnce(9222, { Browser: 'Chrome/142.0.0.0', 'User-Agent': 'Mozilla/5.0 (...) Chrome/142.0.0.0 AntigravityIDE/2.0' });
        mockStopExecFile();

        await expect(stopAntigravity(9222)).resolves.toBe('stopped');
    });
});
