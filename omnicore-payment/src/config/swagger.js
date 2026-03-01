const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Omnicore Payment Service API',
      version: '1.0.0',
      description: 'Stripe-based payment processing: create payment intents, handle webhooks, issue refunds.',
    },
    servers: [{ url: 'http://localhost:3005', description: 'Development server' }],
    components: {
      schemas: {
        PaymentIntentInput: {
          type: 'object',
          required: ['orderId'],
          properties: {
            orderId: { type: 'string', format: 'uuid', description: 'Order to pay for' },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            id:                    { type: 'string', format: 'uuid' },
            orderId:               { type: 'string', format: 'uuid' },
            stripePaymentIntentId: { type: 'string', example: 'pi_3OxTnZ2eZvKYlo2C1PBpABCD' },
            stripeClientSecret:    { type: 'string', example: 'pi_3OxTnZ2eZvKYlo2C1PBpABCD_secret_xxxx', description: 'Only present while status is pending. Omitted once payment resolves.' },
            amount:                { type: 'number', format: 'float', example: 59.98 },
            currency:              { type: 'string', example: 'eur' },
            status:                { type: 'string', enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'] },
            failureReason:         { type: 'string', nullable: true },
            refundId:              { type: 'string', nullable: true, description: 'Stripe refund ID — present after any refund (full or partial)' },
            refundReason:          { type: 'string', nullable: true },
            paidAt:                { type: 'string', format: 'date-time', nullable: true },
            failedAt:              { type: 'string', format: 'date-time', nullable: true },
            refundedAt:            { type: 'string', format: 'date-time', nullable: true },
            createdAt:             { type: 'string', format: 'date-time' },
            updatedAt:             { type: 'string', format: 'date-time' },
          },
        },
        PaginatedPayments: {
          type: 'object',
          properties: {
            data:  { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
            total: { type: 'integer', description: 'Total matching records' },
            page:  { type: 'integer', description: 'Current page (1-based)' },
            limit: { type: 'integer', description: 'Records per page' },
          },
        },
        RefundInput: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              enum: ['duplicate', 'fraudulent', 'requested_by_customer'],
              example: 'requested_by_customer',
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 15.00,
              description: 'Partial refund amount in the payment currency. Omit for a full refund.',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message:       { type: 'string' },
                status:        { type: 'integer' },
                correlationId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
