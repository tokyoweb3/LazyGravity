import { EventEmitter } from 'events';

jest.mock('http', () => ({
    get: jest.fn(),
}));

import * as http from 'http';
import { ensureAntigravityRunning } from '../../src/services/antigravityLauncher';

function mockHttpSuccessOnce(port: number): void {
    (http.get as unknown as jest.Mock).mockImplementationOnce((url: string, cb: (res: EventEmitter) => void) => {
        expect(url).toBe(`http://127.0.0.1:${port}/json/list`);

        const req = new EventEmitter() as EventEmitter & {
            setTimeout: (ms: number, handler: () => void) => void;
            destroy: jest.Mock;
        };
        req.setTimeout = (_ms: number, _handler: () => void) => { };
        req.destroy = jest.fn();

        const res = new EventEmitter();
        cb(res);
        process.nextTick(() => {
            res.emit('data', '[]');
            res.emit('end');
        });

        return req;
    });
}

function mockHttpErrorAlways(): void {
    (http.get as unknown as jest.Mock).mockImplementation((url: string, _cb: (res: EventEmitter) => void) => {
        expect(url).toMatch(/http:\/\/127\.0\.0\.1:\d+\/json\/list/);

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
    let consoleSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => { });
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('stops scanning when the first port responds', async () => {
        mockHttpSuccessOnce(9222);

        await ensureAntigravityRunning();

        expect(http.get).toHaveBeenCalledTimes(1);
        expect(consoleSpy).toHaveBeenCalledWith('\x1b[36m[INFO]\x1b[0m', '[AntigravityLauncher] OK — Port 9222 responding');
    });

    it('outputs a warning log when all ports fail', async () => {
        mockHttpErrorAlways();

        await ensureAntigravityRunning();

        expect(http.get).toHaveBeenCalledTimes(6);
        expect(consoleWarnSpy).toHaveBeenCalledWith('\x1b[33m[WARN]\x1b[0m', '  Antigravity CDP ports are not responding');
    });
});
