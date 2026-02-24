import { logger } from './utils/logger';
import { startBot } from './bot';
import { acquireLock } from './utils/lockfile';
import { LOGO } from './utils/logo';

console.log(LOGO);

// 二重起動防止: 既にBotが起動中なら即終了
acquireLock();

startBot().catch(logger.error);
