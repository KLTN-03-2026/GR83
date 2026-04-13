import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.longitude ?? position.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function normalizeRouteGeometry(routeGeometry) {
  if (!Array.isArray(routeGeometry)) {
    return [];
  }

  return routeGeometry.map(normalizePosition).filter(Boolean);
}

function createPointIcon(type) {
  const isPickup = type === 'pickup';

  return L.divIcon({
    className: `route-preview-map__point route-preview-map__point--${type}`,
    html: `<span>${isPickup ? 'A' : 'B'}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function getProviderLabel(routeProvider) {
  if (routeProvider === 'google-directions') {
    return 'Google Directions';
  }

  if (routeProvider === 'osrm') {
    return 'OSRM';
  }

  if (routeProvider === 'haversine') {
    return 'Duong thang (fallback)';
  }

  return 'Fallback';
}

function renderRouteMap(container, pathPoints, pickup, destination, interactive) {
  const map = L.map(container, {
    zoomControl: interactive,
    attributionControl: interactive,
    dragging: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
    tap: interactive,
    touchZoom: interactive,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
  }).addTo(map);

  L.polyline(pathPoints, {
    color: '#0f766e',
    weight: interactive ? 6 : 5,
    opacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  if (pickup) {
    L.marker(pickup, { icon: createPointIcon('pickup') }).addTo(map);
  }

  if (destination) {
    L.marker(destination, { icon: createPointIcon('destination') }).addTo(map);
  }

  const bounds = L.latLngBounds(pathPoints);
  map.fitBounds(bounds, {
    padding: interactive ? [32, 32] : [20, 20],
    maxZoom: interactive ? 17 : 15,
  });

  return map;
}

export default function RoutePreviewMap({
  pickupPosition,
  destinationPosition,
  routeGeometry,
  routeProvider,
  className = '',
  showProviderLabel = true,
  showExpandButton = true,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewMapRef = useRef(null);
  const expandedMapRef = useRef(null);
  const previewMapContainerRef = useRef(null);
  const expandedMapContainerRef = useRef(null);

  const pickup = normalizePosition(pickupPosition);
  const destination = normalizePosition(destinationPosition);

  const pathPoints = useMemo(() => {
    const points = normalizeRouteGeometry(routeGeometry);

    if (points.length >= 2) {
      return points;
    }

    if (pickup && destination) {
      return [pickup, destination];
    }

    return [];
  }, [destination, pickup, routeGeometry]);

  useEffect(() => {
    if (!previewMapContainerRef.current || pathPoints.length < 2) {
      return undefined;
    }

    const map = renderRouteMap(previewMapContainerRef.current, pathPoints, pickup, destination, false);
    previewMapRef.current = map;

    return () => {
      map.remove();
      previewMapRef.current = null;
    };
  }, [destination, pathPoints, pickup]);

  useEffect(() => {
    if (!isExpanded || !expandedMapContainerRef.current || pathPoints.length < 2) {
      return undefined;
    }

    const map = renderRouteMap(expandedMapContainerRef.current, pathPoints, pickup, destination, true);
    expandedMapRef.current = map;

    const resizeId = window.setTimeout(() => {
      map.invalidateSize();
    }, 50);

    return () => {
      window.clearTimeout(resizeId);
      map.remove();
      expandedMapRef.current = null;
    };
  }, [destination, isExpanded, pathPoints, pickup]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  if (pathPoints.length < 2) {
    return (
      <div className="route-preview-map route-preview-map--empty">
        <p>Chua co du lieu tuyen duong de hien thi ban do.</p>
      </div>
    );
  }

  return (
    <>
      <div className={["route-preview-map", className, pathPoints.length < 2 ? 'route-preview-map--empty' : ''].filter(Boolean).join(' ')} aria-label="Ban do tuyen duong">
        <div className="route-preview-map__canvas" ref={previewMapContainerRef} />
        {showProviderLabel ? <span className="route-preview-map__provider">Tuyen duong: {getProviderLabel(routeProvider)}</span> : null}
        {showExpandButton ? (
          <button
            className="route-preview-map__expand"
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-label="Phong to ban do"
          >
            Phong to
          </button>
        ) : null}
      </div>

      {isExpanded
        ? createPortal(
            <div className="route-preview-modal" role="dialog" aria-modal="true" aria-label="Ban do tuyen duong mo rong">
              <div className="route-preview-modal__backdrop" onClick={() => setIsExpanded(false)} aria-hidden="true" />

              <div className="route-preview-modal__panel">
                <div className="route-preview-modal__header">
                  <strong>Ban do tuyen duong</strong>

                  <button
                    className="route-preview-modal__close"
                    type="button"
                    onClick={() => setIsExpanded(false)}
                    aria-label="Dong ban do"
                  >
                    Dong
                  </button>
                </div>

                <div className="route-preview-modal__canvas" ref={expandedMapContainerRef} />

                <p className="route-preview-modal__note">
                  Su dung cuon chuot de zoom va keo de di chuyen ban do.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
