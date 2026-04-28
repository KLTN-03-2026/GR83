import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.status && params.status !== 'all') {
    searchParams.set('status', String(params.status));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  if (params.visibility && params.visibility !== 'all') {
    searchParams.set('visibility', String(params.visibility));
  }

  if (params.audience && params.audience !== 'all') {
    searchParams.set('audience', String(params.audience));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const adminPromotionService = {
  listPromotions(params = {}, { signal } = {}) {
    return request(`/promotions${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },

  getPromotion(promotionId, { signal } = {}) {
    return request(`/promotions/${encodeURIComponent(String(promotionId))}`, {
      method: 'GET',
      signal,
    });
  },

  createPromotion(payload, { signal } = {}) {
    return request('/promotions', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  updatePromotion(promotionId, payload, { signal } = {}) {
    return request(`/promotions/${encodeURIComponent(String(promotionId))}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      signal,
    });
  },

  deletePromotion(promotionId, { signal } = {}) {
    return request(`/promotions/${encodeURIComponent(String(promotionId))}`, {
      method: 'DELETE',
      signal,
    });
  },
};