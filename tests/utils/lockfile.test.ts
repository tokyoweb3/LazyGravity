import fs from 'fs';
import { acquireLock } from '../../src/utils/lockfile';

jest.mock('fs');
jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
        fn();
    } finally {
        Object.defineProperty(process, 'platform', original);
    }
}

function stubStat(overrides: Partial<fs.Stats>): fs.Stats {
    return {
        isDirectory: () => true,
        mode: 0o40700,
        uid: process.getuid ? process.getuid() : 0,
        ...overrides,
    } as fs.Stats;
}

describe('acquireLock()', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedFs.mkdirSync.mockReturnValue(undefined);
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.openSync.mockReturnValue(3 as unknown as number);
        mockedFs.writeFileSync.mockReturnValue(undefined);
        mockedFs.closeSync.mockReturnValue(undefined);
    });

    it('skips POSIX permission-bit check on Windows (issue #137)', () => {
        mockedFs.lstatSync.mockReturnValue(stubStat({ mode: 0o40777 }));

        withPlatform('win32', () => {
            expect(() => acquireLock()).not.toThrow();
        });
    });

    it('enforces POSIX permission-bit check on Linux', () => {
        mockedFs.lstatSync.mockReturnValue(stubStat({ mode: 0o40777 }));

        withPlatform('linux', () => {
            expect(() => acquireLock()).toThrow(/overly permissive permissions/);
        });
    });

    it('accepts correctly-permissioned directory on Linux', () => {
        mockedFs.lstatSync.mockReturnValue(stubStat({ mode: 0o40700 }));

        withPlatform('linux', () => {
            expect(() => acquireLock()).not.toThrow();
        });
    });
});
