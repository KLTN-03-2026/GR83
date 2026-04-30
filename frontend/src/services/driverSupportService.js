import { request } from '../api/httpClient';

function normalizeDriverId(driverId) {
  return encodeURIComponent(String(driverId ?? '').trim());
}

export const driverSupportService = {
  getOverview(driverId) {
    return request(`/drivers/${normalizeDriverId(driverId)}/support-overview`, {
      method: 'GET',
    });
  },

  listRequests(driverId, params = {}) {
    const searchParams = new URLSearchParams();

    if (params.limit) {
      searchParams.set('limit', String(params.limit));
    }

    const queryString = searchParams.toString();

    return request(`/drivers/${normalizeDriverId(driverId)}/support-requests${queryString ? `?${queryString}` : ''}`, {
      method: 'GET',
    });
  },

  createRequest(driverId, payload) {
    return request(`/drivers/${normalizeDriverId(driverId)}/support-requests`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
