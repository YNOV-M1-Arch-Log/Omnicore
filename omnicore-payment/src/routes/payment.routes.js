const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { body, param, query, validationResult } = require('express-validator');

const VALID_STATUSES = ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'];
const VALID_REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

/**
 * @swagger
 * tags:
 *   - name: Payments
 *     description: Stripe payment processing
 */

/**
 * @swagger
 * /api/payments/intent:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Stripe PaymentIntent for an order
 *     description: |
 *       Returns a `stripeClientSecret` which the frontend passes to `stripe.confirmPayment()`.
 *       The order must be in `pending` status. Only one payment per order is allowed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentIntentInput'
 *     responses:
 *       201:
 *         description: PaymentIntent created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       404:
 *         description: Order not found
 *       409:
 *         description: Payment already exists for this order
 *       422:
 *         description: Order is not in pending status
 */
router.post(
  '/intent',
  [
    body('orderId').isUUID().withMessage('orderId must be a valid UUID'),
    validate,
  ],
  paymentController.createIntent,
);

/**
 * @swagger
 * /api/payments:
 *   get:
 *     tags: [Payments]
 *     summary: List payments (Principal, Tenant)
 *     parameters:
 *       - in: query
 *         name: orderId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, processing, succeeded, failed, cancelled, refunded] }
 *     responses:
 *       200:
 *         description: List of payments
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Payment'
 */
router.get(
  '/',
  [
    query('orderId').optional().isUUID().withMessage('orderId must be a valid UUID'),
    query('status').optional().isIn(VALID_STATUSES).withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}`),
    validate,
  ],
  paymentController.getAll,
);

/**
 * @swagger
 * /api/payments/order/{orderId}:
 *   get:
 *     tags: [Payments]
 *     summary: Get the payment for a specific order
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       404:
 *         description: No payment for this order
 */
router.get(
  '/order/:orderId',
  [
    param('orderId').isUUID().withMessage('Invalid order ID'),
    validate,
  ],
  paymentController.getByOrderId,
);

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Get payment by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       404:
 *         description: Not found
 */
router.get(
  '/:id',
  [
    param('id').isUUID().withMessage('Invalid payment ID'),
    validate,
  ],
  paymentController.getById,
);

/**
 * @swagger
 * /api/payments/{id}/refund:
 *   post:
 *     tags: [Payments]
 *     summary: Issue a full refund (Principal only)
 *     description: |
 *       Creates a Stripe refund and updates payment status to `refunded`.
 *       Also cancels the linked order and restores stock.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefundInput'
 *     responses:
 *       200:
 *         description: Refund issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       404:
 *         description: Payment not found
 *       422:
 *         description: Payment cannot be refunded in current status
 */
router.post(
  '/:id/refund',
  [
    param('id').isUUID().withMessage('Invalid payment ID'),
    body('reason').optional().isIn(VALID_REFUND_REASONS).withMessage(`reason must be one of: ${VALID_REFUND_REASONS.join(', ')}`),
    validate,
  ],
  paymentController.refund,
);

module.exports = router;
