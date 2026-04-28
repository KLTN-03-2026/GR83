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

export const promotionService = {
  listPromotions(params = {}, { signal } = {}) {
    return request(`/promotions${buildQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
};
