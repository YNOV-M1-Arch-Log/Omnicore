const Stripe = require('stripe');
const config = require('./index');

if (!config.stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}

const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: '2024-06-20',
  appInfo: {
    name: 'omnicore-payment',
    version: '1.0.0',
  },
});

module.exports = stripe;
