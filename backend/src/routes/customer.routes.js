import { Router } from 'express';
import {
  getCustomerWalletController,
  listCustomerWalletTransactionsController,
  topupCustomerWalletController,
  transferCustomerWalletController,
} from '../controllers/customer.wallet.controller.js';

const router = Router();

router.get('/:customerId/wallet', getCustomerWalletController);
router.get('/:customerId/wallet/transactions', listCustomerWalletTransactionsController);
router.post('/:customerId/wallet/topup', topupCustomerWalletController);
router.post('/:customerId/wallet/transfer', transferCustomerWalletController);

export default router;
