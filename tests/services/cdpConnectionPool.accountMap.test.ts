import { CdpConnectionPool } from '../../src/services/cdpConnectionPool';

describe('CdpConnectionPool account mapping helpers', () => {
  it('stores and returns preferred account by workspace path', () => {
    const pool = new CdpConnectionPool();
    const workspace = '/tmp/workspace-alpha';
    expect(pool.getPreferredAccountForWorkspace(workspace)).toBeNull();
    pool.setPreferredAccountForWorkspace(workspace, 'work');
    expect(pool.getPreferredAccountForWorkspace(workspace)).toBe('work');
  });
});
