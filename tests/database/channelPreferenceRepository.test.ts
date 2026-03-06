import Database from 'better-sqlite3';
import { ChannelPreferenceRepository } from '../../src/database/channelPreferenceRepository';

describe('ChannelPreferenceRepository', () => {
  let db: Database.Database;
  let repo: ChannelPreferenceRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ChannelPreferenceRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('stores and reads account name', () => {
    expect(repo.getAccountName('ch1')).toBeNull();
    repo.setAccountName('ch1', 'work');
    expect(repo.getAccountName('ch1')).toBe('work');
  });

  it('stores and reads deep think count with default', () => {
    expect(repo.getDeepThinkCount('ch1')).toBe(1);
    repo.setDeepThinkCount('ch1', 4);
    expect(repo.getDeepThinkCount('ch1')).toBe(4);
  });
});
