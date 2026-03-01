const pino = require('pino');

const buildEcsLog = (overrides = {}) => {
  const { serviceName, base: userBase, level: overrideLevel, ...rest } = overrides;
  const env = process.env.NODE_ENV || 'development';
  const defaultLevel = env === 'production' ? 'info' : 'debug';
  const level = overrideLevel || process.env.LOG_LEVEL || defaultLevel;

  const base = {
    service: serviceName || 'omnicore-payment',
    env,
    ...userBase,
  };

  const config = {
    level,
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level(label, number) {
        return { 'log.level': number, level: label };
      },
      log(object) {
        if (object.err instanceof Error) {
          return {
            ...object,
            error: {
              type: object.err.name,
              message: object.err.message,
              stack_trace: object.err.stack,
            },
          };
        }
        return object;
      },
    },
    ...rest,
  };

  if (env === 'development' && !process.env.CI) {
    config.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    };
  }

  return pino(config);
};

const logger = buildEcsLog();

module.exports = { buildEcsLog, logger };
