const pinoHttp = require('pino-http');
const { buildEcsLog } = require('../config/logger');

const httpLogger = pinoHttp({
  logger: buildEcsLog({ base: { component: 'http' } }),
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) {
      return 'error';
    }
    if (res.statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, _res, _error) {
    return `${req.method} ${req.url} failed`;
  },
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration',
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        path: req.path,
        parameters: req.params,
        query: req.query,
        correlationId: req.correlationId ? req.correlationId() : undefined,
        headers: {
          host: req.headers.host,
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
        },
        remoteAddress: req.ip || req.connection?.remoteAddress,
      };
    },
    res(res) {
      if (!res || typeof res !== 'object') {
        return { statusCode: 'unknown' };
      }

      const getHeaderValue = (headerName) => {
        if (typeof res.getHeader === 'function') {
          return res.getHeader(headerName);
        }
        if (res.headers && typeof res.headers === 'object') {
          return res.headers[headerName];
        }
        return undefined;
      };

      return {
        statusCode: res.statusCode,
        headers: {
          'content-type': getHeaderValue('content-type'),
          'content-length': getHeaderValue('content-length'),
        },
      };
    },
  },
});

module.exports = httpLogger;
