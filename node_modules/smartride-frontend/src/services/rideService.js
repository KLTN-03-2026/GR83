import { request } from '../api/httpClient';

function buildTripHistoryQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set('accountId', String(params.accountId));
  }

  if (params.identifier) {
    searchParams.set('identifier', String(params.identifier));
  }

  if (params.roleCode) {
    searchParams.set('roleCode', String(params.roleCode));
  }

  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function buildTripMessagesQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set('accountId', String(params.accountId));
  }

  if (params.roleCode) {
    searchParams.set('roleCode', String(params.roleCode));
  }

  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const rideService = {
  getHealth() {
    return request('/health');
  },
  getTripHistory(params = {}, { signal } = {}) {
    return request(`/rides/history${buildTripHistoryQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
  searchRide(payload) {
    return request('/rides/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  bookRide(payload) {
    return request('/rides/book', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getTripMessages(bookingCode, params = {}, { signal } = {}) {
    return request(`/rides/${encodeURIComponent(String(bookingCode ?? '').trim())}/messages${buildTripMessagesQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
  sendTripMessage(bookingCode, payload = {}) {
    return request(`/rides/${encodeURIComponent(String(bookingCode ?? '').trim())}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateTripStatus(bookingCode, status, metadata = {}) {
    return request(`/rides/${encodeURIComponent(String(bookingCode ?? '').trim())}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
      }),
    });
  },
  submitTripRating(bookingCode, payload = {}) {
    return request(`/rides/${encodeURIComponent(String(bookingCode ?? '').trim())}/rating`, {
      method: 'POST',
      body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    });
  },
};
