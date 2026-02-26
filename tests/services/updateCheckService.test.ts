import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
    checkForUpdates,
    fetchLatestVersion,
    shouldCheckForUpdates,
    UPDATE_CHECK_FILE,
    COOLDOWN_MS,
} from '../../src/services/updateCheckService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('https');
jest.mock('fs');
jest.mock('os');

const mockedHttps = jest.mocked(https);
const mockedFs = jest.mocked(fs);
const mockedOs = jest.mocked(os);

// Stable home directory for all tests
const FAKE_HOME = '/home/testuser';
const CACHE_PATH = path.join(FAKE_HOME, '.lazy-gravity', UPDATE_CHECK_FILE);

beforeEach(() => {
    jest.clearAllMocks();
    mockedOs.homedir.mockReturnValue(FAKE_HOME);
});

// ---------------------------------------------------------------------------
// Helper: build a fake HTTP response
// ---------------------------------------------------------------------------

function fakeResponse(statusCode: number, body: string) {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = statusCode;
    // Emit data + end on next tick so listeners are registered first
    process.nextTick(() => {
        res.emit('data', body);
        res.emit('end');
    });
    return res;
}

function fakeRequest(
    statusCode: number,
    body: string,
): { req: EventEmitter; setup: () => void } {
    const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
    req.end = jest.fn();
    const setup = () => {
        mockedHttps.get.mockImplementation((_url: any, cb: any) => {
            const res = fakeResponse(statusCode, body);
            cb(res);
            return req as any;
        });
    };
    return { req, setup };
}

// ---------------------------------------------------------------------------
// shouldCheckForUpdates
// ---------------------------------------------------------------------------

describe('shouldCheckForUpdates', () => {
    it('returns true when no cache file exists', () => {
        mockedFs.existsSync.mockReturnValue(false);
        expect(shouldCheckForUpdates()).toBe(true);
    });

    it('returns true when the cache file has an old timestamp', () => {
        mockedFs.existsSync.mockReturnValue(true);
        const oldTimestamp = Date.now() - COOLDOWN_MS - 1000;
        mockedFs.readFileSync.mockReturnValue(
            JSON.stringify({ lastCheck: oldTimestamp }),
        );
        expect(shouldCheckForUpdates()).toBe(true);
    });

    it('returns false when the cache file has a recent timestamp', () => {
        mockedFs.existsSync.mockReturnValue(true);
        const recentTimestamp = Date.now() - 1000; // 1 second ago
        mockedFs.readFileSync.mockReturnValue(
            JSON.stringify({ lastCheck: recentTimestamp }),
        );
        expect(shouldCheckForUpdates()).toBe(false);
    });

    it('returns true when the cache file is corrupted', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue('not-json');
        expect(shouldCheckForUpdates()).toBe(true);
    });

    it('returns true when readFileSync throws', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockImplementation(() => {
            throw new Error('EACCES');
        });
        expect(shouldCheckForUpdates()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// fetchLatestVersion
// ---------------------------------------------------------------------------

describe('fetchLatestVersion', () => {
    it('returns the version from npm registry', async () => {
        const { setup } = fakeRequest(200, JSON.stringify({ version: '1.2.3' }));
        setup();

        const version = await fetchLatestVersion();
        expect(version).toBe('1.2.3');
        expect(mockedHttps.get).toHaveBeenCalledWith(
            'https://registry.npmjs.org/lazy-gravity/latest',
            expect.any(Function),
        );
    });

    it('rejects on non-200 status code', async () => {
        const { setup } = fakeRequest(404, 'Not Found');
        setup();

        await expect(fetchLatestVersion()).rejects.toThrow('HTTP 404');
    });

    it('rejects on invalid JSON response', async () => {
        const { setup } = fakeRequest(200, 'not-json');
        setup();

        await expect(fetchLatestVersion()).rejects.toThrow();
    });

    it('rejects on network error', async () => {
        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn();

        mockedHttps.get.mockImplementation((_url: any, _cb: any) => {
            process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
            return req as any;
        });

        await expect(fetchLatestVersion()).rejects.toThrow('ECONNREFUSED');
    });

    it('rejects on timeout', async () => {
        const req = new EventEmitter() as EventEmitter & {
            end: jest.Mock;
            destroy: jest.Mock;
        };
        req.end = jest.fn();
        req.destroy = jest.fn();

        mockedHttps.get.mockImplementation((_url: any, _cb: any) => {
            process.nextTick(() => req.emit('timeout'));
            return req as any;
        });

        await expect(fetchLatestVersion()).rejects.toThrow('timed out');
    });
});

// ---------------------------------------------------------------------------
// checkForUpdates (integration of the above)
// ---------------------------------------------------------------------------

describe('checkForUpdates', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

    afterEach(() => {
        consoleInfoSpy.mockClear();
    });

    afterAll(() => {
        consoleInfoSpy.mockRestore();
    });

    it('prints update notice when a newer version is available', async () => {
        // No cache file → should check
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const { setup } = fakeRequest(200, JSON.stringify({ version: '99.0.0' }));
        setup();

        await checkForUpdates('0.1.0');

        expect(consoleInfoSpy).toHaveBeenCalledWith(
            expect.stringContaining('Update available'),
        );
        expect(consoleInfoSpy).toHaveBeenCalledWith(
            expect.stringContaining('99.0.0'),
        );
        // Should write cache
        expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
            CACHE_PATH,
            expect.stringContaining('lastCheck'),
            'utf-8',
        );
    });

    it('does nothing when already on latest version', async () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const { setup } = fakeRequest(200, JSON.stringify({ version: '0.1.0' }));
        setup();

        await checkForUpdates('0.1.0');

        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('does nothing when local version is newer than registry', async () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const { setup } = fakeRequest(200, JSON.stringify({ version: '0.0.9' }));
        setup();

        await checkForUpdates('0.1.0');

        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('skips check when cooldown has not elapsed', async () => {
        // Cache file exists and is recent
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(
            JSON.stringify({ lastCheck: Date.now() }),
        );

        await checkForUpdates('0.1.0');

        expect(mockedHttps.get).not.toHaveBeenCalled();
        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('silently swallows network errors', async () => {
        mockedFs.existsSync.mockReturnValue(false);

        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn();
        mockedHttps.get.mockImplementation((_url: any, _cb: any) => {
            process.nextTick(() => req.emit('error', new Error('offline')));
            return req as any;
        });

        // Should not throw
        await expect(checkForUpdates('0.1.0')).resolves.toBeUndefined();
        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('writes cache even when versions match', async () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.mkdirSync.mockReturnValue(undefined);
        mockedFs.writeFileSync.mockReturnValue(undefined);

        const { setup } = fakeRequest(200, JSON.stringify({ version: '0.1.0' }));
        setup();

        await checkForUpdates('0.1.0');

        expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
});
