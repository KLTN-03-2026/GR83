import { Router } from 'express';

import {
  createWalletTopupRequest,
  momoWalletCallback,
  zalopayWalletCallback,
  syncWalletTopups,
  transferWallet,
} from '../controllers/wallet.controller.js';

const router = Router();
router.post('/transfer', transferWallet);

router.post('/topup', createWalletTopupRequest);
router.post('/topup/sync', syncWalletTopups);
router.post('/topup/callback/momo', momoWalletCallback);
router.post('/topup/callback/zalopay', zalopayWalletCallback);

export default router;
