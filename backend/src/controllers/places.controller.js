import { reverseGeocodePlace, searchPlaces } from '../services/places.service.js';

export async function placesSearchController(request, response, next) {
  try {
    const query = String(request.query.query ?? request.query.q ?? '');
    const preferFallback = String(request.query.source ?? request.query.provider ?? '') === 'fallback';
    const result = await searchPlaces(query, { preferFallback });

    response.json(result);
  } catch (error) {
    next(error);
  }
}

export async function placesReverseController(request, response, next) {
  try {
    const lat = request.query.lat ?? request.query.latitude;
    const lng = request.query.lng ?? request.query.longitude;
    const result = await reverseGeocodePlace(lat, lng);

    response.json(result);
  } catch (error) {
    next(error);
  }
}
