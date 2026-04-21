import { request } from '../api/httpClient';

export const adminUserService = {
  createUser(payload, { signal } = {}) {
    return request('/auth/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  listUsers({ signal } = {}) {
    return request('/auth/accounts', {
      method: 'GET',
      signal,
    });
  },

  getUser(userId, { signal } = {}) {
    return request(`/auth/accounts/${encodeURIComponent(userId)}`, {
      method: 'GET',
      signal,
    });
  },

  updateUser(userId, payload, { signal } = {}) {
    return request(`/auth/accounts/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
      signal,
    });
  },

  deleteUser(userId, { signal } = {}) {
    return request(`/auth/accounts/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      signal,
    });
  },

  lockUser(userId, { signal } = {}) {
    return request(`/auth/accounts/${encodeURIComponent(userId)}/lock`, {
      method: 'PATCH',
      signal,
    });
  },

  unlockUser(userId, { signal } = {}) {
    return request(`/auth/accounts/${encodeURIComponent(userId)}/unlock`, {
      method: 'PATCH',
      signal,
    });
  },
};
