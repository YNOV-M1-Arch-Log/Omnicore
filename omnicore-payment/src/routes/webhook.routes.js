const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

/**
 * @swagger
 * /webhooks/stripe:
 *   post:
 *     tags: [Webhooks]
 *     summary: Stripe webhook endpoint (no auth — called by Stripe)
 *     description: |
 *       Receives Stripe events and updates payment + order status accordingly.
 *
 *       **Do not call this endpoint manually** — it is called by Stripe.
 *       For local testing use the Stripe CLI:
 *       ```
 *       stripe listen --forward-to http://localhost:3010/webhooks/stripe
 *       stripe trigger payment_intent.succeeded
 *       ```
 *
 *       Handled events:
 *       - `payment_intent.succeeded` → payment: succeeded, order: confirmed
 *       - `payment_intent.payment_failed` → payment: failed
 *       - `payment_intent.canceled` → payment: cancelled
 *       - `payment_intent.processing` → payment: processing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Raw Stripe event payload (signature verified server-side)
 *     responses:
 *       200:
 *         description: Event received and processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 received: { type: boolean, example: true }
 *       400:
 *         description: Invalid signature or missing header
 */
router.post('/stripe', webhookController.handleStripe);

module.exports = router;
