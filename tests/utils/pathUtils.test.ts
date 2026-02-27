import { extractProjectNameFromPath, getAntigravityCdpHint } from '../../src/utils/pathUtils';

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

describe('pathUtils', () => {
    describe('extractProjectNameFromPath()', () => {
        it('extracts name from POSIX path', () => {
            expect(extractProjectNameFromPath('/home/user/Code/MyProject')).toBe('MyProject');
        });

        it('extracts name from Windows path', () => {
            expect(extractProjectNameFromPath('D:\\Code\\MyProject')).toBe('MyProject');
        });

        it('extracts name from Windows drive root', () => {
            expect(extractProjectNameFromPath('D:\\categorizer')).toBe('categorizer');
        });

        it('handles trailing slash', () => {
            expect(extractProjectNameFromPath('/home/user/Code/MyProject/')).toBe('MyProject');
        });

        it('handles trailing backslash', () => {
            expect(extractProjectNameFromPath('C:\\Code\\MyProject\\')).toBe('MyProject');
        });

        it('handles mixed separators', () => {
            expect(extractProjectNameFromPath('C:\\Users\\test/Code/MyProject')).toBe('MyProject');
        });

        it('returns empty string for empty input', () => {
            expect(extractProjectNameFromPath('')).toBe('');
        });

        it('returns name as-is for simple name', () => {
            expect(extractProjectNameFromPath('MyProject')).toBe('MyProject');
        });
    });

    describe('getAntigravityCdpHint()', () => {
        it('returns open -a hint on macOS', () => {
            withPlatform('darwin', () => {
                expect(getAntigravityCdpHint(9222)).toBe(
                    'open -a Antigravity --args --remote-debugging-port=9222',
                );
            });
        });

        it('returns exe hint on Windows', () => {
            withPlatform('win32', () => {
                expect(getAntigravityCdpHint(9222)).toBe(
                    'Antigravity.exe --remote-debugging-port=9222',
                );
            });
        });

        it('returns lowercase hint on Linux', () => {
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
                expect(getAntigravityCdpHint(9333)).toContain('9333');
            });
        });
    });
});
