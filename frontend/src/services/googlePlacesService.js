import { request } from '../api/httpClient';

const searchCache = new Map();
const cacheTtlMs = 5 * 60 * 1000;

function createAbortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function normalizeCacheKey(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase();
}

function cloneResults(results) {
  return results.map((result) => ({ ...result }));
}

function hasCoordinates(result) {
  return Number.isFinite(Number(result?.lat)) && Number.isFinite(Number(result?.lng));
}

function isCoordinateLikeLabel(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return false;
  }

  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(normalizedValue);
}

function resolveAddressObject(rawAddress) {
  if (!rawAddress || typeof rawAddress !== 'object') {
    return null;
  }

  if (rawAddress.address && typeof rawAddress.address === 'object') {
    return rawAddress.address;
  }

  return rawAddress;
}

function buildShortHouseRoadLabel(rawAddress) {
  const address = resolveAddressObject(rawAddress);

  if (!address) {
    return '';
  }

  const houseNumber = String(address.house_number ?? address.housenumber ?? address.street_number ?? '').trim();
  const road = String(address.road ?? address.route ?? address.street ?? '').trim();

  if (!houseNumber || !road) {
    return '';
  }

  return `Số ${houseNumber} ${road}`;
}

async function fetchBrowserFallbackReverseGeocode(latitude, longitude, signal) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('localityLanguage', 'vi');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'vi,en;q=0.9',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Reverse geocode fallback failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const addressParts = [
    data?.locality,
    data?.city,
    data?.principalSubdivision,
    data?.countryName,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  if (addressParts.length > 0) {
    return addressParts.join(', ');
  }

  return String(data?.localityInfo?.administrative?.[0]?.name ?? '').trim();
}

function getCachedResults(cacheKey) {
  const entry = searchCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > cacheTtlMs) {
    searchCache.delete(cacheKey);
    return null;
  }

  return cloneResults(entry.results);
}

function setCachedResults(cacheKey, results) {
  if (!Array.isArray(results) || results.length === 0) {
    return;
  }

  searchCache.set(cacheKey, {
    timestamp: Date.now(),
    results: cloneResults(results),
  });
}

function normalizePrediction(prediction, index) {
  return {
    place_id: prediction.place_id,
    description: prediction.description,
    main_text: prediction.structured_formatting?.main_text ?? prediction.description,
    secondary_text: prediction.structured_formatting?.secondary_text ?? '',
    source: 'google',
    index,
  };
}

function normalizeBackendPrediction(prediction, index) {
  const mainText = String(prediction.main_text ?? prediction.description ?? '').trim();
  const secondaryText = String(prediction.secondary_text ?? '').trim();
  const description = String(prediction.description ?? [mainText, secondaryText].filter(Boolean).join(', ')).trim();

  return {
    place_id: String(prediction.place_id ?? `${prediction.source ?? 'backend'}-${index}`),
    description,
    main_text: mainText || description,
    secondary_text: secondaryText,
    lat: Number(prediction.lat),
    lng: Number(prediction.lng),
    source: prediction.source ?? 'backend',
    index,
  };
}

function getAutocompletePredictions(autocompleteService, query, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const abortHandler = () => reject(createAbortError());

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    autocompleteService.getPlacePredictions(
      {
        input: query,
        language: 'vi',
        componentRestrictions: { country: 'vn' },
      },
      (predictions, status) => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        if (signal?.aborted) {
          reject(createAbortError());
          return;
        }

        if (status === 'OK') {
          resolve(predictions ?? []);
          return;
        }

        if (status === 'ZERO_RESULTS') {
          resolve([]);
          return;
        }

        reject(new Error(`Google Places trả về trạng thái ${status}`));
      },
    );
  });
}

async function searchBackendPlaces(query, signal, source = null) {
  const searchParams = new URLSearchParams({ query });

  if (source) {
    searchParams.set('source', source);
  }

  const response = await request(`/places/search?${searchParams.toString()}`, { signal });
  const results = Array.isArray(response?.results) ? response.results : [];

  return results.map(normalizeBackendPrediction);
}

async function searchBrowserGooglePlaces(query, signal) {
  const google = window.google;

  if (!google?.maps?.places?.AutocompleteService) {
    return [];
  }

  const autocompleteService = new google.maps.places.AutocompleteService();
  const results = await getAutocompletePredictions(autocompleteService, query, signal);

  return results.map(normalizePrediction);
}

export async function searchGooglePlaces(input, options = {}) {
  const query = String(input ?? '').trim();
  const signal = options.signal;

  if (!query) {
    return [];
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  const cacheKey = normalizeCacheKey(query);
  const cachedResults = getCachedResults(cacheKey);

  if (cachedResults) {
    return cachedResults;
  }

  let backendResults = [];

  try {
    backendResults = await searchBackendPlaces(query, signal);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    console.warn('Backend places search unavailable, falling back to browser Google Places.', error);
  }

  if (backendResults.some(hasCoordinates)) {
    setCachedResults(cacheKey, backendResults);
    return backendResults;
  }

  let browserResults = [];

  try {
    browserResults = await searchBrowserGooglePlaces(query, signal);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    console.warn('Browser Google Places unavailable, falling back to backend search.', error);
  }

  if (browserResults.length > 0 && window.google?.maps?.places?.PlacesService) {
    setCachedResults(cacheKey, browserResults);
    return browserResults;
  }

  try {
    const fallbackResults = await searchBackendPlaces(query, signal, 'fallback');

    if (fallbackResults.some(hasCoordinates)) {
      setCachedResults(cacheKey, fallbackResults);
      return fallbackResults;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    console.warn('Fallback backend places search unavailable.', error);
  }

  if (browserResults.length > 0) {
    setCachedResults(cacheKey, browserResults);
    return browserResults;
  }

  if (backendResults.length > 0) {
    setCachedResults(cacheKey, backendResults);
    return backendResults;
  }

  return [];
}

export async function reverseGeocodeCoordinates(lat, lng, options = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Tọa độ không hợp lệ.');
  }

  const searchParams = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
  });

  const response = await request(`/places/reverse?${searchParams.toString()}`, {
    signal: options.signal,
  });

  const label = String(response?.label ?? '').trim();
  const shortHouseRoadLabel = buildShortHouseRoadLabel(response?.address);
  let resolvedLabel = shortHouseRoadLabel || label;

  if (!resolvedLabel || isCoordinateLikeLabel(resolvedLabel)) {
    try {
      const fallbackLabel = await fetchBrowserFallbackReverseGeocode(latitude, longitude, options.signal);

      if (fallbackLabel) {
        resolvedLabel = fallbackLabel;
      }
    } catch {
      // Keep backend result when browser fallback is unavailable.
    }
  }

  return {
    label: resolvedLabel || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    lat: Number.isFinite(Number(response?.lat)) ? Number(response.lat) : latitude,
    lng: Number.isFinite(Number(response?.lng)) ? Number(response.lng) : longitude,
    provider: String(response?.provider ?? '').trim() || 'unknown',
  };
}
