import { listAccountNames, resolveValidAccountName } from '../../src/utils/accountUtils';

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
});
