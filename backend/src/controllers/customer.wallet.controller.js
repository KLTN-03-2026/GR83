import {
  getCustomerWallet,
  listCustomerWalletTransactions,
  topupCustomerWallet,
  transferCustomerWallet,
} from '../services/customer.wallet.service.js';

export async function getCustomerWalletController(request, response, next) {
  try {
    const result = await getCustomerWallet(request.params.customerId);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listCustomerWalletTransactionsController(request, response, next) {
  try {
    const result = await listCustomerWalletTransactions(request.params.customerId, request.query);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function topupCustomerWalletController(request, response, next) {
  try {
    const result = await topupCustomerWallet(request.params.customerId, request.body);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function transferCustomerWalletController(request, response, next) {
  try {
    const result = await transferCustomerWallet(request.params.customerId, request.body);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
