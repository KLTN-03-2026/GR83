import { request } from '../api/httpClient';

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.status && params.status !== 'all') {
    searchParams.set('status', String(params.status));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const promotionService = {
  listPromotions(params = {}, { signal } = {}) {
    return request(`/promotions${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
};
