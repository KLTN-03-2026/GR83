import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.status) {
    searchParams.set('status', String(params.status));
  }

  if (params.recipient) {
    searchParams.set('recipient', String(params.recipient));
  }

  if (params.accountId) {
    searchParams.set('accountId', String(params.accountId));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const notificationService = {
  listNotifications(params = {}, { signal } = {}) {
    return request(`/notifications${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },

  deleteNotification(notificationId, { signal } = {}) {
    return request(`/notifications/${encodeURIComponent(String(notificationId))}`, {
      method: 'DELETE',
      signal,
    });
  },
};
