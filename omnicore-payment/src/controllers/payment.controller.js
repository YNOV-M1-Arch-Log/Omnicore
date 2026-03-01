const paymentService = require('../services/payment.service');
const { logger } = require('../config/logger');

class PaymentController {
  async createIntent(req, res, next) {
    try {
      const { orderId } = req.body;
      const correlationId = req.correlationId ? req.correlationId() : undefined;
      const payment = await paymentService.createIntent(orderId, correlationId);
      logger.info({ paymentId: payment.id, orderId }, 'Payment intent created');
      res.status(201).json(payment);
    } catch (error) {
      logger.error({ err: error }, 'Failed to create payment intent');
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const filters = {};
      if (req.query.orderId) filters.orderId = req.query.orderId;
      if (req.query.status)  filters.status  = req.query.status;
      if (req.query.page)    filters.page    = req.query.page;
      if (req.query.limit)   filters.limit   = req.query.limit;
      res.json(await paymentService.getAll(filters));
    } catch (error) {
      logger.error({ err: error }, 'Failed to list payments');
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      res.json(await paymentService.getById(req.params.id));
    } catch (error) {
      logger.error({ err: error, id: req.params.id }, 'Failed to get payment');
      next(error);
    }
  }

  async getByOrderId(req, res, next) {
    try {
      res.json(await paymentService.getByOrderId(req.params.orderId));
    } catch (error) {
      logger.error({ err: error, orderId: req.params.orderId }, 'Failed to get payment by order');
      next(error);
    }
  }

  async refund(req, res, next) {
    try {
      const correlationId = req.correlationId ? req.correlationId() : undefined;
      const amount = req.body.amount != null ? Number(req.body.amount) : undefined;
      const payment = await paymentService.refund(req.params.id, req.body.reason, amount, correlationId);
      logger.info({ paymentId: payment.id, amount }, 'Payment refunded');
      res.json(payment);
    } catch (error) {
      logger.error({ err: error, id: req.params.id }, 'Failed to refund payment');
      next(error);
    }
  }
}

module.exports = new PaymentController();
