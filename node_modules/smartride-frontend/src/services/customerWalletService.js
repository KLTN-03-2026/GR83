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

  // Gọi API nạp tiền ví chung cho cả khách và tài xế
  topupWallet({ userId, amount, method, role }) {
    return request(`/wallet/topup`, {
      method: 'POST',
      body: JSON.stringify({ userId, amount, method, role }),
    });
  },

  syncTopupWallet({ userId, role }) {
    return request('/wallet/topup/sync', {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    });
  },

  // Chuyển tiền ví: gọi API mới /wallet/transfer
  transfer(senderId, { recipientPhone, amount, description }) {
    return request(`/wallet/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        senderId,
        phone: recipientPhone,
        amount,
        note: (typeof description === 'string' && description.trim()) ? description.trim() : undefined,
      }),
    });
  },
};
