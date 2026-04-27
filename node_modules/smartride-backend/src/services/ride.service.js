import sql from 'mssql';
import { searchPlaces } from './places.service.js';
import { env } from '../config/env.js';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';
import { ensureNotificationSchema } from './notification.service.js';
import { listPromotions } from './promotion.service.js';
import { publishRideEvent } from './ride.realtime.service.js';

const VEHICLE_CONFIG = {
  motorbike: {
    label: 'Xe máy',
    speedKmh: 24,
    defaultDistanceKm: 5.5,
    defaultEtaMinutes: 8,
  },
  car: {
    label: 'Ô tô',
    speedKmh: 32,
    defaultDistanceKm: 9.2,
    defaultEtaMinutes: 12,
  },
  intercity: {
    label: 'Xe liên tỉnh',
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
const MAX_RECENT_BOOKINGS = 200;
const recentBookings = [];
let rideSchemaPromise = null;
const PAYMENT_METHOD_LABELS = {
  cash: 'Tiền mặt',
  qr: 'Thanh toán bằng QR code',
  wallet: 'Thanh toán bằng Ví điện tử',
};
const PAYMENT_PROVIDER_LABELS = {
  zalopay: 'Zalo pay',
  momo: 'Momo',
  vnpay: 'VNPay',
};
const TRIP_STATUS_LABELS = {
  ChoTaiXe: 'Chờ tài xế',
  DaNhanChuyen: 'Đã nhận chuyến',
  DangDen: 'Đang đến',
  DaDon: 'Đã đón',
  DangThucHien: 'Đang thực hiện',
  HoanThanh: 'Hoàn thành',
  DaHuy: 'Đã hủy',
};
const TRIP_STATUS_TONES = {
  ChoTaiXe: 'scheduled',
  DaNhanChuyen: 'accepted',
  DangDen: 'progress',
  DaDon: 'picked-up',
  DangThucHien: 'progress',
  HoanThanh: 'success',
  DaHuy: 'cancelled',
};
const TRIP_STATUS_TOKEN_MAP = {
  chotaixe: 'ChoTaiXe',
  choxacnhan: 'ChoTaiXe',
  danhanchuyen: 'DaNhanChuyen',
  accepted: 'DaNhanChuyen',
  dangden: 'DangDen',
  headingpickup: 'DangDen',
  dadon: 'DaDon',
  pickedup: 'DaDon',
  inprogress: 'DangThucHien',
  dangthuchien: 'DangThucHien',
  dangthuchuyen: 'DangThucHien',
  hoanthanh: 'HoanThanh',
  completed: 'HoanThanh',
  dahuy: 'DaHuy',
  cancelled: 'DaHuy',
};
const TRIP_STATUS_TRANSITIONS = {
  ChoTaiXe: new Set(['DaNhanChuyen', 'DaHuy']),
  DaNhanChuyen: new Set(['DangDen', 'DaHuy']),
  DangDen: new Set(['DaDon', 'DaHuy']),
  DaDon: new Set(['DangThucHien']),
  DangThucHien: new Set(['HoanThanh']),
  HoanThanh: new Set([]),
  DaHuy: new Set([]),
};
const DRIVER_RIDE_REQUEST_NOTIFICATION_TITLE = 'Cuốc xe mới';
const DRIVER_RIDE_REQUEST_NOTIFICATION_RECIPIENT = 'driver';
const DRIVER_RIDE_REQUEST_NOTIFICATION_STATUS = 'sent';
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
        label: 'tiết kiệm',
        seatLabel: null,
        basePrice: 13_000,
        extraRate: 5_000,
        extraUnitKm: 1,
      },
      {
        id: 'pho-thong',
        label: 'phổ thông',
        seatLabel: null,
        basePrice: 15_000,
        extraRate: 5_200,
        extraUnitKm: 1,
      },
      {
        id: 'plus',
        label: 'Plus',
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
        label: 'tiết kiệm',
        seatLabel: '4 chỗ',
        basePrice: 25_000,
        extraRate: 10_000,
        extraUnitKm: 1,
      },
      {
        id: 'vip',
        label: 'Vip',
        seatLabel: '4 chỗ',
        basePrice: 27_000,
        extraRate: 11_000,
        extraUnitKm: 1,
      },
      {
        id: 'plus',
        label: 'Plus',
        seatLabel: '7 chỗ',
        basePrice: 28_000,
        extraRate: 12_000,
        extraUnitKm: 1,
      },
      {
        id: 'minibus',
        label: 'MiniBus',
        seatLabel: '16 chỗ',
        basePrice: 30_000,
        extraRate: 14_000,
        extraUnitKm: 1,
      },
      {
        id: 'bus',
        label: 'Bus',
        seatLabel: '30 chỗ',
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
        label: 'tiết kiệm',
        seatLabel: '4 chỗ',
        basePrice: 100_000,
        extraRate: 10_000,
        extraUnitKm: 10,
      },
      {
        id: 'vip',
        label: 'Vip',
        seatLabel: '4 chỗ',
        basePrice: 120_000,
        extraRate: 12_000,
        extraUnitKm: 10,
      },
      {
        id: 'plus',
        label: 'Plus',
        seatLabel: '7 chỗ',
        basePrice: 125_000,
        extraRate: 12_500,
        extraUnitKm: 10,
      },
      {
        id: 'minibus',
        label: 'MiniBus',
        seatLabel: '16 chỗ',
        basePrice: 120_000,
        extraRate: 12_000,
        extraUnitKm: 10,
      },
      {
        id: 'bus',
        label: 'Bus',
        seatLabel: '30 chỗ',
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

let pricingTableCache = clonePricingTable(DEFAULT_PRICING_TABLE);

function getPricingTable() {
  return pricingTableCache;
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeStatusToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
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

function serializeRouteGeometry(routeGeometry) {
  const normalizedRouteGeometry = cloneRouteGeometry(routeGeometry)?.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) ?? null;

  if (!normalizedRouteGeometry || normalizedRouteGeometry.length < 2) {
    return null;
  }

  try {
    return JSON.stringify(normalizedRouteGeometry);
  } catch {
    return null;
  }
}

function normalizeStoredRouteGeometry(routeGeometryValue) {
  if (Array.isArray(routeGeometryValue)) {
    const normalizedRouteGeometry = routeGeometryValue
      .map((point) => {
        if (!point || typeof point !== 'object') {
          return null;
        }

        const lat = Number(point.lat);
        const lng = Number(point.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return { lat, lng };
      })
      .filter(Boolean);

    return normalizedRouteGeometry.length >= 2 ? normalizedRouteGeometry : null;
  }

  const normalizedValue = normalizeText(routeGeometryValue);

  if (!normalizedValue) {
    return null;
  }

  try {
    return normalizeStoredRouteGeometry(JSON.parse(normalizedValue));
  } catch {
    return null;
  }
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
    const searchResult = await searchPlaces(label, { preferFallback: true });
    const resolvedPosition = extractFirstPositionFromSearch(searchResult?.results);

    if (resolvedPosition) {
      setCachedLocationPosition(cacheKey, resolvedPosition);
      return resolvedPosition;
    }
  } catch (error) {
    void error;
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
      if (response.status === 429) {
        setCachedRouteMetrics(cacheKey, fallbackMetrics);
        return fallbackMetrics;
      }

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
    if (error?.name !== 'AbortError' && !String(error?.message ?? '').includes('429')) {
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

function createNotFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function createForbiddenError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function parseTripStatus(value) {
  const normalizedToken = normalizeStatusToken(value);

  if (!normalizedToken) {
    return null;
  }

  return TRIP_STATUS_TOKEN_MAP[normalizedToken] ?? null;
}

function normalizeTripStatus(value) {
  return parseTripStatus(value) ?? 'ChoTaiXe';
}

function getTripStatusLabel(tripStatus) {
  return TRIP_STATUS_LABELS[normalizeTripStatus(tripStatus)] ?? TRIP_STATUS_LABELS.ChoTaiXe;
}

function getTripStatusTone(tripStatus) {
  return TRIP_STATUS_TONES[normalizeTripStatus(tripStatus)] ?? TRIP_STATUS_TONES.ChoTaiXe;
}

function canTransitionTripStatus(currentStatus, nextStatus) {
  const normalizedCurrentStatus = normalizeTripStatus(currentStatus);
  const normalizedNextStatus = parseTripStatus(nextStatus);

  if (!normalizedNextStatus) {
    return false;
  }

  if (normalizedCurrentStatus === normalizedNextStatus) {
    return true;
  }

  return TRIP_STATUS_TRANSITIONS[normalizedCurrentStatus]?.has(normalizedNextStatus) ?? false;
}

function normalizeCancellationMeta(cancelMeta = {}) {
  return {
    cancelledByAccountId: normalizeText(cancelMeta.cancelledByAccountId ?? cancelMeta.cancelledById ?? ''),
    cancelledByRoleCode: normalizeText(cancelMeta.cancelledByRoleCode ?? cancelMeta.cancelledByRole ?? cancelMeta.roleCode ?? ''),
    cancelReason: normalizeText(
      cancelMeta.cancelReason
      ?? cancelMeta.cancelReasonText
      ?? cancelMeta.reasonText
      ?? cancelMeta.reasonLabel
      ?? cancelMeta.cancelReasonCustomReason
      ?? '',
    ),
  };
}

function serializeCancellationMeta(cancelMeta = {}) {
  const normalizedCancellationMeta = normalizeCancellationMeta(cancelMeta);

  if (!normalizedCancellationMeta.cancelledByAccountId && !normalizedCancellationMeta.cancelledByRoleCode && !normalizedCancellationMeta.cancelReason) {
    return '';
  }

  return [
    normalizedCancellationMeta.cancelledByRoleCode || '',
    normalizedCancellationMeta.cancelledByAccountId || '',
    normalizedCancellationMeta.cancelReason || '',
  ].join('|||');
}

function parseCancellationMeta(rawValue = '') {
  const normalizedValue = normalizeText(rawValue);

  if (!normalizedValue) {
    return normalizeCancellationMeta();
  }

  if (normalizedValue.startsWith('{')) {
    try {
      const parsedValue = JSON.parse(normalizedValue);

      return normalizeCancellationMeta(parsedValue);
    } catch {
      // Fall through to the delimiter-based format.
    }
  }

  const parts = normalizedValue.split('|||');

  if (parts.length >= 3) {
    return normalizeCancellationMeta({
      cancelledByRoleCode: parts[0],
      cancelledByAccountId: parts[1],
      cancelReason: parts.slice(2).join('|||'),
    });
  }

  return normalizeCancellationMeta({ cancelReason: normalizedValue });
}

function buildTripStatusResult(bookingCode, tripStatus, updatedAt = new Date(), driverAccountId = null, cancelMeta = {}) {
  const normalizedTripStatus = normalizeTripStatus(tripStatus);
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const normalizedCancellationMeta = normalizeCancellationMeta(cancelMeta);

  return {
    success: true,
    bookingCode,
    tripStatus: normalizedTripStatus,
    tripStatusLabel: getTripStatusLabel(normalizedTripStatus),
    tripStatusTone: getTripStatusTone(normalizedTripStatus),
    updatedAt: Number.isNaN(updatedAtDate.getTime()) ? new Date().toISOString() : updatedAtDate.toISOString(),
    driverAccountId: normalizeText(driverAccountId) || '',
    cancelledByAccountId: normalizedCancellationMeta.cancelledByAccountId,
    cancelledByRoleCode: normalizedCancellationMeta.cancelledByRoleCode,
    cancelReason: normalizedCancellationMeta.cancelReason,
  };
}

export async function ensureRideSchema() {
  if (!isSqlServerConfigured()) {
    throw createValidationError('Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.');
  }

  if (!rideSchemaPromise) {
    rideSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'MaTX') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD MaTX VARCHAR(20) NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'MaTBThongBaoTaiXe') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD MaTBThongBaoTaiXe INT NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'LyDoHuy') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD LyDoHuy NVARCHAR(500) NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'TuyenDuongJson') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD TuyenDuongJson NVARCHAR(MAX) NULL;
        END
      `);

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.DanhGiaChuyenXe', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.DanhGiaChuyenXe
          (
            MaDanhGia INT IDENTITY(1,1) NOT NULL,
            MaChuyen VARCHAR(30) NOT NULL,
            MaTK VARCHAR(20) NULL,
            MaTX VARCHAR(20) NULL,
            SoSaoDanhGia INT NOT NULL,
            NhanXetDanhGia NVARCHAR(1000) NULL,
            ThoiDiemDanhGia DATETIME2(0) NOT NULL CONSTRAINT DF_DanhGiaChuyenXe_ThoiDiemDanhGia DEFAULT SYSDATETIME(),
            NgayTao DATETIME2(0) NOT NULL CONSTRAINT DF_DanhGiaChuyenXe_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat DATETIME2(0) NOT NULL CONSTRAINT DF_DanhGiaChuyenXe_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_DanhGiaChuyenXe PRIMARY KEY (MaDanhGia),
            CONSTRAINT UQ_DanhGiaChuyenXe_MaChuyen UNIQUE (MaChuyen),
            CONSTRAINT FK_DanhGiaChuyenXe_DatXe FOREIGN KEY (MaChuyen)
              REFERENCES dbo.DatXe(MaChuyen)
              ON UPDATE NO ACTION
              ON DELETE CASCADE,
            CONSTRAINT FK_DanhGiaChuyenXe_TaiKhoan FOREIGN KEY (MaTK)
              REFERENCES dbo.TaiKhoan(MaTK)
              ON UPDATE CASCADE
              ON DELETE SET NULL,
            CONSTRAINT FK_DanhGiaChuyenXe_TaiXe FOREIGN KEY (MaTX)
              REFERENCES dbo.TaiXe(CCCD)
              ON UPDATE NO ACTION
              ON DELETE SET NULL,
            CONSTRAINT CK_DanhGiaChuyenXe_SoSao CHECK (SoSaoDanhGia BETWEEN 1 AND 5)
          );
        END
      `);

      await pool.request().query(`
        CREATE OR ALTER TRIGGER dbo.TR_TaiKhoan_SetNgayCapNhat
        ON dbo.TaiKhoan
        AFTER UPDATE
        AS
        BEGIN
          SET NOCOUNT ON;

          UPDATE tk
          SET tk.NgayCapNhat = SYSDATETIME()
          FROM dbo.TaiKhoan AS tk
          WHERE EXISTS (
            SELECT 1
            FROM inserted AS i
            WHERE i.MaTK = tk.MaTK
          );
        END
      `);

      await pool.request().query(`
        CREATE OR ALTER TRIGGER dbo.TR_TaiXe_SetNgayCapNhat
        ON dbo.TaiXe
        AFTER UPDATE
        AS
        BEGIN
          SET NOCOUNT ON;

          UPDATE tx
          SET tx.NgayCapNhat = SYSDATETIME()
          FROM dbo.TaiXe AS tx
          WHERE EXISTS (
            SELECT 1
            FROM inserted AS i
            WHERE i.MaTK = tx.MaTK
          );
        END
      `);

      await pool.request().query(`
        CREATE OR ALTER TRIGGER dbo.TR_DatXe_SetNgayCapNhat
        ON dbo.DatXe
        AFTER UPDATE
        AS
        BEGIN
          SET NOCOUNT ON;

          UPDATE dx
          SET dx.NgayCapNhat = SYSDATETIME()
          FROM dbo.DatXe AS dx
          WHERE EXISTS (
            SELECT 1
            FROM inserted AS i
            WHERE i.MaChuyen = dx.MaChuyen
          );
        END
      `);

      await pool.request().query(`
        CREATE OR ALTER TRIGGER dbo.TR_ThanhToan_SetNgayCapNhat
        ON dbo.ThanhToan
        AFTER UPDATE
        AS
        BEGIN
          SET NOCOUNT ON;

          UPDATE tt
          SET tt.NgayCapNhat = SYSDATETIME()
          FROM dbo.ThanhToan AS tt
          WHERE EXISTS (
            SELECT 1
            FROM inserted AS i
            WHERE i.MaTT = tt.MaTT
          );
        END
      `);

      await pool.request().query(`
        UPDATE dx
        SET MaTX = tx.CCCD
        FROM dbo.DatXe dx
        INNER JOIN dbo.TaiXe tx
          ON tx.MaTK = dx.MaTX
        WHERE dx.MaTX IS NOT NULL
          AND LOWER(ISNULL(dx.MaTX, '')) <> LOWER(ISNULL(tx.CCCD, ''));

        UPDATE dx
        SET MaTX = NULL
        FROM dbo.DatXe dx
        WHERE dx.MaTX IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TaiXe tx
            WHERE LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
          );
      `);

      await pool.request().query(`
        BEGIN TRY
          IF EXISTS (
            SELECT 1
            FROM sys.foreign_keys
            WHERE name = N'FK_DatXe_TaiXe'
              AND parent_object_id = OBJECT_ID(N'dbo.DatXe')
          )
          BEGIN
            ALTER TABLE dbo.DatXe DROP CONSTRAINT FK_DatXe_TaiXe;
          END
        END TRY
        BEGIN CATCH
          IF ERROR_NUMBER() NOT IN (3727, 3728)
          BEGIN
            THROW;
          END
        END CATCH
      `);

      await pool.request().query(`
        BEGIN TRY
          IF NOT EXISTS (
            SELECT 1
            FROM sys.foreign_keys
            WHERE name = N'FK_DatXe_TaiXe'
              AND parent_object_id = OBJECT_ID(N'dbo.DatXe')
          )
          BEGIN
            ALTER TABLE dbo.DatXe
            ADD CONSTRAINT FK_DatXe_TaiXe FOREIGN KEY (MaTX)
                REFERENCES dbo.TaiXe(CCCD)
                ON UPDATE NO ACTION
                ON DELETE SET NULL;
          END
        END TRY
        BEGIN CATCH
          IF ERROR_NUMBER() NOT IN (2714, 3727, 3728)
          BEGIN
            THROW;
          END
        END CATCH
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'GiaGoc') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD GiaGoc INT NULL;
        END

        IF COL_LENGTH(N'dbo.DatXe', N'TienGiam') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD TienGiam INT NULL;
        END

        IF COL_LENGTH(N'dbo.DatXe', N'MaUuDai') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD MaUuDai VARCHAR(40) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXe', N'TenUuDai') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD TenUuDai NVARCHAR(120) NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.ThanhToan', N'GiaGoc') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD GiaGoc INT NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'TienGiam') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD TienGiam INT NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'MaUuDai') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD MaUuDai VARCHAR(40) NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'TenUuDai') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD TenUuDai NVARCHAR(120) NULL;
        END
      `);

      await pool.request().query(`
        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_DatXe_TrangThaiChuyen'
            AND parent_object_id = OBJECT_ID(N'dbo.DatXe')
            AND OBJECT_DEFINITION(object_id) NOT LIKE N'%N''DangThucHien''%'
        )
        BEGIN
          ALTER TABLE dbo.DatXe DROP CONSTRAINT CK_DatXe_TrangThaiChuyen;
        END

        IF NOT EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_DatXe_TrangThaiChuyen'
            AND parent_object_id = OBJECT_ID(N'dbo.DatXe')
        )
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD CONSTRAINT CK_DatXe_TrangThaiChuyen CHECK (TrangThaiChuyen IN (N'ChoTaiXe', N'DaNhanChuyen', N'DangDen', N'DaDon', N'DangThucHien', N'HoanThanh', N'DaHuy'));
        END
      `);
    })().catch((error) => {
      rideSchemaPromise = null;
      throw error;
    });
  }

  return rideSchemaPromise;
}

async function resolveDriverCccd(transaction, driverIdentifier) {
  const normalizedDriverIdentifier = normalizeText(driverIdentifier);

  if (!normalizedDriverIdentifier) {
    return '';
  }

  const queryResult = await new sql.Request(transaction)
    .input('driverIdentifier', sql.VarChar(20), normalizedDriverIdentifier)
    .query(`
      SELECT TOP 1
        tx.CCCD
      FROM TaiXe tx
      WHERE
        LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier)
        OR LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverIdentifier)
      ORDER BY CASE WHEN LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier) THEN 0 ELSE 1 END;
    `);

  return normalizeText(queryResult.recordset?.[0]?.CCCD);
}

async function resolveDriverStatus(transaction, driverIdentifier) {
  const normalizedDriverIdentifier = normalizeText(driverIdentifier);

  if (!normalizedDriverIdentifier) {
    return '';
  }

  const queryResult = await new sql.Request(transaction)
    .input('driverIdentifier', sql.VarChar(20), normalizedDriverIdentifier)
    .query(`
      SELECT TOP 1
        tx.TrangThai AS DriverStatus
      FROM TaiXe tx
      WHERE
        LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier)
        OR LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverIdentifier)
      ORDER BY CASE WHEN LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier) THEN 0 ELSE 1 END;
    `);

  return normalizeText(queryResult.recordset?.[0]?.DriverStatus);
}

function isDriverReadyStatus(driverStatus) {
  const normalizedDriverStatus = normalizeStatusToken(driverStatus);

  return normalizedDriverStatus === 'hoatdong' || normalizedDriverStatus === 'hoantat';
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

function normalizePromotionLookupId(value) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function normalizePromotionLookupCode(value) {
  return normalizeText(value).toUpperCase();
}

function calculatePromotionPricing(basePrice, promotion = null) {
  const originalPrice = roundCurrency(basePrice);

  if (!promotion) {
    return {
      originalPrice,
      discountAmount: 0,
      finalPrice: originalPrice,
    };
  }

  const discountPercent = Number(promotion.discountPercent ?? 0);
  const maxAmount = Number(promotion.maxAmount ?? 0);
  const safeDiscountPercent = Number.isFinite(discountPercent) && discountPercent > 0 ? discountPercent : 0;
  const rawDiscountAmount = roundCurrency(originalPrice * safeDiscountPercent / 100);
  const limitedDiscountAmount = Number.isFinite(maxAmount) && maxAmount > 0
    ? Math.min(rawDiscountAmount, roundCurrency(maxAmount))
    : rawDiscountAmount;
  const discountAmount = Math.min(originalPrice, Math.max(0, limitedDiscountAmount));
  const finalPrice = Math.max(0, originalPrice - discountAmount);

  return {
    originalPrice,
    discountAmount,
    finalPrice,
  };
}

function buildPromotionSummaryText(promotion = null, discountAmount = 0) {
  if (!promotion) {
    return '';
  }

  const promotionCode = normalizeText(promotion.code);
  const promotionTitle = normalizeText(promotion.title);
  const parts = [];

  if (promotionCode) {
    parts.push(`Mã ${promotionCode}`);
  }

  if (promotionTitle && promotionTitle !== promotionCode) {
    parts.push(promotionTitle);
  }

  if (discountAmount > 0) {
    parts.push(`Giảm ${formatCurrency(discountAmount)}`);
  }

  return parts.join(' · ').trim();
}

async function resolveBookingPromotion(payload = {}) {
  const promotionId = normalizePromotionLookupId(payload?.promotionId);
  const promotionCode = normalizePromotionLookupCode(payload?.promotionCode);
  const hasPromotionPayload = promotionId !== null || Boolean(promotionCode);

  if (!hasPromotionPayload) {
    return null;
  }

  if (isSqlServerConfigured()) {
    const promotionResult = await listPromotions({ status: 'active' });
    const activePromotions = Array.isArray(promotionResult?.promotions) ? promotionResult.promotions : [];
    let resolvedPromotion = null;

    if (promotionId !== null) {
      resolvedPromotion = activePromotions.find((promotion) => Number(promotion.id) === promotionId) ?? null;
    }

    if (!resolvedPromotion && promotionCode) {
      resolvedPromotion = activePromotions.find((promotion) => normalizePromotionLookupCode(promotion.code) === promotionCode) ?? null;
    }

    if (!resolvedPromotion) {
      throw createValidationError('Ma uu dai khong hop le hoac da het han. Vui long chon lai.');
    }

    return resolvedPromotion;
  }

  const fallbackDiscountPercent = Number(payload?.promotionDiscountPercent);
  const fallbackMaxAmount = Number(payload?.promotionMaxAmount);
  const fallbackPromotionTitle = normalizeText(payload?.promotionTitle);
  const fallbackPromotionScope = normalizeText(payload?.promotionScope);
  const fallbackPromotionExpiresAt = normalizeText(payload?.promotionExpiresAt);

  if (!Number.isFinite(fallbackDiscountPercent) || fallbackDiscountPercent <= 0) {
    return null;
  }

  return {
    id: promotionId,
    code: promotionCode,
    title: fallbackPromotionTitle,
    scope: fallbackPromotionScope,
    discountPercent: fallbackDiscountPercent,
    maxAmount: Number.isFinite(fallbackMaxAmount) && fallbackMaxAmount >= 0 ? fallbackMaxAmount : 0,
    expiresAt: fallbackPromotionExpiresAt,
    status: 'active',
  };
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
      driver: tier.seatLabel ?? 'Tài xế gần bạn',
      seatLabel: tier.seatLabel,
      etaMinutes: estimateMinutes,
      eta: `${estimateMinutes} phút`,
      price,
      priceFormatted: formatCurrency(price),
      note: commonNote,
      vehicleLabel: config.label,
    };
  });
}

function normalizeContactName(value) {
  return normalizeText(value || 'Khách hàng SmartRide');
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

  if (normalizedValue === 'momo' || normalizedValue === 'zalopay' || normalizedValue === 'vnpay') {
    return normalizedValue;
  }

  return 'vnpay';
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

function buildDriverRideRequestNotificationContent(booking) {
  return JSON.stringify({
    type: 'ride_request',
    source: 'booking',
    bookingCode: booking.bookingCode,
    customerAccountId: booking.customerAccountId,
    driverAccountId: booking.driverAccountId,
    createdAt: booking.createdAt,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    vehicle: booking.vehicle,
    vehicleLabel: booking.vehicleLabel,
    rideTitle: booking.rideTitle,
    seatLabel: booking.seatLabel,
    etaMinutes: booking.etaMinutes,
    priceFormatted: booking.priceFormatted,
    paymentSummary: booking.paymentSummary,
    routeDistanceKm: booking.routeDistanceKm,
    routeProvider: booking.routeProvider,
    pickup: booking.pickup,
    destination: booking.destination,
    routeGeometry: booking.routeGeometry,
  });
}

function cloneRideBookingSnapshot(booking) {
  if (!booking || typeof booking !== 'object') {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(booking));
  } catch {
    return null;
  }
}

function buildRideBookingCreatedEvent(booking) {
  const bookingSnapshot = cloneRideBookingSnapshot(booking);

  if (!bookingSnapshot) {
    return null;
  }

  return {
    type: 'ride.booking.created',
    routingKey: 'ride.booking.created',
    bookingCode: normalizeText(bookingSnapshot.bookingCode),
    customerAccountId: normalizeText(bookingSnapshot.customerAccountId),
    driverAccountId: normalizeText(bookingSnapshot.driverAccountId),
    tripStatus: normalizeTripStatus(bookingSnapshot.tripStatus),
    tripStatusLabel: getTripStatusLabel(bookingSnapshot.tripStatus),
    tripStatusTone: getTripStatusTone(bookingSnapshot.tripStatus),
    audience: ['customer', 'driver'],
    booking: bookingSnapshot,
    source: 'booking',
    createdAt: bookingSnapshot.createdAt,
  };
}

function buildRideTripStatusUpdatedEvent(bookingCode, tripStatusResult, currentRow = null, bookingSnapshot = null) {
  const resolvedBooking = cloneRideBookingSnapshot(bookingSnapshot ?? findRecentBookingByCode(bookingCode)) ?? {};
  const customerAccountId = normalizeText(currentRow?.MaTK ?? currentRow?.customerAccountId ?? resolvedBooking?.customerAccountId);
  const driverAccountId = normalizeText(
    tripStatusResult?.driverAccountId
      ?? currentRow?.driverAccountId
      ?? resolvedBooking?.driverAccountId
      ?? currentRow?.MaTX,
  );
  const driverVehicleLicensePlate = normalizeText(
    currentRow?.driverVehicleLicensePlate ?? resolvedBooking?.driverVehicleLicensePlate ?? resolvedBooking?.driverLicensePlate,
  );
  const driverVehicleName = normalizeText(currentRow?.driverVehicleName ?? resolvedBooking?.driverVehicleName);

  if (driverVehicleLicensePlate) {
    resolvedBooking.driverVehicleLicensePlate = driverVehicleLicensePlate;
    resolvedBooking.driverLicensePlate = driverVehicleLicensePlate;
  }

  if (driverVehicleName) {
    resolvedBooking.driverVehicleName = driverVehicleName;
  }

  const driverRequestNotificationId = Number(
    currentRow?.driverRequestNotificationId ?? resolvedBooking?.driverRequestNotificationId ?? 0,
  );

  if (Number.isInteger(driverRequestNotificationId) && driverRequestNotificationId > 0) {
    resolvedBooking.driverRequestNotificationId = driverRequestNotificationId;
  }

  return {
    type: 'ride.trip.status.updated',
    routingKey: 'ride.trip.status.updated',
    bookingCode: normalizeText(bookingCode),
    customerAccountId,
    driverAccountId,
    cancelledByAccountId: normalizeText(tripStatusResult?.cancelledByAccountId ?? resolvedBooking?.cancelledByAccountId),
    cancelledByRoleCode: normalizeText(tripStatusResult?.cancelledByRoleCode ?? resolvedBooking?.cancelledByRoleCode),
    cancelReason: normalizeText(tripStatusResult?.cancelReason ?? resolvedBooking?.cancelReason),
    tripStatus: normalizeTripStatus(tripStatusResult?.tripStatus),
    tripStatusLabel: normalizeText(tripStatusResult?.tripStatusLabel),
    tripStatusTone: normalizeText(tripStatusResult?.tripStatusTone),
    audience: ['customer', ...(driverAccountId ? ['driver'] : [])],
    booking: resolvedBooking,
    source: 'status-update',
    createdAt: tripStatusResult?.updatedAt ?? new Date().toISOString(),
  };
}

function buildRideTripRatingUpdatedEvent(bookingCode, ratingResult, currentRow = null, bookingSnapshot = null) {
  const resolvedBooking = cloneRideBookingSnapshot(bookingSnapshot ?? findRecentBookingByCode(bookingCode)) ?? {};
  const customerAccountId = normalizeText(currentRow?.customerAccountId ?? currentRow?.MaTK ?? resolvedBooking?.customerAccountId);
  const driverAccountId = normalizeText(
    currentRow?.driverAccountId
      ?? resolvedBooking?.driverAccountId
      ?? currentRow?.MaTX,
  );
  const normalizedRatingScore = Number(
    ratingResult?.ratingScore ?? currentRow?.ratingScore ?? resolvedBooking?.ratingScore,
  );
  const ratingScore = Number.isFinite(normalizedRatingScore) && normalizedRatingScore > 0 ? normalizedRatingScore : null;
  const ratingComment = normalizeText(
    ratingResult?.ratingComment ?? currentRow?.ratingComment ?? resolvedBooking?.ratingComment,
  );
  const ratingSubmittedAt = normalizeText(
    ratingResult?.ratingSubmittedAt ?? currentRow?.ratingSubmittedAt ?? resolvedBooking?.ratingSubmittedAt,
  );

  if (ratingScore !== null) {
    resolvedBooking.ratingScore = ratingScore;
  }

  if (ratingComment) {
    resolvedBooking.ratingComment = ratingComment;
  }

  if (ratingSubmittedAt) {
    resolvedBooking.ratingSubmittedAt = ratingSubmittedAt;
  }

  return {
    type: 'ride.trip.rating.updated',
    routingKey: 'ride.trip.rating.updated',
    bookingCode: normalizeText(bookingCode),
    customerAccountId,
    driverAccountId,
    ratingScore,
    ratingComment,
    ratingSubmittedAt,
    audience: ['customer', ...(driverAccountId ? ['driver'] : [])],
    booking: resolvedBooking,
    source: 'rating-update',
    createdAt: ratingSubmittedAt || new Date().toISOString(),
  };
}

function publishRideEventSafely(event) {
  if (!event) {
    return;
  }

  void publishRideEvent(event).catch((error) => {
    console.warn('[realtime] Không thể đồng bộ sự kiện chuyến xe:', error);
  });
}

function saveRecentBooking(booking) {
  recentBookings.unshift(booking);

  if (recentBookings.length > MAX_RECENT_BOOKINGS) {
    recentBookings.length = MAX_RECENT_BOOKINGS;
  }
}

function findRecentBookingByCode(bookingCode) {
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedBookingCode) {
    return null;
  }

  return recentBookings.find((booking) => normalizeText(booking.bookingCode) === normalizedBookingCode) ?? null;
}

function updateRecentBookingTripStatus(bookingCode, tripStatus, driverAccountId = '', cancelMeta = {}) {
  const booking = findRecentBookingByCode(bookingCode);

  if (!booking) {
    return null;
  }

  const normalizedTripStatus = normalizeTripStatus(tripStatus);
  const normalizedDriverAccountId = normalizeText(driverAccountId);
  const currentDriverAccountId = normalizeText(booking.driverAccountId);

  if (normalizedTripStatus === 'DaNhanChuyen') {
    if (!normalizedDriverAccountId) {
      throw createValidationError('Vui lòng cung cấp tài khoản tài xế để nhận chuyến.');
    }

    if (currentDriverAccountId && currentDriverAccountId.toLowerCase() !== normalizedDriverAccountId.toLowerCase()) {
      throw createValidationError('Đã có tài xế khác nhận đơn');
    }

    booking.driverAccountId = normalizedDriverAccountId;
  } else if (!currentDriverAccountId && normalizedDriverAccountId) {
    booking.driverAccountId = normalizedDriverAccountId;
  }

  booking.tripStatus = normalizedTripStatus;
  booking.tripStatusLabel = getTripStatusLabel(booking.tripStatus);
  booking.tripStatusTone = getTripStatusTone(booking.tripStatus);
  booking.updatedAt = new Date().toISOString();

  if (normalizedTripStatus === 'DaHuy') {
    const normalizedCancellationMeta = normalizeCancellationMeta(cancelMeta);

    booking.cancelledByAccountId = normalizedCancellationMeta.cancelledByAccountId;
    booking.cancelledByRoleCode = normalizedCancellationMeta.cancelledByRoleCode;
    booking.cancelReason = normalizedCancellationMeta.cancelReason;
  }

  return booking;
}

function updateRecentBookingRating(bookingCode, ratingScore, ratingComment = '', ratingSubmittedAt = '') {
  const booking = findRecentBookingByCode(bookingCode);

  if (!booking) {
    return null;
  }

  booking.ratingScore = ratingScore;
  booking.ratingComment = normalizeText(ratingComment);
  booking.ratingSubmittedAt = ratingSubmittedAt || new Date().toISOString();
  booking.updatedAt = booking.ratingSubmittedAt;

  return booking;
}

function buildTripStatusSqlRequest(transaction, bookingCode, tripStatus, driverAccountId = null, cancelMeta = {}) {
  const cancellationPayload = serializeCancellationMeta(cancelMeta);

  return new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .input('tripStatus', sql.NVarChar(20), tripStatus)
    .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
    .input('cancelReasonPayload', sql.NVarChar(500), cancellationPayload || null);
}

async function readTripStatusRow(transaction, bookingCode) {
  const queryResult = await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP 1
        dx.MaChuyen,
        dx.MaTK,
        dx.MaTX,
        dx.MaTBThongBaoTaiXe AS driverRequestNotificationId,
        dx.LyDoHuy AS cancelReasonRaw,
        dx.TrangThaiChuyen,
        dx.NgayCapNhat,
        tx.MaTK AS driverAccountId,
        tx.CCCD AS driverCccd,
        JSON_VALUE(tx.ThongTinXe, '$.licensePlate') AS driverVehicleLicensePlate,
        JSON_VALUE(tx.ThongTinXe, '$.name') AS driverVehicleName
      FROM DatXe dx WITH (UPDLOCK, ROWLOCK)
      LEFT JOIN TaiXe tx
        ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
      WHERE dx.MaChuyen = @bookingCode
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function resolveDriverRideRequestNotificationId(transaction, bookingCode, preferredNotificationId = null) {
  const normalizedPreferredNotificationId = Number(preferredNotificationId);

  if (Number.isInteger(normalizedPreferredNotificationId) && normalizedPreferredNotificationId > 0) {
    return normalizedPreferredNotificationId;
  }

  const notificationTitle = `${DRIVER_RIDE_REQUEST_NOTIFICATION_TITLE} ${normalizeText(bookingCode)}`;
  const queryResult = await new sql.Request(transaction)
    .input('notificationTitle', sql.NVarChar(200), notificationTitle)
    .input('recipient', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_RECIPIENT)
    .input('status', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_STATUS)
    .query(`
      SELECT TOP 1
        tb.MaTB
      FROM dbo.ThongBao tb
      WHERE tb.TieuDe = @notificationTitle
        AND tb.NguoiNhan = @recipient
        AND tb.TrangThai = @status
      ORDER BY tb.MaTB DESC;
    `);

  return Number(queryResult.recordset?.[0]?.MaTB ?? 0) || null;
}

async function updateTripStatusInDatabase(bookingCode, tripStatus, driverAccountId = '', cancelMeta = {}) {
  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const currentRow = await readTripStatusRow(transaction, bookingCode);

    if (!currentRow) {
      throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
    }

    const currentTripStatus = normalizeTripStatus(currentRow.TrangThaiChuyen);
    const normalizedTripStatus = parseTripStatus(tripStatus);
    const normalizedDriverAccountId = normalizeText(driverAccountId);
    const currentDriverCccd = normalizeText(currentRow.MaTX);
    const resolvedDriverCccd = normalizedDriverAccountId
      ? await resolveDriverCccd(transaction, normalizedDriverAccountId)
      : '';
    const resolvedDriverStatus = normalizedDriverAccountId
      ? await resolveDriverStatus(transaction, normalizedDriverAccountId)
      : '';
    const driverTripId = resolvedDriverCccd || normalizedDriverAccountId;

    if (!normalizedTripStatus) {
      throw createValidationError('Trang thai chuyen khong hop le.');
    }

    if (normalizedTripStatus === 'DaHuy' && ['DaDon', 'DangThucHien'].includes(currentTripStatus)) {
      throw createValidationError('Không thể hủy chuyến sau khi khách đã được đón.');
    }

    if (!canTransitionTripStatus(currentTripStatus, normalizedTripStatus)) {
      throw createValidationError('Khong the cap nhat trang thai chuyen theo thu tu hien tai.');
    }

    if (normalizedDriverAccountId && !resolvedDriverCccd) {
      throw createValidationError('Không tìm thấy thông tin tài xế hợp lệ.');
    }

    if (normalizedTripStatus === 'DaNhanChuyen' && !driverTripId) {
      throw createValidationError('Vui lòng cung cấp tài khoản tài xế để nhận chuyến.');
    }

    if (normalizedTripStatus === 'DaNhanChuyen' && !isDriverReadyStatus(resolvedDriverStatus)) {
      throw createValidationError('Tài khoản tài xế chưa ở trạng thái hoạt động.');
    }

    if (currentDriverCccd && driverTripId && currentDriverCccd.toLowerCase() !== driverTripId.toLowerCase()) {
      throw createValidationError('Đã có tài xế khác nhận đơn');
    }

    await buildTripStatusSqlRequest(transaction, bookingCode, normalizedTripStatus, driverTripId || null, cancelMeta)
      .query(`
        UPDATE DatXe
        SET
          TrangThaiChuyen = @tripStatus,
          MaTX = CASE
            WHEN @tripStatus = N'DaNhanChuyen' THEN COALESCE(MaTX, @driverAccountId)
            ELSE MaTX
          END,
          LyDoHuy = CASE
            WHEN @tripStatus = N'DaHuy' THEN NULLIF(@cancelReasonPayload, '')
            ELSE LyDoHuy
          END
        WHERE MaChuyen = @bookingCode;
      `);

      if (normalizedTripStatus === 'DaNhanChuyen' || normalizedTripStatus === 'DaHuy') {
        const driverRequestNotificationId = await resolveDriverRideRequestNotificationId(
          transaction,
          bookingCode,
          currentRow?.driverRequestNotificationId,
        );

        if (driverRequestNotificationId) {
          await new sql.Request(transaction)
            .input('notificationId', sql.Int, driverRequestNotificationId)
            .query(`
              DELETE FROM dbo.ThongBao
              WHERE MaTB = @notificationId;
            `);
        }
      }

    const updatedRow = await readTripStatusRow(transaction, bookingCode);

    await transaction.commit();

    const updatedBooking = updateRecentBookingTripStatus(
      bookingCode,
      normalizedTripStatus,
      normalizedDriverAccountId || driverTripId,
      cancelMeta,
    );
    const normalizedCancellationMeta = normalizeCancellationMeta({
      ...cancelMeta,
      ...parseCancellationMeta(updatedRow?.cancelReasonRaw ?? currentRow?.cancelReasonRaw ?? ''),
    });
    const tripStatusResult = buildTripStatusResult(
      normalizeText(updatedRow?.MaChuyen ?? bookingCode),
      updatedRow?.TrangThaiChuyen ?? normalizedTripStatus,
      updatedRow?.NgayCapNhat ?? new Date(),
      normalizeText(updatedRow?.driverAccountId ?? currentRow?.driverAccountId ?? normalizedDriverAccountId) || null,
      normalizedCancellationMeta,
    );

    publishRideEventSafely(
      buildRideTripStatusUpdatedEvent(
        bookingCode,
        tripStatusResult,
        {
          ...currentRow,
          ...updatedRow,
        },
        updatedBooking,
      ),
    );

    return tripStatusResult;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback failures.
    }

    throw error;
  }
}

async function persistBookingToDatabase(booking) {
  if (!isSqlServerConfigured()) {
    return null;
  }

  await ensureNotificationSchema();
  await ensureRideSchema();

  const paymentCode = generatePaymentCode(booking.bookingCode);
  const paymentStatus = getPaymentStatus(booking.paymentMethod);
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), booking.bookingCode)
      .input('accountId', sql.VarChar(20), booking.customerAccountId || null)
      .input('driverAccountId', sql.VarChar(20), booking.driverAccountId || null)
      .input('customerName', sql.NVarChar(100), booking.customerName)
      .input('customerPhone', sql.VarChar(15), booking.customerPhone || null)
      .input('vehicle', sql.VarChar(20), booking.vehicle)
      .input('scheduleEnabled', sql.Bit, booking.scheduleEnabled)
      .input('pickupLabel', sql.NVarChar(255), booking.pickup?.label ?? '')
      .input('destinationLabel', sql.NVarChar(255), booking.destination?.label ?? '')
      .input('routeDistanceKm', sql.Decimal(10, 2), booking.routeDistanceKm ?? null)
      .input('routeProvider', sql.NVarChar(30), booking.routeProvider)
      .input('routeGeometryJson', sql.NVarChar(sql.MAX), serializeRouteGeometry(booking.routeGeometry))
      .input('rideId', sql.VarChar(64), booking.selectedRideId)
      .input('rideTitle', sql.NVarChar(100), booking.rideTitle)
      .input('seatLabel', sql.NVarChar(50), booking.seatLabel || null)
      .input('etaMinutes', sql.Int, booking.etaMinutes)
      .input('price', sql.Int, booking.price)
      .input('originalPrice', sql.Int, booking.originalPrice ?? booking.price)
      .input('discountAmount', sql.Int, booking.discountAmount ?? 0)
      .input('promotionCode', sql.VarChar(40), booking.promotionCode || null)
      .input('promotionTitle', sql.NVarChar(120), booking.promotionTitle || null)
      .input('paymentMethod', sql.VarChar(20), booking.paymentMethod)
      .input('paymentProvider', sql.VarChar(20), booking.paymentProvider || null)
      .input('tripStatus', sql.NVarChar(20), booking.tripStatus)
      .input('paymentStatus', sql.NVarChar(20), paymentStatus)
      .input('createdAt', sql.DateTime2(0), new Date(booking.createdAt))
      .query(`
        INSERT INTO DatXe
        (
          MaChuyen,
          MaTK,
          MaTX,
          TenKhachHang,
          SDT,
          LoaiXe,
          DatLich,
          DiemDon,
          DiemDen,
          QuangDuongKm,
          NguonTuyenDuong,
          TuyenDuongJson,
          MaHangXe,
          TenHangXe,
          LoaiGhe,
          ThoiGianDuKienPhut,
          GiaTien,
          GiaGoc,
          TienGiam,
          MaUuDai,
          TenUuDai,
          PhuongThucThanhToan,
          NhaCungCapThanhToan,
          TrangThaiChuyen,
          TrangThaiThanhToan,
          NgayTao,
          NgayCapNhat
        )
        VALUES
        (
          @bookingCode,
          @accountId,
          @driverAccountId,
          @customerName,
          @customerPhone,
          @vehicle,
          @scheduleEnabled,
          @pickupLabel,
          @destinationLabel,
          @routeDistanceKm,
          @routeProvider,
          @routeGeometryJson,
          @rideId,
          @rideTitle,
          @seatLabel,
          @etaMinutes,
          @price,
          @originalPrice,
          @discountAmount,
          @promotionCode,
          @promotionTitle,
          @paymentMethod,
          @paymentProvider,
          @tripStatus,
          @paymentStatus,
          @createdAt,
          @createdAt
        )
      `);

    await new sql.Request(transaction)
      .input('paymentCode', sql.VarChar(30), paymentCode)
      .input('bookingCode', sql.VarChar(30), booking.bookingCode)
      .input('amount', sql.Int, booking.price)
      .input('originalAmount', sql.Int, booking.originalPrice ?? booking.price)
      .input('discountAmount', sql.Int, booking.discountAmount ?? 0)
      .input('promotionCode', sql.VarChar(40), booking.promotionCode || null)
      .input('promotionTitle', sql.NVarChar(120), booking.promotionTitle || null)
      .input('note', sql.NVarChar(255), booking.promotionSummary || null)
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
          GiaGoc,
          TienGiam,
          MaUuDai,
          TenUuDai,
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
          @originalAmount,
          @discountAmount,
          @promotionCode,
          @promotionTitle,
          @paymentMethod,
          @paymentProvider,
          @paymentStatus,
          NULL,
          @note,
          @createdAt,
          @createdAt
        )
      `);

    const driverNotificationTitle = `${DRIVER_RIDE_REQUEST_NOTIFICATION_TITLE} ${booking.bookingCode}`;
    const driverNotificationContent = buildDriverRideRequestNotificationContent(booking);
    const driverNotificationResult = await new sql.Request(transaction)
      .input('title', sql.NVarChar(200), driverNotificationTitle)
      .input('content', sql.NVarChar(sql.MAX), driverNotificationContent)
      .input('accountId', sql.VarChar(20), booking.customerAccountId || null)
      .input('recipient', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_RECIPIENT)
      .input('status', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_STATUS)
      .input('sendAt', sql.DateTime2(0), new Date(booking.createdAt))
      .input('createdAt', sql.DateTime2(0), new Date(booking.createdAt))
      .query(`
        INSERT INTO dbo.ThongBao
        (
          MaTK,
          TieuDe,
          NoiDung,
          NguoiNhan,
          TrangThai,
          ThoiGianGuiDuKien,
          NgayTao,
          NgayCapNhat
        )
        OUTPUT INSERTED.MaTB
        VALUES
        (
          @accountId,
          @title,
          @content,
          @recipient,
          @status,
          @sendAt,
          @createdAt,
          @createdAt
        )
      `);

    const driverNotificationRow = driverNotificationResult.recordset?.[0];
    booking.driverRequestNotificationId = Number(driverNotificationRow?.MaTB ?? 0) || null;

    if (booking.driverRequestNotificationId) {
      await new sql.Request(transaction)
        .input('bookingCode', sql.VarChar(30), booking.bookingCode)
        .input('notificationId', sql.Int, booking.driverRequestNotificationId)
        .query(`
          UPDATE DatXe
          SET MaTBThongBaoTaiXe = @notificationId
          WHERE MaChuyen = @bookingCode;
        `);
    }

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

  if (!customerAccountId) {
    throw createValidationError('Vui lòng đăng nhập để đặt xe.');
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

  const appliedPromotion = await resolveBookingPromotion(payload);
  const promotionPricing = calculatePromotionPricing(selectedRide.price, appliedPromotion);
  const promotionSummary = buildPromotionSummaryText(appliedPromotion, promotionPricing.discountAmount);

  const booking = {
    bookingCode: generateBookingCode(),
    createdAt: new Date().toISOString(),
    customerAccountId: customerAccountId || null,
    customerName,
    customerPhone: customerPhone || null,
    driverAccountId: null,
    vehicle: quoteResult.vehicle,
    vehicleLabel: selectedRide.vehicleLabel,
    scheduleEnabled: quoteResult.scheduleEnabled,
    pickup: quoteResult.pickup,
    destination: quoteResult.destination,
    routeDistanceKm: quoteResult.routeDistanceKm,
    routeGeometry: cloneRouteGeometry(quoteResult.routeGeometry),
    routeProvider: quoteResult.routeProvider,
    selectedRideId: selectedRide.id,
    rideTitle: selectedRide.title,
    seatLabel: selectedRide.seatLabel,
    etaMinutes: selectedRide.etaMinutes,
    price: promotionPricing.finalPrice,
    priceFormatted: formatCurrency(promotionPricing.finalPrice),
    originalPrice: promotionPricing.originalPrice,
    originalPriceFormatted: formatCurrency(promotionPricing.originalPrice),
    discountAmount: promotionPricing.discountAmount,
    discountAmountFormatted: formatCurrency(promotionPricing.discountAmount),
    promotionId: appliedPromotion ? normalizePromotionLookupId(appliedPromotion.id) : null,
    promotionCode: normalizeText(appliedPromotion?.code).toUpperCase() || null,
    promotionTitle: normalizeText(appliedPromotion?.title) || null,
    promotionDiscountPercent: Number(appliedPromotion?.discountPercent ?? 0) || 0,
    promotionMaxAmount: Number(appliedPromotion?.maxAmount ?? 0) || 0,
    promotionScope: normalizeText(appliedPromotion?.scope) || null,
    promotionExpiresAt: normalizeText(appliedPromotion?.expiresAt) || null,
    promotionSummary,
    paymentMethod,
    paymentMethodLabel: getPaymentMethodLabel(paymentMethod),
    paymentProvider,
    paymentProviderLabel: paymentProvider ? getPaymentProviderLabel(paymentProvider) : '',
    paymentSummary: paymentProvider ? `${getPaymentMethodLabel(paymentMethod)} - ${getPaymentProviderLabel(paymentProvider)}` : getPaymentMethodLabel(paymentMethod),
  };

  booking.tripStatus = 'ChoTaiXe';
  booking.tripStatusLabel = getTripStatusLabel(booking.tripStatus);
  booking.tripStatusTone = getTripStatusTone(booking.tripStatus);

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
  publishRideEventSafely(buildRideBookingCreatedEvent(booking));

  return {
    success: true,
    message: `Dat xe thanh cong. Ma chuyen: ${booking.bookingCode}`,
    booking,
  };
}

const TRIP_HISTORY_STATUS_LABELS = {
  completed: 'Hoàn thành',
  scheduled: 'Đặt trước',
  'in-progress': 'Đang thực hiện',
  cancelled: 'Đã hủy',
};

const TRIP_HISTORY_STATUS_TONES = {
  completed: 'success',
  scheduled: 'scheduled',
  'in-progress': 'progress',
  cancelled: 'cancelled',
};

const TRIP_HISTORY_LIMIT_DEFAULT = 24;
const TRIP_HISTORY_LIMIT_MAX = 40;

function normalizeTripHistoryRoleCode(rawRoleCode) {
  const normalizedRoleCode = String(rawRoleCode ?? '').trim().toUpperCase();

  if (normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3') {
    return normalizedRoleCode;
  }

  const roleToken = String(rawRoleCode ?? '').trim().toLowerCase();

  if (roleToken.includes('admin') || roleToken.includes('quantri')) {
    return 'Q1';
  }

  if (roleToken.includes('taixe') || roleToken.includes('driver')) {
    return 'Q3';
  }

  return 'Q2';
}

function normalizeTripHistoryLimit(value) {
  const numericLimit = Number.parseInt(String(value ?? '').trim(), 10);

  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    return TRIP_HISTORY_LIMIT_DEFAULT;
  }

  return Math.min(TRIP_HISTORY_LIMIT_MAX, numericLimit);
}

function normalizeHistoryStatus(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'completed' || normalizedValue === 'scheduled' || normalizedValue === 'in-progress' || normalizedValue === 'cancelled') {
    return normalizedValue;
  }

  return 'in-progress';
}

function getHistoryStatusLabel(status) {
  return TRIP_HISTORY_STATUS_LABELS[status] ?? TRIP_HISTORY_STATUS_LABELS['in-progress'];
}

function getHistoryStatusTone(status) {
  return TRIP_HISTORY_STATUS_TONES[status] ?? 'neutral';
}

function getTripHistoryPaymentLabel(paymentMethod, paymentProvider) {
  const normalizedMethod = normalizeText(paymentMethod).toLowerCase();
  const providerLabel = getPaymentProviderLabel(paymentProvider);

  if (normalizedMethod === 'qr') {
    return providerLabel ? `QR code - ${providerLabel}` : 'QR code';
  }

  if (normalizedMethod === 'wallet') {
    return providerLabel ? `Ví điện tử - ${providerLabel}` : 'Ví điện tử';
  }

  return getPaymentMethodLabel('cash');
}

function getTripHistoryVehicleLabel(vehicle) {
  return VEHICLE_CONFIG[vehicle]?.label ?? VEHICLE_CONFIG.motorbike.label;
}

function getTripHistoryRouteProvider(routeProvider) {
  const normalizedProvider = normalizeText(routeProvider).toLowerCase();

  if (normalizedProvider === 'google-directions' || normalizedProvider === 'osrm') {
    return normalizedProvider;
  }

  return 'haversine';
}

function getTripHistoryStatus(row = {}) {
  const tripStatus = normalizeTripStatus(row.tripStatus ?? row.TrangThaiChuyen);
  const paymentStatus = normalizeText(row.paymentStatus ?? row.TrangThaiThanhToan).toLowerCase();

  if (tripStatus === 'HoanThanh' || paymentStatus === 'dathanhtoan') {
    return 'completed';
  }

  if (tripStatus === 'DaHuy' || paymentStatus === 'thatbai') {
    return 'cancelled';
  }

  if (tripStatus === 'ChoTaiXe') {
    return 'scheduled';
  }

  if (tripStatus === 'DaNhanChuyen' || tripStatus === 'DangDen' || tripStatus === 'DaDon' || tripStatus === 'DangThucHien') {
    return 'in-progress';
  }

  return 'in-progress';
}

function buildTripHistoryNote(row, statusLabel) {
  if (Boolean(row.scheduleEnabled ?? row.DatLich)) {
    return 'Cuốc xe được đặt trước theo lịch từ server.';
  }

  if (statusLabel === 'Hoàn thành') {
    return 'Thanh toán và booking đã được ghi nhận đầy đủ trên server.';
  }

  if (statusLabel === 'Đã hủy') {
    const cancellationMeta = parseCancellationMeta(row.cancelReasonRaw ?? row.cancelReason ?? row.LyDoHuy);
    const cancelledByRoleCode = normalizeText(cancellationMeta.cancelledByRoleCode ?? row.cancelledByRoleCode).toLowerCase();
    const cancelledByLabel = cancelledByRoleCode === 'q3' || cancelledByRoleCode === 'driver'
      ? 'Tài xế'
      : cancelledByRoleCode === 'q2' || cancelledByRoleCode === 'customer'
        ? 'Khách hàng'
        : '';
    const cancelReason = normalizeText(cancellationMeta.cancelReason ?? row.cancelReason);

    if (cancelledByLabel && cancelReason) {
      return `Hủy bởi ${cancelledByLabel}: ${cancelReason}`;
    }

    if (cancelledByLabel) {
      return `Hủy bởi ${cancelledByLabel}.`;
    }

    if (cancelReason) {
      return `Lý do hủy: ${cancelReason}`;
    }

    return 'Giao dịch không hoàn tất hoặc cần kiểm tra lại.';
  }

  return 'Dữ liệu booking được đồng bộ trực tiếp từ server.';
}

function normalizeHistoryAccountRow(accountRow) {
  if (!accountRow) {
    return null;
  }

  return {
    id: normalizeText(accountRow.MaTK),
    displayName: normalizeText(accountRow.Ten || accountRow.TaiKhoan || accountRow.MaTK),
    email: normalizeText(accountRow.Email),
    phone: normalizeText(accountRow.SDT),
    roleCode: normalizeText(accountRow.MaQuyen).toUpperCase(),
  };
}

function buildTripHistorySummary(rows = []) {
  return rows.reduce((summary, row) => {
    const status = getTripHistoryStatus(row);
    const distanceKm = Number(row.routeDistanceKm ?? row.QuangDuongKm);
    const amount = Number(row.paymentAmount ?? row.SoTien ?? row.GiaTien);

    summary.totalTrips += 1;
    summary.totalAmount += Number.isFinite(amount) ? amount : 0;
    summary.totalDistanceKm += Number.isFinite(distanceKm) ? distanceKm : 0;

    if (status === 'completed') {
      summary.completedTrips += 1;
    }

    if (status === 'scheduled') {
      summary.scheduledTrips += 1;
    }

    if (status === 'in-progress') {
      summary.inProgressTrips += 1;
    }

    if (status === 'cancelled') {
      summary.cancelledTrips += 1;
    }

    return summary;
  }, {
    totalTrips: 0,
    completedTrips: 0,
    scheduledTrips: 0,
    inProgressTrips: 0,
    cancelledTrips: 0,
    totalAmount: 0,
    totalDistanceKm: 0,
  });
}

function normalizeTripHistoryDate(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function buildTripHistoryReviewSummary(rows = []) {
  const ratingCounts = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  let totalReviews = 0;
  let ratingTotal = 0;
  let firstTripAt = null;
  let latestTripAt = null;
  let latestReviewAt = null;

  rows.forEach((row) => {
    const tripDate = normalizeTripHistoryDate(row.bookedAt ?? row.NgayTao ?? row.updatedAt ?? row.NgayCapNhat);

    if (tripDate) {
      if (!firstTripAt || tripDate < firstTripAt) {
        firstTripAt = tripDate;
      }

      if (!latestTripAt || tripDate > latestTripAt) {
        latestTripAt = tripDate;
      }
    }

    const normalizedRatingScore = Number(row.ratingScore ?? 0);

    if (!Number.isFinite(normalizedRatingScore) || normalizedRatingScore <= 0) {
      return;
    }

    const ratingScore = Math.max(1, Math.min(5, Math.round(normalizedRatingScore)));
    totalReviews += 1;
    ratingTotal += ratingScore;
    ratingCounts[ratingScore] += 1;

    const reviewDate = normalizeTripHistoryDate(row.ratingSubmittedAt ?? row.updatedAt ?? row.NgayCapNhat);

    if (reviewDate && (!latestReviewAt || reviewDate > latestReviewAt)) {
      latestReviewAt = reviewDate;
    }
  });

  return {
    totalReviews,
    averageRating: totalReviews > 0 ? Number((ratingTotal / totalReviews).toFixed(2)) : 0,
    ratingCounts,
    firstTripAt: firstTripAt?.toISOString?.() ?? '',
    latestTripAt: latestTripAt?.toISOString?.() ?? '',
    latestReviewAt: latestReviewAt?.toISOString?.() ?? '',
  };
}

async function resolveHistoryAccount(payload = {}) {
  const accountId = normalizeText(payload.accountId);
  const identifier = normalizeText(payload.identifier).toLowerCase();

  if (!accountId && !identifier) {
    return null;
  }

  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('accountId', sql.VarChar(20), accountId)
    .input('identifier', sql.VarChar(150), identifier)
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.Ten,
        tk.Email,
        tk.SDT,
        tk.TaiKhoan,
        tk.MaQuyen
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE
        (
          @accountId <> ''
          AND (
            LOWER(ISNULL(tk.MaTK, '')) = LOWER(@accountId)
            OR LOWER(ISNULL(tx.CCCD, '')) = LOWER(@accountId)
          )
        )
        OR (
          @identifier <> ''
          AND (
            LOWER(ISNULL(tk.Email, '')) = @identifier
            OR LOWER(ISNULL(tk.TaiKhoan, '')) = @identifier
          )
        )
      ORDER BY CASE
        WHEN (@accountId <> '' AND LOWER(ISNULL(tk.MaTK, '')) = LOWER(@accountId)) THEN 0
        WHEN (@accountId <> '' AND LOWER(ISNULL(tx.CCCD, '')) = LOWER(@accountId)) THEN 1
        ELSE 2
      END;
    `);

  return normalizeHistoryAccountRow(queryResult.recordset?.[0] ?? null);
}

function buildTripHistorySelectClause() {
  return `
    SELECT
      dx.MaChuyen AS bookingCode,
      dx.MaTK AS accountId,
      dx.MaTX AS driverAccountId,
      dx.LyDoHuy AS cancelReasonRaw,
      dx.TenKhachHang AS customerName,
      dx.SDT AS customerPhone,
      dx.LoaiXe AS vehicle,
      dx.DatLich AS scheduleEnabled,
      dx.DiemDon AS pickupLabel,
      dx.DiemDen AS destinationLabel,
      dx.QuangDuongKm AS routeDistanceKm,
      dx.NguonTuyenDuong AS routeProvider,
      dx.TuyenDuongJson AS routeGeometryJson,
      dg.SoSaoDanhGia AS ratingScore,
      dg.NhanXetDanhGia AS ratingComment,
      dg.ThoiDiemDanhGia AS ratingSubmittedAt,
      dx.MaHangXe AS rideId,
      dx.TenHangXe AS rideTitle,
      dx.LoaiGhe AS seatLabel,
      dx.ThoiGianDuKienPhut AS etaMinutes,
      dx.GiaTien AS basePrice,
      dx.GiaGoc AS originalPrice,
      dx.TienGiam AS discountAmount,
      dx.MaUuDai AS promotionCode,
      dx.TenUuDai AS promotionTitle,
      dx.PhuongThucThanhToan AS paymentMethod,
      dx.NhaCungCapThanhToan AS paymentProvider,
      dx.TrangThaiChuyen AS tripStatus,
      dx.TrangThaiThanhToan AS bookingPaymentStatus,
      dx.NgayTao AS bookedAt,
      dx.NgayCapNhat AS updatedAt,
      tt.MaTT AS paymentCode,
      tt.SoTien AS paymentAmount,
      tt.GiaGoc AS paymentOriginalAmount,
      tt.TienGiam AS paymentDiscountAmount,
      tt.MaUuDai AS paymentPromotionCode,
      tt.TenUuDai AS paymentPromotionTitle,
      tt.PhuongThucThanhToan AS paymentMethodFromPayment,
      tt.NhaCungCapThanhToan AS paymentProviderFromPayment,
      tt.TrangThaiThanhToan AS paymentStatus,
      tt.ThoiDiemThanhToan AS paidAt,
      tt.NgayTao AS paymentCreatedAt,
      tk.Ten AS accountName,
      tk.Email AS accountEmail,
      tk.SDT AS accountPhone,
      tk.TaiKhoan AS accountUsername,
      tx.TrangThai AS driverStatus,
      driverTk.Ten AS driverName,
      driverTk.Email AS driverEmail,
      driverTk.SDT AS driverPhone,
      driverTk.TaiKhoan AS driverUsername,
      JSON_VALUE(tx.ThongTinXe, '$.licensePlate') AS driverVehicleLicensePlate,
      JSON_VALUE(tx.ThongTinXe, '$.name') AS driverVehicleName
    FROM DatXe dx
    LEFT JOIN DanhGiaChuyenXe dg ON dg.MaChuyen = dx.MaChuyen
    LEFT JOIN ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
    LEFT JOIN TaiKhoan tk ON tk.MaTK = dx.MaTK
    LEFT JOIN TaiXe tx ON tx.CCCD = dx.MaTX
    LEFT JOIN TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
  `;
}

function buildTripHistoryWhereClause(roleCode) {
  if (roleCode === 'Q1') {
    return '';
  }

  if (roleCode === 'Q3') {
    return `
      WHERE
        (
          (@accountId <> '' AND (
            LOWER(ISNULL(tx.MaTK, '')) = LOWER(@accountId)
            OR LOWER(ISNULL(dx.MaTX, '')) = LOWER(@accountId)
          ))
          OR (
            @identifier <> ''
            AND (
              LOWER(ISNULL(driverTk.Email, '')) = @identifier
              OR LOWER(ISNULL(driverTk.TaiKhoan, '')) = @identifier
            )
          )
        )
    `;
  }

  return `
    WHERE
      (
        (@accountId <> '' AND LOWER(ISNULL(dx.MaTK, '')) = LOWER(@accountId))
        OR (
          @identifier <> ''
          AND (
            LOWER(ISNULL(tk.Email, '')) = @identifier
            OR LOWER(ISNULL(tk.TaiKhoan, '')) = @identifier
          )
        )
      )
  `;
}

function buildTripHistoryQuery(roleCode) {
  return `${buildTripHistorySelectClause()}${buildTripHistoryWhereClause(roleCode)}
    ORDER BY dx.NgayTao DESC, dx.MaChuyen DESC;
  `;
}

async function enrichTripHistoryRow(row, account = null) {
  const pickupLabel = normalizeText(row.pickupLabel);
  const destinationLabel = normalizeText(row.destinationLabel);
  const storedRouteGeometry = normalizeStoredRouteGeometry(row.routeGeometryJson);
  let pickupPosition = storedRouteGeometry?.[0] ? { ...storedRouteGeometry[0] } : null;
  let destinationPosition = storedRouteGeometry?.[storedRouteGeometry.length - 1]
    ? { ...storedRouteGeometry[storedRouteGeometry.length - 1] }
    : null;

  if (!storedRouteGeometry) {
    const [pickupPositionRaw, destinationPositionRaw] = await Promise.all([
      pickupLabel ? resolveLocationPosition({ label: pickupLabel }) : Promise.resolve(null),
      destinationLabel ? resolveLocationPosition({ label: destinationLabel }) : Promise.resolve(null),
    ]);

    pickupPosition = pickupPositionRaw;
    destinationPosition = destinationPositionRaw;
  }

  const fallbackRouteGeometry = pickupPosition && destinationPosition
    ? [
        {
          lat: pickupPosition.lat,
          lng: pickupPosition.lng,
        },
        {
          lat: destinationPosition.lat,
          lng: destinationPosition.lng,
        },
      ]
    : null;
  const routeGeometry = storedRouteGeometry ?? fallbackRouteGeometry;
  const normalizedRatingScore = Number(row.ratingScore ?? 0);
  const ratingScore = Number.isFinite(normalizedRatingScore) && normalizedRatingScore > 0 ? normalizedRatingScore : null;
  const ratingComment = normalizeText(row.ratingComment);
  const ratingSubmittedAtValue = row.ratingSubmittedAt;
  const ratingSubmittedAtDate = ratingSubmittedAtValue ? new Date(ratingSubmittedAtValue) : null;

  const paymentMethod = normalizeText(row.paymentMethodFromPayment ?? row.paymentMethod).toLowerCase();
  const paymentProvider = normalizeText(row.paymentProviderFromPayment ?? row.paymentProvider).toLowerCase();
  const paymentStatus = normalizeText(row.paymentStatus ?? row.bookingPaymentStatus).toLowerCase();
  const tripStatus = normalizeTripStatus(row.tripStatus ?? row.TrangThaiChuyen);
  const status = getTripHistoryStatus(row);
  const finalPrice = Number(row.paymentAmount ?? row.basePrice ?? row.price ?? 0);
  const originalPrice = Number(row.originalPrice ?? row.paymentOriginalAmount ?? finalPrice);
  const discountAmount = Number(row.discountAmount ?? row.paymentDiscountAmount ?? Math.max(0, originalPrice - finalPrice));
  const routeDistanceKm = Number(row.routeDistanceKm ?? 0);
  const etaMinutes = Number(row.etaMinutes ?? 0);
  const bookedAt = row.bookedAt ? new Date(row.bookedAt) : null;
  const paidAt = row.paidAt ? new Date(row.paidAt) : null;
  const completedAt = paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : bookedAt;
  const bookingCode = normalizeText(row.bookingCode);
  const paymentCode = normalizeText(row.paymentCode || `TT-${bookingCode}`);
  const rideTitle = normalizeText(row.rideTitle);
  const customerName = normalizeText(row.customerName || account?.displayName || 'Khách hàng SmartRide');
  const customerPhone = normalizeText(row.customerPhone);
  const vehicle = normalizeText(row.vehicle).toLowerCase();
  const vehicleLabel = getTripHistoryVehicleLabel(vehicle);
  const routeProvider = getTripHistoryRouteProvider(row.routeProvider);
  const paymentLabel = getTripHistoryPaymentLabel(paymentMethod, paymentProvider);
  const paymentStatusLabel = getPaymentStatusLabel(paymentStatus || row.bookingPaymentStatus);
  const driverVehicleLicensePlate = normalizeText(row.driverVehicleLicensePlate);
  const driverVehicleName = normalizeText(row.driverVehicleName);
  const promotionCode = normalizeText(row.promotionCode ?? row.paymentPromotionCode);
  const promotionTitle = normalizeText(row.promotionTitle ?? row.paymentPromotionTitle);
  const promotionSummary = [
    promotionCode ? `Mã ${promotionCode}` : '',
    promotionTitle && promotionTitle !== promotionCode ? promotionTitle : '',
    discountAmount > 0 ? `Giảm ${formatCurrency(discountAmount)}` : '',
  ].filter(Boolean).join(' · ');

  return {
    id: bookingCode || paymentCode,
    bookingCode,
    tripCode: paymentCode,
    paymentCode,
    status,
    statusLabel: getHistoryStatusLabel(status),
    statusTone: getHistoryStatusTone(status),
    tripStatus,
    tripStatusLabel: getTripStatusLabel(tripStatus),
    tripStatusTone: getTripStatusTone(tripStatus),
    completedAt: completedAt?.toISOString?.() ?? '',
    bookedAt: bookedAt?.toISOString?.() ?? '',
    rideTitle: rideTitle || vehicleLabel,
    vehicle,
    vehicleLabel,
    customerName,
    customerPhone,
    paymentLabel,
    paymentMethod,
    paymentProvider,
    paymentStatus,
    paymentStatusLabel,
    price: finalPrice,
    priceFormatted: formatCurrency(finalPrice),
    originalPrice,
    originalPriceFormatted: formatCurrency(originalPrice),
    discountAmount,
    discountAmountFormatted: formatCurrency(discountAmount),
    promotionCode,
    promotionTitle,
    promotionSummary,
    routeDistanceKm,
    etaMinutes,
    pickupLabel,
    destinationLabel,
    pickupPosition,
    destinationPosition,
    routeProvider,
    routeGeometry,
    ratingScore,
    ratingComment,
    ratingSubmittedAt: ratingSubmittedAtDate && !Number.isNaN(ratingSubmittedAtDate.getTime())
      ? ratingSubmittedAtDate.toISOString()
      : '',
    scheduleEnabled: Boolean(row.scheduleEnabled),
    note: buildTripHistoryNote(row, getHistoryStatusLabel(status)),
    cancelledByAccountId: normalizeText(parseCancellationMeta(row.cancelReasonRaw ?? row.cancelReason ?? row.LyDoHuy).cancelledByAccountId),
    cancelledByRoleCode: normalizeText(parseCancellationMeta(row.cancelReasonRaw ?? row.cancelReason ?? row.LyDoHuy).cancelledByRoleCode),
    cancelReason: normalizeText(parseCancellationMeta(row.cancelReasonRaw ?? row.cancelReason ?? row.LyDoHuy).cancelReason),
    accountDisplayName: account?.displayName ?? normalizeText(row.accountName),
    accountIdentifier: account?.email ?? normalizeText(row.accountEmail || row.accountUsername || row.accountId),
    accountPhone: account?.phone ?? normalizeText(row.accountPhone),
    accountRoleCode: account?.roleCode ?? '',
    driverAccountId: normalizeText(row.driverAccountId),
    driverDisplayName: normalizeText(row.driverName),
    driverIdentifier: normalizeText(row.driverEmail || row.driverUsername),
    driverPhone: normalizeText(row.driverPhone),
    driverStatus: normalizeText(row.driverStatus),
    driverVehicleLicensePlate,
    driverVehicleName,
    driverLicensePlate: driverVehicleLicensePlate,
  };
}

export async function updateTripStatus(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode ?? payload?.tripCode ?? payload?.id);
  const requestedTripStatus = parseTripStatus(payload?.status);
  const normalizedDriverAccountId = normalizeText(payload?.driverAccountId ?? payload?.driverId);
  const cancelMeta = normalizeCancellationMeta(payload);

  if (!bookingCode) {
    throw createValidationError('Vui long cung cap ma chuyen de cap nhat trang thai.');
  }

  if (!requestedTripStatus) {
    throw createValidationError('Trang thai chuyen khong hop le.');
  }

  if (!isSqlServerConfigured()) {
    const updatedBooking = updateRecentBookingTripStatus(bookingCode, requestedTripStatus, normalizedDriverAccountId, cancelMeta);

    if (!updatedBooking) {
      throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
    }

    return buildTripStatusResult(
      updatedBooking.bookingCode,
      updatedBooking.tripStatus,
      updatedBooking.updatedAt,
      updatedBooking.driverAccountId,
      cancelMeta,
    );
  }

  return updateTripStatusInDatabase(bookingCode, requestedTripStatus, normalizedDriverAccountId, cancelMeta);
}

export async function submitRideRating(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode ?? payload?.tripCode ?? payload?.id);
  const normalizedAccountId = normalizeText(payload?.accountId ?? payload?.customerAccountId ?? payload?.userId);
  const ratingValue = Number(payload?.rating ?? payload?.score ?? payload?.stars);
  const normalizedRatingScore = Number.isFinite(ratingValue) ? Math.round(ratingValue) : NaN;
  const ratingComment = normalizeText(payload?.comment ?? payload?.note ?? payload?.feedback ?? '');

  if (!bookingCode) {
    throw createValidationError('Vui long cung cap ma chuyen de gui danh gia.');
  }

  if (!Number.isInteger(normalizedRatingScore) || normalizedRatingScore < 1 || normalizedRatingScore > 5) {
    throw createValidationError('So sao danh gia khong hop le. Vui long chon tu 1 den 5 sao.');
  }

  const ratingSubmittedAt = new Date().toISOString();

  if (!isSqlServerConfigured()) {
    const updatedBooking = updateRecentBookingRating(bookingCode, normalizedRatingScore, ratingComment, ratingSubmittedAt);

    if (!updatedBooking) {
      throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
    }

    const ratingResult = {
      bookingCode,
      ratingScore: normalizedRatingScore,
      ratingComment,
      ratingSubmittedAt,
    };

    publishRideEventSafely(buildRideTripRatingUpdatedEvent(bookingCode, ratingResult, updatedBooking, updatedBooking));

    return {
      success: true,
      message: 'Danh gia da duoc ghi nhan trong bo nho tam.',
      bookingCode,
      rating: ratingResult,
      booking: updatedBooking,
    };
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const currentRowResult = await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .query(`
        SELECT TOP 1
          dx.MaChuyen AS bookingCode,
          dx.MaTK AS customerAccountId,
          dx.MaTX AS driverCccd,
          dx.TrangThaiChuyen AS tripStatus,
          dg.SoSaoDanhGia AS ratingScore,
          dg.NhanXetDanhGia AS ratingComment,
          dg.ThoiDiemDanhGia AS ratingSubmittedAt,
          tx.MaTK AS driverAccountId
        FROM DatXe dx WITH (UPDLOCK, ROWLOCK)
        LEFT JOIN DanhGiaChuyenXe dg ON dg.MaChuyen = dx.MaChuyen
        LEFT JOIN TaiXe tx ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
        WHERE dx.MaChuyen = @bookingCode;
      `);

    const currentRow = currentRowResult.recordset?.[0] ?? null;

    if (!currentRow) {
      throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
    }

    if (normalizedAccountId && normalizeText(currentRow.customerAccountId) && normalizeText(currentRow.customerAccountId).toLowerCase() !== normalizedAccountId.toLowerCase()) {
      throw createForbiddenError('Ban khong co quyen danh gia chuyen nay.');
    }

    if (normalizeTripStatus(currentRow.tripStatus) !== 'HoanThanh') {
      throw createValidationError('Chi co the danh gia sau khi hoan thanh chuyen xe.');
    }

    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .input('customerAccountId', sql.VarChar(20), currentRow.customerAccountId ?? null)
      .input('driverCccd', sql.VarChar(20), currentRow.driverCccd ?? null)
      .input('ratingScore', sql.Int, normalizedRatingScore)
      .input('ratingComment', sql.NVarChar(1000), ratingComment || null)
      .input('ratingSubmittedAt', sql.DateTime2(0), new Date(ratingSubmittedAt))
      .query(`
        IF EXISTS (
          SELECT 1
          FROM dbo.DanhGiaChuyenXe WITH (UPDLOCK, HOLDLOCK)
          WHERE MaChuyen = @bookingCode
        )
        BEGIN
          UPDATE dbo.DanhGiaChuyenXe
          SET
            MaTK = @customerAccountId,
            MaTX = @driverCccd,
            SoSaoDanhGia = @ratingScore,
            NhanXetDanhGia = @ratingComment,
            ThoiDiemDanhGia = @ratingSubmittedAt,
            NgayCapNhat = @ratingSubmittedAt
          WHERE MaChuyen = @bookingCode;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.DanhGiaChuyenXe (
            MaChuyen,
            MaTK,
            MaTX,
            SoSaoDanhGia,
            NhanXetDanhGia,
            ThoiDiemDanhGia,
            NgayTao,
            NgayCapNhat
          )
          VALUES (
            @bookingCode,
            @customerAccountId,
            @driverCccd,
            @ratingScore,
            @ratingComment,
            @ratingSubmittedAt,
            @ratingSubmittedAt,
            @ratingSubmittedAt
          );
        END
      `);

    const updatedRowResult = await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .query(`
        SELECT TOP 1
          dx.MaChuyen AS bookingCode,
          dx.MaTK AS customerAccountId,
          dx.MaTX AS driverCccd,
          dx.TrangThaiChuyen AS tripStatus,
          dg.SoSaoDanhGia AS ratingScore,
          dg.NhanXetDanhGia AS ratingComment,
          dg.ThoiDiemDanhGia AS ratingSubmittedAt,
          tx.MaTK AS driverAccountId
        FROM DatXe dx
        LEFT JOIN DanhGiaChuyenXe dg ON dg.MaChuyen = dx.MaChuyen
        LEFT JOIN TaiXe tx ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
        WHERE dx.MaChuyen = @bookingCode;
      `);

    const updatedRow = updatedRowResult.recordset?.[0] ?? currentRow;

    await transaction.commit();

    const updatedBooking = updateRecentBookingRating(bookingCode, normalizedRatingScore, ratingComment, ratingSubmittedAt);
    const ratingResult = {
      bookingCode,
      ratingScore: normalizedRatingScore,
      ratingComment,
      ratingSubmittedAt,
    };

    publishRideEventSafely(
      buildRideTripRatingUpdatedEvent(
        bookingCode,
        ratingResult,
        {
          ...currentRow,
          ...updatedRow,
        },
        updatedBooking,
      ),
    );

    return {
      success: true,
      message: 'Danh gia da duoc luu thanh cong.',
      bookingCode,
      rating: ratingResult,
      booking: updatedBooking ?? null,
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback failures.
    }

    if (error?.code === 'ETIMEOUT' || error?.code === 'ECONNREFUSED' || error?.code === 'ELOGIN') {
      const fallbackBooking = updateRecentBookingRating(bookingCode, normalizedRatingScore, ratingComment, ratingSubmittedAt);

      if (fallbackBooking) {
        const ratingResult = {
          bookingCode,
          ratingScore: normalizedRatingScore,
          ratingComment,
          ratingSubmittedAt,
        };

        publishRideEventSafely(buildRideTripRatingUpdatedEvent(bookingCode, ratingResult, fallbackBooking, fallbackBooking));

        return {
          success: true,
          message: 'Khong the ket noi SQL Server, da ghi nhan danh gia tam thoi trong bo nho.',
          bookingCode,
          rating: ratingResult,
          booking: fallbackBooking,
        };
      }
    }

    throw error;
  }
}

export async function getTripHistory(payload = {}) {
  const roleCode = normalizeTripHistoryRoleCode(payload?.roleCode);
  const limit = normalizeTripHistoryLimit(payload?.limit);
  const normalizedAccountId = normalizeText(payload?.accountId);
  const normalizedIdentifier = normalizeText(payload?.identifier).toLowerCase();

  if (roleCode !== 'Q1' && !normalizedAccountId && !normalizedIdentifier) {
    throw createValidationError('Thiếu thông tin tài khoản để tải lịch sử chuyến.');
  }

  await ensureRideSchema();

  const [resolvedAccount, pool] = await Promise.all([
    resolveHistoryAccount(payload),
    getSqlServerPool(),
  ]);

  const queryResult = await pool
    .request()
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .input('identifier', sql.VarChar(150), normalizedIdentifier)
    .query(buildTripHistoryQuery(roleCode));

  const rows = queryResult.recordset ?? [];
  const summary = buildTripHistorySummary(rows);
  const reviewSummary = buildTripHistoryReviewSummary(rows);
  const items = await Promise.all(rows.slice(0, limit).map((row) => enrichTripHistoryRow(row, resolvedAccount)));

  return {
    success: true,
    message: 'Lấy lịch sử chuyến thành công.',
    scope: roleCode === 'Q3' ? 'driver' : roleCode === 'Q1' ? 'admin' : 'customer',
    account: resolvedAccount,
    totalCount: rows.length,
    limit,
    summary,
    reviewSummary,
    items,
  };
}
