import sql from 'mssql';
import { searchPlaces } from './places.service.js';
import { env } from '../config/env.js';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';
import { readFileSync, statSync } from 'node:fs';

const VEHICLE_CONFIG = {
  motorbike: {
    label: 'Xe may',
    speedKmh: 24,
    defaultDistanceKm: 5.5,
    defaultEtaMinutes: 8,
  },
  car: {
    label: 'O to',
    speedKmh: 32,
    defaultDistanceKm: 9.2,
    defaultEtaMinutes: 12,
  },
  intercity: {
    label: 'Xe lien tinh',
    speedKmh: 45,
    defaultDistanceKm: 18.5,
    defaultEtaMinutes: 22,
  },
};

const DISTANCE_RATE_PER_KM = 5000;
const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const ROUTING_SERVICE_URL = 'https://router.project-osrm.org/route/v1/driving';
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const routeCache = new Map();
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const locationCache = new Map();
let googleDirectionsAvailable = Boolean(env.googleMapsServerApiKey);
const PRICE_TABLE_FILE_URL = new URL('../../gia.txt', import.meta.url);
const MAX_RECENT_BOOKINGS = 200;
const recentBookings = [];
const PAYMENT_METHOD_LABELS = {
  cash: 'Tiền mặt',
  qr: 'Thanh toán bằng QR code',
  wallet: 'Thanh toán bằng Ví điện tử',
};
const PAYMENT_PROVIDER_LABELS = {
  zalopay: 'Zalo pay',
  momo: 'Momo',
  shopeepay: 'Shopee pay',
};
const PAYMENT_STATUS_LABELS = {
  ChoThuTien: 'Chờ thu tiền',
  ChoXacNhan: 'Chờ xác nhận',
  DaThanhToan: 'Đã thanh toán',
  ThatBai: 'Thanh toán thất bại',
};

const DEFAULT_PRICING_TABLE = {
  motorbike: {
    prefix: 'RiBike',
    thresholdKm: 2,
    distanceRoundKm: null,
    tiers: [
      {
        id: 'tiet-kiem',
        label: 'tiet kiem',
        seatLabel: null,
        basePrice: 13_000,
        extraRate: 5_000,
        extraUnitKm: 1,
      },
      {
        id: 'pho-thong',
        label: 'pho thong',
        seatLabel: null,
        basePrice: 15_000,
        extraRate: 5_200,
        extraUnitKm: 1,
      },
      {
        id: 'plus',
        label: 'plus',
        seatLabel: null,
        basePrice: 17_000,
        extraRate: 5_400,
        extraUnitKm: 1,
      },
    ],
  },
  car: {
    prefix: 'RiCar',
    thresholdKm: 2,
    distanceRoundKm: null,
    tiers: [
      {
        id: 'tiet-kiem',
        label: 'tiet kiem',
        seatLabel: '4 cho',
        basePrice: 25_000,
        extraRate: 10_000,
        extraUnitKm: 1,
      },
      {
        id: 'vip',
        label: 'vip',
        seatLabel: '4 cho',
        basePrice: 27_000,
        extraRate: 11_000,
        extraUnitKm: 1,
      },
      {
        id: 'plus',
        label: 'plus',
        seatLabel: '7 cho',
        basePrice: 28_000,
        extraRate: 12_000,
        extraUnitKm: 1,
      },
      {
        id: 'minibus',
        label: 'minibus',
        seatLabel: '16 cho',
        basePrice: 30_000,
        extraRate: 14_000,
        extraUnitKm: 1,
      },
      {
        id: 'bus',
        label: 'bus',
        seatLabel: '30 cho',
        basePrice: 32_000,
        extraRate: 15_000,
        extraUnitKm: 1,
      },
    ],
  },
  intercity: {
    prefix: 'RiCar',
    thresholdKm: 50,
    distanceRoundKm: 10,
    tiers: [
      {
        id: 'tiet-kiem',
        label: 'tiet kiem',
        seatLabel: '4 cho',
        basePrice: 100_000,
        extraRate: 10_000,
        extraUnitKm: 10,
      },
      {
        id: 'vip',
        label: 'vip',
        seatLabel: '4 cho',
        basePrice: 120_000,
        extraRate: 12_000,
        extraUnitKm: 10,
      },
      {
        id: 'plus',
        label: 'plus',
        seatLabel: '7 cho',
        basePrice: 125_000,
        extraRate: 12_500,
        extraUnitKm: 10,
      },
      {
        id: 'minibus',
        label: 'minibus',
        seatLabel: '16 cho',
        basePrice: 120_000,
        extraRate: 12_000,
        extraUnitKm: 10,
      },
      {
        id: 'bus',
        label: 'bus',
        seatLabel: '30 cho',
        basePrice: 110_000,
        extraRate: 11_000,
        extraUnitKm: 10,
      },
    ],
  },
};

function clonePricingTable(pricingTable) {
  return Object.fromEntries(
    Object.entries(pricingTable).map(([vehicleKey, pricing]) => [
      vehicleKey,
      {
        ...pricing,
        tiers: pricing.tiers.map((tier) => ({ ...tier })),
      },
    ]),
  );
}

function normalizeIdentifier(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function resolveVehicleFromLine(line) {
  const normalizedLine = normalizeIdentifier(line);

  if (normalizedLine.includes('xe-may')) {
    return 'motorbike';
  }

  if (normalizedLine.includes('xe-lien-tinh')) {
    return 'intercity';
  }

  if (normalizedLine.includes('o-to')) {
    return 'car';
  }

  return null;
}

function parseTierFromPriceLine(line) {
  const cleanedLine = String(line).replace(/^\-\s*/, '');
  const baseMatch = cleanedLine.match(/(\d+)\s*k(?:\s*\/\s*1\s*[^;]+)?/i);
  const rateMatch = cleanedLine.match(/\+(\d+)\s*\/\s*(\d+)\s*km/i);

  if (!baseMatch || !rateMatch) {
    return null;
  }

  const labelChunk = cleanedLine
    .slice(0, baseMatch.index)
    .replace(/:\s*$/, '')
    .trim();
  const seatMatch = labelChunk.match(/\(([^)]+)\)/);
  const label = labelChunk
    .replace(/\(([^)]+)\)/g, '')
    .replace(/:\s*$/, '')
    .trim();
  const basePrice = Number(baseMatch[1]) * 1000;
  const extraRate = Number(rateMatch[1]);
  const extraUnitKm = Number(rateMatch[2]);

  if (!Number.isFinite(basePrice) || !Number.isFinite(extraRate) || !Number.isFinite(extraUnitKm) || extraUnitKm <= 0) {
    return null;
  }

  return {
    id: normalizeIdentifier(label) || `tier-${basePrice}`,
    label: label || 'tuy chon',
    seatLabel: seatMatch ? seatMatch[1].trim() : null,
    basePrice,
    extraRate,
    extraUnitKm,
  };
}

function parsePricingTableFromText(content) {
  const parsedPricing = clonePricingTable(DEFAULT_PRICING_TABLE);
  let currentVehicle = null;
  let pendingThresholdKm = null;

  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const thresholdMatch = line.match(/<\s*(\d+)\s*km/i);

    if (thresholdMatch) {
      const thresholdKm = Number(thresholdMatch[1]);

      if (Number.isFinite(thresholdKm) && thresholdKm > 0) {
        pendingThresholdKm = thresholdKm;
      }

      continue;
    }

    const vehicle = resolveVehicleFromLine(line);

    if (vehicle) {
      currentVehicle = vehicle;
      parsedPricing[currentVehicle].tiers = [];

      if (Number.isFinite(pendingThresholdKm) && pendingThresholdKm > 0) {
        parsedPricing[currentVehicle].thresholdKm = pendingThresholdKm;
      }

      continue;
    }

    if (!currentVehicle || !line.startsWith('-')) {
      continue;
    }

    const tier = parseTierFromPriceLine(line);

    if (tier) {
      parsedPricing[currentVehicle].tiers.push(tier);
    }
  }

  return parsedPricing;
}

function hasCompletePricingTable(pricingTable) {
  return ['motorbike', 'car', 'intercity'].every((vehicle) => Array.isArray(pricingTable?.[vehicle]?.tiers) && pricingTable[vehicle].tiers.length > 0);
}

function loadPricingTable() {
  try {
    const content = readFileSync(PRICE_TABLE_FILE_URL, 'utf8');
    const parsedPricing = parsePricingTableFromText(content);

    if (hasCompletePricingTable(parsedPricing)) {
      return parsedPricing;
    }

    throw new Error('Pricing table is incomplete.');
  } catch (error) {
    console.warn('Cannot load pricing table from gia.txt, using built-in fallback.', error);
    return clonePricingTable(DEFAULT_PRICING_TABLE);
  }
}

let pricingTableCache = clonePricingTable(DEFAULT_PRICING_TABLE);
let pricingTableVersion = null;

function reloadPricingTableIfNeeded() {
  try {
    const fileStats = statSync(PRICE_TABLE_FILE_URL);
    const currentVersion = Number(fileStats.mtimeMs);

    if (Number.isFinite(currentVersion) && pricingTableVersion === currentVersion) {
      return;
    }

    const loadedPricingTable = loadPricingTable();
    pricingTableCache = loadedPricingTable;
    pricingTableVersion = Number.isFinite(currentVersion) ? currentVersion : Date.now();
  } catch (error) {
    console.warn('Cannot refresh pricing table from gia.txt, using previous version.', error);

    if (pricingTableVersion === null) {
      pricingTableCache = clonePricingTable(DEFAULT_PRICING_TABLE);
      pricingTableVersion = Date.now();
    }
  }
}

function getPricingTable() {
  reloadPricingTableIfNeeded();
  return pricingTableCache;
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCoordinate(value) {
  const coordinate = Number(value);

  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  const latitude = normalizeCoordinate(position.lat ?? position.latitude);
  const longitude = normalizeCoordinate(position.lng ?? position.lon ?? position.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

function normalizeLocation(location, fallbackLabel) {
  if (typeof location === 'string') {
    return {
      label: normalizeText(location) || normalizeText(fallbackLabel),
      position: null,
      source: 'manual',
    };
  }

  if (!location || typeof location !== 'object') {
    return {
      label: normalizeText(fallbackLabel),
      position: null,
      source: 'manual',
    };
  }

  return {
    label: normalizeText(location.label ?? location.description ?? location.main_text ?? fallbackLabel),
    position: normalizePosition(location.position ?? location),
    source: location.source ?? 'manual',
  };
}

function calculateDistanceKm(leftPosition, rightPosition) {
  if (!leftPosition || !rightPosition) {
    return null;
  }

  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = radians(rightPosition.lat - leftPosition.lat);
  const deltaLng = radians(rightPosition.lng - leftPosition.lng);
  const startLat = radians(leftPosition.lat);
  const endLat = radians(rightPosition.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.sin(deltaLng / 2) ** 2 * Math.cos(startLat) * Math.cos(endLat);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeRouteGeometry(coordinates) {
  if (!Array.isArray(coordinates)) {
    return null;
  }

  const routeGeometry = coordinates
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return null;
      }

      const longitude = normalizeCoordinate(coordinate[0]);
      const latitude = normalizeCoordinate(coordinate[1]);

      if (longitude === null || latitude === null) {
        return null;
      }

      return {
        lat: latitude,
        lng: longitude,
      };
    })
    .filter(Boolean);

  return routeGeometry.length >= 2 ? routeGeometry : null;
}

function decodeGooglePolyline(encodedPolyline) {
  if (!encodedPolyline || typeof encodedPolyline !== 'string') {
    return null;
  }

  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const points = [];

  while (index < encodedPolyline.length) {
    let result = 0;
    let shift = 0;
    let byte = null;

    do {
      byte = encodedPolyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encodedPolyline.length + 1);

    const deltaLatitude = result & 1 ? ~(result >> 1) : result >> 1;
    latitude += deltaLatitude;

    result = 0;
    shift = 0;

    do {
      byte = encodedPolyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encodedPolyline.length + 1);

    const deltaLongitude = result & 1 ? ~(result >> 1) : result >> 1;
    longitude += deltaLongitude;

    points.push({
      lat: latitude / 1e5,
      lng: longitude / 1e5,
    });
  }

  return points.length >= 2 ? points : null;
}

function sumGoogleLegDistanceMeters(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];

  return legs.reduce((totalDistance, leg) => {
    const distanceMeters = Number(leg?.distance?.value);

    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      return totalDistance;
    }

    return totalDistance + distanceMeters;
  }, 0);
}

function sumGoogleLegDurationSeconds(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];

  return legs.reduce((totalDuration, leg) => {
    const durationSeconds = Number(leg?.duration_in_traffic?.value ?? leg?.duration?.value);

    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      return totalDuration;
    }

    return totalDuration + durationSeconds;
  }, 0);
}

function isGoogleDirectionsUnavailableError(error) {
  const message = String(error?.message ?? error ?? '');

  return /request_denied|billing|api key|not authorized|forbidden|over query limit|invalid/i.test(message);
}

async function getGoogleRouteMetrics(startPosition, endPosition) {
  if (!googleDirectionsAvailable || !env.googleMapsServerApiKey || typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const url = new URL(GOOGLE_DIRECTIONS_URL);
    url.searchParams.set('origin', `${startPosition.lat},${startPosition.lng}`);
    url.searchParams.set('destination', `${endPosition.lat},${endPosition.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('alternatives', 'true');
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('language', 'vi');
    url.searchParams.set('region', 'vn');
    url.searchParams.set('key', env.googleMapsServerApiKey);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Google Directions tra ve HTTP ${response.status}`);
    }

    const data = await response.json();
    const status = String(data?.status ?? 'UNKNOWN');

    if (status !== 'OK') {
      throw new Error(data?.error_message ?? `Google Directions status ${status}`);
    }

    const routes = Array.isArray(data?.routes) ? data.routes : [];

    if (routes.length === 0) {
      throw new Error('Google Directions khong tra ve tuyen duong.');
    }

    const shortestRoute = routes.reduce((bestRoute, currentRoute) => {
      if (!bestRoute) {
        return currentRoute;
      }

      const currentDistance = sumGoogleLegDistanceMeters(currentRoute);
      const bestDistance = sumGoogleLegDistanceMeters(bestRoute);

      if (currentDistance < bestDistance) {
        return currentRoute;
      }

      if (currentDistance === bestDistance) {
        const currentDuration = sumGoogleLegDurationSeconds(currentRoute);
        const bestDuration = sumGoogleLegDurationSeconds(bestRoute);

        if (currentDuration < bestDuration) {
          return currentRoute;
        }
      }

      return bestRoute;
    }, null);

    const distanceMeters = sumGoogleLegDistanceMeters(shortestRoute);

    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      throw new Error('Google Directions tra ve khoang cach khong hop le.');
    }

    const durationSeconds = sumGoogleLegDurationSeconds(shortestRoute);
    const routeGeometry = decodeGooglePolyline(shortestRoute?.overview_polyline?.points);

    return {
      distanceKm: distanceMeters / 1000,
      durationMinutes: Number.isFinite(durationSeconds) ? Math.max(1, Math.round(durationSeconds / 60)) : null,
      provider: 'google-directions',
      geometry: routeGeometry ?? [
        {
          lat: startPosition.lat,
          lng: startPosition.lng,
        },
        {
          lat: endPosition.lat,
          lng: endPosition.lng,
        },
      ],
    };
  } catch (error) {
    if (isGoogleDirectionsUnavailableError(error)) {
      googleDirectionsAvailable = false;
    }

    if (error?.name !== 'AbortError') {
      console.warn('Google Directions unavailable, falling back to OSRM.', error);
    }

    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cloneRouteGeometry(routeGeometry) {
  if (!Array.isArray(routeGeometry)) {
    return null;
  }

  return routeGeometry.map((point) => ({
    lat: Number(point.lat),
    lng: Number(point.lng),
  }));
}

function normalizeLocationCacheKey(label) {
  return normalizeText(label).toLowerCase();
}

function getCachedLocationPosition(cacheKey) {
  const entry = locationCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > LOCATION_CACHE_TTL_MS) {
    locationCache.delete(cacheKey);
    return null;
  }

  return {
    lat: Number(entry.position.lat),
    lng: Number(entry.position.lng),
  };
}

function setCachedLocationPosition(cacheKey, position) {
  locationCache.set(cacheKey, {
    timestamp: Date.now(),
    position: {
      lat: Number(position.lat),
      lng: Number(position.lng),
    },
  });
}

function extractFirstPositionFromSearch(results) {
  if (!Array.isArray(results)) {
    return null;
  }

  for (const result of results) {
    const position = normalizePosition(result);

    if (position) {
      return position;
    }
  }

  return null;
}

async function resolveLocationPosition(location) {
  if (location?.position) {
    return location.position;
  }

  const label = normalizeText(location?.label);

  if (!label) {
    return null;
  }

  const cacheKey = normalizeLocationCacheKey(label);
  const cachedPosition = getCachedLocationPosition(cacheKey);

  if (cachedPosition) {
    return cachedPosition;
  }

  try {
    const searchResult = await searchPlaces(label);
    const resolvedPosition = extractFirstPositionFromSearch(searchResult?.results);

    if (resolvedPosition) {
      setCachedLocationPosition(cacheKey, resolvedPosition);
      return resolvedPosition;
    }
  } catch (error) {
    console.warn(`Cannot geocode location "${label}".`, error);
  }

  return null;
}

function createRouteCacheKey(startPosition, endPosition) {
  return [startPosition, endPosition]
    .map((position) => `${position.lat.toFixed(5)},${position.lng.toFixed(5)}`)
    .join('|');
}

function getCachedRouteMetrics(cacheKey) {
  const entry = routeCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(cacheKey);
    return null;
  }

  return {
    ...entry.metrics,
    geometry: cloneRouteGeometry(entry.metrics.geometry),
  };
}

function setCachedRouteMetrics(cacheKey, metrics) {
  routeCache.set(cacheKey, {
    timestamp: Date.now(),
    metrics: {
      ...metrics,
      geometry: cloneRouteGeometry(metrics.geometry),
    },
  });
}

async function getShortestRouteMetrics(startPosition, endPosition) {
  const cacheKey = createRouteCacheKey(startPosition, endPosition);
  const cachedMetrics = getCachedRouteMetrics(cacheKey);

  if (cachedMetrics) {
    return cachedMetrics;
  }

  const fallbackMetrics = {
    distanceKm: calculateDistanceKm(startPosition, endPosition),
    durationMinutes: null,
    provider: 'haversine',
    geometry: [
      {
        lat: startPosition.lat,
        lng: startPosition.lng,
      },
      {
        lat: endPosition.lat,
        lng: endPosition.lng,
      },
    ],
  };

  if (typeof fetch !== 'function') {
    setCachedRouteMetrics(cacheKey, fallbackMetrics);
    return fallbackMetrics;
  }

  const googleRouteMetrics = await getGoogleRouteMetrics(startPosition, endPosition);

  if (googleRouteMetrics) {
    setCachedRouteMetrics(cacheKey, googleRouteMetrics);
    return googleRouteMetrics;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = new URL(`${ROUTING_SERVICE_URL}/${startPosition.lng},${startPosition.lat};${endPosition.lng},${endPosition.lat}`);
    url.searchParams.set('alternatives', 'true');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('annotations', 'false');
    url.searchParams.set('continue_straight', 'false');

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Routing service tra ve trang thai ${response.status}`);
    }

    const data = await response.json();
    const routes = Array.isArray(data?.routes) ? data.routes : [];

    if (routes.length === 0) {
      throw new Error('Routing service khong tra ve tuyen duong phu hop.');
    }

    const shortestRoute = routes.reduce((bestRoute, currentRoute) => {
      if (!bestRoute) {
        return currentRoute;
      }

      const currentDistance = Number(currentRoute?.distance);
      const bestDistance = Number(bestRoute?.distance);

      if (Number.isFinite(currentDistance) && currentDistance < bestDistance) {
        return currentRoute;
      }

      if (Number.isFinite(currentDistance) && currentDistance === bestDistance) {
        const currentDuration = Number(currentRoute?.duration);
        const bestDuration = Number(bestRoute?.duration);

        if (Number.isFinite(currentDuration) && currentDuration < bestDuration) {
          return currentRoute;
        }
      }

      return bestRoute;
    }, null);

    const distanceKm = Number(shortestRoute?.distance) / 1000;
    const durationMinutes = Number.isFinite(Number(shortestRoute?.duration))
      ? Math.max(1, Math.round(Number(shortestRoute.duration) / 60))
      : null;
    const routeGeometry = normalizeRouteGeometry(shortestRoute?.geometry?.coordinates);

    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new Error('Routing service tra ve khoang cach khong hop le.');
    }

    const metrics = {
      distanceKm,
      durationMinutes,
      provider: 'osrm',
      geometry: routeGeometry ?? [
        {
          lat: startPosition.lat,
          lng: startPosition.lng,
        },
        {
          lat: endPosition.lat,
          lng: endPosition.lng,
        },
      ],
    };

    setCachedRouteMetrics(cacheKey, metrics);
    return metrics;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Routing service unavailable, falling back to straight-line distance.', error);
    }

    setCachedRouteMetrics(cacheKey, fallbackMetrics);
    return fallbackMetrics;
  } finally {
    clearTimeout(timeoutId);
  }
}

function estimateDurationMinutes(distanceKm, config, providerDurationMinutes = null) {
  if (Number.isFinite(providerDurationMinutes)) {
    return Math.max(config.defaultEtaMinutes, Math.round(providerDurationMinutes));
  }

  if (!Number.isFinite(distanceKm)) {
    return config.defaultEtaMinutes;
  }

  const travelMinutes = (distanceKm / config.speedKmh) * 60 + 4;

  return Math.max(config.defaultEtaMinutes, Math.round(travelMinutes));
}

function roundCurrency(amount) {
  return Math.max(0, Math.round(amount));
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatRatePerKm(amount) {
  return `${new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 0,
  }).format(amount)}đ/km`;
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function getVehiclePricing(vehicle) {
  const pricingTable = getPricingTable();
  return pricingTable[vehicle] ?? pricingTable.motorbike;
}

function calculateTierPrice(distanceKm, vehiclePricing, tier) {
  if (!Number.isFinite(distanceKm)) {
    return roundCurrency(tier.basePrice);
  }

  const thresholdKm = Number.isFinite(Number(vehiclePricing.thresholdKm)) ? Number(vehiclePricing.thresholdKm) : 0;

  if (distanceKm <= thresholdKm) {
    return roundCurrency(tier.basePrice);
  }

  const roundStepKm = Number(vehiclePricing.distanceRoundKm);
  let adjustedDistanceKm = distanceKm;

  if (Number.isFinite(roundStepKm) && roundStepKm > 0) {
    adjustedDistanceKm = Math.max(thresholdKm, Math.round(distanceKm / roundStepKm) * roundStepKm);
  }

  const extraDistanceKm = Math.max(0, adjustedDistanceKm - thresholdKm);
  const unitKm = Number.isFinite(Number(tier.extraUnitKm)) && Number(tier.extraUnitKm) > 0 ? Number(tier.extraUnitKm) : 1;
  const extraUnits = extraDistanceKm / unitKm;

  return roundCurrency(tier.basePrice + extraUnits * tier.extraRate);
}

function getSummaryFare(distanceKm, vehiclePricing) {
  const mainTier = vehiclePricing.tiers[0];

  if (!mainTier) {
    return 0;
  }

  return calculateTierPrice(distanceKm, vehiclePricing, mainTier);
}

function getBaseRatePerKm(vehiclePricing) {
  const mainTier = vehiclePricing.tiers[0];

  if (!mainTier) {
    return DISTANCE_RATE_PER_KM;
  }

  const unitKm = Number.isFinite(Number(mainTier.extraUnitKm)) && Number(mainTier.extraUnitKm) > 0
    ? Number(mainTier.extraUnitKm)
    : 1;

  return roundCurrency(mainTier.extraRate / unitKm);
}

function buildRideResults(vehicle, distanceKm, baseDurationMinutes) {
  const config = VEHICLE_CONFIG[vehicle] ?? VEHICLE_CONFIG.motorbike;
  const vehiclePricing = getVehiclePricing(vehicle);
  const effectiveDistanceKm = Number.isFinite(distanceKm) ? distanceKm : config.defaultDistanceKm;
  const vehiclePrefix = vehiclePricing.prefix ?? (vehicle === 'motorbike' ? 'RiBike' : 'RiCar');
  const commonNote = vehicle === 'intercity'
    ? 'Đặt ghép theo chỗ ngồi, giá được tính theo bảng giá hiện hành.'
    : 'Giá được ước tính theo bảng giá hiện hành và quãng đường thực tế.';

  return vehiclePricing.tiers.map((tier, index) => {
    const estimateMinutes = Math.max(3, baseDurationMinutes + Math.max(-2, 1 - index));
    const price = calculateTierPrice(effectiveDistanceKm, vehiclePricing, tier);
    const title = `${vehiclePrefix} ${tier.label}`.trim();

    return {
      id: `${vehicle}-${tier.id}`,
      title,
      driver: tier.seatLabel ?? 'Tai xe gan ban',
      seatLabel: tier.seatLabel,
      etaMinutes: estimateMinutes,
      eta: `${estimateMinutes} phut`,
      price,
      priceFormatted: formatCurrency(price),
      note: commonNote,
      vehicleLabel: config.label,
    };
  });
}

function normalizeContactName(value) {
  return normalizeText(value || 'Khach hang SmartRide');
}

function normalizeContactPhone(value) {
  return normalizeText(value || '').replace(/\s+/g, '');
}

function normalizePaymentMethod(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (normalizedValue === 'qr' || normalizedValue === 'wallet') {
    return normalizedValue;
  }

  return 'cash';
}

function normalizePaymentProvider(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (normalizedValue === 'momo' || normalizedValue === 'shopeepay') {
    return normalizedValue;
  }

  return 'zalopay';
}

function getPaymentMethodLabel(paymentMethod) {
  return PAYMENT_METHOD_LABELS[paymentMethod] ?? PAYMENT_METHOD_LABELS.cash;
}

function getPaymentProviderLabel(paymentProvider) {
  return PAYMENT_PROVIDER_LABELS[paymentProvider] ?? '';
}

function getPaymentStatus(paymentMethod) {
  return paymentMethod === 'cash' ? 'ChoThuTien' : 'ChoXacNhan';
}

function getPaymentStatusLabel(paymentStatus) {
  return PAYMENT_STATUS_LABELS[paymentStatus] ?? PAYMENT_STATUS_LABELS.ChoXacNhan;
}

function generatePaymentCode(bookingCode) {
  return `TT-${bookingCode}`;
}

function generateBookingCode() {
  const now = new Date();
  const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `SR-${dateStamp}-${randomSuffix}`;
}

function saveRecentBooking(booking) {
  recentBookings.unshift(booking);

  if (recentBookings.length > MAX_RECENT_BOOKINGS) {
    recentBookings.length = MAX_RECENT_BOOKINGS;
  }
}

async function persistBookingToDatabase(booking) {
  if (!isSqlServerConfigured()) {
    return null;
  }

  const paymentCode = generatePaymentCode(booking.bookingCode);
  const paymentStatus = getPaymentStatus(booking.paymentMethod);
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), booking.bookingCode)
      .input('accountId', sql.VarChar(20), booking.customerAccountId || null)
      .input('customerName', sql.NVarChar(100), booking.customerName)
      .input('customerPhone', sql.VarChar(15), booking.customerPhone || null)
      .input('vehicle', sql.VarChar(20), booking.vehicle)
      .input('scheduleEnabled', sql.Bit, booking.scheduleEnabled)
      .input('pickupLabel', sql.NVarChar(255), booking.pickup?.label ?? '')
      .input('destinationLabel', sql.NVarChar(255), booking.destination?.label ?? '')
      .input('routeDistanceKm', sql.Decimal(10, 2), booking.routeDistanceKm ?? null)
      .input('routeProvider', sql.NVarChar(30), booking.routeProvider)
      .input('rideId', sql.VarChar(64), booking.selectedRideId)
      .input('rideTitle', sql.NVarChar(100), booking.rideTitle)
      .input('seatLabel', sql.NVarChar(50), booking.seatLabel || null)
      .input('etaMinutes', sql.Int, booking.etaMinutes)
      .input('price', sql.Int, booking.price)
      .input('paymentMethod', sql.VarChar(20), booking.paymentMethod)
      .input('paymentProvider', sql.VarChar(20), booking.paymentProvider || null)
      .input('paymentStatus', sql.NVarChar(20), paymentStatus)
      .input('createdAt', sql.DateTime2(0), new Date(booking.createdAt))
      .query(`
        INSERT INTO DatXe
        (
          MaChuyen,
          MaTK,
          TenKhachHang,
          SoDienThoai,
          LoaiXe,
          DatLich,
          DiemDon,
          DiemDen,
          QuangDuongKm,
          NguonTuyenDuong,
          MaHangXe,
          TenHangXe,
          LoaiGhe,
          ThoiGianDuKienPhut,
          GiaTien,
          PhuongThucThanhToan,
          NhaCungCapThanhToan,
          TrangThaiThanhToan,
          NgayTao,
          NgayCapNhat
        )
        VALUES
        (
          @bookingCode,
          @accountId,
          @customerName,
          @customerPhone,
          @vehicle,
          @scheduleEnabled,
          @pickupLabel,
          @destinationLabel,
          @routeDistanceKm,
          @routeProvider,
          @rideId,
          @rideTitle,
          @seatLabel,
          @etaMinutes,
          @price,
          @paymentMethod,
          @paymentProvider,
          @paymentStatus,
          @createdAt,
          @createdAt
        )
      `);

    await new sql.Request(transaction)
      .input('paymentCode', sql.VarChar(30), paymentCode)
      .input('bookingCode', sql.VarChar(30), booking.bookingCode)
      .input('amount', sql.Int, booking.price)
      .input('paymentMethod', sql.VarChar(20), booking.paymentMethod)
      .input('paymentProvider', sql.VarChar(20), booking.paymentProvider || null)
      .input('paymentStatus', sql.NVarChar(20), paymentStatus)
      .input('createdAt', sql.DateTime2(0), new Date(booking.createdAt))
      .query(`
        INSERT INTO ThanhToan
        (
          MaTT,
          MaChuyen,
          SoTien,
          PhuongThucThanhToan,
          NhaCungCapThanhToan,
          TrangThaiThanhToan,
          ThoiDiemThanhToan,
          GhiChu,
          NgayTao,
          NgayCapNhat
        )
        VALUES
        (
          @paymentCode,
          @bookingCode,
          @amount,
          @paymentMethod,
          @paymentProvider,
          @paymentStatus,
          NULL,
          NULL,
          @createdAt,
          @createdAt
        )
      `);

    await transaction.commit();

    return {
      paymentCode,
      paymentStatus,
      paymentStatusLabel: getPaymentStatusLabel(paymentStatus),
    };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function searchRides(payload) {
  const vehicle = Object.prototype.hasOwnProperty.call(VEHICLE_CONFIG, payload?.vehicle) ? payload.vehicle : 'motorbike';
  const pickup = normalizeLocation(payload?.pickup, 'Diem don');
  const destination = normalizeLocation(payload?.destination, 'Diem den');

  if (!pickup.label || !destination.label) {
    throw createValidationError('Vui long chon diem don va diem den truoc khi tim chuyen.');
  }

  const config = VEHICLE_CONFIG[vehicle];
  const [resolvedPickupPosition, resolvedDestinationPosition] = await Promise.all([
    resolveLocationPosition(pickup),
    resolveLocationPosition(destination),
  ]);
  const resolvedPickup = {
    ...pickup,
    position: resolvedPickupPosition,
    source: resolvedPickupPosition && pickup.source === 'manual' ? 'geocoded' : pickup.source,
  };
  const resolvedDestination = {
    ...destination,
    position: resolvedDestinationPosition,
    source: resolvedDestinationPosition && destination.source === 'manual' ? 'geocoded' : destination.source,
  };
  const routeMetrics = resolvedPickupPosition && resolvedDestinationPosition
    ? await getShortestRouteMetrics(resolvedPickupPosition, resolvedDestinationPosition)
    : { distanceKm: null, provider: 'manual', geometry: null };
  const routeDistanceKm = Number.isFinite(routeMetrics.distanceKm) ? routeMetrics.distanceKm : config.defaultDistanceKm;
  const billableDistanceKm = Number.isFinite(routeDistanceKm) ? Number(routeDistanceKm.toFixed(1)) : null;
  const estimatedDurationMinutes = estimateDurationMinutes(routeDistanceKm, config, routeMetrics.durationMinutes);
  const vehiclePricing = getVehiclePricing(vehicle);
  const pricingDistanceKm = Number.isFinite(billableDistanceKm) ? billableDistanceKm : routeDistanceKm;
  const estimatedFare = getSummaryFare(pricingDistanceKm, vehiclePricing);
  const pricePerKm = getBaseRatePerKm(vehiclePricing);

  return {
    success: true,
    vehicle,
    scheduleEnabled: Boolean(payload?.scheduleEnabled),
    pickup: resolvedPickup,
    destination: resolvedDestination,
    routeDistanceKm: billableDistanceKm,
    routeGeometry: cloneRouteGeometry(routeMetrics.geometry),
    pricePerKm,
    pricePerKmFormatted: formatRatePerKm(pricePerKm),
    estimatedDurationMinutes,
    estimatedFare,
    estimatedFareFormatted: formatCurrency(estimatedFare),
    routeProvider: routeMetrics.provider,
    results: buildRideResults(
      vehicle,
      pricingDistanceKm,
      estimatedDurationMinutes,
    ),
  };
}

export async function bookRide(payload) {
  const selectedRideId = normalizeText(payload?.selectedRideId);
  const customerAccountId = normalizeText(payload?.accountId);
  const customerName = normalizeContactName(payload?.customerName);
  const customerPhone = normalizeContactPhone(payload?.customerPhone);
  const paymentMethod = normalizePaymentMethod(payload?.paymentMethod);
  const paymentProvider = paymentMethod === 'wallet' ? normalizePaymentProvider(payload?.paymentProvider) : '';

  if (!selectedRideId) {
    throw createValidationError('Vui long chon hang xe truoc khi dat xe.');
  }

  const quoteResult = await searchRides({
    vehicle: payload?.vehicle,
    scheduleEnabled: payload?.scheduleEnabled,
    pickup: payload?.pickup,
    destination: payload?.destination,
  });

  const selectedRide = quoteResult.results.find((ride) => ride.id === selectedRideId);

  if (!selectedRide) {
    throw createValidationError('Hang xe da chon khong ton tai hoac da thay doi gia. Vui long tim lai chuyen.');
  }

  const booking = {
    bookingCode: generateBookingCode(),
    createdAt: new Date().toISOString(),
    customerAccountId: customerAccountId || null,
    customerName,
    customerPhone: customerPhone || null,
    vehicle: quoteResult.vehicle,
    vehicleLabel: selectedRide.vehicleLabel,
    scheduleEnabled: quoteResult.scheduleEnabled,
    pickup: quoteResult.pickup,
    destination: quoteResult.destination,
    routeDistanceKm: quoteResult.routeDistanceKm,
    routeProvider: quoteResult.routeProvider,
    selectedRideId: selectedRide.id,
    rideTitle: selectedRide.title,
    seatLabel: selectedRide.seatLabel,
    etaMinutes: selectedRide.etaMinutes,
    price: selectedRide.price,
    priceFormatted: selectedRide.priceFormatted,
    paymentMethod,
    paymentMethodLabel: getPaymentMethodLabel(paymentMethod),
    paymentProvider,
    paymentProviderLabel: paymentProvider ? getPaymentProviderLabel(paymentProvider) : '',
    paymentSummary: paymentProvider ? `${getPaymentMethodLabel(paymentMethod)} - ${getPaymentProviderLabel(paymentProvider)}` : getPaymentMethodLabel(paymentMethod),
  };

  booking.paymentCode = generatePaymentCode(booking.bookingCode);
  booking.paymentStatus = getPaymentStatus(paymentMethod);
  booking.paymentStatusLabel = getPaymentStatusLabel(booking.paymentStatus);

  const persistedPayment = await persistBookingToDatabase(booking);

  if (persistedPayment) {
    booking.paymentCode = persistedPayment.paymentCode;
    booking.paymentStatus = persistedPayment.paymentStatus;
    booking.paymentStatusLabel = persistedPayment.paymentStatusLabel;
  }

  saveRecentBooking(booking);

  return {
    success: true,
    message: `Dat xe thanh cong. Ma chuyen: ${booking.bookingCode}`,
    booking,
  };
}
