import { Router } from 'express';
import { databaseHealthController, healthController } from '../controllers/health.controller.js';

const router = Router();

router.get('/', healthController);
router.get('/db', databaseHealthController);

export default router;
