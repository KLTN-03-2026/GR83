const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

function buildRideEventStreamUrl({ accountId = '', roleCode = '' } = {}) {
  const searchParams = new URLSearchParams();

  if (String(accountId ?? '').trim()) {
    searchParams.set('accountId', String(accountId).trim());
  }

  if (String(roleCode ?? '').trim()) {
    searchParams.set('roleCode', String(roleCode).trim());
  }

  const queryString = searchParams.toString();
  return queryString ? `${apiBaseUrl}/rides/stream?${queryString}` : `${apiBaseUrl}/rides/stream`;
}

export function connectRideEventStream({ accountId = '', roleCode = '', onEvent, onError } = {}) {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    return () => {};
  }

  if (!String(accountId ?? '').trim() || !String(roleCode ?? '').trim()) {
    return () => {};
  }

  let source;

  try {
    source = new EventSource(buildRideEventStreamUrl({ accountId, roleCode }));
  } catch (error) {
    onError?.(error);
    return () => {};
  }

  const handleEvent = (event) => {
    if (!event?.data) {
      return;
    }

    try {
      const parsedValue = JSON.parse(event.data);
      onEvent?.(parsedValue);
    } catch (error) {
      onError?.(error);
    }
  };

  source.addEventListener('ride.booking.created', handleEvent);
  source.addEventListener('ride.trip.status.updated', handleEvent);
  source.addEventListener('ride.trip.message.created', handleEvent);
  source.addEventListener('ride.event', handleEvent);
  source.onmessage = handleEvent;
  source.onerror = (error) => {
    onError?.(error);
  };

  return () => {
    source?.close();
  };
}