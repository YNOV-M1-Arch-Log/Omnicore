const { Router } = require('express');
const paymentRoutes = require('./payment.routes');

const router = Router();

router.use('/payments', paymentRoutes);

module.exports = router;
