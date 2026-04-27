import { Router } from 'express';
import {
  createPromotionController,
  deletePromotionController,
  getPromotionController,
  listPromotionsController,
  updatePromotionController,
} from '../controllers/promotion.controller.js';

const router = Router();

router.get('/', listPromotionsController);
router.post('/', createPromotionController);
router.get('/:promotionId', getPromotionController);
router.put('/:promotionId', updatePromotionController);
router.delete('/:promotionId', deletePromotionController);

export default router;