import {
    inferParentScopeChannelId,
    listAccountNames,
    resolveScopedAccountName,
    resolveValidAccountName,
} from '../../src/utils/accountUtils';

describe('accountUtils', () => {
    it('falls back to the first configured account when requested is invalid', () => {
        const accounts = [
            { name: 'default', cdpPort: 9222 },
            { name: 'work', cdpPort: 9333 },
        ];

        expect(resolveValidAccountName('missing', accounts)).toBe('default');
    });

    it('returns the requested account when it exists', () => {
        const accounts = [
            { name: 'default', cdpPort: 9222 },
            { name: 'work', cdpPort: 9333 },
        ];

        expect(resolveValidAccountName('work', accounts)).toBe('work');
    });

    it('lists the default account when config is empty', () => {
        expect(listAccountNames(undefined)).toEqual(['default']);
    });

    it('uses the parent channel account when the conversation has no explicit override', () => {
        const channelPrefRepo = {
            getAccountName: jest.fn((channelId: string) => {
                if (channelId === 'parent-channel') return 'work';
                return null;
            }),
        };
        const accountPrefRepo = {
            getAccountName: jest.fn().mockReturnValue('default'),
        };

        expect(resolveScopedAccountName({
            channelId: 'thread-channel',
            userId: 'user-1',
            parentChannelId: 'parent-channel',
            channelPrefRepo,
            accountPrefRepo,
            accounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work', cdpPort: 9333 },
            ],
        })).toBe('work');
    });

    it('infers the Telegram base chat as parent scope for topic ids', () => {
        const channelPrefRepo = {
            getAccountName: jest.fn((channelId: string) => {
                if (channelId === '1001') return 'work';
                return null;
            }),
        };

        expect(inferParentScopeChannelId('1001_77')).toBe('1001');
        expect(resolveScopedAccountName({
            channelId: '1001_77',
            userId: 'user-1',
            channelPrefRepo,
            accountPrefRepo: { getAccountName: jest.fn().mockReturnValue('default') },
            accounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work', cdpPort: 9333 },
            ],
        })).toBe('work');
    });

    it('prefers an explicit session account over channel and user defaults', () => {
        expect(resolveScopedAccountName({
            channelId: 'session-channel',
            userId: 'user-1',
            sessionAccountName: 'work4',
            selectedAccountByChannel: new Map([['session-channel', 'work1']]),
            channelPrefRepo: { getAccountName: jest.fn().mockReturnValue('work2') },
            accountPrefRepo: { getAccountName: jest.fn().mockReturnValue('default') },
            accounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work1', cdpPort: 9333 },
                { name: 'work2', cdpPort: 9444 },
                { name: 'work4', cdpPort: 9666 },
            ],
        })).toBe('work4');
    });
});
