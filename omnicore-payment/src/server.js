require('dotenv').config();

const app = require('./app');
const { connectDB, disconnectDB } = require('./config/database');
const { logger } = require('./config/logger');
const config = require('./config');

const start = async () => {
  await connectDB();

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `omnicore-payment listening on port ${config.port}`,
    );
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received — closing server');
    server.close(async () => {
      await disconnectDB();
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

start().catch((err) => {
  logger.error({ err }, 'Failed to start omnicore-payment');
  process.exit(1);
});
