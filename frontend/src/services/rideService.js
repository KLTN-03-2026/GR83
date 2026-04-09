import { request } from '../api/httpClient';

export const rideService = {
  getHealth() {
    return request('/health');
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
};
