import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.status) {
    searchParams.set('status', String(params.status));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const adminDriverService = {
  listDrivers(params = {}) {
    return request(`/drivers${buildQueryString(params)}`, {
      method: 'GET',
    });
  },

  uploadDriverDocuments(formData) {
    return request('/drivers/upload-documents', {
      method: 'POST',
      body: formData,
    });
  },

  createDriver(payload) {
    return request('/drivers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDriver(driverId, payload) {
    return request(`/drivers/${encodeURIComponent(String(driverId))}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  approveDriver(driverId) {
    return request(`/drivers/${encodeURIComponent(String(driverId))}/approve`, {
      method: 'PATCH',
    });
  },

  rejectDriver(driverId) {
    return request(`/drivers/${encodeURIComponent(String(driverId))}/reject`, {
      method: 'PATCH',
    });
  },

  lockDriver(driverId) {
    return request(`/drivers/${encodeURIComponent(String(driverId))}/lock`, {
      method: 'PATCH',
    });
  },

  unlockDriver(driverId) {
    return request(`/drivers/${encodeURIComponent(String(driverId))}/unlock`, {
      method: 'PATCH',
    });
  },
};
