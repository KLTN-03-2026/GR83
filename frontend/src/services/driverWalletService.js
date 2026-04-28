import { request } from '../api/httpClient';

function normalizeDriverId(driverId) {
  return encodeURIComponent(String(driverId ?? '').trim());
}

export const driverWalletService = {
  getWallet(driverId) {
    return request(`/drivers/${normalizeDriverId(driverId)}/wallet`, {
      method: 'GET',
    });
  },

  listTransactions(driverId, params = {}) {
    const searchParams = new URLSearchParams();

    if (params.type) {
      searchParams.set('type', String(params.type));
    }

    const queryString = searchParams.toString();

    return request(`/drivers/${normalizeDriverId(driverId)}/wallet/transactions${queryString ? `?${queryString}` : ''}`, {
      method: 'GET',
    });
  },

  topup(driverId, payload) {
    return request(`/drivers/${normalizeDriverId(driverId)}/wallet/topup`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  transfer(driverId, payload) {
    return request(`/drivers/${normalizeDriverId(driverId)}/wallet/transfer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
