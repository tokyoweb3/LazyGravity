import { LOGO } from '../../utils/logo';
import { acquireLock } from '../../utils/lockfile';
import { startBot } from '../../bot';
import { logger } from '../../utils/logger';

export async function startAction(): Promise<void> {
    console.log(LOGO);
    acquireLock();
    await startBot().catch((err) => {
        logger.error('Failed to start bot:', err);
        process.exit(1);
    });
}
