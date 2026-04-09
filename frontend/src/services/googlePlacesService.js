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

async function searchBackendPlaces(query, signal) {
  const response = await request(`/places/search?query=${encodeURIComponent(query)}`, { signal });
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

  if (backendResults.length > 0) {
    setCachedResults(cacheKey, backendResults);
    return backendResults;
  }

  try {
    const browserResults = await searchBrowserGooglePlaces(query, signal);

    if (browserResults.length > 0) {
      setCachedResults(cacheKey, browserResults);
      return browserResults;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    console.warn('Browser Google Places unavailable, falling back to backend search.', error);
  }

  return backendResults;
}
