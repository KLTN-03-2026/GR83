import { Router } from 'express';
import authRoutes from './auth.routes.js';
import assistantRoutes from './assistant.routes.js';
import driverRoutes from './driver.routes.js';
import healthRoutes from './health.routes.js';
import notificationRoutes from './notification.routes.js';
import promotionRoutes from './promotion.routes.js';
import placesRoutes from './places.routes.js';
import rideRoutes from './ride.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/assistant', assistantRoutes);
router.use('/auth', authRoutes);
router.use('/drivers', driverRoutes);
router.use('/notifications', notificationRoutes);
router.use('/promotions', promotionRoutes);
router.use('/places', placesRoutes);
router.use('/rides', rideRoutes);

export default router;
