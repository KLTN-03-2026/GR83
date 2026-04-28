import { request } from '../api/httpClient';

function normalizeDriverId(driverId) {
  return encodeURIComponent(String(driverId ?? '').trim());
}

function normalizeRequestId(requestId) {
  return encodeURIComponent(String(requestId ?? '').trim());
}

export const driverVehicleRequestService = {
  getDriverProfile(driverId) {
    return request(`/drivers/${normalizeDriverId(driverId)}/profile`, {
      method: 'GET',
    });
  },

  createChangeRequest(driverId, payload) {
    return request(`/drivers/${normalizeDriverId(driverId)}/vehicle-change-requests`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listPendingRequests() {
    return request('/drivers/vehicle-change-requests/pending', {
      method: 'GET',
    });
  },

  getRequestDetail(requestId) {
    return request(`/drivers/vehicle-change-requests/${normalizeRequestId(requestId)}`, {
      method: 'GET',
    });
  },

  approveRequest(requestId, payload) {
    return request(`/drivers/vehicle-change-requests/${normalizeRequestId(requestId)}/approve`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  rejectRequest(requestId, payload) {
    return request(`/drivers/vehicle-change-requests/${normalizeRequestId(requestId)}/reject`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  listDriverResolutions(driverId, { unseenOnly = false } = {}) {
    const searchParams = new URLSearchParams();

    if (unseenOnly) {
      searchParams.set('unseenOnly', 'true');
    }

    const queryString = searchParams.toString();

    return request(
      `/drivers/${normalizeDriverId(driverId)}/vehicle-change-requests/resolutions${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
      },
    );
  },

  acknowledgeResolution(driverId, requestId) {
    return request(
      `/drivers/${normalizeDriverId(driverId)}/vehicle-change-requests/${normalizeRequestId(requestId)}/acknowledge`,
      {
        method: 'PATCH',
      },
    );
  },
};
