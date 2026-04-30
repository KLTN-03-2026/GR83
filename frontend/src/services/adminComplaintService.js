import { request } from '../api/httpClient';

function buildAdminComplaintQueryString(params = {}) {
  const query = new URLSearchParams();

  if (params.status) {
    query.set('status', String(params.status).trim());
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

export const adminComplaintService = {
  listComplaints(params = {}, { signal } = {}) {
    return request(`/rides/issues/admin${buildAdminComplaintQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },

  getComplaintDetail(complaintId, { signal } = {}) {
    return request(`/rides/issues/admin/${encodeURIComponent(String(complaintId ?? '').trim())}`, {
      method: 'GET',
      signal,
    });
  },

  updateComplaint(complaintId, payload, { signal } = {}) {
    return request(`/rides/issues/admin/${encodeURIComponent(String(complaintId ?? '').trim())}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    });
  },
};
