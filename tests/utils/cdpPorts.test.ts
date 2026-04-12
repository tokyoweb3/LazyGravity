import {
    normalizeAntigravityAccounts,
    parseAntigravityAccounts,
    serializeAntigravityAccounts,
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
});
