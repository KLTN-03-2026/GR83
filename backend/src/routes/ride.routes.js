import { Router } from 'express';
import { bookRideController, searchRideController } from '../controllers/ride.controller.js';

const router = Router();

router.post('/search', searchRideController);
router.post('/book', bookRideController);

export default router;
