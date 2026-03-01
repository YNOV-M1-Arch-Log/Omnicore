const correlator = require('express-correlation-id');
const { logger } = require('../config/logger');

const correlationId = () => {
  return correlator({
    generator: () => {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 9);
      return `${timestamp}-${random}`;
    },
    header: 'X-Correlation-Id',
  });
};

const attachCorrelationId = (req, res, next) => {
  const correlationId = req.correlationId();

  logger.setBindings({
    correlationId,
    requestId: correlationId,
  });

  res.setHeader('X-Correlation-Id', correlationId);

  next();
};

module.exports = {
  correlationId,
  attachCorrelationId,
};
