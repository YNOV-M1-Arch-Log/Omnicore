const { prisma } = require('../config/database');

class PaymentRepository {
  create(data) {
    return prisma.payment.create({ data });
  }

  async findAll(filters = {}) {
    const where = {};
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.status)  where.status  = filters.status;

    const page  = Math.max(1, filters.page  || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const skip  = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
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
