const stripe = require('../config/stripe');
const config = require('../config');
const { logger } = require('../config/logger');
const paymentRepository = require('../repositories/payment.repository');

class PaymentService {
  /**
   * Create a Stripe PaymentIntent for an order.
   * Fetches the order directly from the order service to get amount + currency.
   */
  async createIntent(orderId, correlationId) {
    // 1. Check no existing payment for this order
    const existing = await paymentRepository.findByOrderId(orderId);
    if (existing) {
      const err = new Error(`A payment already exists for order ${orderId}`);
      err.status = 409;
      throw err;
    }

    // 2. Fetch order from order service to get total and currency
    const order = await this._fetchOrder(orderId, correlationId);

    if (order.status !== 'pending') {
      const err = new Error(`Order is in status '${order.status}' — only pending orders can be paid`);
      err.status = 422;
      throw err;
    }

    // 3. Create Stripe PaymentIntent (amount in smallest currency unit — cents)
    const amountInCents = Math.round(Number(order.totalAmount) * 100);
    const currency = (order.currency || 'EUR').toLowerCase();

    const intent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      metadata: { orderId, service: 'omnicore-payment' },
      // automatic_payment_methods enables all payment methods configured in Stripe Dashboard
      automatic_payment_methods: { enabled: true },
    });

    logger.info({ orderId, intentId: intent.id, amount: amountInCents, currency }, 'Stripe PaymentIntent created');

    // 4. Persist payment record
    const payment = await paymentRepository.create({
      orderId,
      stripePaymentIntentId: intent.id,
      stripeClientSecret: intent.client_secret,
      amount: order.totalAmount,
      currency,
      status: 'pending',
    });

    return payment;
  }

  async getAll(filters = {}) {
    const result = await paymentRepository.findAll(filters);
    return { ...result, data: result.data.map((p) => this._sanitize(p)) };
  }

  async getById(id) {
    const payment = await paymentRepository.findById(id);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }
    return this._sanitize(payment);
  }

  async getByOrderId(orderId) {
    const payment = await paymentRepository.findByOrderId(orderId);
    if (!payment) {
      const err = new Error(`No payment found for order ${orderId}`);
      err.status = 404;
      throw err;
    }
    return this._sanitize(payment);
  }

  /**
   * Issue a full or partial refund via Stripe and update the payment record.
   * - Full refund (no amount, or amount === payment.amount): status → 'refunded', order → 'cancelled'.
   * - Partial refund (amount < payment.amount): Stripe partial refund, status stays 'succeeded',
   *   order is NOT cancelled, refundId is recorded.
   */
  async refund(id, reason, amount, correlationId) {
    // Use repo directly to get raw record (stripePaymentIntentId is needed)
    const payment = await paymentRepository.findById(id);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }

    if (payment.status !== 'succeeded') {
      const err = new Error(`Cannot refund a payment in status '${payment.status}'`);
      err.status = 422;
      throw err;
    }

    const paymentAmount = Number(payment.amount);
    if (amount != null && amount > paymentAmount) {
      const err = new Error(`Refund amount ${amount} exceeds payment amount ${paymentAmount}`);
      err.status = 422;
      throw err;
    }

    const isPartial = amount != null && amount < paymentAmount;

    const refundParams = {
      payment_intent: payment.stripePaymentIntentId,
      ...(reason && { reason }),
      ...(isPartial && { amount: Math.round(amount * 100) }),
    };

    const stripeRefund = await stripe.refunds.create(refundParams);
    logger.info({ paymentId: id, refundId: stripeRefund.id, isPartial, amount }, 'Stripe refund created');

    const updateData = {
      refundId: stripeRefund.id,
      refundReason: reason || null,
      refundedAt: new Date(),
      ...(!isPartial && { status: 'refunded' }),
    };

    const updated = await paymentRepository.update(id, updateData);

    if (!isPartial) {
      await this._updateOrderStatus(payment.orderId, 'cancelled', 'Payment refunded', correlationId);
    }

    return this._sanitize(updated);
  }

  // ── Webhook handlers ─────────────────────────────────────────────────────

  /**
   * Handle incoming Stripe webhook events.
   * Verifies signature, dispatches to the appropriate handler.
   */
  async handleWebhook(rawBody, signature) {
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
    } catch (err) {
      logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
      const e = new Error(`Webhook signature verification failed: ${err.message}`);
      e.status = 400;
      throw e;
    }

    logger.info({ type: event.type, id: event.id }, 'Stripe webhook received');

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this._onPaymentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this._onPaymentFailed(event.data.object);
        break;
      case 'payment_intent.canceled':
        await this._onPaymentCancelled(event.data.object);
        break;
      case 'payment_intent.processing':
        await this._onPaymentProcessing(event.data.object);
        break;
      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event type — ignored');
    }

    return { received: true };
  }

  async _onPaymentSucceeded(intent) {
    const payment = await paymentRepository.findByStripeIntentId(intent.id);
    if (!payment) {
      logger.warn({ intentId: intent.id }, 'payment_intent.succeeded — no matching payment found');
      return;
    }
    await paymentRepository.update(payment.id, {
      status: 'succeeded',
      paidAt: new Date(),
    });
    logger.info({ paymentId: payment.id, orderId: payment.orderId }, 'Payment succeeded');

    // Advance the order to 'confirmed'
    await this._updateOrderStatus(payment.orderId, 'confirmed', null, intent.id);
  }

  async _onPaymentFailed(intent) {
    const payment = await paymentRepository.findByStripeIntentId(intent.id);
    if (!payment) return;

    const reason = intent.last_payment_error?.message || 'Unknown failure';
    await paymentRepository.update(payment.id, {
      status: 'failed',
      failureReason: reason,
      failedAt: new Date(),
    });
    logger.warn({ paymentId: payment.id, reason }, 'Payment failed');
  }

  async _onPaymentCancelled(intent) {
    const payment = await paymentRepository.findByStripeIntentId(intent.id);
    if (!payment) return;

    await paymentRepository.update(payment.id, { status: 'cancelled' });
    logger.info({ paymentId: payment.id }, 'Payment cancelled');
  }

  async _onPaymentProcessing(intent) {
    const payment = await paymentRepository.findByStripeIntentId(intent.id);
    if (!payment) return;

    await paymentRepository.update(payment.id, { status: 'processing' });
    logger.info({ paymentId: payment.id }, 'Payment processing');
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Strip stripeClientSecret from any payment that is no longer pending.
   * The secret is only needed once (frontend passes it to Stripe.js to confirm).
   * Once the payment resolves it is inert, but returning it in every GET is unnecessary.
   */
  _sanitize(payment) {
    if (!payment || payment.status === 'pending') return payment;
    const { stripeClientSecret: _omit, ...rest } = payment;
    return rest;
  }

  async _fetchOrder(orderId, correlationId) {
    try {
      const res = await fetch(`${config.orderServiceUrl}/api/orders/${orderId}`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'X-Correlation-Id': correlationId || 'internal' },
      });
      if (res.status === 404) {
        const err = new Error(`Order ${orderId} not found`);
        err.status = 404;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`Order service error: ${res.status}`);
        err.status = 502;
        throw err;
      }
      return res.json();
    } catch (err) {
      if (err.status) throw err;
      const e = new Error('Order service unreachable');
      e.status = 503;
      throw e;
    }
  }

  async _updateOrderStatus(orderId, status, cancellationReason, correlationId) {
    try {
      const body = { status };
      if (cancellationReason) body.cancellationReason = cancellationReason;

      const res = await fetch(`${config.orderServiceUrl}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId || 'internal',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn({ orderId, status, httpStatus: res.status }, 'Failed to update order status from payment service');
      }
    } catch (err) {
      logger.warn({ err, orderId, status }, 'Error calling order service to update status');
    }
  }
}

module.exports = new PaymentService();
