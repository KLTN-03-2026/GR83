import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const query = new URLSearchParams();

  if (params.status) {
    query.set('status', String(params.status).trim());
  }

  if (params.violationType) {
    query.set('violationType', String(params.violationType).trim());
  }

  if (params.keyword) {
    query.set('keyword', String(params.keyword).trim());
  }

  if (params.limit) {
    query.set('limit', String(params.limit));
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export const adminDriverViolationService = {
  listViolations(params = {}, { signal } = {}) {
    return request(`/rides/violations/admin${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },

  getViolationDetail(violationId, { signal } = {}) {
    return request(`/rides/violations/admin/${encodeURIComponent(String(violationId ?? '').trim())}`, {
      method: 'GET',
      signal,
    });
  },

  updateViolation(violationId, payload, { signal } = {}) {
    return request(`/rides/violations/admin/${encodeURIComponent(String(violationId ?? '').trim())}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    });
  },
};