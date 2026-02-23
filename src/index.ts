import { logger } from './utils/logger';
import { startBot } from './bot';
import { acquireLock } from './utils/lockfile';

const logoSuperLiquid = `
      .           *                  .
            /\\___/\\            z Z    
    *      ( - . - )____________z          *  
            \\_                __)                   
              \\_  \\________/  /          .     
                \\__)      \\__)

     ~ Booting... LazyGravity ~
`;

console.log(logoSuperLiquid);

// 二重起動防止: 既にBotが起動中なら即終了
acquireLock();

startBot().catch(logger.error);
