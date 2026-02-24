import { logger } from './utils/logger';
import { startBot } from './bot';
import { acquireLock } from './utils/lockfile';
import { LOGO } from './utils/logo';

console.log(LOGO);

// Prevent duplicate launch: exit immediately if bot is already running
acquireLock();

startBot().catch(logger.error);
