const { prisma } = require('../config/database');

class PaymentRepository {
  create(data) {
    return prisma.payment.create({ data });
  }

  findAll(filters = {}) {
    const where = {};
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.status)  where.status  = filters.status;
    return prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id) {
    return prisma.payment.findUnique({ where: { id } });
  }

  findByOrderId(orderId) {
    return prisma.payment.findUnique({ where: { orderId } });
  }

  findByStripeIntentId(stripePaymentIntentId) {
    return prisma.payment.findUnique({ where: { stripePaymentIntentId } });
  }

  update(id, data) {
    return prisma.payment.update({ where: { id }, data });
  }
}

module.exports = new PaymentRepository();
