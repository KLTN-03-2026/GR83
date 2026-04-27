import { io } from 'socket.io-client';

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api').trim();

function getSocketBaseUrl() {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, '');

  if (normalizedApiBaseUrl.toLowerCase().endsWith('/api')) {
    return normalizedApiBaseUrl.slice(0, -4);
  }

  return normalizedApiBaseUrl;
}

function normalizeRideEventPayload(eventName, payload) {
  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      type: String(payload.type ?? eventName).trim() || eventName,
    };
  }

  return {
    type: eventName,
    payload,
  };
}

export function createRideSocketConnection({ accountId = '', roleCode = '', onEvent, onError, onConnect, onDisconnect } = {}) {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!String(accountId ?? '').trim() || !String(roleCode ?? '').trim()) {
    return null;
  }

  let socket;

  try {
    socket = io(getSocketBaseUrl(), {
      transports: ['websocket', 'polling'],
      query: {
        accountId: String(accountId).trim(),
        roleCode: String(roleCode).trim(),
      },
    });
  } catch (error) {
    onError?.(error);
    return null;
  }

  socket.on('connect', () => {
    onConnect?.(socket);
  });

  socket.on('connect_error', (error) => {
    onError?.(error);
  });

  socket.on('disconnect', (reason) => {
    onDisconnect?.(reason);
  });

  socket.onAny((eventName, payload) => {
    if (!String(eventName ?? '').startsWith('ride.')) {
      return;
    }

    onEvent?.(normalizeRideEventPayload(eventName, payload));
  });

  return socket;
}

export function connectRideEventStream({ accountId = '', roleCode = '', onEvent, onError } = {}) {
  const socket = createRideSocketConnection({
    accountId,
    roleCode,
    onEvent,
    onError,
  });

  if (!socket) {
    return () => {};
  }

  return () => {
    socket.removeAllListeners();
    socket.disconnect();
  };
}
