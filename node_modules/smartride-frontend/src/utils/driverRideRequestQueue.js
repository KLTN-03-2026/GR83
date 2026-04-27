import { notificationService } from '../services/notificationService';

export const DRIVER_RIDE_REQUEST_QUEUE_STORAGE_KEY = 'smartride.pendingDriverRideRequests';
export const DRIVER_RIDE_REQUEST_SEEN_NOTIFICATION_IDS_STORAGE_KEY = 'smartride.seenDriverRideRequestNotificationIds';
export const DRIVER_RIDE_REQUEST_NEARBY_DISTANCE_KM = 3;

function normalizeStorageScopeKey(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  return normalizedValue ? encodeURIComponent(normalizedValue) : 'global';
}

function getSeenNotificationIdsStorageKey(scopeKey = '') {
  return `${DRIVER_RIDE_REQUEST_SEEN_NOTIFICATION_IDS_STORAGE_KEY}.${normalizeStorageScopeKey(scopeKey)}`;
}

function getDriverRideRequestQueueStorageKey(scopeKey = '') {
  const normalizedScopeKey = normalizeStorageScopeKey(scopeKey);

  return normalizedScopeKey === 'global'
    ? DRIVER_RIDE_REQUEST_QUEUE_STORAGE_KEY
    : `${DRIVER_RIDE_REQUEST_QUEUE_STORAGE_KEY}.${normalizedScopeKey}`;
}

function normalizeCoordinate(value) {
  const coordinate = Number(value);

  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const latitude = normalizeCoordinate(position.lat ?? position.latitude);
  const longitude = normalizeCoordinate(position.lng ?? position.longitude ?? position.lon);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { lat: latitude, lng: longitude };
}

function normalizeIdentifier(value) {
  const identifier = Number(value);

  return Number.isInteger(identifier) && identifier > 0 ? identifier : null;
}

function parseRideRequestContent(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(trimmedContent);

    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return null;
    }

    if (String(parsedValue.type ?? '').trim().toLowerCase() !== 'ride_request') {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

function normalizeLocationRecord(location) {
  if (!location || typeof location !== 'object') {
    return { label: '', position: null };
  }

  return {
    label: String(location.label ?? location.description ?? location.main_text ?? '').trim(),
    position: normalizePosition(location.position ?? location),
  };
}

function normalizeNotificationRideRequest(notification) {
  if (!notification || typeof notification !== 'object') {
    return null;
  }

  return normalizeRideRequest({
    ...notification,
    id: notification.id,
    notificationId: notification.id,
    title: notification.title,
    content: notification.content,
    createdAt: notification.createdAt,
    status: notification.status,
  });
}

export function calculateDistanceKm(leftPosition, rightPosition) {
  const origin = normalizePosition(leftPosition);
  const destination = normalizePosition(rightPosition);

  if (!origin || !destination) {
    return null;
  }

  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = radians(destination.lat - origin.lat);
  const deltaLng = radians(destination.lng - origin.lng);
  const startLat = radians(origin.lat);
  const endLat = radians(destination.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.sin(deltaLng / 2) ** 2 * Math.cos(startLat) * Math.cos(endLat);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeRideRequest(request) {
  if (!request || typeof request !== 'object') {
    return null;
  }

  const parsedRideRequest = parseRideRequestContent(request.content);
  const sourceRequest = parsedRideRequest ?? request;
  const bookingCode = String(sourceRequest.bookingCode ?? request.bookingCode ?? request.requestId ?? '').trim();

  if (!bookingCode) {
    return null;
  }

  const notificationId = normalizeIdentifier(
    sourceRequest.notificationId
    ?? sourceRequest.driverRequestNotificationId
    ?? request.notificationId
    ?? request.driverRequestNotificationId
    ?? request.id,
  );
  const pickup = normalizeLocationRecord(sourceRequest.pickup ?? request.pickup);
  const destination = normalizeLocationRecord(sourceRequest.destination ?? request.destination);
  const routeGeometrySource = Array.isArray(sourceRequest.routeGeometry)
    ? sourceRequest.routeGeometry
    : Array.isArray(request.routeGeometry)
      ? request.routeGeometry
      : [];

  return {
    requestId: bookingCode,
    bookingCode,
    notificationId,
    accountId: String(sourceRequest.accountId ?? request.accountId ?? '').trim() || null,
    customerAccountId: String(sourceRequest.customerAccountId ?? request.customerAccountId ?? request.accountId ?? '').trim() || null,
    driverAccountId: String(sourceRequest.driverAccountId ?? request.driverAccountId ?? '').trim() || null,
    notificationTitle: String(request.title ?? sourceRequest.notificationTitle ?? '').trim(),
    notificationContent: String(request.content ?? sourceRequest.notificationContent ?? '').trim(),
    createdAt: String(sourceRequest.createdAt ?? request.createdAt ?? new Date().toISOString()),
    customerName: String(sourceRequest.customerName ?? request.customerName ?? '').trim(),
    customerPhone: String(sourceRequest.customerPhone ?? request.customerPhone ?? '').trim(),
    vehicleLabel: String(sourceRequest.vehicleLabel ?? sourceRequest.rideTitle ?? request.vehicleLabel ?? request.rideTitle ?? '').trim(),
    rideTitle: String(sourceRequest.rideTitle ?? sourceRequest.vehicleLabel ?? request.rideTitle ?? request.vehicleLabel ?? '').trim(),
    pickup,
    destination,
    routeGeometry: routeGeometrySource
      .map((point) => normalizePosition(point))
      .filter(Boolean),
    routeProvider: String(sourceRequest.routeProvider ?? request.routeProvider ?? 'haversine').trim() || 'haversine',
    routeDistanceKm: Number.isFinite(Number(sourceRequest.routeDistanceKm ?? request.routeDistanceKm))
      ? Number(sourceRequest.routeDistanceKm ?? request.routeDistanceKm)
      : null,
    etaMinutes: Number.isFinite(Number(sourceRequest.etaMinutes ?? request.etaMinutes))
      ? Number(sourceRequest.etaMinutes ?? request.etaMinutes)
      : null,
    priceFormatted: String(sourceRequest.priceFormatted ?? request.priceFormatted ?? '').trim(),
    paymentSummary: String(sourceRequest.paymentSummary ?? request.paymentSummary ?? '').trim(),
    source: String(sourceRequest.source ?? request.source ?? (notificationId ? 'notification' : 'manual')).trim() || 'manual',
    status: String(sourceRequest.status ?? request.status ?? 'pending').trim().toLowerCase() || 'pending',
  };
}

function normalizeAccountId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isOwnRideRequest(request, accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);

  if (!normalizedAccountId) {
    return false;
  }

  const ownerAccountId = normalizeAccountId(request?.customerAccountId ?? request?.accountId);

  return Boolean(ownerAccountId && ownerAccountId === normalizedAccountId);
}

function readStoredNotificationIds(scopeKey = '') {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(getSeenNotificationIdsStorageKey(scopeKey));

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.map(normalizeIdentifier).filter(Boolean);
  } catch {
    try {
      window.localStorage.removeItem(getSeenNotificationIdsStorageKey(scopeKey));
    } catch {
      // Ignore cleanup failures.
    }

    return [];
  }
}

function saveStoredNotificationIds(notificationIds, scopeKey = '') {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      getSeenNotificationIdsStorageKey(scopeKey),
      JSON.stringify(notificationIds),
    );
  } catch {
    // Ignore storage failures.
  }
}

export function readSeenDriverRideRequestNotificationIds(scopeKey = '') {
  return readStoredNotificationIds(scopeKey);
}

export function markDriverRideRequestNotificationSeen(notificationId, scopeKey = '') {
  const normalizedNotificationId = normalizeIdentifier(notificationId);

  if (!normalizedNotificationId) {
    return false;
  }

  const notificationIds = new Set(readStoredNotificationIds(scopeKey));

  if (notificationIds.has(normalizedNotificationId)) {
    return false;
  }

  notificationIds.add(normalizedNotificationId);
  saveStoredNotificationIds(Array.from(notificationIds), scopeKey);

  return true;
}

function readStoredQueue(scopeKey = '') {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(getDriverRideRequestQueueStorageKey(scopeKey));

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.map(normalizeRideRequest).filter(Boolean);
  } catch {
    try {
      window.localStorage.removeItem(getDriverRideRequestQueueStorageKey(scopeKey));
    } catch {
      // Ignore cleanup failures.
    }

    return [];
  }
}

function saveQueue(queue, scopeKey = '') {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getDriverRideRequestQueueStorageKey(scopeKey), JSON.stringify(queue));
  } catch {
    // Ignore storage failures.
  }
}

export function readDriverRideRequestQueue(scopeKey = '') {
  return readStoredQueue(scopeKey);
}

async function readDriverRideRequestQueueFromNotifications({ signal, accountId } = {}) {
  const response = await notificationService.listNotifications(
    { recipient: 'driver', status: 'sent' },
    { signal },
  );
  const normalizedAccountId = normalizeAccountId(accountId);
  const seenNotificationIds = new Set(readStoredNotificationIds(accountId));
  const notifications = Array.isArray(response?.notifications) ? response.notifications : [];

  return notifications
    .map(normalizeNotificationRideRequest)
    .filter(Boolean)
    .filter((request) => !request.notificationId || !seenNotificationIds.has(request.notificationId))
    .filter((request) => !normalizedAccountId || !isOwnRideRequest(request, normalizedAccountId));
}

export async function loadDriverRideRequestQueue(options = {}) {
  const accountId = String(options?.accountId ?? '').trim();

  try {
    const remoteQueue = await readDriverRideRequestQueueFromNotifications(options);
    const localQueue = readStoredQueue(accountId);
    const mergedQueue = [...remoteQueue];

    localQueue
      .filter((request) => !accountId || !isOwnRideRequest(request, accountId))
      .forEach((request) => {
      if (!mergedQueue.some((item) => item.requestId === request.requestId)) {
        mergedQueue.push(request);
      }
      });

    return mergedQueue;
  } catch {
    const fallbackQueue = readStoredQueue(accountId);

    return accountId
      ? fallbackQueue.filter((request) => !isOwnRideRequest(request, accountId))
      : fallbackQueue;
  }
}

export async function consumeDriverRideRequest(request, options = {}) {
  const normalizedRequestId = String(request?.requestId ?? '').trim();
  const normalizedNotificationId = normalizeIdentifier(request?.notificationId);
  const accountId = String(options?.accountId ?? '').trim();
  let remoteDeleteSucceeded = false;

  if (normalizedNotificationId) {
    try {
      await notificationService.deleteNotification(normalizedNotificationId);
      remoteDeleteSucceeded = true;
    } catch (error) {
      remoteDeleteSucceeded = Number(error?.statusCode) === 404;
    }

    if (!remoteDeleteSucceeded) {
      return false;
    }

    try {
      markDriverRideRequestNotificationSeen(normalizedNotificationId, accountId);
    } catch {
      // Ignore local storage failures after the backend request has been cleared.
    }
  }

  if (normalizedRequestId && remoteDeleteSucceeded) {
    removeDriverRideRequest(normalizedRequestId, accountId);
  }

  if (!normalizedNotificationId && normalizedRequestId) {
    removeDriverRideRequest(normalizedRequestId, accountId);
    return true;
  }

  return remoteDeleteSucceeded;
}

export function enqueueDriverRideRequest(request, options = {}) {
  const normalizedRequest = normalizeRideRequest(request);
  const accountId = String(options?.accountId ?? '').trim();

  if (!normalizedRequest) {
    return null;
  }

  if (accountId && isOwnRideRequest(normalizedRequest, accountId)) {
    return null;
  }

  const queue = readStoredQueue(accountId).filter((item) => item.requestId !== normalizedRequest.requestId);
  queue.unshift(normalizedRequest);
  saveQueue(queue, accountId);

  return normalizedRequest;
}

export function removeDriverRideRequest(requestId, scopeKey = '') {
  const normalizedRequestId = String(requestId ?? '').trim();

  if (!normalizedRequestId) {
    return false;
  }

  const queue = readStoredQueue(scopeKey);
  const nextQueue = queue.filter((item) => item.requestId !== normalizedRequestId);

  if (nextQueue.length === queue.length) {
    return false;
  }

  saveQueue(nextQueue, scopeKey);
  return true;
}

export function findNearbyDriverRideRequest(queue, driverPosition, maxDistanceKm = DRIVER_RIDE_REQUEST_NEARBY_DISTANCE_KM) {
  const candidateQueue = Array.isArray(queue) ? queue : [];

  if (candidateQueue.length === 0) {
    return null;
  }

  if (!driverPosition) {
    return {
      request: candidateQueue[0],
      distanceKm: null,
    };
  }

  let bestMatch = null;

  candidateQueue.forEach((request) => {
    const distanceKm = calculateDistanceKm(driverPosition, request?.pickup?.position);

    if (!Number.isFinite(distanceKm)) {
      return;
    }

    if (distanceKm <= maxDistanceKm && (!bestMatch || distanceKm < bestMatch.distanceKm)) {
      bestMatch = {
        request,
        distanceKm,
      };
    }
  });

  if (bestMatch) {
    return bestMatch;
  }

  return {
    request: candidateQueue[0],
    distanceKm: null,
  };
}
