import {
    getCdpCandidatePorts,
    normalizeAntigravityAccounts,
    parseAntigravityAccounts,
    serializeAntigravityAccounts,
    DEFAULT_CDP_PORTS,
} from '../../src/utils/cdpPorts';

describe('cdpPorts', () => {
    it('parses ANTIGRAVITY_ACCOUNTS entries with optional user-data-dir', () => {
        expect(parseAntigravityAccounts('default:9222,work:9333@/Users/test/work')).toEqual([
            { name: 'default', cdpPort: 9222 },
            { name: 'work', cdpPort: 9333, userDataDir: '/Users/test/work' },
        ]);
    });

    it('serializes accounts back into ANTIGRAVITY_ACCOUNTS format', () => {
        expect(serializeAntigravityAccounts([
            { name: 'default', cdpPort: 9222 },
            { name: 'work', cdpPort: 9333, userDataDir: '/Users/test/work' },
        ])).toBe('default:9222,work:9333@/Users/test/work');
    });

    it('drops duplicate names during normalization and keeps optional user-data-dir', () => {
        expect(normalizeAntigravityAccounts([
            { name: 'default', cdpPort: 9222 },
            { name: 'default', cdpPort: 9333, userDataDir: '/tmp/ignored' },
            { name: 'work', cdpPort: 9444, userDataDir: '/tmp/work' },
        ])).toEqual([
            { name: 'default', cdpPort: 9222 },
            { name: 'work', cdpPort: 9444, userDataDir: '/tmp/work' },
        ]);
    });

    describe('getCdpCandidatePorts', () => {
        it('returns default ports when no env variables are passed', () => {
            expect(getCdpCandidatePorts('', '')).toEqual([...DEFAULT_CDP_PORTS]);
        });

        it('includes single CDP_PORT override and deduplicates', () => {
            expect(getCdpCandidatePorts('', '9888')).toEqual([9888, ...DEFAULT_CDP_PORTS]);
        });

        it('includes ports from ANTIGRAVITY_ACCOUNTS and single CDP_PORT override', () => {
            expect(getCdpCandidatePorts('custom:9777,work:9333@/tmp/dir', '9888')).toEqual([
                9888,
                9777,
                9333,
                9222,
                9223,
                9444,
                9555,
                9666,
            ]);
        });

        it('ignores invalid non-numeric or out-of-range port values safely', () => {
            expect(getCdpCandidatePorts('invalid:abc,outOfRange:999999', 'invalidPort')).toEqual([
                ...DEFAULT_CDP_PORTS,
            ]);
        });
    });
});

