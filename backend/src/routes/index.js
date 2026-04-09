import { Router } from 'express';
import authRoutes from './auth.routes.js';
import driverRoutes from './driver.routes.js';
import healthRoutes from './health.routes.js';
import placesRoutes from './places.routes.js';
import rideRoutes from './ride.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/drivers', driverRoutes);
router.use('/places', placesRoutes);
router.use('/rides', rideRoutes);

export default router;
