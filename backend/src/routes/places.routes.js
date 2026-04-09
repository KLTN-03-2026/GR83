import { Router } from 'express';
import { placesReverseController, placesSearchController } from '../controllers/places.controller.js';

const router = Router();

router.get('/search', placesSearchController);
router.get('/reverse', placesReverseController);

export default router;
