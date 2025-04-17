import { ArbitrageBot } from './bot/ArbitrageBot';
import { logger } from './utils/Logger';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    const { FLASH_LOAN_ADDRESS, PRIVATE_KEY, RPC_URL } = process.env;
    if (!FLASH_LOAN_ADDRESS) throw new Error('FLASH_LOAN_ADDRESS environment variable is not set');
    if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY environment variable is not set');
    if (!RPC_URL) throw new Error('RPC_URL environment variable is not set');

    const arbitrageBot = new ArbitrageBot(FLASH_LOAN_ADDRESS, PRIVATE_KEY, RPC_URL);
    await arbitrageBot.start();

    const shutdown = () => {
      logger.info('Shutting down ArbitrageBot');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    logger.info('ArbitrageBot is running');
  } catch (error: any) {
    logger.error(`Failed to start ArbitrageBot: ${error.message}`);
    process.exit(1);
  }
}
main().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});
