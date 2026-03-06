import { listAccountNames, resolveValidAccountName } from '../../src/utils/accountUtils';

describe('accountUtils', () => {
  it('falls back to first configured account when requested is invalid', () => {
    const accounts = [
      { name: 'default', cdpPort: 9222 },
      { name: 'work', cdpPort: 9333 },
    ];
    expect(resolveValidAccountName('missing', accounts)).toBe('default');
  });

  it('returns requested account when valid', () => {
    const accounts = [
      { name: 'default', cdpPort: 9222 },
      { name: 'work', cdpPort: 9333 },
    ];
    expect(resolveValidAccountName('work', accounts)).toBe('work');
  });

  it('lists default account when config is empty', () => {
    expect(listAccountNames(undefined)).toEqual(['default']);
  });
});
