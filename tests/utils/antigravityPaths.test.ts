import { getAntigravityCliPath, getAntigravityFallback, getAntigravityCdpHint } from '../../src/utils/antigravityPaths';
import * as os from 'os';
import * as path from 'path';

// Helper to temporarily override process.platform
function withPlatform(platform: string, fn: () => void): void {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
        fn();
    } finally {
        Object.defineProperty(process, 'platform', original);
    }
}

describe('antigravityPaths', () => {
    describe('getAntigravityCliPath', () => {
        it('returns macOS CLI path on darwin', () => {
            withPlatform('darwin', () => {
                expect(getAntigravityCliPath()).toBe(
                    '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
                );
            });
        });

        it('returns Windows exe path on win32', () => {
            const origEnv = process.env.LOCALAPPDATA;
            process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
            try {
                withPlatform('win32', () => {
                    expect(getAntigravityCliPath()).toBe(
                        path.join('C:\\Users\\test\\AppData\\Local', 'Programs', 'Antigravity', 'Antigravity.exe'),
                    );
                });
            } finally {
                if (origEnv === undefined) {
                    delete process.env.LOCALAPPDATA;
                } else {
                    process.env.LOCALAPPDATA = origEnv;
                }
            }
        });

        it('falls back to homedir on win32 without LOCALAPPDATA', () => {
            const origEnv = process.env.LOCALAPPDATA;
            delete process.env.LOCALAPPDATA;
            try {
                withPlatform('win32', () => {
                    const expected = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity', 'Antigravity.exe');
                    expect(getAntigravityCliPath()).toBe(expected);
                });
            } finally {
                if (origEnv !== undefined) {
                    process.env.LOCALAPPDATA = origEnv;
                }
            }
        });

        it('returns lowercase command on linux', () => {
            withPlatform('linux', () => {
                expect(getAntigravityCliPath()).toBe('antigravity');
            });
        });
    });

    describe('getAntigravityFallback', () => {
        it('returns open -a on darwin', () => {
            withPlatform('darwin', () => {
                const result = getAntigravityFallback('/test/path');
                expect(result.command).toBe('open');
                expect(result.args).toEqual(['-a', 'Antigravity', '/test/path']);
                expect(result.options).toBeUndefined();
            });
        });

        it('returns exe path with shell on win32', () => {
            const origEnv = process.env.LOCALAPPDATA;
            process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
            try {
                withPlatform('win32', () => {
                    const result = getAntigravityFallback('D:\\ripper');
                    expect(result.command).toContain('Antigravity.exe');
                    expect(result.args).toEqual(['D:\\ripper']);
                    expect(result.options).toEqual({ shell: true });
                });
            } finally {
                if (origEnv === undefined) {
                    delete process.env.LOCALAPPDATA;
                } else {
                    process.env.LOCALAPPDATA = origEnv;
                }
            }
        });

        it('returns lowercase command on linux', () => {
            withPlatform('linux', () => {
                const result = getAntigravityFallback('/home/user/project');
                expect(result.command).toBe('antigravity');
                expect(result.args).toEqual(['/home/user/project']);
            });
        });
    });

    describe('getAntigravityCdpHint', () => {
        it('returns open -a hint on darwin', () => {
            withPlatform('darwin', () => {
                expect(getAntigravityCdpHint(9222)).toBe(
                    'open -a Antigravity --args --remote-debugging-port=9222',
                );
            });
        });

        it('returns exe hint on win32', () => {
            withPlatform('win32', () => {
                expect(getAntigravityCdpHint(9222)).toBe(
                    'Antigravity.exe --remote-debugging-port=9222',
                );
            });
        });

        it('returns lowercase hint on linux', () => {
            withPlatform('linux', () => {
                expect(getAntigravityCdpHint(9222)).toBe(
                    'antigravity --remote-debugging-port=9222',
                );
            });
        });

        it('uses default port 9222', () => {
            withPlatform('darwin', () => {
                expect(getAntigravityCdpHint()).toContain('9222');
            });
        });

        it('uses custom port', () => {
            withPlatform('darwin', () => {
                expect(getAntigravityCdpHint(9223)).toContain('9223');
            });
        });
    });
});
