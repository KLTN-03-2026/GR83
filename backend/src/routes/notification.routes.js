import { Router } from 'express';
import {
  createNotificationController,
  deleteNotificationController,
  getNotificationController,
  listNotificationsController,
  updateNotificationController,
} from '../controllers/notification.controller.js';

const router = Router();

router.get('/', listNotificationsController);
router.post('/', createNotificationController);
router.get('/:notificationId', getNotificationController);
router.put('/:notificationId', updateNotificationController);
router.delete('/:notificationId', deleteNotificationController);

export default router;
