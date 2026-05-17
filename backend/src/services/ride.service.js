import sql from 'mssql';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { searchPlaces } from './places.service.js';
import { env } from '../config/env.js';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';
import { createNotification, ensureNotificationSchema } from './notification.service.js';
import { listPromotions } from './promotion.service.js';
import { hasActiveRideSocketClient, publishRideEvent } from './ride.realtime.service.js';
import { ensureDriverSchema } from './driver.service.js';
import { deductCustomerWalletForRide, refundCustomerWalletForRide } from './customer.wallet.service.js';
import {
  enforceDriverAutoLockForContinuousCancellation,
  ensureDriverViolationSchema,
} from './driverViolation.service.js';

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

const BOOKING_SERVICE_FEE = {
  motorbike: 5000,
  car: 7000,
  intercity: 10000,
};

const DISTANCE_RATE_PER_KM = 5000;
const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const ROUTING_SERVICE_URL = 'https://router.project-osrm.org/route/v1/driving';
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const routeCache = new Map();
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const RIDE_HISTORY_LOCATION_LOOKUP_TIMEOUT_MS = 700;
const RIDE_HISTORY_FALLBACK_MAX_ROWS = 4;
const locationCache = new Map();
let googleDirectionsAvailable = Boolean(env.googleMapsServerApiKey);
let googleDirectionsWarningLogged = false;
const MAX_RECENT_BOOKINGS = 200;
const recentBookings = [];
let rideSchemaPromise = null;
const PAYMENT_METHOD_LABELS = {
  cash: 'Tiền mặt',
  wallet: 'Thanh toán bằng Ví điện tử',
  app_wallet: 'Ví SmartRide',
};
const PAYMENT_PROVIDER_LABELS = {
  zalopay: 'Zalo pay',
  momo: 'Momo',
  app_wallet: 'Ví SmartRide',
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
  DaDon: new Set(['DangThucHien', 'DaHuy']),
  DangThucHien: new Set(['HoanThanh', 'DaHuy']),
  HoanThanh: new Set([]),
  DaHuy: new Set([]),
};
const DRIVER_RIDE_REQUEST_NOTIFICATION_TITLE = 'Cuốc xe mới';
const DRIVER_RIDE_REQUEST_NOTIFICATION_RECIPIENT = 'driver';
const DRIVER_RIDE_REQUEST_NOTIFICATION_STATUS = 'sent';
const DRIVER_DISPATCH_ATTEMPT_STATUS = {
  pending: 'pending',
  rejected: 'rejected',
  accepted: 'accepted',
};
const DRIVER_DISPATCH_WARNING_REJECT_STREAK = 3;
const DRIVER_DISPATCH_LOCK_REJECT_STREAK = 5;
const DRIVER_DISPATCH_LOCK_WINDOW_MS = 60 * 60 * 1000;
const DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS = 60 * 1000;
const DRIVER_DISPATCH_FAILURE_REASON = 'Hết thời gian phản hồi và không còn tài xế phù hợp.';
const PAYMENT_STATUS_LABELS = {
  ChoThuTien: 'Chờ thu tiền',
  ChoXacNhan: 'Chờ xác nhận',
  DaThanhToan: 'Đã thanh toán',
  ThatBai: 'Thanh toán thất bại',
};
const ZALOPAY_TIMEOUT_MS = 12000;
const MOMO_TIMEOUT_MS = 12000;
const MOMO_SUCCESS_RESULT_CODE = 0;
const momoMockPaidOrderIds = new Set();
const SQL_DEADLOCK_ERROR_NUMBER = 1205;
const SQL_DEADLOCK_RETRY_ATTEMPTS = 3;
const SQL_DEADLOCK_RETRY_BASE_DELAY_MS = 120;

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

function stripVietnameseDiacritics(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeVehicleCategory(value) {
  const normalizedToken = stripVietnameseDiacritics(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (!normalizedToken) {
    return '';
  }

  if (Object.prototype.hasOwnProperty.call(VEHICLE_CONFIG, normalizedToken)) {
    return normalizedToken;
  }

  if (
    normalizedToken.includes('motorbike')
    || normalizedToken.includes('xemay')
    || normalizedToken.includes('bike')
    || normalizedToken.includes('moto')
    || normalizedToken.includes('wave')
    || normalizedToken.includes('sirius')
    || normalizedToken.includes('airblade')
    || normalizedToken.includes('exciter')
    || normalizedToken.includes('winner')
    || normalizedToken.includes('vario')
    || normalizedToken.includes('vision')
    || normalizedToken.includes('shmode')
  ) {
    return 'motorbike';
  }

  if (
    normalizedToken.includes('intercity')
    || normalizedToken.includes('lientinh')
    || normalizedToken.includes('minibus')
    || normalizedToken.includes('bus')
    || normalizedToken.includes('16cho')
    || normalizedToken.includes('30cho')
    || normalizedToken.includes('transit')
  ) {
    return 'intercity';
  }

  if (
    normalizedToken.includes('car')
    || normalizedToken.includes('oto')
    || normalizedToken.includes('xehoi')
    || normalizedToken.includes('sedan')
    || normalizedToken.includes('4cho')
    || normalizedToken.includes('7cho')
    || normalizedToken.includes('toyota')
    || normalizedToken.includes('vios')
    || normalizedToken.includes('hyundai')
    || normalizedToken.includes('accent')
    || normalizedToken.includes('kia')
    || normalizedToken.includes('morning')
    || normalizedToken.includes('mazda')
    || normalizedToken.includes('mitsubishi')
  ) {
    return 'car';
  }

  return '';
}

function normalizeStatusToken(value) {
  return stripVietnameseDiacritics(value)
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
      if (!googleDirectionsWarningLogged) {
        const fallbackReason = normalizeText(error?.message ?? 'Unknown Google Directions error');
        console.warn(
          `Google Directions unavailable (reason: ${fallbackReason}). Falling back to OSRM for this runtime.`,
        );
        googleDirectionsWarningLogged = true;
      }

      googleDirectionsAvailable = false;
      return null;
    }

    if (error?.name !== 'AbortError') {
      const fallbackReason = normalizeText(error?.message ?? 'Unknown route provider error');
      console.warn(`Google Directions request failed, fallback to OSRM. Reason: ${fallbackReason}`);
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

async function resolveLocationPositionWithTimeout(location, timeoutMs = RIDE_HISTORY_LOCATION_LOOKUP_TIMEOUT_MS) {
  const effectiveTimeoutMs = Number(timeoutMs);

  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
    return resolveLocationPosition(location);
  }

  let timeoutId = null;
  const locationLookupPromise = resolveLocationPosition(location).catch(() => null);

  try {
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), effectiveTimeoutMs);
    });

    return await Promise.race([
      locationLookupPromise,
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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

function isSqlDeadlockError(error) {
  const normalizedMessage = normalizeText(error?.message).toLowerCase();
  const directErrorNumber = Number(error?.number);
  const originalErrorNumber = Number(error?.originalError?.number ?? error?.originalError?.info?.number);

  return (
    directErrorNumber === SQL_DEADLOCK_ERROR_NUMBER
    || originalErrorNumber === SQL_DEADLOCK_ERROR_NUMBER
    || normalizedMessage.includes('deadlock')
  );
}

function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
  });
}

async function runWithSqlDeadlockRetry(task, operationName = 'sql-transaction') {
  let attempt = 0;

  while (attempt < SQL_DEADLOCK_RETRY_ATTEMPTS) {
    attempt += 1;

    try {
      return await task();
    } catch (error) {
      if (!isSqlDeadlockError(error) || attempt >= SQL_DEADLOCK_RETRY_ATTEMPTS) {
        throw error;
      }

      const retryDelayMs = SQL_DEADLOCK_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
      console.warn(`[sql] Deadlock detected in ${operationName}. Retrying (${attempt}/${SQL_DEADLOCK_RETRY_ATTEMPTS})...`);
      await waitForRetryDelay(retryDelayMs);
    }
  }

  return task();
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
        IF COL_LENGTH(N'dbo.DatXe', N'MaTKTaiXeDuocMoi') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD MaTKTaiXeDuocMoi VARCHAR(20) NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXe', N'LanDieuPhoiHienTai') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe
          ADD LanDieuPhoiHienTai INT NOT NULL CONSTRAINT DF_DatXe_LanDieuPhoiHienTai DEFAULT (0);
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
        IF COL_LENGTH(N'dbo.TaiXe', N'KhoaTamDen') IS NULL
        BEGIN
          ALTER TABLE dbo.TaiXe
          ADD KhoaTamDen DATETIME2(0) NULL;
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.TaiXe', N'LyDoKhoaTam') IS NULL
        BEGIN
          ALTER TABLE dbo.TaiXe
          ADD LyDoKhoaTam NVARCHAR(500) NULL;
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
        IF OBJECT_ID(N'dbo.DatXeDieuPhoi', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.DatXeDieuPhoi
          (
            MaDieuPhoi INT IDENTITY(1,1) NOT NULL,
            MaChuyen VARCHAR(30) NOT NULL,
            MaTKTaiXe VARCHAR(20) NOT NULL,
            MaTX VARCHAR(20) NULL,
            ThuTuDieuPhoi INT NOT NULL,
            TrangThai VARCHAR(20) NOT NULL CONSTRAINT DF_DatXeDieuPhoi_TrangThai DEFAULT 'pending',
            KhoangCachKm DECIMAL(10, 3) NULL,
            LyDoTuChoi NVARCHAR(500) NULL,
            DuLieuDieuPhoi NVARCHAR(1200) NULL,
            NgayPhanHoi DATETIME2(0) NULL,
            NgayTao DATETIME2(0) NOT NULL CONSTRAINT DF_DatXeDieuPhoi_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat DATETIME2(0) NOT NULL CONSTRAINT DF_DatXeDieuPhoi_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_DatXeDieuPhoi PRIMARY KEY (MaDieuPhoi),
            CONSTRAINT UQ_DatXeDieuPhoi_MaChuyen_MaTKTaiXe UNIQUE (MaChuyen, MaTKTaiXe),
            CONSTRAINT FK_DatXeDieuPhoi_DatXe FOREIGN KEY (MaChuyen)
              REFERENCES dbo.DatXe(MaChuyen)
              ON UPDATE NO ACTION
              ON DELETE CASCADE,
            CONSTRAINT FK_DatXeDieuPhoi_TaiKhoan FOREIGN KEY (MaTKTaiXe)
              REFERENCES dbo.TaiKhoan(MaTK)
              ON UPDATE NO ACTION
              ON DELETE NO ACTION,
            CONSTRAINT FK_DatXeDieuPhoi_TaiXe FOREIGN KEY (MaTX)
              REFERENCES dbo.TaiXe(CCCD)
              ON UPDATE NO ACTION
              ON DELETE SET NULL,
            CONSTRAINT CK_DatXeDieuPhoi_TrangThai CHECK (TrangThai IN ('pending', 'rejected', 'accepted')),
            CONSTRAINT CK_DatXeDieuPhoi_ThuTu CHECK (ThuTuDieuPhoi > 0)
          );
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'MaTX') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD MaTX VARCHAR(20) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'KhoangCachKm') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD KhoangCachKm DECIMAL(10, 3) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'LyDoTuChoi') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD LyDoTuChoi NVARCHAR(500) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'DuLieuDieuPhoi') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD DuLieuDieuPhoi NVARCHAR(1200) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayPhanHoi') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD NgayPhanHoi DATETIME2(0) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayTao') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD NgayTao DATETIME2(0) NULL;

          IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayMoi') IS NOT NULL
          BEGIN
            EXEC sp_executesql N'
              UPDATE dbo.DatXeDieuPhoi
              SET NgayTao = COALESCE(NgayTao, NgayMoi, SYSDATETIME())
              WHERE NgayTao IS NULL;
            ';
          END
          ELSE
          BEGIN
            EXEC sp_executesql N'
              UPDATE dbo.DatXeDieuPhoi
              SET NgayTao = COALESCE(NgayTao, SYSDATETIME())
              WHERE NgayTao IS NULL;
            ';
          END

          ALTER TABLE dbo.DatXeDieuPhoi
          ALTER COLUMN NgayTao DATETIME2(0) NOT NULL;

          IF NOT EXISTS (
            SELECT 1
            FROM sys.default_constraints dc
            INNER JOIN sys.columns c
              ON c.object_id = dc.parent_object_id
             AND c.column_id = dc.parent_column_id
            WHERE dc.parent_object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
              AND c.name = N'NgayTao'
          )
          BEGIN
            ALTER TABLE dbo.DatXeDieuPhoi
            ADD CONSTRAINT DF_DatXeDieuPhoi_NgayTao DEFAULT SYSDATETIME() FOR NgayTao;
          END
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayCapNhat') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXeDieuPhoi
          ADD NgayCapNhat DATETIME2(0) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayCapNhat') IS NOT NULL
        BEGIN
          DECLARE @backfillNgayCapNhatSql NVARCHAR(MAX) = N'
            UPDATE dbo.DatXeDieuPhoi
            SET NgayCapNhat = COALESCE(NgayCapNhat, NgayTao, SYSDATETIME())
            WHERE NgayCapNhat IS NULL;
          ';

          EXEC sp_executesql @backfillNgayCapNhatSql;

          IF EXISTS (
            SELECT 1
            FROM sys.columns
            WHERE object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
              AND name = N'NgayCapNhat'
              AND is_nullable = 1
          )
          BEGIN
            EXEC sp_executesql N'ALTER TABLE dbo.DatXeDieuPhoi ALTER COLUMN NgayCapNhat DATETIME2(0) NOT NULL;';
          END
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayCapNhat') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM sys.default_constraints dc
            INNER JOIN sys.columns c
              ON c.object_id = dc.parent_object_id
             AND c.column_id = dc.parent_column_id
            WHERE dc.parent_object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
              AND c.name = N'NgayCapNhat'
          )
        BEGIN
          EXEC sp_executesql N'ALTER TABLE dbo.DatXeDieuPhoi ADD CONSTRAINT DF_DatXeDieuPhoi_NgayCapNhat DEFAULT SYSDATETIME() FOR NgayCapNhat;';
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'MaTX') IS NOT NULL
        BEGIN
          EXEC sp_executesql N'
            UPDATE dp
            SET dp.MaTX = tx.CCCD
            FROM dbo.DatXeDieuPhoi AS dp
            INNER JOIN dbo.TaiXe AS tx
              ON tx.MaTK = dp.MaTKTaiXe
            WHERE dp.MaTX IS NULL OR LTRIM(RTRIM(dp.MaTX)) = '''';
          ';

          EXEC sp_executesql N'
            UPDATE dp
            SET dp.MaTX = NULL
            FROM dbo.DatXeDieuPhoi AS dp
            LEFT JOIN dbo.TaiXe AS tx
              ON tx.CCCD = dp.MaTX
            WHERE dp.MaTX IS NOT NULL
              AND tx.CCCD IS NULL;
          ';
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'MaTX') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM sys.foreign_key_columns AS fkc
            INNER JOIN sys.columns AS pc
              ON pc.object_id = fkc.parent_object_id
             AND pc.column_id = fkc.parent_column_id
            INNER JOIN sys.columns AS rc
              ON rc.object_id = fkc.referenced_object_id
             AND rc.column_id = fkc.referenced_column_id
            WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
              AND fkc.referenced_object_id = OBJECT_ID(N'dbo.TaiXe')
              AND pc.name = N'MaTX'
              AND rc.name = N'CCCD'
          )
        BEGIN
          EXEC sp_executesql N'
            ALTER TABLE dbo.DatXeDieuPhoi
            ADD CONSTRAINT FK_DatXeDieuPhoi_TaiXe FOREIGN KEY (MaTX)
              REFERENCES dbo.TaiXe(CCCD)
              ON UPDATE NO ACTION
              ON DELETE SET NULL;
          ';
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayTao') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = N'IX_DatXeDieuPhoi_MaTKTaiXe_NgayTao'
              AND object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
          )
        BEGIN
          CREATE INDEX IX_DatXeDieuPhoi_MaTKTaiXe_NgayTao
          ON dbo.DatXeDieuPhoi (MaTKTaiXe, NgayTao DESC, MaDieuPhoi DESC);
        END

        IF COL_LENGTH(N'dbo.DatXeDieuPhoi', N'NgayMoi') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = N'IX_DatXeDieuPhoi_MaTKTaiXe_NgayMoi'
              AND object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi')
          )
        BEGIN
          CREATE INDEX IX_DatXeDieuPhoi_MaTKTaiXe_NgayMoi
          ON dbo.DatXeDieuPhoi (MaTKTaiXe, NgayMoi DESC, MaDieuPhoi DESC);
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

        IF COL_LENGTH(N'dbo.DatXe', N'PhanTramPhiNenTang') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD PhanTramPhiNenTang DECIMAL(5, 2) NULL;
        END

        IF COL_LENGTH(N'dbo.DatXe', N'TienPhiNenTang') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD TienPhiNenTang INT NULL;
        END

        IF COL_LENGTH(N'dbo.DatXe', N'TienTaiXeNhan') IS NULL
        BEGIN
          ALTER TABLE dbo.DatXe ADD TienTaiXeNhan INT NULL;
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

        IF COL_LENGTH(N'dbo.ThanhToan', N'GatewayAppTransId') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD GatewayAppTransId VARCHAR(80) NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'GatewayTransToken') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD GatewayTransToken VARCHAR(120) NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'GatewayLastQueryAt') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD GatewayLastQueryAt DATETIME2(0) NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'GatewayLastReturnCode') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD GatewayLastReturnCode INT NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'PhanTramPhiNenTang') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD PhanTramPhiNenTang DECIMAL(5, 2) NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'TienPhiNenTang') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD TienPhiNenTang INT NULL;
        END

        IF COL_LENGTH(N'dbo.ThanhToan', N'TienTaiXeNhan') IS NULL
        BEGIN
          ALTER TABLE dbo.ThanhToan ADD TienTaiXeNhan INT NULL;
        END
      `);

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.PaymentGatewayAudit', N'U') IS NOT NULL AND OBJECT_ID(N'dbo.NhatKyCongThanhToan', N'U') IS NULL
          EXEC sp_rename N'dbo.PaymentGatewayAudit', N'NhatKyCongThanhToan';

        IF OBJECT_ID(N'dbo.NhatKyCongThanhToan', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.NhatKyCongThanhToan
          (
            MaNhatKy BIGINT IDENTITY(1,1) NOT NULL,
            MaThanhToan VARCHAR(30) NULL,
            MaChuyen VARCHAR(30) NULL,
            NhaCungCap VARCHAR(20) NOT NULL,
            LoaiSuKien VARCHAR(40) NOT NULL,
            Nguon VARCHAR(30) NOT NULL,
            TrangThaiXacThuc VARCHAR(20) NOT NULL,
            MacYeuCau VARCHAR(128) NULL,
            MacTinhToan VARCHAR(128) NULL,
            MaGiaoDichNCC VARCHAR(80) NULL,
            MaPhanHoiNCC INT NULL,
            NoiDung NVARCHAR(500) NULL,
            DuLieuYeuCau NVARCHAR(MAX) NULL,
            DuLieuPhanHoi NVARCHAR(MAX) NULL,
            NgayTao DATETIME2(0) NOT NULL CONSTRAINT DF_PaymentGatewayAudit_CreatedAt DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_PaymentGatewayAudit PRIMARY KEY (MaNhatKy)
          );
        END

        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'AuditId') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MaNhatKy') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.AuditId', N'MaNhatKy', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'PaymentCode') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MaThanhToan') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.PaymentCode', N'MaThanhToan', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'BookingCode') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MaChuyen') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.BookingCode', N'MaChuyen', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'Provider') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'NhaCungCap') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.Provider', N'NhaCungCap', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'EventType') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'LoaiSuKien') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.EventType', N'LoaiSuKien', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'Source') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'Nguon') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.Source', N'Nguon', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'VerifyStatus') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'TrangThaiXacThuc') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.VerifyStatus', N'TrangThaiXacThuc', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'RequestMac') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MacYeuCau') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.RequestMac', N'MacYeuCau', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'ComputedMac') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MacTinhToan') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.ComputedMac', N'MacTinhToan', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'AppTransId') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MaGiaoDichNCC') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.AppTransId', N'MaGiaoDichNCC', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'GatewayReturnCode') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'MaPhanHoiNCC') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.GatewayReturnCode', N'MaPhanHoiNCC', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'Message') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'NoiDung') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.Message', N'NoiDung', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'RequestPayload') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'DuLieuYeuCau') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.RequestPayload', N'DuLieuYeuCau', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'ResponsePayload') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'DuLieuPhanHoi') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.ResponsePayload', N'DuLieuPhanHoi', N'COLUMN';
        IF COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'CreatedAt') IS NOT NULL AND COL_LENGTH(N'dbo.NhatKyCongThanhToan', N'NgayTao') IS NULL
          EXEC sp_rename N'dbo.NhatKyCongThanhToan.CreatedAt', N'NgayTao', N'COLUMN';
      `);

      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE name = N'IX_PaymentGatewayAudit_BookingCode_CreatedAt'
            AND object_id = OBJECT_ID(N'dbo.NhatKyCongThanhToan')
        )
        BEGIN
          CREATE INDEX IX_PaymentGatewayAudit_BookingCode_CreatedAt
          ON dbo.NhatKyCongThanhToan(MaChuyen, NgayTao DESC);
        END

        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE name = N'IX_ThanhToan_GatewayAppTransId'
            AND object_id = OBJECT_ID(N'dbo.ThanhToan')
        )
        BEGIN
          CREATE INDEX IX_ThanhToan_GatewayAppTransId
          ON dbo.ThanhToan(GatewayAppTransId)
          WHERE GatewayAppTransId IS NOT NULL;
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

async function countDriverActiveTrips(transaction, driverCccd, excludeBookingCode = '') {
  const normalizedDriverCccd = normalizeText(driverCccd);

  if (!normalizedDriverCccd) {
    return 0;
  }

  const queryResult = await new sql.Request(transaction)
    .input('driverCccd', sql.VarChar(20), normalizedDriverCccd)
    .input('excludeBookingCode', sql.VarChar(30), normalizeText(excludeBookingCode) || null)
    .query(`
      SELECT COUNT(1) AS activeTripCount
      FROM dbo.DatXe dx
      WHERE LOWER(ISNULL(dx.MaTX, '')) = LOWER(@driverCccd)
        AND (@excludeBookingCode IS NULL OR dx.MaChuyen <> @excludeBookingCode)
        AND dx.TrangThaiChuyen IN (N'DaNhanChuyen', N'DangDen', N'DaDon', N'DangThucHien');
    `);

  return Number(queryResult.recordset?.[0]?.activeTripCount ?? 0) || 0;
}

async function resolveDriverDispatchState(transaction, driverIdentifier) {
  const normalizedDriverIdentifier = normalizeText(driverIdentifier);

  if (!normalizedDriverIdentifier) {
    return {
      driverStatus: '',
      temporaryLockUntil: null,
      temporaryLockReason: '',
    };
  }

  const queryResult = await new sql.Request(transaction)
    .input('driverIdentifier', sql.VarChar(20), normalizedDriverIdentifier)
    .query(`
      SELECT TOP 1
        tx.TrangThai AS DriverStatus,
        tx.KhoaTamDen AS TemporaryLockUntil,
        tx.LyDoKhoaTam AS TemporaryLockReason,
        JSON_VALUE(tx.ThongTinXe, '$.name') AS DriverVehicleName,
        JSON_VALUE(tx.ThongTinXe, '$.vehicleType') AS DriverVehicleType
      FROM TaiXe tx
      WHERE
        LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier)
        OR LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverIdentifier)
      ORDER BY CASE WHEN LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverIdentifier) THEN 0 ELSE 1 END;
    `);

  const row = queryResult.recordset?.[0] ?? null;
  const temporaryLockUntil = row?.TemporaryLockUntil ? new Date(row.TemporaryLockUntil) : null;

  return {
    driverStatus: normalizeText(row?.DriverStatus),
    temporaryLockUntil: temporaryLockUntil && !Number.isNaN(temporaryLockUntil.getTime()) ? temporaryLockUntil : null,
    temporaryLockReason: normalizeText(row?.TemporaryLockReason),
    vehicleCategory:
      normalizeVehicleCategory(row?.DriverVehicleType)
      || normalizeVehicleCategory(row?.DriverVehicleName),
  };
}

async function resolveDriverDispatchCandidates(
  transaction,
  pickup = {},
  excludedDriverSystemAccountIds = [],
  requiredVehicleCategory = '',
) {
  const normalizedRequiredVehicleCategory = normalizeVehicleCategory(requiredVehicleCategory);
  const queryResult = await new sql.Request(transaction).query(`
    SELECT
      tx.MaTK AS driverSystemAccountId,
      tx.CCCD AS driverAccountId,
      tx.DiaChi AS driverAddress,
      JSON_VALUE(tx.ThongTinXe, '$.name') AS driverVehicleName,
      JSON_VALUE(tx.ThongTinXe, '$.vehicleType') AS driverVehicleType,
      tx.TrangThai AS driverStatus,
      tx.KhoaTamDen AS temporaryLockUntil,
      tx.LyDoKhoaTam AS temporaryLockReason,
      activeTrips.activeTripCount,
      tk.Ten AS driverName,
      tk.SDT AS driverPhone,
      tk.TrangThai AS accountStatus
    FROM dbo.TaiXe tx
    INNER JOIN dbo.TaiKhoan tk
      ON tk.MaTK = tx.MaTK
    OUTER APPLY (
      SELECT COUNT(1) AS activeTripCount
      FROM dbo.DatXe dxActive
      WHERE LOWER(ISNULL(dxActive.MaTX, '')) = LOWER(ISNULL(tx.CCCD, ''))
        AND dxActive.TrangThaiChuyen IN (N'DaNhanChuyen', N'DangDen', N'DaDon', N'DangThucHien')
    ) activeTrips
    WHERE tx.MaTK IS NOT NULL
      AND NULLIF(tx.CCCD, '') IS NOT NULL;
  `);

  const excludedSet = new Set(
    (Array.isArray(excludedDriverSystemAccountIds) ? excludedDriverSystemAccountIds : [])
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean),
  );

  const pickupPosition = normalizePosition(pickup?.position) || await resolveLocationPosition(pickup);
  const now = Date.now();
  const rows = queryResult.recordset ?? [];
  const normalizedCandidates = await Promise.all(rows.map(async (row) => {
    const driverSystemAccountId = normalizeText(row.driverSystemAccountId);

    if (!driverSystemAccountId || excludedSet.has(driverSystemAccountId.toLowerCase())) {
      return null;
    }

    // Only dispatch to drivers that are currently online in realtime channel.
    if (!hasActiveRideSocketClient({ accountId: driverSystemAccountId, roleCode: 'Q3' })) {
      return null;
    }

    const accountStatus = normalizeStatusToken(row.accountStatus);
    const driverStatus = normalizeStatusToken(row.driverStatus);
    const activeTripCount = Number(row.activeTripCount ?? 0);
    const hasActiveTrip = Number.isFinite(activeTripCount) && activeTripCount > 0;

    if (accountStatus === 'khoa' || hasActiveTrip) {
      return null;
    }

    if (!isDriverReadyStatus(driverStatus) && (driverStatus === 'khoa' || driverStatus === 'choduyet')) {
      return null;
    }

    const temporaryLockUntil = row.temporaryLockUntil ? new Date(row.temporaryLockUntil) : null;

    if (temporaryLockUntil && !Number.isNaN(temporaryLockUntil.getTime()) && temporaryLockUntil.getTime() > now) {
      return null;
    }

    const driverPosition = await resolveLocationPosition({
      label: normalizeText(row.driverAddress),
      position: null,
    });

    const driverVehicleCategory =
      normalizeVehicleCategory(row.driverVehicleType)
      || normalizeVehicleCategory(row.driverVehicleName);

    if (!driverVehicleCategory) {
      return null;
    }

    if (normalizedRequiredVehicleCategory && driverVehicleCategory !== normalizedRequiredVehicleCategory) {
      return null;
    }

    const distanceKm = pickupPosition && driverPosition
      ? calculateDistanceKm(pickupPosition, driverPosition)
      : null;

    return {
      driverSystemAccountId,
      driverAccountId: normalizeText(row.driverAccountId),
      driverName: normalizeText(row.driverName),
      driverPhone: normalizeText(row.driverPhone),
      driverAddress: normalizeText(row.driverAddress),
      driverVehicleCategory,
      distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(3)) : null,
    };
  }));

  return normalizedCandidates
    .filter(Boolean)
    .sort((leftCandidate, rightCandidate) => {
      const leftDistance = Number.isFinite(leftCandidate.distanceKm) ? leftCandidate.distanceKm : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(rightCandidate.distanceKm) ? rightCandidate.distanceKm : Number.POSITIVE_INFINITY;

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return leftCandidate.driverSystemAccountId.localeCompare(rightCandidate.driverSystemAccountId);
    });
}

async function insertDriverDispatchAttempt(transaction, payload = {}) {
  const bookingCode = normalizeText(payload.bookingCode);
  const driverSystemAccountId = normalizeText(payload.driverSystemAccountId);
  const driverAccountId = normalizeText(payload.driverAccountId);
  const dispatchOrder = Number(payload.dispatchOrder);
  const distanceKm = Number(payload.distanceKm);
  const status = normalizeText(payload.status || DRIVER_DISPATCH_ATTEMPT_STATUS.pending).toLowerCase();
  const dispatchPayload = normalizeText(payload.dispatchPayload || '');

  if (!bookingCode || !driverSystemAccountId || !Number.isInteger(dispatchOrder) || dispatchOrder <= 0) {
    return;
  }

  await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
    .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
    .input('dispatchOrder', sql.Int, dispatchOrder)
    .input('status', sql.VarChar(20), status)
    .input('distanceKm', sql.Decimal(10, 3), Number.isFinite(distanceKm) ? distanceKm : null)
    .input('dispatchPayload', sql.NVarChar(1200), dispatchPayload || null)
    .query(`
      INSERT INTO dbo.DatXeDieuPhoi
      (
        MaChuyen,
        MaTKTaiXe,
        MaTX,
        ThuTuDieuPhoi,
        TrangThai,
        KhoangCachKm,
        DuLieuDieuPhoi
      )
      VALUES
      (
        @bookingCode,
        @driverSystemAccountId,
        NULLIF(@driverAccountId, ''),
        @dispatchOrder,
        @status,
        @distanceKm,
        NULLIF(@dispatchPayload, '')
      );
    `);
}

async function upsertDispatchViolation(transaction, payload = {}) {
  const fingerprint = normalizeText(payload.fingerprint);

  if (!fingerprint) {
    return false;
  }

  await ensureDriverViolationSchema();

  const result = await new sql.Request(transaction)
    .input('fingerprint', sql.VarChar(150), fingerprint)
    .input('bookingCode', sql.VarChar(30), normalizeText(payload.bookingCode) || null)
    .input('driverAccountId', sql.VarChar(20), normalizeText(payload.driverAccountId) || null)
    .input('driverSystemAccountId', sql.VarChar(20), normalizeText(payload.driverSystemAccountId) || null)
    .input('driverName', sql.NVarChar(120), normalizeText(payload.driverName) || null)
    .input('driverPhone', sql.VarChar(20), normalizeText(payload.driverPhone) || null)
    .input('description', sql.NVarChar(1200), normalizeText(payload.description) || null)
    .input('severity', sql.VarChar(20), normalizeText(payload.severity || 'medium').toLowerCase())
    .input('detectedAt', sql.DateTime2(0), new Date())
    .input('detectionPayload', sql.NVarChar(2000), normalizeText(payload.detectionPayload) || null)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.ViPhamTaiXe WHERE Fingerprint = @fingerprint)
      BEGIN
        INSERT INTO dbo.ViPhamTaiXe
        (
          Fingerprint,
          NguonPhatHien,
          LoaiViPham,
          TenLoaiViPham,
          MoTa,
          MucDo,
          TrangThai,
          MaChuyen,
          MaTX,
          MaTKTaiXe,
          TenTaiXe,
          driverPhone,
          NgayPhatHien,
          DuLieuPhatHien,
          NgayTao,
          NgayCapNhat
        )
        VALUES
        (
          @fingerprint,
          'system',
          'cancel-trip',
          N'Hủy chuyến',
          COALESCE(@description, N'Hệ thống ghi nhận tài xế từ chối cuốc liên tiếp.'),
          @severity,
          'pending',
          NULLIF(@bookingCode, ''),
          NULLIF(@driverAccountId, ''),
          NULLIF(@driverSystemAccountId, ''),
          NULLIF(@driverName, ''),
          NULLIF(@driverPhone, ''),
          @detectedAt,
          NULLIF(@detectionPayload, ''),
          SYSDATETIME(),
          SYSDATETIME()
        );

        SELECT CAST(1 AS INT) AS inserted;
      END
      ELSE
      BEGIN
        SELECT CAST(0 AS INT) AS inserted;
      END;
    `);

  return result.recordset?.[0]?.inserted > 0;
}

async function enforceDriverDispatchRejectPolicy(transaction, payload = {}) {
  const driverSystemAccountId = normalizeText(payload.driverSystemAccountId);
  const bookingCode = normalizeText(payload.bookingCode);

  if (!driverSystemAccountId) {
    return { warningTriggered: false, temporaryLockTriggered: false };
  }

  const driverResult = await new sql.Request(transaction)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
    .query(`
      SELECT TOP 1
        tx.CCCD AS driverAccountId,
        tx.KhoaTamDen AS temporaryLockUntil,
        tk.Ten AS driverName,
        tk.SDT AS driverPhone
      FROM dbo.TaiXe tx
      LEFT JOIN dbo.TaiKhoan tk
        ON tk.MaTK = tx.MaTK
      WHERE tx.MaTK = @driverSystemAccountId;
    `);

  const driverRow = driverResult.recordset?.[0] ?? null;

  if (!driverRow) {
    return { warningTriggered: false, temporaryLockTriggered: false };
  }

  const historyResult = await new sql.Request(transaction)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
    .query(`
      SELECT TOP (12)
        dp.TrangThai AS dispatchStatus,
        dp.NgayPhanHoi AS respondedAt
      FROM dbo.DatXeDieuPhoi dp
      WHERE dp.MaTKTaiXe = @driverSystemAccountId
        AND dp.TrangThai IN ('rejected', 'accepted')
        AND dp.NgayPhanHoi IS NOT NULL
      ORDER BY dp.NgayPhanHoi DESC, dp.MaDieuPhoi DESC;
    `);

  const historyRows = historyResult.recordset ?? [];
  let rejectionStreak = 0;

  for (const row of historyRows) {
    if (normalizeText(row.dispatchStatus).toLowerCase() !== DRIVER_DISPATCH_ATTEMPT_STATUS.rejected) {
      break;
    }

    rejectionStreak += 1;
  }

  const warningTriggered = rejectionStreak >= DRIVER_DISPATCH_WARNING_REJECT_STREAK;
  const topFiveRejectedRows = historyRows
    .slice(0, DRIVER_DISPATCH_LOCK_REJECT_STREAK)
    .filter((row) => normalizeText(row.dispatchStatus).toLowerCase() === DRIVER_DISPATCH_ATTEMPT_STATUS.rejected);
  const firstRejectAt = topFiveRejectedRows[0]?.respondedAt ? new Date(topFiveRejectedRows[0].respondedAt) : null;
  const fifthRejectAt = topFiveRejectedRows[DRIVER_DISPATCH_LOCK_REJECT_STREAK - 1]?.respondedAt
    ? new Date(topFiveRejectedRows[DRIVER_DISPATCH_LOCK_REJECT_STREAK - 1].respondedAt)
    : null;
  const temporaryLockTriggered = topFiveRejectedRows.length === DRIVER_DISPATCH_LOCK_REJECT_STREAK
    && firstRejectAt
    && fifthRejectAt
    && !Number.isNaN(firstRejectAt.getTime())
    && !Number.isNaN(fifthRejectAt.getTime())
    && (firstRejectAt.getTime() - fifthRejectAt.getTime()) <= DRIVER_DISPATCH_LOCK_WINDOW_MS;

  if (warningTriggered) {
    await upsertDispatchViolation(transaction, {
      fingerprint: `dispatch-reject-warning:${driverSystemAccountId}:${bookingCode}`.slice(0, 150),
      bookingCode,
      driverAccountId: normalizeText(driverRow.driverAccountId),
      driverSystemAccountId,
      driverName: normalizeText(driverRow.driverName),
      driverPhone: normalizeText(driverRow.driverPhone),
      severity: rejectionStreak >= DRIVER_DISPATCH_LOCK_REJECT_STREAK ? 'high' : 'medium',
      description: `Tài xế đã từ chối ${rejectionStreak} cuốc liên tiếp.`,
      detectionPayload: JSON.stringify({
        source: 'dispatch-rejection-policy',
        streak: rejectionStreak,
      }),
    });

    if (rejectionStreak === DRIVER_DISPATCH_WARNING_REJECT_STREAK) {
      await createNotification({
        accountId: driverSystemAccountId,
        title: 'Cảnh cáo từ chối cuốc liên tiếp',
        content: 'Bạn đã từ chối 3 cuốc liên tiếp. Hệ thống đã ghi nhận vi phạm, vui lòng nhận cuốc đúng quy định.',
        recipient: 'driver',
        status: 'sent',
        sendAt: new Date().toISOString(),
      });
    }
  }

  if (temporaryLockTriggered) {
    await new sql.Request(transaction)
      .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
      .query(`
        UPDATE dbo.TaiXe
        SET
          KhoaTamDen = DATEADD(HOUR, 1, SYSDATETIME()),
          LyDoKhoaTam = N'Từ chối 5 cuốc liên tiếp trong 1 giờ',
          NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @driverSystemAccountId;
      `);

    await upsertDispatchViolation(transaction, {
      fingerprint: `dispatch-reject-lock:${driverSystemAccountId}:${bookingCode}`.slice(0, 150),
      bookingCode,
      driverAccountId: normalizeText(driverRow.driverAccountId),
      driverSystemAccountId,
      driverName: normalizeText(driverRow.driverName),
      driverPhone: normalizeText(driverRow.driverPhone),
      severity: 'high',
      description: 'Tài xế từ chối 5 cuốc liên tiếp trong 1 giờ, hệ thống tự động khóa nhận chuyến 1 giờ.',
      detectionPayload: JSON.stringify({
        source: 'dispatch-rejection-policy',
        streak: rejectionStreak,
        lockMinutes: 60,
      }),
    });

    await createNotification({
      accountId: driverSystemAccountId,
      title: 'Tạm khóa nhận chuyến 1 giờ',
      content: 'Bạn đã từ chối 5 cuốc liên tiếp trong 1 giờ. Chức năng nhận chuyến đã tạm khóa 1 giờ.',
      recipient: 'driver',
      status: 'sent',
      sendAt: new Date().toISOString(),
    });
  }

  return {
    warningTriggered,
    temporaryLockTriggered,
    rejectionStreak,
  };
}

function isDriverReadyStatus(driverStatus) {
  const normalizedDriverStatus = normalizeStatusToken(driverStatus);

  return (
    normalizedDriverStatus === 'hoatdong'
    || normalizedDriverStatus === 'hoantat'
    || normalizedDriverStatus === 'dangcho'
    || normalizedDriverStatus === 'ranh'
    || normalizedDriverStatus === 'active'
    || normalizedDriverStatus === 'online'
    || normalizedDriverStatus === 'sansang'
    || normalizedDriverStatus === 'ready'
    || normalizedDriverStatus === 'available'
  );
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
      minOrderAmount: 0,
      isEligible: true,
    };
  }

  const discountType = String(promotion.discountType ?? 'percent').trim().toLowerCase();
  const discountPercent = Number(promotion.discountPercent ?? 0);
  const discountAmountValue = Number(promotion.discountAmount ?? 0);
  const maxAmount = Number(promotion.maxAmount ?? 0);
  const minOrderAmount = Number(promotion.minOrderAmount ?? 0);
  const safeMinOrderAmount = Number.isFinite(minOrderAmount) && minOrderAmount > 0 ? roundCurrency(minOrderAmount) : 0;

  if (safeMinOrderAmount > 0 && originalPrice < safeMinOrderAmount) {
    return {
      originalPrice,
      discountAmount: 0,
      finalPrice: originalPrice,
      minOrderAmount: safeMinOrderAmount,
      isEligible: false,
    };
  }

  const rawDiscountAmount = discountType === 'fixed'
    ? roundCurrency(Number.isFinite(discountAmountValue) && discountAmountValue > 0 ? discountAmountValue : 0)
    : roundCurrency(originalPrice * (Number.isFinite(discountPercent) && discountPercent > 0 ? discountPercent : 0) / 100);
  const limitedDiscountAmount = discountType === 'percent' && Number.isFinite(maxAmount) && maxAmount > 0
    ? Math.min(rawDiscountAmount, roundCurrency(maxAmount))
    : rawDiscountAmount;
  const discountAmount = Math.min(originalPrice, Math.max(0, limitedDiscountAmount));
  const finalPrice = Math.max(0, originalPrice - discountAmount);

  return {
    originalPrice,
    discountAmount,
    finalPrice,
    minOrderAmount: safeMinOrderAmount,
    isEligible: true,
  };
}

function buildPromotionIneligibleMessage(promotion = null, minOrderAmount = 0) {
  const promotionCode = normalizeText(promotion?.code);
  const minOrderText = formatCurrency(minOrderAmount || 0);

  if (promotionCode) {
    return `Mã ${promotionCode} chỉ áp dụng cho đơn từ ${minOrderText}.`;
  }

  return `Ưu đãi chỉ áp dụng cho đơn từ ${minOrderText}.`;
}

function buildPromotionTypeSummaryText(promotion = null) {
  const discountType = String(promotion?.discountType ?? 'percent').trim().toLowerCase();

  if (discountType === 'fixed') {
    const discountAmount = Number(promotion?.discountAmount ?? 0);
    return discountAmount > 0 ? `Giảm cố định ${formatCurrency(discountAmount)}` : '';
  }

  const discountPercent = Number(promotion?.discountPercent ?? 0);
  const maxAmount = Number(promotion?.maxAmount ?? 0);

  if (!(discountPercent > 0)) {
    return '';
  }

  const maxAmountText = maxAmount > 0 ? `, tối đa ${formatCurrency(maxAmount)}` : '';
  return `Giảm ${discountPercent}%${maxAmountText}`;
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

  const typeSummary = buildPromotionTypeSummaryText(promotion);

  if (typeSummary) {
    parts.push(typeSummary);
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
    const promotionResult = await listPromotions({ status: 'active', visibility: 'all' });
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

    if (String(resolvedPromotion.visibility ?? '').toLowerCase() === 'hidden') {
      const normalizedResolvedCode = normalizePromotionLookupCode(resolvedPromotion.code);

      if (!promotionCode || normalizedResolvedCode !== promotionCode) {
        throw createValidationError('Ma uu dai khong hop le hoac da het han. Vui long chon lai.');
      }
    }

    return resolvedPromotion;
  }

  const fallbackDiscountType = String(payload?.promotionDiscountType ?? 'percent').trim().toLowerCase();
  const fallbackDiscountPercent = Number(payload?.promotionDiscountPercent);
  const fallbackDiscountAmount = Number(payload?.promotionDiscountAmount);
  const fallbackMaxAmount = Number(payload?.promotionMaxAmount);
  const fallbackMinOrderAmount = Number(payload?.promotionMinOrderAmount);
  const fallbackPromotionTitle = normalizeText(payload?.promotionTitle);
  const fallbackPromotionScope = normalizeText(payload?.promotionScope);
  const fallbackPromotionStartsAt = normalizeText(payload?.promotionStartsAt);
  const fallbackPromotionExpiresAt = normalizeText(payload?.promotionExpiresAt);
  const fallbackPromotionVisibility = normalizeText(payload?.promotionVisibility) || 'public';

  const hasPercentDiscount = fallbackDiscountType !== 'fixed' && Number.isFinite(fallbackDiscountPercent) && fallbackDiscountPercent > 0;
  const hasFixedDiscount = fallbackDiscountType === 'fixed' && Number.isFinite(fallbackDiscountAmount) && fallbackDiscountAmount > 0;

  if (!hasPercentDiscount && !hasFixedDiscount) {
    return null;
  }

  return {
    id: promotionId,
    code: promotionCode,
    title: fallbackPromotionTitle,
    scope: fallbackPromotionScope,
    discountType: fallbackDiscountType === 'fixed' ? 'fixed' : 'percent',
    discountPercent: hasPercentDiscount ? fallbackDiscountPercent : 0,
    discountAmount: hasFixedDiscount ? fallbackDiscountAmount : 0,
    maxAmount: Number.isFinite(fallbackMaxAmount) && fallbackMaxAmount >= 0 ? fallbackMaxAmount : 0,
    minOrderAmount: Number.isFinite(fallbackMinOrderAmount) && fallbackMinOrderAmount >= 0 ? fallbackMinOrderAmount : 0,
    startsAt: fallbackPromotionStartsAt,
    expiresAt: fallbackPromotionExpiresAt,
    visibility: fallbackPromotionVisibility,
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

  const serviceFee = BOOKING_SERVICE_FEE[vehicle] ?? 5000;

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
      serviceFee,
      serviceFeeFormatted: formatCurrency(serviceFee),
      totalPrice: price + serviceFee,
      totalPriceFormatted: formatCurrency(price + serviceFee),
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

  if (normalizedValue === 'app_wallet' || normalizedValue === 'qr') {
    return 'wallet';
  }

  if (normalizedValue === 'wallet') {
    return normalizedValue;
  }

  return 'cash';
}

function normalizePaymentProvider(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (normalizedValue === 'momo' || normalizedValue === 'zalopay' || normalizedValue === 'app_wallet') {
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

function getPaymentStatus(paymentMethod, paymentProvider = '') {
  const normalizedMethod = normalizeText(paymentMethod).toLowerCase();
  const normalizedProvider = normalizeText(paymentProvider).toLowerCase();

  if (normalizedMethod === 'cash') {
    return 'ChoThuTien';
  }

  if ((normalizedMethod === 'wallet' && normalizedProvider === 'app_wallet') || normalizedMethod === 'app_wallet') {
    return 'DaThanhToan';
  }

  // Non-cash methods must be confirmed by payment gateway callback.
  return 'ChoXacNhan';
}

function normalizePaymentStatusValue(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (normalizedValue === 'dathanhtoan') {
    return 'DaThanhToan';
  }

  if (normalizedValue === 'chothutien') {
    return 'ChoThuTien';
  }

  if (normalizedValue === 'thatbai') {
    return 'ThatBai';
  }

  if (normalizedValue === 'choxacnhan' || normalizedValue === 'choxacthanh') {
    return 'ChoXacNhan';
  }

  return 'ChoXacNhan';
}

function getPaymentStatusLabel(paymentStatus) {
  const normalizedPaymentStatus = normalizePaymentStatusValue(paymentStatus);
  return PAYMENT_STATUS_LABELS[normalizedPaymentStatus] ?? PAYMENT_STATUS_LABELS.ChoXacNhan;
}

function generatePaymentCode(bookingCode) {
  return `TT-${bookingCode}`;
}

function generateBookingCode() {
  const now = new Date();
  const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const timeStamp = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}${String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0')}`;
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);

  return `SR-${dateStamp}-${timeStamp}-${randomSuffix}`;
}

function isZaloPayConfigured() {
  return Boolean(normalizeText(env.zaloPayAppId) && normalizeText(env.zaloPayKey1) && normalizeText(env.zaloPayKey2));
}

function isMoMoConfigured() {
  return Boolean(normalizeText(env.momoPartnerCode) && normalizeText(env.momoAccessKey) && normalizeText(env.momoSecretKey));
}

function isMoMoMockModeEnabled() {
  return Boolean(env.momoMockMode);
}

function computeZaloPayHmac(data, secret) {
  return createHmac('sha256', String(secret ?? ''))
    .update(String(data ?? ''))
    .digest('hex');
}

function computeMoMoHmac(data, secret) {
  return createHmac('sha256', String(secret ?? ''))
    .update(String(data ?? ''))
    .digest('hex');
}

function encodeMoMoExtraData(payload = {}) {
  try {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  } catch {
    return '';
  }
}

function decodeMoMoExtraData(value = '') {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return {};
  }

  try {
    const decoded = Buffer.from(normalizedValue, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeCompareText(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue ?? ''), 'utf8');
  const right = Buffer.from(String(rightValue ?? ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

async function logPaymentGatewayAudit(payload = {}) {
  if (!isSqlServerConfigured()) {
    return;
  }

  try {
    await ensureRideSchema();

    const pool = await getSqlServerPool();
    await pool
      .request()
      .input('paymentCode', sql.VarChar(30), normalizeText(payload.paymentCode) || null)
      .input('bookingCode', sql.VarChar(30), normalizeText(payload.bookingCode) || null)
      .input('provider', sql.VarChar(20), normalizeText(payload.provider).toLowerCase() || 'zalopay')
      .input('eventType', sql.VarChar(40), normalizeText(payload.eventType).toLowerCase() || 'unknown')
      .input('source', sql.VarChar(30), normalizeText(payload.source).toLowerCase() || 'server')
      .input('verifyStatus', sql.VarChar(20), normalizeText(payload.verifyStatus).toLowerCase() || 'unknown')
      .input('requestMac', sql.VarChar(128), normalizeText(payload.requestMac) || null)
      .input('computedMac', sql.VarChar(128), normalizeText(payload.computedMac) || null)
      .input('appTransId', sql.VarChar(80), normalizeText(payload.appTransId) || null)
      .input('gatewayReturnCode', sql.Int, Number.isFinite(Number(payload.gatewayReturnCode)) ? Number(payload.gatewayReturnCode) : null)
      .input('message', sql.NVarChar(500), normalizeText(payload.message) || null)
      .input('requestPayload', sql.NVarChar(sql.MAX), payload.requestPayload ? JSON.stringify(payload.requestPayload) : null)
      .input('responsePayload', sql.NVarChar(sql.MAX), payload.responsePayload ? JSON.stringify(payload.responsePayload) : null)
      .query(`
        INSERT INTO dbo.NhatKyCongThanhToan
        (
          MaThanhToan,
          MaChuyen,
          NhaCungCap,
          LoaiSuKien,
          Nguon,
          TrangThaiXacThuc,
          MacYeuCau,
          MacTinhToan,
          MaGiaoDichNCC,
          MaPhanHoiNCC,
          NoiDung,
          DuLieuYeuCau,
          DuLieuPhanHoi,
          NgayTao
        )
        VALUES
        (
          @paymentCode,
          @bookingCode,
          @provider,
          @eventType,
          @source,
          @verifyStatus,
          @requestMac,
          @computedMac,
          @appTransId,
          @gatewayReturnCode,
          @message,
          @requestPayload,
          @responsePayload,
          SYSUTCDATETIME()
        );
      `);
  } catch {
    // Never break payment flow because audit logging fails.
  }
}

async function queryZaloPayOrderStatus(appTransId) {
  const normalizedAppTransId = normalizeText(appTransId);

  if (!normalizedAppTransId) {
    throw createValidationError('Thiếu app_trans_id để truy vấn trạng thái ZaloPay.');
  }

  if (!isZaloPayConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình ZaloPay (APP_ID/KEY1/KEY2).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để truy vấn ZaloPay.');
  }

  const appId = normalizeText(env.zaloPayAppId);
  const key1 = normalizeText(env.zaloPayKey1);
  const macData = `${appId}|${normalizedAppTransId}|${key1}`;
  const mac = computeZaloPayHmac(macData, key1);

  const body = new URLSearchParams({
    app_id: appId,
    app_trans_id: normalizedAppTransId,
    mac,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZALOPAY_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.zaloPayQueryOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể truy vấn trạng thái ZaloPay (HTTP ${response.status}).`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Truy vấn trạng thái ZaloPay bị quá thời gian phản hồi.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function generateZaloPayAppTransId(bookingCode) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${yy}${mm}${dd}`;
  const bookingToken = normalizeText(bookingCode)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(-14);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `${datePrefix}_${bookingToken}${randomSuffix}`;
}

function generateMoMoOrderId(bookingCode) {
  const normalizedBookingCode = normalizeText(bookingCode).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 22) || 'BOOKING';
  return `SR_${normalizedBookingCode}_${Date.now()}`;
}

function extractBookingCodeFromMoMoOrderId(orderId = '') {
  const normalizedOrderId = normalizeText(orderId);
  const matched = /^SR_([a-zA-Z0-9_-]+)_\d+$/.exec(normalizedOrderId);

  if (!matched?.[1]) {
    return '';
  }

  return normalizeText(matched[1]);
}

async function createZaloPayOrder(booking) {
  if (!isZaloPayConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình ZaloPay (APP_ID/KEY1/KEY2).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để gọi cổng thanh toán ZaloPay.');
  }

  const appId = normalizeText(env.zaloPayAppId);
  const key1 = normalizeText(env.zaloPayKey1);
  const appUser = normalizeText(booking.customerAccountId || booking.customerPhone || 'guest');
  const amount = Number(booking.price ?? 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createValidationError('Số tiền thanh toán ZaloPay không hợp lệ.');
  }

  const appTransId = generateZaloPayAppTransId(booking.bookingCode);
  const appTime = Date.now();
  const embedData = JSON.stringify({
    bookingCode: booking.bookingCode,
    accountId: booking.customerAccountId,
    paymentProvider: 'zalopay',
    redirectUrl: normalizeText(env.zaloPayRedirectUrl) || '',
  });
  const items = JSON.stringify([]);
  const description = `Thanh toan chuyến ${booking.bookingCode} - SmartRide`;
  const callbackUrl = normalizeText(env.zaloPayCallbackUrl);
  const macData = `${appId}|${appTransId}|${appUser}|${amount}|${appTime}|${embedData}|${items}`;
  const mac = computeZaloPayHmac(macData, key1);

  const body = new URLSearchParams({
    app_id: appId,
    app_user: appUser,
    app_time: String(appTime),
    amount: String(amount),
    app_trans_id: appTransId,
    embed_data: embedData,
    item: items,
    description,
    bank_code: '',
    mac,
  });

  if (callbackUrl) {
    body.set('callback_url', callbackUrl);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZALOPAY_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.zaloPayCreateOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể tạo đơn ZaloPay (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    const returnCode = Number(payload?.return_code ?? payload?.returncode ?? 0);

    if (returnCode !== 1) {
      const errorMessage = normalizeText(payload?.return_message ?? payload?.returnmessage) || 'ZaloPay từ chối tạo đơn.';
      const subReturnCode = Number(payload?.sub_return_code ?? payload?.subreturncode ?? NaN);
      const subReturnMessage = normalizeText(payload?.sub_return_message ?? payload?.subreturnmessage);

      let detailedMessage = errorMessage;

      if (subReturnMessage) {
        detailedMessage = `${detailedMessage} - ${subReturnMessage}`;
      }

      if (Number.isFinite(subReturnCode)) {
        detailedMessage = `${detailedMessage} (sub_return_code: ${subReturnCode})`;
      }

      throw createValidationError(detailedMessage);
    }

    return {
      provider: 'zalopay',
      appTransId,
      amount,
      orderUrl: normalizeText(payload?.order_url ?? payload?.orderurl),
      deepLink: normalizeText(payload?.deeplink ?? payload?.deep_link ?? payload?.order_url ?? payload?.orderurl),
      qrCodeUrl: normalizeText(payload?.qr_code ?? payload?.qrCode),
      zpTransToken: normalizeText(payload?.zp_trans_token ?? payload?.zptranstoken),
      gatewayTransToken: normalizeText(payload?.zp_trans_token ?? payload?.zptranstoken),
      raw: payload,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Kết nối ZaloPay bị quá thời gian phản hồi. Vui lòng thử lại.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createMoMoOrder(booking) {
  if (isMoMoMockModeEnabled()) {
    const mockOrderId = generateMoMoOrderId(booking.bookingCode);
    const amount = Number(booking.price ?? 0);
    const redirectUrl = normalizeText(env.momoRedirectUrl) || 'http://localhost:5173/';
    const orderUrl = `${redirectUrl.replace(/\/$/, '')}/?payment_provider=momo&mock=1&orderId=${encodeURIComponent(mockOrderId)}`;

    momoMockPaidOrderIds.delete(mockOrderId);

    return {
      provider: 'momo',
      appTransId: mockOrderId,
      amount,
      orderUrl,
      payUrl: orderUrl,
      deepLink: orderUrl,
      qrCodeUrl: '',
      gatewayTransToken: `MOCK-${Date.now()}`,
      raw: {
        mock: true,
        resultCode: MOMO_SUCCESS_RESULT_CODE,
        message: 'MoMo mock mode create-order success',
      },
    };
  }

  if (!isMoMoConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình MoMo (PARTNER_CODE/ACCESS_KEY/SECRET_KEY).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để gọi cổng thanh toán MoMo.');
  }

  const partnerCode = normalizeText(env.momoPartnerCode);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const orderId = generateMoMoOrderId(booking.bookingCode);
  const requestId = `${orderId}_${Math.floor(100 + Math.random() * 900)}`;
  const amount = Number(booking.price ?? 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createValidationError('Số tiền thanh toán MoMo không hợp lệ.');
  }

  const redirectUrl = normalizeText(env.momoRedirectUrl) || 'http://localhost:5173/';
  const ipnUrl = normalizeText(env.momoCallbackUrl);

  if (!ipnUrl) {
    throw createValidationError('Thiếu MOMO_CALLBACK_URL để nhận xác nhận thanh toán MoMo.');
  }

  const orderInfo = `Thanh toan chuyen ${booking.bookingCode} - SmartRide`;
  const requestType = normalizeText(env.momoRequestType) || 'captureWallet';
  const extraData = encodeMoMoExtraData({
    bookingCode: booking.bookingCode,
    accountId: booking.customerAccountId,
    paymentProvider: 'momo',
    redirectUrl,
  });
  const rawSignature = [
    `accessKey=${accessKey}`,
    `amount=${Math.round(amount)}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=${requestType}`,
  ].join('&');
  const signature = computeMoMoHmac(rawSignature, secretKey);

  const body = {
    partnerCode,
    partnerName: 'SmartRide',
    storeId: 'SmartRide',
    requestId,
    amount: String(Math.round(amount)),
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    lang: 'vi',
    requestType,
    autoCapture: true,
    extraData,
    signature,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOMO_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.momoCreateOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể tạo đơn MoMo (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    const resultCode = Number(payload?.resultCode ?? payload?.result_code ?? NaN);

    if (!Number.isFinite(resultCode) || resultCode !== MOMO_SUCCESS_RESULT_CODE) {
      const errorMessage = normalizeText(payload?.message ?? payload?.localMessage) || 'MoMo từ chối tạo đơn.';
      throw createValidationError(`${errorMessage} (resultCode: ${Number.isFinite(resultCode) ? resultCode : 'unknown'})`);
    }

    return {
      provider: 'momo',
      appTransId: orderId,
      amount,
      orderUrl: normalizeText(payload?.payUrl),
      payUrl: normalizeText(payload?.payUrl),
      deepLink: normalizeText(payload?.deeplink ?? payload?.deeplinkMiniApp),
      qrCodeUrl: normalizeText(payload?.qrCodeUrl),
      gatewayTransToken: normalizeText(payload?.transId),
      raw: payload,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Kết nối MoMo bị quá thời gian phản hồi. Vui lòng thử lại.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function queryMoMoOrderStatus(orderId) {
  const normalizedOrderId = normalizeText(orderId);

  if (!normalizedOrderId) {
    throw createValidationError('Thiếu orderId để truy vấn trạng thái MoMo.');
  }

  if (isMoMoMockModeEnabled()) {
    const isPaid = momoMockPaidOrderIds.has(normalizedOrderId);

    return {
      resultCode: isPaid ? MOMO_SUCCESS_RESULT_CODE : 1001,
      message: isPaid ? 'MoMo mock mode payment success' : 'MoMo mock mode pending callback',
      orderId: normalizedOrderId,
      transId: isPaid ? `MOCK-${Date.now()}` : '',
    };
  }

  if (!isMoMoConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình MoMo (PARTNER_CODE/ACCESS_KEY/SECRET_KEY).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để truy vấn MoMo.');
  }

  const partnerCode = normalizeText(env.momoPartnerCode);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const requestId = `${normalizedOrderId}_${Date.now()}`;
  const rawSignature = [
    `accessKey=${accessKey}`,
    `orderId=${normalizedOrderId}`,
    `partnerCode=${partnerCode}`,
    `requestId=${requestId}`,
  ].join('&');
  const signature = computeMoMoHmac(rawSignature, secretKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOMO_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.momoQueryOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        partnerCode,
        requestId,
        orderId: normalizedOrderId,
        lang: 'vi',
        signature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể truy vấn trạng thái MoMo (HTTP ${response.status}).`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Truy vấn trạng thái MoMo bị quá thời gian phản hồi.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
    paymentMethod: booking.paymentMethod,
    paymentMethodLabel: booking.paymentMethodLabel,
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
      ?? currentRow?.dispatchedDriverSystemAccountId
      ?? resolvedBooking?.driverAccountId
      ?? resolvedBooking?.dispatchedDriverSystemAccountId
      ?? currentRow?.MaTKTaiXeDuocMoi
      ?? currentRow?.MaTX,
  );
  const driverDisplayName = normalizeText(
    currentRow?.driverName ?? resolvedBooking?.driverDisplayName ?? resolvedBooking?.driverName,
  );
  const driverPhone = normalizeText(currentRow?.driverPhone ?? resolvedBooking?.driverPhone);
  const driverIdentifier = normalizeText(
    currentRow?.driverEmail
      ?? currentRow?.driverUsername
      ?? resolvedBooking?.driverIdentifier,
  );
  const driverStatus = normalizeText(currentRow?.driverStatus ?? resolvedBooking?.driverStatus);
  const driverVehicleLicensePlate = normalizeText(
    currentRow?.driverVehicleLicensePlate ?? resolvedBooking?.driverVehicleLicensePlate ?? resolvedBooking?.driverLicensePlate,
  );
  const driverVehicleName = normalizeText(currentRow?.driverVehicleName ?? resolvedBooking?.driverVehicleName);

  if (driverDisplayName) {
    resolvedBooking.driverDisplayName = driverDisplayName;
    resolvedBooking.driverName = driverDisplayName;
  }

  if (driverPhone) {
    resolvedBooking.driverPhone = driverPhone;
  }

  if (driverIdentifier) {
    resolvedBooking.driverIdentifier = driverIdentifier;
  }

  if (driverStatus) {
    resolvedBooking.driverStatus = driverStatus;
  }

  if (driverVehicleLicensePlate) {
    resolvedBooking.driverVehicleLicensePlate = driverVehicleLicensePlate;
    resolvedBooking.driverLicensePlate = driverVehicleLicensePlate;
  }

  if (driverVehicleName) {
    resolvedBooking.driverVehicleName = driverVehicleName;
  }

  if (driverAccountId) {
    resolvedBooking.driverAccountId = driverAccountId;
    resolvedBooking.dispatchedDriverSystemAccountId = driverAccountId;
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

function buildRidePaymentUpdatedEvent(bookingCode, paymentResult = {}, currentRow = null, bookingSnapshot = null) {
  const resolvedBooking = cloneRideBookingSnapshot(bookingSnapshot ?? findRecentBookingByCode(bookingCode)) ?? {};
  const customerAccountId = normalizeText(currentRow?.MaTK ?? currentRow?.customerAccountId ?? resolvedBooking?.customerAccountId);
  const driverAccountId = normalizeText(
    currentRow?.driverAccountId
      ?? resolvedBooking?.driverAccountId
      ?? currentRow?.MaTX,
  );
  const paymentStatus = normalizeText(paymentResult?.paymentStatus ?? currentRow?.paymentStatus ?? currentRow?.bookingPaymentStatus);
  const paymentMethod = normalizeText(paymentResult?.paymentMethod ?? currentRow?.paymentMethod ?? resolvedBooking?.paymentMethod).toLowerCase();
  const paymentProvider = normalizeText(paymentResult?.paymentProvider ?? currentRow?.paymentProvider ?? resolvedBooking?.paymentProvider).toLowerCase();
  const paymentCode = normalizeText(paymentResult?.paymentCode ?? currentRow?.paymentCode ?? resolvedBooking?.paymentCode);

  if (paymentStatus) {
    resolvedBooking.paymentStatus = paymentStatus;
    resolvedBooking.paymentStatusLabel = getPaymentStatusLabel(paymentStatus);
  }

  if (paymentMethod) {
    resolvedBooking.paymentMethod = paymentMethod;
    resolvedBooking.paymentMethodLabel = getPaymentMethodLabel(paymentMethod);
  }

  if (paymentProvider) {
    resolvedBooking.paymentProvider = paymentProvider;
    resolvedBooking.paymentProviderLabel = getPaymentProviderLabel(paymentProvider);
  }

  if (paymentCode) {
    resolvedBooking.paymentCode = paymentCode;
  }

  if (resolvedBooking.paymentMethodLabel) {
    resolvedBooking.paymentSummary = resolvedBooking.paymentProviderLabel
      ? `${resolvedBooking.paymentMethodLabel} - ${resolvedBooking.paymentProviderLabel}`
      : resolvedBooking.paymentMethodLabel;
  }

  if (paymentResult?.paidAt) {
    resolvedBooking.paidAt = paymentResult.paidAt;
  }

  return {
    type: 'ride.payment.updated',
    routingKey: 'ride.payment.updated',
    bookingCode: normalizeText(bookingCode),
    customerAccountId,
    driverAccountId,
    paymentCode,
    paymentMethod,
    paymentProvider,
    paymentStatus,
    paymentStatusLabel: getPaymentStatusLabel(paymentStatus),
    paidAt: normalizeText(paymentResult?.paidAt ?? currentRow?.paymentPaidAt ?? resolvedBooking?.paidAt),
    audience: ['customer', ...(driverAccountId ? ['driver'] : []), 'admin'],
    booking: resolvedBooking,
    source: normalizeText(paymentResult?.source) || 'payment-update',
    createdAt: new Date().toISOString(),
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

  if (normalizedTripStatus === 'HoanThanh' && normalizeText(booking.paymentMethod).toLowerCase() === 'cash') {
    booking.paymentStatus = 'DaThanhToan';
    booking.paymentStatusLabel = getPaymentStatusLabel('DaThanhToan');
  }

  if (normalizedTripStatus === 'DaHuy') {
    const normalizedCancellationMeta = normalizeCancellationMeta(cancelMeta);

    booking.cancelledByAccountId = normalizedCancellationMeta.cancelledByAccountId;
    booking.cancelledByRoleCode = normalizedCancellationMeta.cancelledByRoleCode;
    booking.cancelReason = normalizedCancellationMeta.cancelReason;
    booking.paymentStatus = 'ThatBai';
    booking.paymentStatusLabel = getPaymentStatusLabel('ThatBai');
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
        dx.LoaiXe AS vehicle,
        dx.DiemDon AS pickupLabel,
        dx.MaTKTaiXeDuocMoi AS dispatchedDriverSystemAccountId,
        dx.LanDieuPhoiHienTai AS dispatchAttemptOrder,
        dx.MaTBThongBaoTaiXe AS driverRequestNotificationId,
        dx.LyDoHuy AS cancelReasonRaw,
        dx.PhuongThucThanhToan AS paymentMethod,
        dx.NhaCungCapThanhToan AS paymentProvider,
        dx.TrangThaiThanhToan AS bookingPaymentStatus,
        dx.TrangThaiChuyen,
        dx.NgayCapNhat,
        tt.MaTT AS paymentCode,
        tt.SoTien AS paymentAmount,
        tt.PhanTramPhiNenTang AS paymentPlatformFeePercent,
        tt.TienPhiNenTang AS paymentPlatformFeeAmount,
        tt.TienTaiXeNhan AS paymentDriverNetIncome,
        tt.TrangThaiThanhToan AS paymentStatus,
        tt.ThoiDiemThanhToan AS paymentPaidAt,
        tx.MaTK AS driverAccountId,
        tx.CCCD AS driverCccd,
        driverTk.Ten AS driverName,
        driverTk.SDT AS driverPhone,
        driverTk.Email AS driverEmail,
        driverTk.TaiKhoan AS driverUsername,
        tx.TrangThai AS driverStatus,
        JSON_VALUE(tx.ThongTinXe, '$.licensePlate') AS driverVehicleLicensePlate,
        JSON_VALUE(tx.ThongTinXe, '$.name') AS driverVehicleName
      FROM DatXe dx WITH (UPDLOCK, ROWLOCK)
      LEFT JOIN ThanhToan tt
        ON tt.MaChuyen = dx.MaChuyen
      LEFT JOIN TaiXe tx
        ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
      LEFT JOIN TaiKhoan driverTk
        ON driverTk.MaTK = tx.MaTK
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

async function dispatchBookingToNextDriver(transaction, booking, excludedDriverSystemAccountIds = []) {
  const bookingCode = normalizeText(booking?.bookingCode);

  if (!bookingCode) {
    return null;
  }

  const attemptedDriversResult = await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT dp.MaTKTaiXe AS driverSystemAccountId
      FROM dbo.DatXeDieuPhoi dp
      WHERE dp.MaChuyen = @bookingCode;
    `);

  const attemptedDriverIds = new Set(
    (attemptedDriversResult.recordset ?? [])
      .map((row) => normalizeText(row.driverSystemAccountId).toLowerCase())
      .filter(Boolean),
  );

  for (const excludedDriverId of excludedDriverSystemAccountIds) {
    const normalizedDriverId = normalizeText(excludedDriverId).toLowerCase();

    if (normalizedDriverId) {
      attemptedDriverIds.add(normalizedDriverId);
    }
  }

  const candidates = await resolveDriverDispatchCandidates(
    transaction,
    booking?.pickup ?? {},
    Array.from(attemptedDriverIds),
    booking?.vehicle,
  );

  const nextCandidate = candidates[0] ?? null;

  if (!nextCandidate) {
    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .query(`
        UPDATE dbo.DatXe
        SET
          MaTKTaiXeDuocMoi = NULL,
          MaTBThongBaoTaiXe = NULL
        WHERE MaChuyen = @bookingCode;
      `);

    return null;
  }

  const dispatchOrder = Number((booking?.dispatchAttemptOrder ?? 0)) + 1;
  const rideRequestBooking = {
    ...booking,
    driverAccountId: nextCandidate.driverSystemAccountId,
    driverDistanceKm: nextCandidate.distanceKm,
  };
  const driverNotificationTitle = `${DRIVER_RIDE_REQUEST_NOTIFICATION_TITLE} ${bookingCode}`;
  const driverNotificationContent = buildDriverRideRequestNotificationContent(rideRequestBooking);
  const driverNotificationResult = await new sql.Request(transaction)
    .input('title', sql.NVarChar(200), driverNotificationTitle)
    .input('content', sql.NVarChar(sql.MAX), driverNotificationContent)
    .input('accountId', sql.VarChar(20), nextCandidate.driverSystemAccountId)
    .input('recipient', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_RECIPIENT)
    .input('status', sql.VarChar(20), DRIVER_RIDE_REQUEST_NOTIFICATION_STATUS)
    .input('sendAt', sql.DateTime2(0), new Date())
    .input('createdAt', sql.DateTime2(0), new Date())
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
      );
    `);

  const driverNotificationId = Number(driverNotificationResult.recordset?.[0]?.MaTB ?? 0) || null;

  await insertDriverDispatchAttempt(transaction, {
    bookingCode,
    driverSystemAccountId: nextCandidate.driverSystemAccountId,
    driverAccountId: nextCandidate.driverAccountId,
    dispatchOrder,
    status: DRIVER_DISPATCH_ATTEMPT_STATUS.pending,
    distanceKm: nextCandidate.distanceKm,
    dispatchPayload: JSON.stringify({
      source: 'dispatch',
      distanceKm: nextCandidate.distanceKm,
      driverAddress: nextCandidate.driverAddress,
    }),
  });

  await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .input('driverSystemAccountId', sql.VarChar(20), nextCandidate.driverSystemAccountId)
    .input('dispatchOrder', sql.Int, dispatchOrder)
    .input('notificationId', sql.Int, driverNotificationId)
    .query(`
      UPDATE dbo.DatXe
      SET
        MaTKTaiXeDuocMoi = @driverSystemAccountId,
        LanDieuPhoiHienTai = @dispatchOrder,
        MaTBThongBaoTaiXe = @notificationId
      WHERE MaChuyen = @bookingCode;
    `);

  return {
    ...nextCandidate,
    dispatchOrder,
    notificationId: driverNotificationId,
  };
}

async function createDispatchFailureNotification(transaction, payload = {}) {
  const customerAccountId = normalizeText(payload.customerAccountId);

  if (!customerAccountId) {
    return null;
  }

  const bookingCode = normalizeText(payload.bookingCode);
  const notificationTitle = bookingCode
    ? `Không tìm thấy tài xế cho chuyến ${bookingCode}`
    : 'Không tìm thấy tài xế phù hợp';
  const notificationContent = payload.message || DRIVER_DISPATCH_FAILURE_REASON;
  const now = new Date();

  const notificationResult = await new sql.Request(transaction)
    .input('accountId', sql.VarChar(20), customerAccountId)
    .input('title', sql.NVarChar(200), notificationTitle)
    .input('content', sql.NVarChar(sql.MAX), notificationContent)
    .input('recipient', sql.VarChar(20), 'customer')
    .input('status', sql.VarChar(20), 'sent')
    .input('sendAt', sql.DateTime2(0), now)
    .input('createdAt', sql.DateTime2(0), now)
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
      );
    `);

  return Number(notificationResult.recordset?.[0]?.MaTB ?? 0) || null;
}

async function markBookingDispatchFailed(transaction, payload = {}) {
  const bookingCode = normalizeText(payload.bookingCode);
  const customerAccountId = normalizeText(payload.customerAccountId);
  const failureReason = normalizeText(payload.failureReason || DRIVER_DISPATCH_FAILURE_REASON);

  if (!bookingCode) {
    return null;
  }

  const cancelMeta = {
    cancelledByRoleCode: 'q1',
    cancelledByAccountId: 'system',
    cancelReason: failureReason,
  };

  await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .input('tripStatus', sql.NVarChar(20), 'DaHuy')
    .input('cancelReasonPayload', sql.NVarChar(500), serializeCancellationMeta(cancelMeta))
    .query(`
      UPDATE dbo.DatXe
      SET
        TrangThaiChuyen = @tripStatus,
        TrangThaiThanhToan = N'ThatBai',
        MaTKTaiXeDuocMoi = NULL,
        MaTBThongBaoTaiXe = NULL,
        LyDoHuy = @cancelReasonPayload,
        NgayCapNhat = SYSDATETIME()
      WHERE MaChuyen = @bookingCode;

      UPDATE dbo.ThanhToan
      SET
        TrangThaiThanhToan = N'ThatBai',
        GatewayLastReturnCode = COALESCE(GatewayLastReturnCode, -1)
      WHERE MaChuyen = @bookingCode
        AND TrangThaiThanhToan <> N'ThatBai';
    `);

  const notificationId = await createDispatchFailureNotification(transaction, {
    bookingCode,
    customerAccountId,
    message: failureReason,
  });

  return {
    cancelMeta,
    notificationId,
  };
}

async function updateTripStatusInDatabase(bookingCode, tripStatus, driverAccountId = '', cancelMeta = {}) {
  await ensureRideSchema();
  await ensureDriverSchema();

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
    const resolvedDriverDispatchState = normalizedDriverAccountId
      ? await resolveDriverDispatchState(transaction, normalizedDriverAccountId)
      : { driverStatus: '', temporaryLockUntil: null, temporaryLockReason: '', vehicleCategory: '' };
    const resolvedDriverStatus = resolvedDriverDispatchState.driverStatus;
    const resolvedDriverVehicleCategory = resolvedDriverDispatchState.vehicleCategory;
    const driverTripId = resolvedDriverCccd || normalizedDriverAccountId;
    const dispatchedDriverSystemAccountId = normalizeText(currentRow.dispatchedDriverSystemAccountId);
    const requestedVehicleCategory = normalizeVehicleCategory(currentRow.vehicle);

    if (!normalizedTripStatus) {
      throw createValidationError('Trang thai chuyen khong hop le.');
    }

    if (normalizedTripStatus === 'DaHuy' && ['DaDon', 'DangThucHien'].includes(currentTripStatus)) {
      const cancellationMeta = normalizeCancellationMeta(cancelMeta);
      const cancelledByRoleCode = String(cancellationMeta?.cancelledByRoleCode ?? '').trim().toLowerCase();

      if (cancelledByRoleCode !== 'q1') {
        throw createValidationError('Không thể hủy chuyến sau khi khách đã được đón.');
      }
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

    if (
      normalizedTripStatus === 'DaNhanChuyen'
      && dispatchedDriverSystemAccountId
      && normalizedDriverAccountId
      && dispatchedDriverSystemAccountId.toLowerCase() !== normalizedDriverAccountId.toLowerCase()
    ) {
      throw createValidationError('Chuyến này đang được gửi cho tài xế khác.');
    }

    if (normalizedTripStatus === 'DaNhanChuyen' && requestedVehicleCategory) {
      if (!resolvedDriverVehicleCategory) {
        throw createValidationError('Không xác định được loại xe của tài xế. Vui lòng cập nhật hồ sơ xe trước khi nhận chuyến.');
      }

      if (resolvedDriverVehicleCategory !== requestedVehicleCategory) {
        throw createValidationError('Loại xe của tài xế không phù hợp với cuốc xe này.');
      }
    }

    if (normalizedTripStatus === 'DaNhanChuyen' && !isDriverReadyStatus(resolvedDriverStatus)) {
      const normalizedResolvedDriverStatus = normalizeStatusToken(resolvedDriverStatus);

      if (normalizedResolvedDriverStatus === 'khoa' || normalizedResolvedDriverStatus === 'choduyet') {
        throw createValidationError('Tài khoản tài xế chưa ở trạng thái hoạt động.');
      }

      const activeTripCount = await countDriverActiveTrips(transaction, resolvedDriverCccd, bookingCode);

      if (activeTripCount > 0) {
        throw createValidationError('Tài xế đang có cuốc khác chưa hoàn tất.');
      }

      await new sql.Request(transaction)
        .input('driverSystemAccountId', sql.VarChar(20), normalizedDriverAccountId)
        .query(`
          UPDATE dbo.TaiXe
          SET
            TrangThai = N'HoatDong',
            NgayCapNhat = SYSDATETIME()
          WHERE MaTK = @driverSystemAccountId
            AND LOWER(ISNULL(TrangThai, '')) NOT IN (N'khoa', N'choduyet');
        `);
    }

    if (
      normalizedTripStatus === 'DaNhanChuyen'
      && resolvedDriverDispatchState.temporaryLockUntil
      && resolvedDriverDispatchState.temporaryLockUntil.getTime() > Date.now()
    ) {
      const lockUntilLabel = resolvedDriverDispatchState.temporaryLockUntil.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      throw createValidationError(
        `${resolvedDriverDispatchState.temporaryLockReason || 'Tài xế đang bị tạm khóa nhận chuyến'} đến ${lockUntilLabel}.`,
      );
    }

    if (currentDriverCccd && driverTripId && currentDriverCccd.toLowerCase() !== driverTripId.toLowerCase()) {
      throw createValidationError('Đã có tài xế khác nhận đơn');
    }

    const beforePaymentStatus = normalizeText(currentRow.paymentStatus || currentRow.bookingPaymentStatus);

    await buildTripStatusSqlRequest(transaction, bookingCode, normalizedTripStatus, driverTripId || null, cancelMeta)
      .query(`
        UPDATE DatXe
        SET
          TrangThaiChuyen = @tripStatus,
          TrangThaiThanhToan = CASE
            WHEN @tripStatus = N'HoanThanh' AND PhuongThucThanhToan = 'cash' THEN N'DaThanhToan'
            WHEN @tripStatus = N'DaHuy' THEN N'ThatBai'
            ELSE TrangThaiThanhToan
          END,
          MaTX = CASE
            WHEN @tripStatus = N'DaNhanChuyen' THEN COALESCE(MaTX, @driverAccountId)
            ELSE MaTX
          END,
          MaTKTaiXeDuocMoi = CASE
            WHEN @tripStatus IN (N'DaNhanChuyen', N'DaHuy') THEN NULL
            ELSE MaTKTaiXeDuocMoi
          END,
          LyDoHuy = CASE
            WHEN @tripStatus = N'DaHuy' THEN NULLIF(@cancelReasonPayload, '')
            ELSE LyDoHuy
          END
        WHERE MaChuyen = @bookingCode;

        IF @tripStatus = N'HoanThanh'
          UPDATE ThanhToan
          SET TrangThaiThanhToan = N'DaThanhToan'
          WHERE MaChuyen = @bookingCode
            AND PhuongThucThanhToan = 'cash'
            AND TrangThaiThanhToan = N'ChoThuTien';

        IF @tripStatus = N'DaHuy'
          UPDATE ThanhToan
          SET
            TrangThaiThanhToan = N'ThatBai',
            GatewayLastReturnCode = COALESCE(GatewayLastReturnCode, -1)
          WHERE MaChuyen = @bookingCode
            AND TrangThaiThanhToan <> N'ThatBai';
      `);

      if (normalizedTripStatus === 'DaNhanChuyen' && normalizedDriverAccountId) {
        await new sql.Request(transaction)
          .input('bookingCode', sql.VarChar(30), bookingCode)
          .input('driverSystemAccountId', sql.VarChar(20), normalizedDriverAccountId)
          .query(`
            UPDATE dbo.DatXeDieuPhoi
            SET
              TrangThai = 'accepted',
              NgayPhanHoi = SYSDATETIME(),
              NgayCapNhat = SYSDATETIME()
            WHERE MaChuyen = @bookingCode
              AND MaTKTaiXe = @driverSystemAccountId
              AND TrangThai = 'pending';
          `);
      }

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

    if (normalizedTripStatus === 'DaHuy' || normalizedTripStatus === 'HoanThanh') {
      const driverSystemAccountIdForAvailabilityReset = normalizeText(
        updatedRow?.driverAccountId
          ?? currentRow?.driverAccountId
          ?? normalizedDriverAccountId,
      );

      if (driverSystemAccountIdForAvailabilityReset) {
        await new sql.Request(transaction)
          .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountIdForAvailabilityReset)
          .query(`
            UPDATE dbo.TaiXe
            SET
              TrangThai = N'HoatDong',
              NgayCapNhat = SYSDATETIME()
            WHERE MaTK = @driverSystemAccountId
              AND LOWER(ISNULL(TrangThai, '')) NOT IN (N'khoa', N'choduyet');
          `);
      }
    }

    if (normalizedTripStatus === 'HoanThanh') {
      await applyDriverWalletSettlement(transaction, {
        bookingCode,
        currentRow,
        updatedRow,
      });
    }

    if (normalizedTripStatus === 'DaHuy') {
      const refundPaymentMethod = normalizePaymentMethod(currentRow.paymentMethod);
      const refundPaymentProvider = normalizePaymentProvider(currentRow.paymentProvider);
      const normalizedBeforePaymentStatus = normalizePaymentStatusValue(beforePaymentStatus);
      const isWalletProviderRefund = refundPaymentProvider === 'app_wallet'
        || refundPaymentProvider === 'zalopay'
        || refundPaymentProvider === 'momo';

      if (refundPaymentMethod === 'wallet' && isWalletProviderRefund && normalizedBeforePaymentStatus === 'DaThanhToan') {
        const refundCustomerMaTK = normalizeText(currentRow.MaTK);
        const refundAmount = Number(currentRow.paymentAmount ?? 0);
        if (refundCustomerMaTK && refundAmount > 0) {
          await refundCustomerWalletForRide(refundCustomerMaTK, refundAmount, bookingCode, transaction);
        }
      }
    }

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

    const afterPaymentStatus = normalizeText(updatedRow?.paymentStatus || updatedRow?.bookingPaymentStatus);

    if (
      afterPaymentStatus
      && (!beforePaymentStatus || beforePaymentStatus.toLowerCase() !== afterPaymentStatus.toLowerCase())
    ) {
      publishRideEventSafely(
        buildRidePaymentUpdatedEvent(
          bookingCode,
          {
            paymentCode: normalizeText(updatedRow?.paymentCode),
            paymentMethod: normalizeText(updatedRow?.paymentMethod),
            paymentProvider: normalizeText(updatedRow?.paymentProvider),
            paymentStatus: afterPaymentStatus,
            paidAt: updatedRow?.paymentPaidAt ? new Date(updatedRow.paymentPaidAt).toISOString() : '',
            source: 'trip-status-update',
          },
          {
            ...currentRow,
            ...updatedRow,
          },
          updatedBooking,
        ),
      );
    }

    if (normalizedTripStatus === 'DaHuy') {
      const canceledByRoleCode = normalizeText(normalizedCancellationMeta.cancelledByRoleCode).toLowerCase();

      if (canceledByRoleCode === 'q3' || canceledByRoleCode === 'driver') {
        try {
          await enforceDriverAutoLockForContinuousCancellation({
            bookingCode: normalizeText(updatedRow?.MaChuyen ?? bookingCode),
            driverAccountId: normalizeText(updatedRow?.MaTX ?? currentRow?.MaTX ?? ''),
            driverSystemAccountId: normalizeText(updatedRow?.driverAccountId ?? currentRow?.driverAccountId ?? ''),
          });
        } catch {
          // Do not block trip status update if policy side-effects fail.
        }
      }
    }

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

async function rejectTripDispatchInDatabase(payload = {}) {
  await ensureRideSchema();

  const bookingCode = normalizeText(payload.bookingCode);
  const driverSystemAccountId = normalizeText(payload.driverAccountId ?? payload.driverId);
  const rejectReason = normalizeText(
    payload.reasonText
      ?? payload.reasonLabel
      ?? payload.cancelReason
      ?? payload.note
      ?? '',
  );

  if (!bookingCode) {
    throw createValidationError('Vui lòng cung cấp mã chuyến để từ chối cuốc.');
  }

  if (!driverSystemAccountId) {
    throw createValidationError('Vui lòng cung cấp tài khoản tài xế.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const currentRow = await readTripStatusRow(transaction, bookingCode);

    if (!currentRow) {
      throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
    }

    const currentTripStatus = normalizeTripStatus(currentRow.TrangThaiChuyen);
    const currentDispatchedDriverSystemAccountId = normalizeText(currentRow.dispatchedDriverSystemAccountId);

    if (currentTripStatus !== 'ChoTaiXe') {
      throw createValidationError('Chuyến không còn ở trạng thái chờ nhận nên không thể từ chối cuốc.');
    }

    if (!currentDispatchedDriverSystemAccountId) {
      throw createValidationError('Hiện chưa có tài xế đang được mời nhận cuốc.');
    }

    if (currentDispatchedDriverSystemAccountId.toLowerCase() !== driverSystemAccountId.toLowerCase()) {
      throw createValidationError('Bạn không phải tài xế đang được mời nhận cuốc này.');
    }

    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
      .input('rejectReason', sql.NVarChar(500), rejectReason || null)
      .query(`
        UPDATE dbo.DatXeDieuPhoi
        SET
          TrangThai = 'rejected',
          LyDoTuChoi = NULLIF(@rejectReason, ''),
          NgayPhanHoi = SYSDATETIME(),
          NgayCapNhat = SYSDATETIME()
        WHERE MaChuyen = @bookingCode
          AND MaTKTaiXe = @driverSystemAccountId
          AND TrangThai = 'pending';
      `);

    const currentNotificationId = Number(currentRow?.driverRequestNotificationId ?? 0);

    if (currentNotificationId > 0) {
      await new sql.Request(transaction)
        .input('notificationId', sql.Int, currentNotificationId)
        .query(`
          DELETE FROM dbo.ThongBao
          WHERE MaTB = @notificationId;
        `);
    }

    const policyResult = await enforceDriverDispatchRejectPolicy(transaction, {
      driverSystemAccountId,
      bookingCode,
    });

    const recentBooking = findRecentBookingByCode(bookingCode);

    const nextDispatch = await dispatchBookingToNextDriver(
      transaction,
      {
        ...(recentBooking ?? {}),
        bookingCode,
        customerAccountId: normalizeText(currentRow?.MaTK ?? recentBooking?.customerAccountId),
        pickup: recentBooking?.pickup ?? {
          label: normalizeText(currentRow?.pickupLabel),
          position: null,
        },
        dispatchAttemptOrder: Number(currentRow?.dispatchAttemptOrder ?? 0),
      },
      [driverSystemAccountId],
    );

    let failureMeta = null;

    if (!nextDispatch) {
      failureMeta = await markBookingDispatchFailed(transaction, {
        bookingCode,
        customerAccountId: normalizeText(currentRow?.MaTK ?? recentBooking?.customerAccountId),
        failureReason: DRIVER_DISPATCH_FAILURE_REASON,
      });
    }

    await transaction.commit();

    if (nextDispatch) {
      if (recentBooking) {
        recentBooking.driverAccountId = normalizeText(nextDispatch.driverSystemAccountId);
        recentBooking.driverRequestNotificationId = Number(nextDispatch.notificationId ?? 0) || null;
      }

      publishRideEventSafely(buildRideBookingCreatedEvent({
        ...(recentBooking ?? { bookingCode }),
        bookingCode,
        driverAccountId: normalizeText(nextDispatch.driverSystemAccountId),
        driverRequestNotificationId: Number(nextDispatch.notificationId ?? 0) || null,
      }));
    } else {
      const updatedBooking = updateRecentBookingTripStatus(
        bookingCode,
        'DaHuy',
        '',
        failureMeta?.cancelMeta,
      );

      publishRideEventSafely(
        buildRideTripStatusUpdatedEvent(
          bookingCode,
          buildTripStatusResult(
            bookingCode,
            'DaHuy',
            new Date(),
            '',
            failureMeta?.cancelMeta,
          ),
          {
            ...currentRow,
            TrangThaiChuyen: 'DaHuy',
            cancelReasonRaw: serializeCancellationMeta(failureMeta?.cancelMeta),
          },
          updatedBooking,
        ),
      );
    }

    return {
      success: true,
      bookingCode,
      message: nextDispatch
        ? 'Đã từ chối cuốc và chuyển cho tài xế kế tiếp.'
        : 'Đã từ chối cuốc. Hiện chưa còn tài xế phù hợp để chuyển tiếp.',
      dispatchedToNextDriver: Boolean(nextDispatch),
      nextDriverAccountId: normalizeText(nextDispatch?.driverSystemAccountId),
      rejectionPolicy: policyResult,
    };
  } catch (error) {
    await transaction.rollback().catch(() => {});
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
  const paymentStatus = getPaymentStatus(booking.paymentMethod, booking.paymentProvider);
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
      .input('platformFeePercent', sql.Decimal(5, 2), Number(booking.platformFeePercent ?? 0) || 0)
      .input('platformFeeAmount', sql.Int, booking.platformFeeAmount ?? 0)
      .input('driverNetIncome', sql.Int, booking.driverNetIncome ?? booking.price ?? 0)
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
          PhanTramPhiNenTang,
          TienPhiNenTang,
          TienTaiXeNhan,
          MaUuDai,
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
          @platformFeePercent,
          @platformFeeAmount,
          @driverNetIncome,
          @promotionCode,
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
      .input('platformFeePercent', sql.Decimal(5, 2), Number(booking.platformFeePercent ?? 0) || 0)
      .input('platformFeeAmount', sql.Int, booking.platformFeeAmount ?? 0)
      .input('driverNetIncome', sql.Int, booking.driverNetIncome ?? booking.price ?? 0)
      .input('promotionCode', sql.VarChar(40), booking.promotionCode || null)
      .input('promotionTitle', sql.NVarChar(120), booking.promotionTitle || null)
      .input('note', sql.NVarChar(255), booking.promotionSummary || null)
      .input('paymentMethod', sql.VarChar(20), booking.paymentMethod)
      .input('paymentProvider', sql.VarChar(20), booking.paymentProvider || null)
      .input('gatewayAppTransId', sql.VarChar(80), normalizeText(booking?.paymentGateway?.appTransId) || null)
      .input(
        'gatewayTransToken',
        sql.VarChar(120),
        normalizeText(booking?.paymentGateway?.gatewayTransToken ?? booking?.paymentGateway?.zpTransToken) || null,
      )
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
          PhanTramPhiNenTang,
          TienPhiNenTang,
          TienTaiXeNhan,
          MaUuDai,
          PhuongThucThanhToan,
          NhaCungCapThanhToan,
          GatewayAppTransId,
          GatewayTransToken,
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
          @platformFeePercent,
          @platformFeeAmount,
          @driverNetIncome,
          @promotionCode,
          @paymentMethod,
          @paymentProvider,
          @gatewayAppTransId,
          @gatewayTransToken,
          @paymentStatus,
          NULL,
          @note,
          @createdAt,
          @createdAt
        )
      `);

    const shouldDispatchImmediately = normalizeText(booking?.paymentMethod).toLowerCase() === 'cash'
      || normalizePaymentStatusValue(paymentStatus) === 'DaThanhToan';

    let dispatchResult = null;

    if (shouldDispatchImmediately) {
      dispatchResult = await dispatchBookingToNextDriver(transaction, {
        ...booking,
        dispatchAttemptOrder: 0,
      });

      booking.driverAccountId = normalizeText(dispatchResult?.driverSystemAccountId) || '';
      booking.driverRequestNotificationId = Number(dispatchResult?.notificationId ?? 0) || null;
    } else {
      booking.driverAccountId = '';
      booking.driverRequestNotificationId = null;
    }

    await transaction.commit();

    return {
      paymentCode,
      paymentStatus,
      paymentStatusLabel: getPaymentStatusLabel(paymentStatus),
      dispatchedDriverAccountId: booking.driverAccountId,
      driverRequestNotificationId: booking.driverRequestNotificationId,
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
    bookingServiceFee: BOOKING_SERVICE_FEE[vehicle] ?? 5000,
    bookingServiceFeeFormatted: formatCurrency(BOOKING_SERVICE_FEE[vehicle] ?? 5000),
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

  if (appliedPromotion && !promotionPricing.isEligible) {
    throw createValidationError(buildPromotionIneligibleMessage(appliedPromotion, promotionPricing.minOrderAmount));
  }

  const promotionSummary = buildPromotionSummaryText(appliedPromotion, promotionPricing.discountAmount);
  const bookingPrice = Number(promotionPricing.finalPrice ?? 0);
  const normalizedBookingPrice = Number.isFinite(bookingPrice) ? Math.max(0, Math.round(bookingPrice)) : 0;
  const serviceFeeAmount = Math.max(0, Math.round(selectedRide.serviceFee ?? BOOKING_SERVICE_FEE[quoteResult.vehicle] ?? BOOKING_SERVICE_FEE.motorbike ?? 5000));
  const totalBookingPrice = Math.max(0, normalizedBookingPrice + serviceFeeAmount);
  const platformFeePercent = normalizeFeePercent(env.driverPlatformFeePercent);
  const platformFeeAmount = Math.round(totalBookingPrice * platformFeePercent / 100);
  const driverNetIncome = Math.max(0, Math.round(totalBookingPrice * ((100 - platformFeePercent) / 100)) - serviceFeeAmount);

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
    price: totalBookingPrice,
    priceFormatted: formatCurrency(totalBookingPrice),
    platformFeePercent,
    platformFeeAmount,
    platformFeeAmountFormatted: formatCurrency(platformFeeAmount),
    serviceFeeAmount,
    serviceFeeAmountFormatted: formatCurrency(serviceFeeAmount),
    driverNetIncome,
    driverNetIncomeFormatted: formatCurrency(driverNetIncome),
    originalPrice: promotionPricing.originalPrice,
    originalPriceFormatted: formatCurrency(promotionPricing.originalPrice),
    discountAmount: promotionPricing.discountAmount,
    discountAmountFormatted: formatCurrency(promotionPricing.discountAmount),
    promotionId: appliedPromotion ? normalizePromotionLookupId(appliedPromotion.id) : null,
    promotionCode: normalizeText(appliedPromotion?.code).toUpperCase() || null,
    promotionTitle: normalizeText(appliedPromotion?.title) || null,
    promotionDiscountType: normalizeText(appliedPromotion?.discountType) || 'percent',
    promotionDiscountPercent: Number(appliedPromotion?.discountPercent ?? 0) || 0,
    promotionDiscountAmount: Number(appliedPromotion?.discountAmount ?? 0) || 0,
    promotionMaxAmount: Number(appliedPromotion?.maxAmount ?? 0) || 0,
    promotionMinOrderAmount: Number(appliedPromotion?.minOrderAmount ?? 0) || 0,
    promotionScope: normalizeText(appliedPromotion?.scope) || null,
    promotionVisibility: normalizeText(appliedPromotion?.visibility) || 'public',
    promotionStartsAt: normalizeText(appliedPromotion?.startsAt) || null,
    promotionExpiresAt: normalizeText(appliedPromotion?.expiresAt) || null,
    promotionSummary,
    paymentMethod,
    paymentMethodLabel: getPaymentMethodLabel(paymentMethod),
    paymentProvider,
    paymentProviderLabel: paymentProvider ? getPaymentProviderLabel(paymentProvider) : '',
    paymentSummary: paymentProvider ? `${getPaymentMethodLabel(paymentMethod)} - ${getPaymentProviderLabel(paymentProvider)}` : getPaymentMethodLabel(paymentMethod),
  };

  let paymentGateway = null;

  if (paymentMethod === 'wallet' && paymentProvider === 'app_wallet') {
    await deductCustomerWalletForRide(customerAccountId, totalBookingPrice, booking.bookingCode);
  } else if (paymentMethod === 'wallet' && paymentProvider === 'zalopay') {
    paymentGateway = await createZaloPayOrder(booking);
  } else if (paymentMethod === 'wallet' && paymentProvider === 'momo') {
    paymentGateway = await createMoMoOrder(booking);
  }

  if (paymentGateway) {
    booking.paymentGateway = paymentGateway;
  }

  booking.tripStatus = 'ChoTaiXe';
  booking.tripStatusLabel = getTripStatusLabel(booking.tripStatus);
  booking.tripStatusTone = getTripStatusTone(booking.tripStatus);

  booking.paymentCode = generatePaymentCode(booking.bookingCode);
  booking.paymentStatus = getPaymentStatus(paymentMethod, paymentProvider);
  booking.paymentStatusLabel = getPaymentStatusLabel(booking.paymentStatus);

  const persistedPayment = await runWithSqlDeadlockRetry(
    () => persistBookingToDatabase(booking),
    'persistBookingToDatabase',
  );

  if (persistedPayment) {
    booking.paymentCode = persistedPayment.paymentCode;
    booking.paymentStatus = persistedPayment.paymentStatus;
    booking.paymentStatusLabel = persistedPayment.paymentStatusLabel;
    booking.driverAccountId = normalizeText(persistedPayment.dispatchedDriverAccountId);

    if (persistedPayment.driverRequestNotificationId) {
      booking.driverRequestNotificationId = persistedPayment.driverRequestNotificationId;
    }
  }

  saveRecentBooking(booking);
  publishRideEventSafely(buildRideBookingCreatedEvent(booking));

  return {
    success: true,
    message: `Dat xe thanh cong. Ma chuyen: ${booking.bookingCode}`,
    booking,
    paymentGateway,
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

const TRIP_HISTORY_LIMIT_DEFAULT = 120;
const TRIP_HISTORY_LIMIT_MAX = 5000;
const DRIVER_PLATFORM_FEE_PERCENT_DEFAULT = 30;

function normalizeFeePercent(value, fallback = DRIVER_PLATFORM_FEE_PERCENT_DEFAULT) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return Math.max(0, Math.min(100, Number(fallback) || DRIVER_PLATFORM_FEE_PERCENT_DEFAULT));
  }

  return Math.max(0, Math.min(100, numericValue));
}

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

  if (normalizedMethod === 'wallet' || normalizedMethod === 'qr' || normalizedMethod === 'app_wallet') {
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

  // A trip is completed only when the trip lifecycle reaches HoanThanh.
  // Paid wallet orders can still be waiting for driver acceptance/execution.
  if (tripStatus === 'HoanThanh') {
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

function buildTripHistorySummary(rows = [], platformFeePercent = DRIVER_PLATFORM_FEE_PERCENT_DEFAULT) {
  const normalizedPlatformFeePercent = normalizeFeePercent(platformFeePercent);

  return rows.reduce((summary, row) => {
    const status = getTripHistoryStatus(row);
    const distanceKm = Number(row.routeDistanceKm ?? row.QuangDuongKm);
    const amount = Number(row.paymentAmount ?? row.SoTien ?? row.GiaTien);
    const normalizedAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const platformFeeAmount = status === 'completed'
      ? Math.round(normalizedAmount * normalizedPlatformFeePercent / 100)
      : 0;
    const driverNetIncome = status === 'completed'
      ? Math.max(0, normalizedAmount - platformFeeAmount)
      : 0;

    summary.totalTrips += 1;
    summary.totalAmount += normalizedAmount;
    summary.totalDistanceKm += Number.isFinite(distanceKm) ? distanceKm : 0;
    summary.totalDriverNetIncome += driverNetIncome;
    summary.totalPlatformFeeAmount += platformFeeAmount;

    if (status === 'completed') {
      summary.completedTrips += 1;
      summary.completedAmount += normalizedAmount;
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
    completedAmount: 0,
    totalDistanceKm: 0,
    totalDriverNetIncome: 0,
    totalPlatformFeeAmount: 0,
    platformFeePercent: normalizedPlatformFeePercent,
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
      tx.MaTK AS driverSystemAccountId,
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
      dx.PhanTramPhiNenTang AS platformFeePercent,
      dx.TienPhiNenTang AS platformFeeAmount,
      dx.TienTaiXeNhan AS driverNetIncome,
      dx.MaUuDai AS promotionCode,
      ud.TenUuDai AS promotionTitle,
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
      tt.PhanTramPhiNenTang AS paymentPlatformFeePercent,
      tt.TienPhiNenTang AS paymentPlatformFeeAmount,
      tt.TienTaiXeNhan AS paymentDriverNetIncome,
      tt.MaUuDai AS paymentPromotionCode,
      ud.TenUuDai AS paymentPromotionTitle,
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
    LEFT JOIN dbo.UuDai ud ON ud.MaUuDai = dx.MaUuDai
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

async function enrichTripHistoryRow(row, account = null, options = {}) {
  const shouldResolveLocationFallback = options?.resolveLocationFallback !== false;
  const resolveLocation = typeof options?.resolveLocation === 'function'
    ? options.resolveLocation
    : (location) => resolveLocationPositionWithTimeout(location, options?.resolveLocationTimeoutMs);
  const pickupLabel = normalizeText(row.pickupLabel);
  const destinationLabel = normalizeText(row.destinationLabel);
  const storedRouteGeometry = normalizeStoredRouteGeometry(row.routeGeometryJson);
  let pickupPosition = storedRouteGeometry?.[0] ? { ...storedRouteGeometry[0] } : null;
  let destinationPosition = storedRouteGeometry?.[storedRouteGeometry.length - 1]
    ? { ...storedRouteGeometry[storedRouteGeometry.length - 1] }
    : null;

  if (!storedRouteGeometry && shouldResolveLocationFallback) {
    const [pickupPositionRaw, destinationPositionRaw] = await Promise.all([
      pickupLabel ? resolveLocation({ label: pickupLabel }) : Promise.resolve(null),
      destinationLabel ? resolveLocation({ label: destinationLabel }) : Promise.resolve(null),
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
  const paymentStatus = normalizePaymentStatusValue(row.paymentStatus ?? row.bookingPaymentStatus);
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
  const paymentStatusLabel = getPaymentStatusLabel(paymentStatus);
  const platformFeePercent = normalizeFeePercent(env.driverPlatformFeePercent);
  const storedPlatformFeePercent = Number(row.paymentPlatformFeePercent ?? row.platformFeePercent);
  const normalizedPlatformFeePercent = Number.isFinite(storedPlatformFeePercent)
    ? normalizeFeePercent(storedPlatformFeePercent, platformFeePercent)
    : platformFeePercent;
  const storedPlatformFeeAmount = Number(row.paymentPlatformFeeAmount ?? row.platformFeeAmount);
  const platformFeeAmount = status === 'completed'
    ? (
      Number.isFinite(storedPlatformFeeAmount)
        ? Math.max(0, Math.round(storedPlatformFeeAmount))
        : Math.round(Math.max(0, finalPrice) * normalizedPlatformFeePercent / 100)
    )
    : 0;
  const storedDriverNetIncome = Number(row.paymentDriverNetIncome ?? row.driverNetIncome);
  const driverNetIncome = status === 'completed'
    ? (
      Number.isFinite(storedDriverNetIncome)
        ? Math.max(0, Math.round(storedDriverNetIncome))
        : Math.max(0, Math.round(finalPrice) - platformFeeAmount)
    )
    : 0;
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
    platformFeePercent: normalizedPlatformFeePercent,
    platformFeeAmount,
    platformFeeAmountFormatted: formatCurrency(platformFeeAmount),
    driverNetIncome,
    driverNetIncomeFormatted: formatCurrency(driverNetIncome),
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

  return runWithSqlDeadlockRetry(
    () => updateTripStatusInDatabase(bookingCode, requestedTripStatus, normalizedDriverAccountId, cancelMeta),
    'updateTripStatusInDatabase',
  );
}

export async function rejectTripDispatch(payload = {}) {
  if (!isSqlServerConfigured()) {
    throw createValidationError('Từ chối cuốc cần kết nối cơ sở dữ liệu để đồng bộ điều phối.');
  }

  return runWithSqlDeadlockRetry(
    () => rejectTripDispatchInDatabase(payload),
    'rejectTripDispatchInDatabase',
  );
}

async function processTimedOutDispatchBookingInDatabase(bookingCode, referenceTime = new Date()) {
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedBookingCode) {
    return {
      processed: false,
      redispatched: false,
      cancelled: false,
    };
  }

  await ensureRideSchema();
  await ensureNotificationSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  const now = referenceTime instanceof Date ? new Date(referenceTime.getTime()) : new Date(referenceTime);

  if (Number.isNaN(now.getTime())) {
    throw createValidationError('Thời điểm xử lý timeout điều phối không hợp lệ.');
  }

  await transaction.begin();

  try {
    const currentRow = await readTripStatusRow(transaction, normalizedBookingCode);

    if (!currentRow) {
      await transaction.commit();
      return {
        bookingCode: normalizedBookingCode,
        processed: false,
        redispatched: false,
        cancelled: false,
      };
    }

    const currentTripStatus = normalizeTripStatus(currentRow.TrangThaiChuyen);
    const currentDispatchedDriverSystemAccountId = normalizeText(currentRow.dispatchedDriverSystemAccountId);

    if (currentTripStatus !== 'ChoTaiXe') {
      await transaction.commit();
      return {
        bookingCode: normalizedBookingCode,
        processed: false,
        redispatched: false,
        cancelled: false,
      };
    }

    const pendingDispatchResult = await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
      .input('driverSystemAccountId', sql.VarChar(20), currentDispatchedDriverSystemAccountId)
      .query(`
        SELECT TOP 1
          dp.MaDieuPhoi,
          dp.MaTKTaiXe,
          dp.NgayTao,
          dp.ThuTuDieuPhoi
        FROM dbo.DatXeDieuPhoi dp WITH (UPDLOCK, ROWLOCK)
        WHERE dp.MaChuyen = @bookingCode
          AND dp.TrangThai = 'pending'
          AND (
            NULLIF(@driverSystemAccountId, '') IS NULL
            OR dp.MaTKTaiXe = @driverSystemAccountId
          )
        ORDER BY dp.MaDieuPhoi DESC;
      `);

    const pendingDispatchRow = pendingDispatchResult.recordset?.[0] ?? null;
    const timedOutDriverSystemAccountId = normalizeText(
      pendingDispatchRow?.MaTKTaiXe ?? currentDispatchedDriverSystemAccountId,
    );

    if (!pendingDispatchRow || !timedOutDriverSystemAccountId) {
      await transaction.commit();
      return {
        bookingCode: normalizedBookingCode,
        processed: false,
        redispatched: false,
        cancelled: false,
      };
    }

    const dispatchCreatedAt = pendingDispatchRow?.NgayTao ? new Date(pendingDispatchRow.NgayTao) : null;

    if (!dispatchCreatedAt || Number.isNaN(dispatchCreatedAt.getTime())) {
      await transaction.commit();
      return {
        bookingCode: normalizedBookingCode,
        processed: false,
        redispatched: false,
        cancelled: false,
      };
    }

    if ((now.getTime() - dispatchCreatedAt.getTime()) < DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS) {
      await transaction.commit();
      return {
        bookingCode: normalizedBookingCode,
        processed: false,
        redispatched: false,
        cancelled: false,
      };
    }

    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
      .input('driverSystemAccountId', sql.VarChar(20), timedOutDriverSystemAccountId)
      .query(`
        UPDATE dbo.DatXeDieuPhoi
        SET
          TrangThai = 'rejected',
          LyDoTuChoi = N'Timeout quá hạn phản hồi',
          NgayPhanHoi = SYSDATETIME(),
          NgayCapNhat = SYSDATETIME()
        WHERE MaChuyen = @bookingCode
          AND MaTKTaiXe = @driverSystemAccountId
          AND TrangThai = 'pending';
      `);

    const currentNotificationId = Number(currentRow?.driverRequestNotificationId ?? 0);

    if (currentNotificationId > 0) {
      await new sql.Request(transaction)
        .input('notificationId', sql.Int, currentNotificationId)
        .query(`
          DELETE FROM dbo.ThongBao
          WHERE MaTB = @notificationId;
        `);
    }

    const recentBooking = findRecentBookingByCode(normalizedBookingCode);
    const nextDispatch = await dispatchBookingToNextDriver(
      transaction,
      {
        ...(recentBooking ?? {}),
        bookingCode: normalizedBookingCode,
        vehicle: normalizeText(currentRow?.vehicle ?? recentBooking?.vehicle),
        customerAccountId: normalizeText(currentRow?.MaTK ?? recentBooking?.customerAccountId),
        pickup: recentBooking?.pickup ?? {
          label: normalizeText(currentRow?.pickupLabel),
          position: null,
        },
        dispatchAttemptOrder: Number(currentRow?.dispatchAttemptOrder ?? 0),
      },
      [timedOutDriverSystemAccountId],
    );

    let failureMeta = null;

    if (!nextDispatch) {
      failureMeta = await markBookingDispatchFailed(transaction, {
        bookingCode: normalizedBookingCode,
        customerAccountId: normalizeText(currentRow?.MaTK ?? recentBooking?.customerAccountId),
        failureReason: DRIVER_DISPATCH_FAILURE_REASON,
      });
    }

    await transaction.commit();

    if (nextDispatch) {
      if (recentBooking) {
        recentBooking.driverAccountId = normalizeText(nextDispatch.driverSystemAccountId);
        recentBooking.driverRequestNotificationId = Number(nextDispatch.notificationId ?? 0) || null;
      }

      publishRideEventSafely(buildRideBookingCreatedEvent({
        ...(recentBooking ?? { bookingCode: normalizedBookingCode }),
        bookingCode: normalizedBookingCode,
        driverAccountId: normalizeText(nextDispatch.driverSystemAccountId),
        driverRequestNotificationId: Number(nextDispatch.notificationId ?? 0) || null,
      }));

      return {
        bookingCode: normalizedBookingCode,
        processed: true,
        redispatched: true,
        cancelled: false,
        nextDriverAccountId: normalizeText(nextDispatch.driverSystemAccountId),
      };
    }

    const updatedBooking = updateRecentBookingTripStatus(
      normalizedBookingCode,
      'DaHuy',
      '',
      failureMeta?.cancelMeta,
    );

    publishRideEventSafely(
      buildRideTripStatusUpdatedEvent(
        normalizedBookingCode,
        buildTripStatusResult(
          normalizedBookingCode,
          'DaHuy',
          new Date(),
          '',
          failureMeta?.cancelMeta,
        ),
        {
          ...currentRow,
          TrangThaiChuyen: 'DaHuy',
          cancelReasonRaw: serializeCancellationMeta(failureMeta?.cancelMeta),
        },
        updatedBooking,
      ),
    );

    return {
      bookingCode: normalizedBookingCode,
      processed: true,
      redispatched: false,
      cancelled: true,
      nextDriverAccountId: '',
    };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function runTimedOutDispatchSweep(payload = {}) {
  if (!isSqlServerConfigured()) {
    return {
      success: true,
      message: 'Bỏ qua sweep timeout điều phối vì chưa cấu hình SQL Server.',
      checkedCount: 0,
      processedCount: 0,
      redispatchedCount: 0,
      cancelledCount: 0,
      items: [],
    };
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  let referenceTime = null;

  if (payload?.referenceTime !== undefined && payload?.referenceTime !== null) {
    const referenceTimeSource = payload.referenceTime;

    referenceTime = referenceTimeSource instanceof Date
      ? new Date(referenceTimeSource.getTime())
      : new Date(referenceTimeSource);
  } else {
    const serverNowResult = await new sql.Request(pool).query('SELECT SYSDATETIME() AS referenceTime;');
    const serverNowRaw = serverNowResult.recordset?.[0]?.referenceTime;

    referenceTime = serverNowRaw ? new Date(serverNowRaw) : new Date();
  }

  if (Number.isNaN(referenceTime.getTime())) {
    throw createValidationError('Thời điểm sweep timeout điều phối không hợp lệ.');
  }
  const maxRowsRaw = Number(payload?.maxRows ?? 20);
  const maxRows = Number.isInteger(maxRowsRaw) && maxRowsRaw > 0 ? Math.min(maxRowsRaw, 200) : 20;

  const timeoutCandidatesResult = await new sql.Request(pool)
    .input('maxRows', sql.Int, maxRows)
    .input('referenceTime', sql.DateTime2(0), referenceTime)
    .input('timeoutMs', sql.Int, DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS)
    .query(`
      WITH PendingDispatch AS (
        SELECT
          dp.MaChuyen,
          MAX(dp.NgayTao) AS LatestPendingAt
        FROM dbo.DatXeDieuPhoi dp
        WHERE dp.TrangThai = 'pending'
        GROUP BY dp.MaChuyen
      )
      SELECT TOP (@maxRows)
        dx.MaChuyen AS bookingCode
      FROM dbo.DatXe dx
      INNER JOIN PendingDispatch pd
        ON pd.MaChuyen = dx.MaChuyen
      WHERE dx.TrangThaiChuyen = N'ChoTaiXe'
        AND pd.LatestPendingAt <= DATEADD(MILLISECOND, -@timeoutMs, @referenceTime)
      ORDER BY pd.LatestPendingAt ASC;
    `);

  const bookingCodes = (timeoutCandidatesResult.recordset ?? [])
    .map((row) => normalizeText(row?.bookingCode))
    .filter(Boolean);
  const items = [];

  for (const bookingCode of bookingCodes) {
    const result = await runWithSqlDeadlockRetry(
      () => processTimedOutDispatchBookingInDatabase(bookingCode, referenceTime),
      'processTimedOutDispatchBookingInDatabase',
    );

    items.push(result);
  }

  const processedItems = items.filter((item) => item?.processed);
  const redispatchedCount = processedItems.filter((item) => item?.redispatched).length;
  const cancelledCount = processedItems.filter((item) => item?.cancelled).length;

  return {
    success: true,
    message: processedItems.length > 0
      ? 'Đã xử lý timeout điều phối chuyến xe.'
      : 'Không có cuốc nào cần xử lý timeout điều phối.',
    checkedCount: bookingCodes.length,
    processedCount: processedItems.length,
    redispatchedCount,
    cancelledCount,
    items,
  };
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
  const traceStartedAt = Date.now();
  const roleCode = normalizeTripHistoryRoleCode(payload?.roleCode);
  const viewMode = normalizeText(payload?.view ?? payload?.mode).toLowerCase();
  const limit = normalizeTripHistoryLimit(payload?.limit);
  const normalizedAccountId = normalizeText(payload?.accountId);
  const normalizedIdentifier = normalizeText(payload?.identifier).toLowerCase();
  const isAdminGlobalHistory = roleCode === 'Q1' && !normalizedAccountId && !normalizedIdentifier;
  const isAdminDashboardMode = isAdminGlobalHistory && (viewMode === '' || viewMode === 'dashboard' || viewMode === 'summary');

  if (roleCode !== 'Q1' && !normalizedAccountId && !normalizedIdentifier) {
    throw createValidationError('Thiếu thông tin tài khoản để tải lịch sử chuyến.');
  }

  const schemaStartedAt = Date.now();
  await ensureRideSchema();
  const schemaDurationMs = Date.now() - schemaStartedAt;

  const [resolvedAccount, pool] = await Promise.all([
    resolveHistoryAccount(payload),
    getSqlServerPool(),
  ]);

  const queryStartedAt = Date.now();
  const queryResult = isAdminDashboardMode
    ? await pool
      .request()
      .query(`
        SELECT
          dx.MaChuyen AS bookingCode,
          dx.MaTK AS accountId,
          dx.MaTX AS driverAccountId,
          dx.TrangThaiChuyen AS tripStatus,
          dx.GiaTien AS basePrice,
          dx.NgayTao AS bookedAt,
          dx.NgayCapNhat AS updatedAt,
          driverTk.Ten AS driverName
        FROM dbo.DatXe dx
        LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
        LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
        ORDER BY dx.NgayTao DESC, dx.MaChuyen DESC;
      `)
    : await pool
      .request()
      .input('accountId', sql.VarChar(20), normalizedAccountId)
      .input('identifier', sql.VarChar(150), normalizedIdentifier)
      .query(buildTripHistoryQuery(roleCode));
  const queryDurationMs = Date.now() - queryStartedAt;

  const rows = queryResult.recordset ?? [];
  const platformFeePercent = normalizeFeePercent(env.driverPlatformFeePercent);
  const summary = buildTripHistorySummary(rows, platformFeePercent);
  const reviewSummary = buildTripHistoryReviewSummary(rows);
  // Admin dashboards only need aggregates and key metadata. Skipping geocoder fallback
  // avoids heavy external lookups that can stall large history requests.
  const shouldResolveLocationFallback = roleCode !== 'Q1' && !isAdminDashboardMode;
  const fallbackRowLimit = shouldResolveLocationFallback
    ? Math.max(0, Math.min(limit, RIDE_HISTORY_FALLBACK_MAX_ROWS))
    : 0;
  const locationResolveMemo = new Map();
  const resolveLocationForHistory = async (location) => {
    const label = normalizeText(location?.label);

    if (!label) {
      return null;
    }

    const cacheKey = normalizeLocationCacheKey(label);

    if (!locationResolveMemo.has(cacheKey)) {
      locationResolveMemo.set(
        cacheKey,
        resolveLocationPositionWithTimeout({ label }, RIDE_HISTORY_LOCATION_LOOKUP_TIMEOUT_MS).catch(() => null),
      );
    }

    return locationResolveMemo.get(cacheKey);
  };
  const enrichStartedAt = Date.now();
  const items = await Promise.all(
    rows.slice(0, limit).map((row, index) => enrichTripHistoryRow(row, resolvedAccount, {
      resolveLocationFallback: shouldResolveLocationFallback && index < fallbackRowLimit,
      resolveLocation: resolveLocationForHistory,
      resolveLocationTimeoutMs: RIDE_HISTORY_LOCATION_LOOKUP_TIMEOUT_MS,
    })),
  );
  const enrichDurationMs = Date.now() - enrichStartedAt;
  const totalDurationMs = Date.now() - traceStartedAt;

  if (totalDurationMs >= 3000) {
    console.warn(
      `[ride-history] slow response role=${roleCode} total=${totalDurationMs}ms schema=${schemaDurationMs}ms query=${queryDurationMs}ms enrich=${enrichDurationMs}ms rows=${rows.length} limit=${limit}`,
    );
  }

  return {
    success: true,
    message: 'Lấy lịch sử chuyến thành công.',
    scope: roleCode === 'Q3' ? 'driver' : roleCode === 'Q1' ? 'admin' : 'customer',
    account: resolvedAccount,
    totalCount: rows.length,
    limit,
    platformFeePercent,
    summary,
    reviewSummary,
    items,
  };
}

export async function getTripInvoice(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode ?? payload?.tripCode ?? payload?.id);
  const roleCode = normalizeTripHistoryRoleCode(payload?.roleCode);
  const normalizedAccountId = normalizeText(payload?.accountId);
  const normalizedIdentifier = normalizeText(payload?.identifier).toLowerCase();

  if (!bookingCode) {
    throw createValidationError('Thiếu mã chuyến để lấy hóa đơn.');
  }

  if (roleCode !== 'Q1' && !normalizedAccountId && !normalizedIdentifier) {
    throw createValidationError('Thiếu thông tin tài khoản để lấy hóa đơn.');
  }

  await ensureRideSchema();

  const [resolvedAccount, pool] = await Promise.all([
    resolveHistoryAccount(payload),
    getSqlServerPool(),
  ]);

  const queryResult = await pool
    .request()
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      ${buildTripHistorySelectClause()}
      WHERE LOWER(ISNULL(dx.MaChuyen, '')) = LOWER(@bookingCode)
      ORDER BY dx.NgayTao DESC;
    `);

  const row = queryResult.recordset?.[0] ?? null;

  if (!row) {
    throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
  }

  const requesterAccountId = normalizeText(resolvedAccount?.id || normalizedAccountId);
  const ownerAccountId = normalizeText(row.accountId);
  const driverAccountId = normalizeText(row.driverAccountId);
  const driverSystemAccountId = normalizeText(row.driverSystemAccountId);

  if (roleCode === 'Q2') {
    if (requesterAccountId && ownerAccountId.toLowerCase() !== requesterAccountId.toLowerCase()) {
      throw createForbiddenError('Ban khong co quyen xem hoa don cua chuyen nay.');
    }
  }

  if (roleCode === 'Q3') {
    const isDriverOwner = requesterAccountId
      && (
        driverAccountId.toLowerCase() === requesterAccountId.toLowerCase()
        || driverSystemAccountId.toLowerCase() === requesterAccountId.toLowerCase()
      );

    if (!isDriverOwner) {
      throw createForbiddenError('Ban khong co quyen xem hoa don cua chuyen nay.');
    }
  }

  const item = await enrichTripHistoryRow(row, resolvedAccount);

  if (item.status !== 'completed') {
    throw createForbiddenError('Chỉ có thể xuất hóa đơn cho chuyến đi đã hoàn thành.');
  }

  const invoiceCode = normalizeText(item.paymentCode).replace(/^TT/i, 'HDX') || `HDX-${item.bookingCode}`;

  return {
    success: true,
    message: 'Lấy hóa đơn chuyến đi thành công.',
    item: {
      ...item,
      invoiceCode,
    },
  };
}

async function applyDriverWalletSettlement(transaction, payload = {}) {
  const bookingCode = normalizeText(payload.bookingCode);
  const currentRow = payload.currentRow ?? {};
  const updatedRow = payload.updatedRow ?? {};
  const driverSystemAccountId = normalizeText(updatedRow.driverAccountId ?? currentRow.driverAccountId);

  if (!bookingCode || !driverSystemAccountId) {
    return null;
  }

  const paymentAmountValue = Number(updatedRow.paymentAmount ?? currentRow.paymentAmount);
  const paymentAmount = Number.isFinite(paymentAmountValue) ? Math.max(0, Math.round(paymentAmountValue)) : 0;
  const vehicle = normalizeText(updatedRow.vehicle ?? currentRow.vehicle).toLowerCase();
  const serviceFeeAmount = Math.max(0, Math.round(BOOKING_SERVICE_FEE[vehicle] ?? BOOKING_SERVICE_FEE.motorbike ?? 5000));
  const distanceFareAmount = Math.max(0, paymentAmount - serviceFeeAmount);
  const paymentMethod = normalizePaymentMethod(updatedRow.paymentMethod ?? currentRow.paymentMethod);
  const platformFeePercent = 30;
  const platformFeeAmount = Math.round(distanceFareAmount * 0.3);
  const driverNetIncome = Math.round(distanceFareAmount * 0.7);
  const cashSettlementCharge = Math.max(0, Math.round(distanceFareAmount * 0.3));
  const walletDelta = paymentMethod === 'wallet'
    ? driverNetIncome
    : -cashSettlementCharge;
  const receiveAmount = walletDelta > 0 ? walletDelta : 0;
  const transferAmount = walletDelta < 0 ? Math.abs(walletDelta) : 0;

  if (receiveAmount <= 0 && transferAmount <= 0) {
    return null;
  }

  const payoutReferenceCode = `TRIPPAYIN-${bookingCode}`.slice(0, 40);
  const feeReferenceCode = `TRIPFEE-${bookingCode}`.slice(0, 40);
  const payoutDescription = `Thu nhập chuyến ${bookingCode}`;
  const feeDescription = paymentMethod === 'cash'
    ? `Khấu trừ ví chuyến ${bookingCode} `
    : `Điều chỉnh ví chuyến ${bookingCode} `;
  const pendingFeeDescription = paymentMethod === 'cash'
    ? `${feeDescription} - ví không đủ số dư, chờ xử lý sau`
    : feeDescription;

  await new sql.Request(transaction)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId)
    .input('receiveAmount', sql.Int, receiveAmount)
    .input('transferAmount', sql.Int, transferAmount)
    .input('payoutReferenceCode', sql.VarChar(40), payoutReferenceCode)
    .input('feeReferenceCode', sql.VarChar(40), feeReferenceCode)
    .input('payoutDescription', sql.NVarChar(255), payoutDescription)
    .input('feeDescription', sql.NVarChar(255), feeDescription)
    .input('pendingFeeDescription', sql.NVarChar(255), pendingFeeDescription)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @driverSystemAccountId)
      BEGIN
        INSERT INTO dbo.Vi (MaTK, SoDu)
        VALUES (@driverSystemAccountId, 0);
      END

      IF @receiveAmount > 0
        AND NOT EXISTS (
        SELECT 1
        FROM dbo.GiaoDichVi
        WHERE MaTK = @driverSystemAccountId
          AND MaThamChieu = @payoutReferenceCode
      )
      BEGIN
        DECLARE @walletBeforeReceive INT;
        DECLARE @walletAfterReceive INT;

        SELECT @walletBeforeReceive = SoDu
        FROM dbo.Vi
        WHERE MaTK = @driverSystemAccountId;

        UPDATE dbo.Vi
        SET
          SoDu = SoDu + @receiveAmount,
          NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @driverSystemAccountId;

        SELECT @walletAfterReceive = SoDu
        FROM dbo.Vi
        WHERE MaTK = @driverSystemAccountId;

        INSERT INTO dbo.GiaoDichVi
        (
          MaTK,
          LoaiGiaoDich,
          SoTien,
          SoDuTruoc,
          SoDuSau,
          MoTa,
          MaThamChieu,
          TrangThai
        )
        VALUES
        (
          @driverSystemAccountId,
          'receive',
          @receiveAmount,
          @walletBeforeReceive,
          @walletAfterReceive,
          @payoutDescription,
          @payoutReferenceCode,
          'completed'
        );
      END

      IF @transferAmount > 0
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.GiaoDichVi
          WHERE MaTK = @driverSystemAccountId
            AND MaThamChieu = @feeReferenceCode
        )
      BEGIN
        DECLARE @walletBeforeFee INT;
        DECLARE @walletAfterFee INT;

        SELECT @walletBeforeFee = SoDu
        FROM dbo.Vi
        WHERE MaTK = @driverSystemAccountId;

        IF COALESCE(@walletBeforeFee, 0) >= @transferAmount
        BEGIN
          UPDATE dbo.Vi
          SET
            SoDu = SoDu - @transferAmount,
            NgayCapNhat = SYSDATETIME()
          WHERE MaTK = @driverSystemAccountId;

          SELECT @walletAfterFee = SoDu
          FROM dbo.Vi
          WHERE MaTK = @driverSystemAccountId;

          INSERT INTO dbo.GiaoDichVi
          (
            MaTK,
            LoaiGiaoDich,
            SoTien,
            SoDuTruoc,
            SoDuSau,
            MoTa,
            MaThamChieu,
            TrangThai
          )
          VALUES
          (
            @driverSystemAccountId,
            'transfer',
            -@transferAmount,
            @walletBeforeFee,
            @walletAfterFee,
            @feeDescription,
            @feeReferenceCode,
            'completed'
          );
        END
        ELSE
        BEGIN
          SET @walletAfterFee = COALESCE(@walletBeforeFee, 0);

          INSERT INTO dbo.GiaoDichVi
          (
            MaTK,
            LoaiGiaoDich,
            SoTien,
            SoDuTruoc,
            SoDuSau,
            MoTa,
            MaThamChieu,
            TrangThai
          )
          VALUES
          (
            @driverSystemAccountId,
            'transfer',
            -@transferAmount,
            COALESCE(@walletBeforeFee, 0),
            @walletAfterFee,
            @pendingFeeDescription,
            @feeReferenceCode,
            'pending'
          );
        END
      END
    `);

  return {
    driverSystemAccountId,
    paymentAmount,
    paymentMethod,
    serviceFeeAmount,
    platformFeePercent,
    platformFeeAmount,
    driverNetIncome,
    cashSettlementCharge,
  };
}

async function markBookingPaidByGateway({
  bookingCode,
  paidAt = new Date(),
  appTransId = '',
  zpTransToken = '',
  gatewayTransToken = '',
  gatewayReturnCode = null,
}) {
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedBookingCode) {
    throw createValidationError('Thiếu mã chuyến để cập nhật thanh toán.');
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const request = new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
      .input('paidAt', sql.DateTime2(0), paidAt instanceof Date ? paidAt : new Date(paidAt))
      .input('gatewayAppTransId', sql.VarChar(80), normalizeText(appTransId) || null)
      .input('gatewayTransToken', sql.VarChar(120), normalizeText(gatewayTransToken || zpTransToken) || null)
      .input('gatewayReturnCode', sql.Int, Number.isFinite(Number(gatewayReturnCode)) ? Number(gatewayReturnCode) : null);

    const bookingResult = await request.query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS accountId,
        dx.MaTX AS driverAccountId,
        dx.MaTKTaiXeDuocMoi AS dispatchedDriverSystemAccountId,
        dx.LanDieuPhoiHienTai AS dispatchAttemptOrder,
        dx.LoaiXe AS vehicle,
        dx.DiemDon AS pickupLabel,
        dx.TrangThaiChuyen AS tripStatus,
        dx.TrangThaiThanhToan AS bookingPaymentStatus,
        tt.TrangThaiThanhToan AS paymentStatus,
        tt.MaTT AS paymentCode,
        tt.ThoiDiemThanhToan AS paidAt
      FROM dbo.DatXe dx
      LEFT JOIN dbo.ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
      WHERE dx.MaChuyen = @bookingCode;
    `);

    const currentRow = bookingResult.recordset?.[0] ?? null;

    if (!currentRow?.bookingCode) {
      throw createNotFoundError(`Khong tim thay chuyen ${normalizedBookingCode}.`);
    }

    await request.query(`
      UPDATE dbo.DatXe
      SET
        TrangThaiThanhToan = N'DaThanhToan',
        NgayCapNhat = SYSUTCDATETIME()
      WHERE MaChuyen = @bookingCode
        AND TrangThaiThanhToan <> N'DaThanhToan';

      UPDATE dbo.ThanhToan
      SET
        TrangThaiThanhToan = N'DaThanhToan',
        ThoiDiemThanhToan = COALESCE(ThoiDiemThanhToan, @paidAt),
        GatewayAppTransId = COALESCE(GatewayAppTransId, @gatewayAppTransId),
        GatewayTransToken = COALESCE(GatewayTransToken, @gatewayTransToken),
        GatewayLastQueryAt = SYSUTCDATETIME(),
        GatewayLastReturnCode = COALESCE(@gatewayReturnCode, GatewayLastReturnCode),
        NgayCapNhat = SYSUTCDATETIME()
      WHERE MaChuyen = @bookingCode
        AND (TrangThaiThanhToan <> N'DaThanhToan' OR GatewayLastReturnCode IS NULL);
    `);

    let dispatchResult = null;
    const hasDispatchedDriver = Boolean(normalizeText(currentRow.dispatchedDriverSystemAccountId));
    const currentTripStatus = normalizeTripStatus(currentRow.tripStatus);

    if (!hasDispatchedDriver && currentTripStatus === 'ChoTaiXe') {
      dispatchResult = await dispatchBookingToNextDriver(transaction, {
        bookingCode: normalizedBookingCode,
        vehicle: normalizeText(currentRow.vehicle),
        customerAccountId: normalizeText(currentRow.accountId),
        pickup: {
          label: normalizeText(currentRow.pickupLabel),
          position: null,
        },
        dispatchAttemptOrder: Number(currentRow.dispatchAttemptOrder ?? 0),
      });
    }

    await transaction.commit();

    const updatedBooking = findRecentBookingByCode(normalizedBookingCode);
    if (updatedBooking) {
      updatedBooking.paymentStatus = 'DaThanhToan';
      updatedBooking.paymentStatusLabel = getPaymentStatusLabel('DaThanhToan');
      updatedBooking.driverAccountId = normalizeText(dispatchResult?.driverSystemAccountId || updatedBooking.driverAccountId);
      updatedBooking.driverRequestNotificationId = Number(
        dispatchResult?.notificationId ?? updatedBooking.driverRequestNotificationId ?? 0,
      ) || null;
      updatedBooking.updatedAt = new Date().toISOString();
    }

    if (dispatchResult) {
      publishRideEventSafely(buildRideBookingCreatedEvent({
        ...(updatedBooking ?? { bookingCode: normalizedBookingCode }),
        bookingCode: normalizedBookingCode,
        driverAccountId: normalizeText(dispatchResult.driverSystemAccountId),
        driverRequestNotificationId: Number(dispatchResult.notificationId ?? 0) || null,
      }));
    }

    publishRideEventSafely(
      buildRidePaymentUpdatedEvent(
        normalizedBookingCode,
        {
          paymentCode: normalizeText(currentRow.paymentCode),
          paymentStatus: 'DaThanhToan',
          paidAt: (paidAt instanceof Date ? paidAt : new Date(paidAt)).toISOString(),
          source: 'gateway-callback',
        },
        currentRow,
        updatedBooking,
      ),
    );

    return {
      success: true,
      bookingCode: normalizedBookingCode,
      paymentCode: normalizeText(currentRow.paymentCode),
      paymentStatus: 'DaThanhToan',
      paymentStatusLabel: getPaymentStatusLabel('DaThanhToan'),
      paidAt: (paidAt instanceof Date ? paidAt : new Date(paidAt)).toISOString(),
      booking: updatedBooking ?? null,
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback failures.
    }

    throw error;
  }
}

async function markBookingFailedByGateway({
  bookingCode,
  gatewayReturnCode = null,
  appTransId = '',
  gatewayTransToken = '',
  reason = 'gateway_payment_failed',
}) {
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedBookingCode) {
    throw createValidationError('Thiếu mã chuyến để cập nhật thanh toán thất bại.');
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const request = new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
      .input('gatewayReturnCode', sql.Int, Number.isFinite(Number(gatewayReturnCode)) ? Number(gatewayReturnCode) : null)
      .input('gatewayAppTransId', sql.VarChar(80), normalizeText(appTransId) || null)
      .input('gatewayTransToken', sql.VarChar(120), normalizeText(gatewayTransToken) || null)
      .input('cancelReasonPayload', sql.NVarChar(500), serializeCancellationMeta({
        cancelledByRoleCode: 'q2',
        cancelledByAccountId: 'payment-gateway',
        cancelReason: normalizeText(reason) || 'Thanh toán thất bại hoặc bị hủy.',
      }));

    const currentResult = await request.query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS accountId,
        dx.TrangThaiChuyen AS tripStatus,
        tt.MaTT AS paymentCode
      FROM dbo.DatXe dx
      LEFT JOIN dbo.ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
      WHERE dx.MaChuyen = @bookingCode;
    `);

    const currentRow = currentResult.recordset?.[0] ?? null;

    if (!currentRow?.bookingCode) {
      throw createNotFoundError(`Khong tim thay chuyen ${normalizedBookingCode}.`);
    }

    await request.query(`
      UPDATE dbo.DatXe
      SET
        TrangThaiThanhToan = N'ThatBai',
        TrangThaiChuyen = CASE
          WHEN TrangThaiChuyen = N'ChoTaiXe' THEN N'DaHuy'
          ELSE TrangThaiChuyen
        END,
        MaTKTaiXeDuocMoi = NULL,
        MaTBThongBaoTaiXe = NULL,
        LyDoHuy = CASE
          WHEN TrangThaiChuyen = N'ChoTaiXe' THEN @cancelReasonPayload
          ELSE LyDoHuy
        END,
        NgayCapNhat = SYSUTCDATETIME()
      WHERE MaChuyen = @bookingCode
        AND TrangThaiThanhToan <> N'DaThanhToan';

      UPDATE dbo.ThanhToan
      SET
        TrangThaiThanhToan = CASE
          WHEN TrangThaiThanhToan = N'DaThanhToan' THEN TrangThaiThanhToan
          ELSE N'ThatBai'
        END,
        GatewayAppTransId = COALESCE(GatewayAppTransId, @gatewayAppTransId),
        GatewayTransToken = COALESCE(GatewayTransToken, @gatewayTransToken),
        GatewayLastQueryAt = SYSUTCDATETIME(),
        GatewayLastReturnCode = COALESCE(@gatewayReturnCode, GatewayLastReturnCode),
        NgayCapNhat = SYSUTCDATETIME()
      WHERE MaChuyen = @bookingCode;
    `);

    await transaction.commit();

    const updatedBooking = findRecentBookingByCode(normalizedBookingCode);
    if (updatedBooking) {
      updatedBooking.paymentStatus = 'ThatBai';
      updatedBooking.paymentStatusLabel = getPaymentStatusLabel('ThatBai');
      if (normalizeTripStatus(currentRow.tripStatus) === 'ChoTaiXe') {
        updatedBooking.tripStatus = 'DaHuy';
        updatedBooking.tripStatusLabel = getTripStatusLabel('DaHuy');
        updatedBooking.tripStatusTone = getTripStatusTone('DaHuy');
      }
      updatedBooking.updatedAt = new Date().toISOString();
    }

    publishRideEventSafely(
      buildRidePaymentUpdatedEvent(
        normalizedBookingCode,
        {
          paymentCode: normalizeText(currentRow.paymentCode),
          paymentStatus: 'ThatBai',
          source: 'gateway-callback',
        },
        currentRow,
        updatedBooking,
      ),
    );

    if (normalizeTripStatus(currentRow.tripStatus) === 'ChoTaiXe') {
      publishRideEventSafely(
        buildRideTripStatusUpdatedEvent(
          normalizedBookingCode,
          buildTripStatusResult(normalizedBookingCode, 'DaHuy', new Date(), '', {
            cancelledByRoleCode: 'q2',
            cancelledByAccountId: 'payment-gateway',
            cancelReason: normalizeText(reason) || 'Thanh toán thất bại hoặc bị hủy.',
          }),
          {
            ...currentRow,
            TrangThaiChuyen: 'DaHuy',
          },
          updatedBooking,
        ),
      );
    }

    return {
      success: true,
      bookingCode: normalizedBookingCode,
      paymentStatus: 'ThatBai',
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback failures.
    }

    throw error;
  }
}

export async function handleZaloPayCallback(payload = {}) {
  const callbackData = normalizeText(payload?.data);
  const callbackMac = normalizeText(payload?.mac).toLowerCase();

  if (!isZaloPayConfigured()) {
    return {
      return_code: 0,
      return_message: 'zalopay_not_configured',
    };
  }

  if (!callbackData || !callbackMac) {
    await logPaymentGatewayAudit({
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_payload',
      requestPayload: payload,
      message: 'missing_data_or_mac',
    });

    return {
      return_code: -1,
      return_message: 'invalid_payload',
    };
  }

  const expectedMac = computeZaloPayHmac(callbackData, normalizeText(env.zaloPayKey2)).toLowerCase();

  if (!safeCompareText(expectedMac, callbackMac)) {
    await logPaymentGatewayAudit({
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_mac',
      requestMac: callbackMac,
      computedMac: expectedMac,
      requestPayload: payload,
      message: 'mac_mismatch',
    });

    return {
      return_code: -1,
      return_message: 'invalid_mac',
    };
  }

  let parsedCallback = null;

  try {
    parsedCallback = JSON.parse(callbackData);
  } catch {
    await logPaymentGatewayAudit({
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_data_json',
      requestMac: callbackMac,
      computedMac: expectedMac,
      requestPayload: payload,
      message: 'invalid_data_json',
    });

    return {
      return_code: 0,
      return_message: 'invalid_data_json',
    };
  }

  let embedData = {};

  try {
    embedData = parsedCallback?.embed_data ? JSON.parse(parsedCallback.embed_data) : {};
  } catch {
    embedData = {};
  }

  const bookingCode = normalizeText(embedData?.bookingCode);
  const appTransId = normalizeText(parsedCallback?.app_trans_id);
  const zpTransToken = normalizeText(parsedCallback?.zp_trans_id ?? parsedCallback?.zp_trans_token);
  const appId = normalizeText(parsedCallback?.app_id);
  const amount = Number(parsedCallback?.amount ?? 0);
  const serverTime = Number(parsedCallback?.server_time ?? 0);
  const paidAt = Number.isFinite(serverTime) && serverTime > 0 ? new Date(serverTime) : new Date();

  if (!appId || appId !== normalizeText(env.zaloPayAppId)) {
    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_appid',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      requestPayload: parsedCallback,
      message: 'appid_mismatch',
    });

    return {
      return_code: 0,
      return_message: 'invalid_appid',
    };
  }

  if (!bookingCode) {
    await logPaymentGatewayAudit({
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'missing_booking_code',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      requestPayload: parsedCallback,
      message: 'missing_booking_code',
    });

    return {
      return_code: 0,
      return_message: 'missing_booking_code',
    };
  }

  try {
    const pool = await getSqlServerPool();
    const paymentLookupResult = await pool
      .request()
      .input('bookingCode', sql.VarChar(30), bookingCode)
      .query(`
        SELECT TOP 1
          tt.MaTT AS paymentCode,
          tt.SoTien AS paymentAmount,
          tt.GatewayAppTransId AS gatewayAppTransId,
          tt.TrangThaiThanhToan AS paymentStatus
        FROM dbo.ThanhToan tt
        WHERE tt.MaChuyen = @bookingCode;
      `);

    const paymentRow = paymentLookupResult.recordset?.[0] ?? null;

    if (!paymentRow) {
      await logPaymentGatewayAudit({
        bookingCode,
        provider: 'zalopay',
        eventType: 'callback',
        source: 'webhook',
        verifyStatus: 'payment_not_found',
        requestMac: callbackMac,
        computedMac: expectedMac,
        appTransId,
        requestPayload: parsedCallback,
        message: 'payment_not_found',
      });

      return {
        return_code: 0,
        return_message: 'payment_not_found',
      };
    }

    if (appTransId && normalizeText(paymentRow.gatewayAppTransId) && !safeCompareText(appTransId, normalizeText(paymentRow.gatewayAppTransId))) {
      await logPaymentGatewayAudit({
        paymentCode: normalizeText(paymentRow.paymentCode),
        bookingCode,
        provider: 'zalopay',
        eventType: 'callback',
        source: 'webhook',
        verifyStatus: 'app_trans_id_mismatch',
        requestMac: callbackMac,
        computedMac: expectedMac,
        appTransId,
        requestPayload: parsedCallback,
        message: 'app_trans_id_mismatch',
      });

      return {
        return_code: 0,
        return_message: 'app_trans_id_mismatch',
      };
    }

    if (Number.isFinite(amount) && amount > 0 && Number(paymentRow.paymentAmount ?? 0) !== amount) {
      await logPaymentGatewayAudit({
        paymentCode: normalizeText(paymentRow.paymentCode),
        bookingCode,
        provider: 'zalopay',
        eventType: 'callback',
        source: 'webhook',
        verifyStatus: 'amount_mismatch',
        requestMac: callbackMac,
        computedMac: expectedMac,
        appTransId,
        requestPayload: parsedCallback,
        message: 'amount_mismatch',
      });

      return {
        return_code: 0,
        return_message: 'amount_mismatch',
      };
    }
  } catch {
    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'lookup_error',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      requestPayload: parsedCallback,
      message: 'lookup_error',
    });
  }

  // Chỉ xử lý thành công khi status === 1
  const status = Number(parsedCallback?.status ?? 0);
  if (status !== 1) {
    try {
      await runWithSqlDeadlockRetry(
        () => markBookingFailedByGateway({
          bookingCode,
          gatewayReturnCode: status,
          appTransId,
          gatewayTransToken: zpTransToken,
          reason: 'Thanh toán ZaloPay không thành công hoặc đã bị hủy.',
        }),
        'markBookingFailedByGateway-zalopay-callback',
      );
    } catch {
      // Keep callback idempotent even if local state update fails.
    }

    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'not_success_status',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      gatewayReturnCode: status,
      requestPayload: parsedCallback,
      message: `zalopay_status_not_success: ${status}`,
    });
    return {
      return_code: 0,
      return_message: 'not_success_status',
    };
  }

  try {
    await runWithSqlDeadlockRetry(
      () => markBookingPaidByGateway({
        bookingCode,
        paidAt,
        appTransId,
        zpTransToken,
        gatewayReturnCode: status,
      }),
      'markBookingPaidByGateway-zalopay-callback',
    );

    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'success',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      gatewayReturnCode: status,
      requestPayload: parsedCallback,
      responsePayload: { return_code: 1, return_message: 'success' },
      message: 'callback_verified_and_applied',
    });

    return {
      return_code: 1,
      return_message: 'success',
    };
  } catch {
    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'zalopay',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'processing_error',
      requestMac: callbackMac,
      computedMac: expectedMac,
      appTransId,
      requestPayload: parsedCallback,
      message: 'processing_error',
    });

    return {
      return_code: 0,
      return_message: 'processing_error',
    };
  }
}

export async function handleMoMoCallback(payload = {}) {
  if (isMoMoMockModeEnabled()) {
    const orderId = normalizeText(payload?.orderId);
    const bookingCodeFromExtraData = normalizeText(decodeMoMoExtraData(payload?.extraData)?.bookingCode);
    const bookingCode = bookingCodeFromExtraData || extractBookingCodeFromMoMoOrderId(orderId);

    if (orderId) {
      momoMockPaidOrderIds.add(orderId);
    }

    if (bookingCode) {
      try {
        await runWithSqlDeadlockRetry(
          () => markBookingPaidByGateway({
            bookingCode,
            paidAt: new Date(),
            appTransId: orderId,
            gatewayTransToken: normalizeText(payload?.transId) || `MOCK-${Date.now()}`,
            gatewayReturnCode: MOMO_SUCCESS_RESULT_CODE,
          }),
          'markBookingPaidByGateway-momo-mock-callback',
        );
      } catch {
        // Keep callback idempotent in mock mode.
      }
    }

    return {
      resultCode: 0,
      message: 'received',
      mock: true,
    };
  }

  if (!isMoMoConfigured()) {
    return {
      resultCode: 0,
      message: 'momo_not_configured',
    };
  }

  const signature = normalizeText(payload?.signature).toLowerCase();
  const partnerCode = normalizeText(payload?.partnerCode);
  const orderId = normalizeText(payload?.orderId);
  const requestId = normalizeText(payload?.requestId);
  const amount = Number(payload?.amount ?? 0);
  const resultCode = Number(payload?.resultCode ?? payload?.errorCode ?? NaN);
  const message = normalizeText(payload?.message ?? payload?.localMessage);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const expectedPartnerCode = normalizeText(env.momoPartnerCode);

  if (!signature || !orderId || !requestId || !partnerCode) {
    await logPaymentGatewayAudit({
      provider: 'momo',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_payload',
      requestPayload: payload,
      message: 'missing_required_fields',
    });

    return {
      resultCode: 0,
      message: 'received',
    };
  }

  const rawSignatures = [
    [
      `accessKey=${accessKey}`,
      `amount=${Number.isFinite(amount) ? Math.round(amount) : normalizeText(payload?.amount)}`,
      `extraData=${normalizeText(payload?.extraData)}`,
      `message=${message}`,
      `orderId=${orderId}`,
      `orderInfo=${normalizeText(payload?.orderInfo)}`,
      `orderType=${normalizeText(payload?.orderType)}`,
      `partnerCode=${partnerCode}`,
      `payType=${normalizeText(payload?.payType)}`,
      `requestId=${requestId}`,
      `responseTime=${normalizeText(payload?.responseTime)}`,
      `resultCode=${Number.isFinite(resultCode) ? resultCode : normalizeText(payload?.resultCode)}`,
      `transId=${normalizeText(payload?.transId)}`,
    ].join('&'),
    [
      `accessKey=${accessKey}`,
      `amount=${Number.isFinite(amount) ? Math.round(amount) : normalizeText(payload?.amount)}`,
      `extraData=${normalizeText(payload?.extraData)}`,
      `message=${message}`,
      `orderId=${orderId}`,
      `orderInfo=${normalizeText(payload?.orderInfo)}`,
      `partnerCode=${partnerCode}`,
      `requestId=${requestId}`,
      `responseTime=${normalizeText(payload?.responseTime)}`,
      `resultCode=${Number.isFinite(resultCode) ? resultCode : normalizeText(payload?.resultCode)}`,
      `transId=${normalizeText(payload?.transId)}`,
    ].join('&'),
  ];

  const matchedSignature = rawSignatures.some((rawData) => {
    const expectedSignature = computeMoMoHmac(rawData, secretKey).toLowerCase();
    return safeCompareText(expectedSignature, signature);
  });

  if (!matchedSignature) {
    await logPaymentGatewayAudit({
      provider: 'momo',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_signature',
      requestMac: signature,
      requestPayload: payload,
      message: 'signature_mismatch',
    });

    return {
      resultCode: 0,
      message: 'received',
    };
  }

  if (!safeCompareText(partnerCode, expectedPartnerCode)) {
    await logPaymentGatewayAudit({
      provider: 'momo',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'invalid_partner_code',
      appTransId: orderId,
      requestPayload: payload,
      message: 'partner_code_mismatch',
    });

    return {
      resultCode: 0,
      message: 'received',
    };
  }

  const extraData = decodeMoMoExtraData(payload?.extraData);
  const bookingCode = normalizeText(extraData?.bookingCode) || extractBookingCodeFromMoMoOrderId(orderId);

  if (!bookingCode) {
    await logPaymentGatewayAudit({
      provider: 'momo',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'missing_booking_code',
      appTransId: orderId,
      requestPayload: payload,
      message: 'missing_booking_code',
    });

    return {
      resultCode: 0,
      message: 'received',
    };
  }

  await logPaymentGatewayAudit({
    bookingCode,
    provider: 'momo',
    eventType: 'callback',
    source: 'webhook',
    verifyStatus: Number.isFinite(resultCode) && resultCode === MOMO_SUCCESS_RESULT_CODE ? 'paid' : 'pending',
    appTransId: orderId,
    gatewayReturnCode: Number.isFinite(resultCode) ? resultCode : null,
    message,
    requestPayload: payload,
  });

  if (!Number.isFinite(resultCode) || resultCode !== MOMO_SUCCESS_RESULT_CODE) {
    return {
      resultCode: 0,
      message: 'received',
    };
  }

  try {
    await runWithSqlDeadlockRetry(
      () => markBookingPaidByGateway({
        bookingCode,
        paidAt: new Date(),
        appTransId: orderId,
        gatewayTransToken: normalizeText(payload?.transId),
        gatewayReturnCode: resultCode,
      }),
      'markBookingPaidByGateway-momo-callback',
    );
  } catch {
    await logPaymentGatewayAudit({
      bookingCode,
      provider: 'momo',
      eventType: 'callback',
      source: 'webhook',
      verifyStatus: 'processing_error',
      appTransId: orderId,
      requestPayload: payload,
      message: 'processing_error',
    });
  }

  return {
    resultCode: 0,
    message: 'received',
  };
}

export async function triggerMoMoMockPaymentCallback(payload = {}) {
  if (!isMoMoMockModeEnabled()) {
    throw createValidationError('MoMo mock mode chưa bật. Không thể giả lập callback.');
  }

  const bookingCode = normalizeText(payload?.bookingCode);
  const accountId = normalizeText(payload?.accountId);

  if (!bookingCode) {
    throw createValidationError('Thiếu mã chuyến để giả lập callback MoMo.');
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const result = await pool
    .request()
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS accountId,
        dx.PhuongThucThanhToan AS paymentMethod,
        dx.NhaCungCapThanhToan AS paymentProvider,
        tt.SoTien AS paymentAmount,
        tt.GatewayAppTransId AS gatewayAppTransId,
        tt.TrangThaiThanhToan AS paymentStatus
      FROM dbo.DatXe dx
      LEFT JOIN dbo.ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
      WHERE LOWER(ISNULL(dx.MaChuyen, '')) = LOWER(@bookingCode)
      ORDER BY tt.NgayCapNhat DESC;
    `);

  const row = result.recordset?.[0] ?? null;

  if (!row) {
    throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
  }

  const ownerAccountId = normalizeText(row.accountId);

  if (accountId && ownerAccountId && ownerAccountId.toLowerCase() !== accountId.toLowerCase()) {
    throw createForbiddenError('Bạn không có quyền giả lập callback cho chuyến này.');
  }

  const paymentMethod = normalizeText(row.paymentMethod).toLowerCase();
  const paymentProvider = normalizeText(row.paymentProvider).toLowerCase();

  if (paymentMethod !== 'wallet' || paymentProvider !== 'momo') {
    throw createValidationError('Chuyến này không sử dụng thanh toán ví MoMo.');
  }

  if (normalizeText(row.paymentStatus).toLowerCase() === 'dathanhtoan') {
    return {
      success: true,
      message: 'Chuyến đã được thanh toán trước đó.',
      bookingCode,
      alreadyPaid: true,
    };
  }

  const orderId = normalizeText(row.gatewayAppTransId) || generateMoMoOrderId(bookingCode);
  const amount = Number(row.paymentAmount ?? 0);
  const callbackPayload = {
    partnerCode: normalizeText(env.momoPartnerCode) || 'MOCK_PARTNER',
    orderId,
    requestId: `${orderId}_MOCK_${Date.now()}`,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1000,
    orderInfo: `SmartRide MoMo mock callback ${bookingCode}`,
    orderType: 'momo_wallet',
    transId: `MOCK-${Date.now()}`,
    resultCode: MOMO_SUCCESS_RESULT_CODE,
    message: 'Successful.',
    payType: 'qr',
    responseTime: String(Date.now()),
    extraData: encodeMoMoExtraData({ bookingCode, source: 'internal-mock-confirm' }),
    signature: 'MOCK_SIGNATURE',
  };

  const callbackResult = await handleMoMoCallback(callbackPayload);

  return {
    success: true,
    message: 'Đã giả lập callback MoMo thành công.',
    bookingCode,
    callbackResult,
  };
}

export async function getTripPaymentStatus(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode);
  const accountId = normalizeText(payload?.accountId);

  if (!bookingCode) {
    throw createValidationError('Thiếu mã chuyến để kiểm tra thanh toán.');
  }

  await ensureRideSchema();

  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS accountId,
        dx.PhuongThucThanhToan AS paymentMethod,
        dx.NhaCungCapThanhToan AS paymentProvider,
        dx.TrangThaiThanhToan AS bookingPaymentStatus,
        dx.TrangThaiChuyen AS tripStatus,
        tt.MaTT AS paymentCode,
        tt.TrangThaiThanhToan AS paymentStatus,
        tt.ThoiDiemThanhToan AS paidAt,
        tt.NgayCapNhat AS paymentUpdatedAt,
        tt.GatewayAppTransId AS gatewayAppTransId,
        tt.GatewayTransToken AS gatewayTransToken,
        tt.GatewayLastQueryAt AS gatewayLastQueryAt,
        tt.GatewayLastReturnCode AS gatewayLastReturnCode
      FROM dbo.DatXe dx
      LEFT JOIN dbo.ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
      WHERE LOWER(ISNULL(dx.MaChuyen, '')) = LOWER(@bookingCode)
      ORDER BY tt.NgayCapNhat DESC;
    `);

  const row = queryResult.recordset?.[0] ?? null;

  if (!row) {
    throw createNotFoundError(`Khong tim thay chuyen ${bookingCode}.`);
  }

  const ownerAccountId = normalizeText(row.accountId);

  if (accountId && ownerAccountId && ownerAccountId.toLowerCase() !== accountId.toLowerCase()) {
    throw createForbiddenError('Bạn không có quyền kiểm tra thanh toán cho chuyến này.');
  }

  let paymentStatus = normalizeText(row.paymentStatus || row.bookingPaymentStatus || 'ChoXacNhan');
  let paidAt = row.paidAt ? new Date(row.paidAt) : null;
  const paymentProvider = normalizeText(row.paymentProvider).toLowerCase();
  const gatewayAppTransId = normalizeText(row.gatewayAppTransId);

  // Callback can be delayed; query payment gateway directly for latest state when still pending.
  if (paymentProvider === 'zalopay' && normalizeText(paymentStatus).toLowerCase() !== 'dathanhtoan' && gatewayAppTransId) {
    try {
      const gatewayResult = await queryZaloPayOrderStatus(gatewayAppTransId);
      const gatewayReturnCode = Number(gatewayResult?.return_code ?? gatewayResult?.returncode ?? 0);
      const isPaidByGateway = gatewayReturnCode === 1;

      await pool
        .request()
        .input('bookingCode', sql.VarChar(30), bookingCode)
        .input('gatewayReturnCode', sql.Int, Number.isFinite(gatewayReturnCode) ? gatewayReturnCode : null)
        .query(`
          UPDATE dbo.ThanhToan
          SET
            GatewayLastQueryAt = SYSUTCDATETIME(),
            GatewayLastReturnCode = @gatewayReturnCode
          WHERE MaChuyen = @bookingCode;
        `);

      await logPaymentGatewayAudit({
        paymentCode: normalizeText(row.paymentCode),
        bookingCode,
        provider: 'zalopay',
        eventType: 'query',
        source: 'payment-status-api',
        verifyStatus: isPaidByGateway ? 'paid' : 'pending',
        appTransId: gatewayAppTransId,
        gatewayReturnCode,
        message: normalizeText(gatewayResult?.return_message ?? gatewayResult?.sub_return_message),
        responsePayload: gatewayResult,
      });

      if (isPaidByGateway) {
        const markResult = await runWithSqlDeadlockRetry(
          () => markBookingPaidByGateway({
            bookingCode,
            paidAt: new Date(),
            appTransId: gatewayAppTransId,
            zpTransToken: normalizeText(gatewayResult?.zp_trans_id ?? gatewayResult?.zp_trans_token),
            gatewayReturnCode,
          }),
          'markBookingPaidByGateway-zalopay-query',
        );

        paymentStatus = 'DaThanhToan';
        paidAt = markResult?.paidAt ? new Date(markResult.paidAt) : new Date();
      }
    } catch (error) {
      await logPaymentGatewayAudit({
        paymentCode: normalizeText(row.paymentCode),
        bookingCode,
        provider: 'zalopay',
        eventType: 'query',
        source: 'payment-status-api',
        verifyStatus: 'error',
        appTransId: gatewayAppTransId,
        message: normalizeText(error?.message) || 'query_failed',
      });
    }
  }

  if (paymentProvider === 'momo' && normalizeText(paymentStatus).toLowerCase() !== 'dathanhtoan' && gatewayAppTransId) {
    try {
      const gatewayResult = await queryMoMoOrderStatus(gatewayAppTransId);
      const gatewayReturnCode = Number(gatewayResult?.resultCode ?? gatewayResult?.errorCode ?? NaN);
      const isPaidByGateway = Number.isFinite(gatewayReturnCode) && gatewayReturnCode === MOMO_SUCCESS_RESULT_CODE;

      await pool
        .request()
        .input('bookingCode', sql.VarChar(30), bookingCode)
        .input('gatewayReturnCode', sql.Int, Number.isFinite(gatewayReturnCode) ? gatewayReturnCode : null)
        .query(`
          UPDATE dbo.ThanhToan
          SET
            GatewayLastQueryAt = SYSUTCDATETIME(),
            GatewayLastReturnCode = @gatewayReturnCode
          WHERE MaChuyen = @bookingCode;
        `);

      await logPaymentGatewayAudit({
        paymentCode: normalizeText(row.paymentCode),
        bookingCode,
        provider: 'momo',
        eventType: 'query',
        source: 'payment-status-api',
        verifyStatus: isPaidByGateway ? 'paid' : 'pending',
        appTransId: gatewayAppTransId,
        gatewayReturnCode,
        message: normalizeText(gatewayResult?.message ?? gatewayResult?.localMessage),
        responsePayload: gatewayResult,
      });

      if (isPaidByGateway) {
        const markResult = await runWithSqlDeadlockRetry(
          () => markBookingPaidByGateway({
            bookingCode,
            paidAt: new Date(),
            appTransId: gatewayAppTransId,
            gatewayTransToken: normalizeText(gatewayResult?.transId),
            gatewayReturnCode,
          }),
          'markBookingPaidByGateway-momo-query',
        );

        paymentStatus = 'DaThanhToan';
        paidAt = markResult?.paidAt ? new Date(markResult.paidAt) : new Date();
      }
    } catch (error) {
      await logPaymentGatewayAudit({
        paymentCode: normalizeText(row.paymentCode),
        bookingCode,
        provider: 'momo',
        eventType: 'query',
        source: 'payment-status-api',
        verifyStatus: 'error',
        appTransId: gatewayAppTransId,
        message: normalizeText(error?.message) || 'query_failed',
      });
    }
  }

  return {
    success: true,
    message: 'Lấy trạng thái thanh toán thành công.',
    payment: {
      bookingCode: normalizeText(row.bookingCode),
      paymentCode: normalizeText(row.paymentCode),
      paymentMethod: normalizeText(row.paymentMethod).toLowerCase(),
      paymentProvider,
      paymentStatus,
      paymentStatusLabel: getPaymentStatusLabel(paymentStatus),
      tripStatus: normalizeText(row.tripStatus),
      gatewayAppTransId,
      gatewayTransToken: normalizeText(row.gatewayTransToken),
      paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt.toISOString() : '',
      updatedAt: row.paymentUpdatedAt ? new Date(row.paymentUpdatedAt).toISOString() : '',
      isPaid: normalizeText(paymentStatus).toLowerCase() === 'dathanhtoan',
    },
  };
}
