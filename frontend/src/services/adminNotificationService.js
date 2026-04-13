import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.recipient && params.recipient !== 'all') {
    searchParams.set('recipient', String(params.recipient));
  }

  if (params.status && params.status !== 'all') {
    searchParams.set('status', String(params.status));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const adminNotificationService = {
  listNotifications(params = {}, { signal } = {}) {
    return request(`/notifications${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },

  getNotification(notificationId, { signal } = {}) {
    return request(`/notifications/${encodeURIComponent(String(notificationId))}`, {
      method: 'GET',
      signal,
    });
  },

  createNotification(payload, { signal } = {}) {
    return request('/notifications', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  updateNotification(notificationId, payload, { signal } = {}) {
    return request(`/notifications/${encodeURIComponent(String(notificationId))}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
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
