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
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of payments
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedPayments'
 */
router.get(
  '/',
  [
    query('orderId').optional().isUUID().withMessage('orderId must be a valid UUID'),
    query('status').optional().isIn(VALID_STATUSES).withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}`),
    query('page').optional().isInt({ min: 1 }).toInt().withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt().withMessage('limit must be between 1 and 100'),
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
 *     summary: Issue a full or partial refund (Principal only)
 *     description: |
 *       Creates a Stripe refund.
 *
 *       **Full refund** (omit `amount` or set it equal to the payment amount):
 *       - Payment status → `refunded`
 *       - Linked order → `cancelled` (stock restored automatically by order service)
 *
 *       **Partial refund** (provide `amount` < payment amount):
 *       - Stripe issues a partial refund for the specified amount
 *       - Payment status stays `succeeded`; `refundId` is recorded for audit
 *       - Linked order is NOT cancelled
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
 *         description: Payment not in succeeded status, or amount exceeds payment total
 */
router.post(
  '/:id/refund',
  [
    param('id').isUUID().withMessage('Invalid payment ID'),
    body('reason').optional().isIn(VALID_REFUND_REASONS).withMessage(`reason must be one of: ${VALID_REFUND_REASONS.join(', ')}`),
    body('amount').optional().isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
    validate,
  ],
  paymentController.refund,
);

module.exports = router;
