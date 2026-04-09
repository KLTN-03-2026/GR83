import { env } from '../config/env.js';

const NOMINATIM_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'vi,en;q=0.9',
  'User-Agent': 'SmartRide/1.0 (https://github.com; local-dev)',
  Referer: 'http://localhost:5173',
};

const DA_NANG_CENTER = {
  lat: 16.0439,
  lng: 108.1993,
};

const DA_NANG_VIEWBOX = {
  west: 108.05,
  north: 16.2,
  east: 108.35,
  south: 15.9,
};

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map();
const reverseGeocodeCache = new Map();
let googleGeocodingAvailable = Boolean(env.googleMapsServerApiKey);

function normalizeCoordinate(value) {
  const coordinate = Number(value);

  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizeSearchText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOrderedTokenMatches(tokens, haystack) {
  let lastIndex = -1;
  let matchedCount = 0;

  for (const token of tokens) {
    const tokenIndex = haystack.indexOf(token, lastIndex + 1);

    if (tokenIndex === -1) {
      break;
    }

    matchedCount += 1;
    lastIndex = tokenIndex;
  }

  return matchedCount;
}

function normalizeCacheKey(value) {
  return normalizeSearchText(value);
}

function isWithinDaNangBounds(lat, lng) {
  return lat >= DA_NANG_VIEWBOX.south && lat <= DA_NANG_VIEWBOX.north && lng >= DA_NANG_VIEWBOX.west && lng <= DA_NANG_VIEWBOX.east;
}

function isDaNangResult(result) {
  const latitude = normalizeCoordinate(result.lat);
  const longitude = normalizeCoordinate(result.lng);

  if (latitude !== null && longitude !== null) {
    return isWithinDaNangBounds(latitude, longitude);
  }

  const combinedText = normalizeSearchText([result.description, result.main_text, result.secondary_text].filter(Boolean).join(' '));

  return combinedText.includes('da nang');
}

function pickDaNangResults(results) {
  const daNangResults = results.filter(isDaNangResult);

  return daNangResults.length > 0 ? daNangResults : results;
}

function getCachedSearchResult(cacheKey) {
  const entry = searchCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    return null;
  }

  return {
    provider: entry.provider,
    results: entry.results.map((result) => ({ ...result })),
  };
}

function setCachedSearchResult(cacheKey, value) {
  searchCache.set(cacheKey, {
    timestamp: Date.now(),
    provider: value.provider,
    results: value.results.map((result) => ({ ...result })),
  });
}

function getCachedReverseGeocode(cacheKey) {
  const entry = reverseGeocodeCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > SEARCH_CACHE_TTL_MS) {
    reverseGeocodeCache.delete(cacheKey);
    return null;
  }

  return { ...entry.value };
}

function setCachedReverseGeocode(cacheKey, value) {
  reverseGeocodeCache.set(cacheKey, {
    timestamp: Date.now(),
    value: { ...value },
  });
}

function isGoogleGeocoderUnavailableError(error) {
  const message = String(error?.message ?? error ?? '');

  return /billing|request_denied|api key|not authorized|unauthorized|forbidden|over query limit/i.test(message);
}

function addDaNangBias(url) {
  url.searchParams.set(
    'viewbox',
    `${DA_NANG_VIEWBOX.west},${DA_NANG_VIEWBOX.north},${DA_NANG_VIEWBOX.east},${DA_NANG_VIEWBOX.south}`,
  );
  url.searchParams.set('bounded', '1');
}

function addGoogleDaNangBias(url) {
  url.searchParams.set('location', `${DA_NANG_CENTER.lat},${DA_NANG_CENTER.lng}`);
  url.searchParams.set('radius', '50000');
}

function addPhotonDaNangBias(url) {
  url.searchParams.set(
    'bbox',
    `${DA_NANG_VIEWBOX.west},${DA_NANG_VIEWBOX.south},${DA_NANG_VIEWBOX.east},${DA_NANG_VIEWBOX.north}`,
  );
}

function scoreFieldMatch(fieldText, normalizedQuery, queryTokens, numericQueryTokens, weight = 1) {
  const normalizedField = normalizeSearchText(fieldText);

  if (!normalizedField) {
    return 0;
  }

  let score = 0;
  const orderedTokenMatches = countOrderedTokenMatches(queryTokens, normalizedField);
  const matchedTokens = queryTokens.filter((token) => normalizedField.includes(token));
  const fieldNumericTokens = normalizedField.match(/\d+/g) ?? [];
  const matchedNumericTokens = numericQueryTokens.filter((token) => fieldNumericTokens.includes(token));

  if (normalizedField === normalizedQuery) {
    score += 700;
  }

  if (normalizedQuery && normalizedField.startsWith(normalizedQuery)) {
    score += 260;
  }

  if (normalizedQuery && normalizedField.includes(normalizedQuery)) {
    score += 180;
  }

  score += matchedTokens.length * 55;
  score += orderedTokenMatches * 95;

  if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) {
    score += 150;
  }

  if (queryTokens.length > 1 && orderedTokenMatches === queryTokens.length) {
    score += 120;
  }

  if (numericQueryTokens.length > 0) {
    score += matchedNumericTokens.length * 50;
    score -= (numericQueryTokens.length - matchedNumericTokens.length) * 60;
  }

  return score * weight;
}

function rankSearchResults(query, results) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const numericQueryTokens = queryTokens.filter((token) => /\d/.test(token));
  const textQueryTokens = queryTokens.filter((token) => !/\d/.test(token));
  const textQueryPhrase = textQueryTokens.join(' ');
  const queryIncludesAirport =
    normalizedQuery.includes('san bay') || normalizedQuery.includes('airport') || normalizedQuery.includes('aerodrome');
  const queryLooksLikePark = normalizedQuery.includes('cong vien') || normalizedQuery.includes('park');
  const queryLooksLikeSpecificAddress = queryTokens.length >= 2 && !queryIncludesAirport && !queryLooksLikePark;
  const queryType = queryIncludesAirport ? 'airport' : queryLooksLikePark ? 'park' : queryLooksLikeSpecificAddress ? 'address' : 'generic';

  const scoredResults = results.map((result) => {
    const normalizedMainText = normalizeSearchText(result.main_text ?? '');
    const normalizedSecondaryText = normalizeSearchText(result.secondary_text ?? '');
    const normalizedDescription = normalizeSearchText(result.description ?? '');
    const combinedText = [normalizedMainText, normalizedSecondaryText, normalizedDescription].filter(Boolean).join(' ');
    const matchedTokens = queryTokens.filter((token) => combinedText.includes(token));
    const featureKey = String(result.featureKey ?? '').toLowerCase();
    const featureValue = String(result.featureValue ?? '').toLowerCase();
    const typePriority = (() => {
      if (queryType === 'airport') {
        if (featureKey === 'aeroway' && featureValue === 'aerodrome') {
          return 4;
        }

        if (featureKey === 'aeroway') {
          return 3;
        }

        if (featureKey === 'highway') {
          return 0;
        }

        return 1;
      }

      if (queryType === 'address') {
        if (featureKey === 'highway') {
          return 4;
        }

        if (featureKey === 'aeroway') {
          return 2;
        }

        if (featureKey === 'leisure' && featureValue === 'park') {
          return 0;
        }

        return 1;
      }

      if (queryType === 'park') {
        if (featureKey === 'leisure' && featureValue === 'park') {
          return 4;
        }

        return 1;
      }

      return 1;
    })();

    let score = 0;

    if (!combinedText) {
      return { ...result, _score: score, _matchedTokens: matchedTokens.length };
    }

    score += scoreFieldMatch(result.main_text, normalizedQuery, queryTokens, numericQueryTokens, 1.7);
    score += scoreFieldMatch(result.secondary_text, normalizedQuery, queryTokens, numericQueryTokens, 0.85);
    score += scoreFieldMatch(result.description, normalizedQuery, queryTokens, numericQueryTokens, 1.05);

    if (textQueryPhrase && normalizedMainText.includes(textQueryPhrase)) {
      score += 120;
    }

    if (textQueryPhrase && normalizedDescription.includes(textQueryPhrase)) {
      score += 60;
    }

    if (combinedText === normalizedQuery) {
      score += 180;
    }

    if (combinedText.includes(normalizedQuery)) {
      score += 100;
    }

    if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) {
      score += 80;
    }

    if (result.source === 'google') {
      score += 15;
    }

    if (result.source === 'photon') {
      score += 10;
    }

    if (featureKey === 'highway') {
      score += queryLooksLikeSpecificAddress ? 600 : 120;
      if (queryIncludesAirport) {
        score -= 400;
      }
    }

    if (featureKey === 'aeroway') {
      score += queryIncludesAirport ? 1500 : 80;
    }

    if (featureKey === 'amenity' && ['bus_station', 'train_station', 'ferry_terminal'].includes(featureValue)) {
      score += 120;
    }

    if (featureKey === 'leisure' && featureValue === 'park') {
      score += queryLooksLikePark ? 220 : -260;
    }

    return {
      ...result,
      _typePriority: typePriority,
      _score: score,
      _matchedTokens: matchedTokens.length,
    };
  });

  const uniqueResults = new Map();

  for (const result of scoredResults) {
    if (!uniqueResults.has(result.place_id)) {
      uniqueResults.set(result.place_id, result);
    }
  }

  return Array.from(uniqueResults.values())
    .sort((left, right) => {
      if (right._typePriority !== left._typePriority) {
        return right._typePriority - left._typePriority;
      }

      if (right._score !== left._score) {
        return right._score - left._score;
      }

      if (right._matchedTokens !== left._matchedTokens) {
        return right._matchedTokens - left._matchedTokens;
      }

      return left.index - right.index;
    })
    .slice(0, 6)
    .map(({ _typePriority, _score, _matchedTokens, ...result }) => result);
}

function normalizeGooglePrediction(prediction, index) {
  return {
    place_id: prediction.place_id,
    description: prediction.description,
    main_text: prediction.structured_formatting?.main_text ?? prediction.description,
    secondary_text: prediction.structured_formatting?.secondary_text ?? '',
    source: 'google',
    index,
  };
}

function normalizeNominatimResult(result, index) {
  const mainText = result.name || result.display_name.split(',')[0]?.trim() || result.display_name;
  const secondaryText = result.display_name.replace(mainText, '').replace(/^,\s*/, '').trim();

  return {
    place_id: result.place_id ? String(result.place_id) : `${result.osm_type ?? 'place'}-${result.osm_id ?? index}-${index}`,
    description: result.display_name,
    main_text: mainText,
    secondary_text: secondaryText,
    lat: normalizeCoordinate(result.lat),
    lng: normalizeCoordinate(result.lon),
    source: 'nominatim',
    index,
  };
}

function normalizePhotonResult(feature, index) {
  const properties = feature.properties ?? {};
  const name = properties.name ?? properties.street ?? properties.city ?? properties.state ?? 'Địa điểm';
  const secondaryParts = [properties.street, properties.district, properties.city, properties.state, properties.country]
    .filter(Boolean)
    .map((part) => String(part).trim());

  return {
    place_id: properties.osm_id ? `photon-${properties.osm_type ?? 'place'}-${properties.osm_id}-${index}` : `photon-${index}`,
    description: [name, ...secondaryParts].filter(Boolean).join(', '),
    main_text: name,
    secondary_text: secondaryParts.join(', '),
    lat: normalizeCoordinate(feature.geometry?.coordinates?.[1]),
    lng: normalizeCoordinate(feature.geometry?.coordinates?.[0]),
    featureKey: properties.osm_key,
    featureValue: properties.osm_value,
    source: 'photon',
    index,
  };
}

async function fetchGooglePredictions(query) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', query);
  url.searchParams.set('key', env.googleMapsServerApiKey);
  url.searchParams.set('language', 'vi');
  url.searchParams.set('components', 'country:vn');
  addGoogleDaNangBias(url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Places API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.status === 'OK') {
    return {
      provider: 'google',
      results: data.predictions.map(normalizeGooglePrediction),
    };
  }

  if (data.status === 'ZERO_RESULTS') {
    return {
      provider: 'google',
      results: [],
    };
  }

  throw new Error(data.error_message || `Google Places API status: ${data.status}`);
}

async function fetchFallbackPredictions(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '20');
  url.searchParams.set('countrycodes', 'vn');
  addDaNangBias(url);

  const response = await fetch(url, {
    headers: NOMINATIM_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Fallback geocoder returned HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: 'nominatim',
    results: data.map(normalizeNominatimResult),
  };
}

async function fetchStructuredFallbackPredictions(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('street', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '20');
  url.searchParams.set('countrycodes', 'vn');
  addDaNangBias(url);

  const response = await fetch(url, {
    headers: NOMINATIM_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Structured fallback geocoder returned HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: 'nominatim',
    results: data.map(normalizeNominatimResult),
  };
}

async function fetchPhotonPredictions(query) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  url.searchParams.set('countrycode', 'vn');
  addPhotonDaNangBias(url);

  const response = await fetch(url, {
    headers: NOMINATIM_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Photon geocoder returned HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: 'photon',
    results: (data.features ?? []).map(normalizePhotonResult),
  };
}

async function fetchFallbackReverseGeocode(lat, lng) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');

  const response = await fetch(url, {
    headers: NOMINATIM_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Fallback reverse geocoder returned HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: 'nominatim',
    label: data.display_name ?? `${lat}, ${lng}`,
    lat: normalizeCoordinate(data.lat) ?? lat,
    lng: normalizeCoordinate(data.lon) ?? lng,
    address: data,
  };
}

export async function searchPlaces(query, options = {}) {
  const trimmedQuery = query.trim();
  const preferFallback = options.preferFallback === true;
  const cacheKey = `${preferFallback ? 'fallback' : 'google'}:${normalizeCacheKey(trimmedQuery)}`;

  const cachedResult = getCachedSearchResult(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  if (!trimmedQuery) {
    const emptyResult = {
      provider: !preferFallback && env.googleMapsServerApiKey ? 'google' : 'nominatim',
      results: [],
    };

    setCachedSearchResult(cacheKey, emptyResult);
    return emptyResult;
  }

  if (!preferFallback && googleGeocodingAvailable && env.googleMapsServerApiKey) {
    try {
      const googleResults = await fetchGooglePredictions(trimmedQuery);
      const rankedGoogleResults = {
        provider: googleResults.provider,
        results: rankSearchResults(trimmedQuery, pickDaNangResults(googleResults.results)),
      };

      setCachedSearchResult(cacheKey, rankedGoogleResults);
      return rankedGoogleResults;
    } catch (error) {
      if (isGoogleGeocoderUnavailableError(error)) {
        googleGeocodingAvailable = false;
      }

      console.warn('Google Places search failed, falling back to Photon/Nominatim.', error);
    }
  }

  try {
    const photonResults = await fetchPhotonPredictions(trimmedQuery);

    if (photonResults.results.length > 0) {
      const rankedPhotonResults = {
        provider: photonResults.provider,
        results: rankSearchResults(trimmedQuery, pickDaNangResults(photonResults.results)),
      };

      setCachedSearchResult(cacheKey, rankedPhotonResults);
      return rankedPhotonResults;
    }
  } catch (error) {
    console.warn('Photon geocoder failed, continuing with free-text Nominatim fallback.', error);
  }

  try {
    const fallbackResults = await fetchFallbackPredictions(trimmedQuery);

    if (fallbackResults.results.length > 0) {
      const fallbackResult = {
        provider: fallbackResults.provider,
        results: rankSearchResults(trimmedQuery, pickDaNangResults(fallbackResults.results)),
      };

      setCachedSearchResult(cacheKey, fallbackResult);
      return fallbackResult;
    }
  } catch (error) {
    console.warn('Free-text Nominatim search failed.', error);
  }

  const fallbackResult = {
    provider: 'nominatim',
    results: [],
  };

  setCachedSearchResult(cacheKey, fallbackResult);
  return fallbackResult;
}

export async function reverseGeocodePlace(lat, lng) {
  const latitude = normalizeCoordinate(lat);
  const longitude = normalizeCoordinate(lng);

  if (latitude === null || longitude === null) {
    throw new Error('Tọa độ không hợp lệ');
  }

  const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const cachedReverseGeocode = getCachedReverseGeocode(cacheKey);

  if (cachedReverseGeocode) {
    return cachedReverseGeocode;
  }

  if (googleGeocodingAvailable && env.googleMapsServerApiKey) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${latitude},${longitude}`);
      url.searchParams.set('key', env.googleMapsServerApiKey);
      url.searchParams.set('language', 'vi');

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        if (data.status === 'OK' && data.results?.length) {
          const place = data.results[0];

          const googleResult = {
            provider: 'google',
            label: place.formatted_address ?? `${latitude}, ${longitude}`,
            lat: latitude,
            lng: longitude,
            address: place,
          };

          setCachedReverseGeocode(cacheKey, googleResult);
          return googleResult;
        }

        if (data.status && data.status !== 'ZERO_RESULTS') {
          googleGeocodingAvailable = false;
        }
      }
    } catch (error) {
      if (isGoogleGeocoderUnavailableError(error)) {
        googleGeocodingAvailable = false;
      }

      console.warn('Google reverse geocoding failed, falling back to Nominatim.', error);
    }
  }

  const fallbackResult = await fetchFallbackReverseGeocode(latitude, longitude);
  setCachedReverseGeocode(cacheKey, fallbackResult);

  return fallbackResult;
}
