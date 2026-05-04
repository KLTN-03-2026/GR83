import { request } from '../api/httpClient';

function normalizeCustomerId(customerId) {
  return encodeURIComponent(String(customerId ?? '').trim());
}

export const customerWalletService = {
  getWallet(customerId) {
    return request(`/customers/${normalizeCustomerId(customerId)}/wallet`, {
      method: 'GET',
    });
  },

  listTransactions(customerId, params = {}) {
    const searchParams = new URLSearchParams();

    if (params.type) {
      searchParams.set('type', String(params.type));
    }

    const queryString = searchParams.toString();

    return request(`/customers/${normalizeCustomerId(customerId)}/wallet/transactions${queryString ? `?${queryString}` : ''}`, {
      method: 'GET',
    });
  },

  topup(customerId, payload) {
    return request(`/customers/${normalizeCustomerId(customerId)}/wallet/topup`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  transfer(customerId, payload) {
    return request(`/customers/${normalizeCustomerId(customerId)}/wallet/transfer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
