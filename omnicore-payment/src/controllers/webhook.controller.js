const paymentService = require('../services/payment.service');
const { logger } = require('../config/logger');

class WebhookController {
  /**
   * POST /webhooks/stripe
   * Body must arrive as raw Buffer (express.raw middleware applied in app.js).
   * Stripe signature verified inside payment service.
   */
  async handleStripe(req, res, next) {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: { message: 'Missing stripe-signature header' } });
      }

      // req.body is a raw Buffer here — passed directly to stripe.webhooks.constructEvent
      const result = await paymentService.handleWebhook(req.body, signature);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, 'Webhook handling failed');
      // Return proper status so Stripe knows whether to retry
      const status = error.status === 400 ? 400 : 500;
      res.status(status).json({ error: { message: error.message } });
    }
  }
}

module.exports = new WebhookController();
