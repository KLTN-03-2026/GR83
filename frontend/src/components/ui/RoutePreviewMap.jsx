import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';

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

function buildPointSignature(point) {
  if (!point) {
    return 'none';
  }

  return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
}

function createPointIcon(type) {
  const labelByType = {
    pickup: 'A',
    destination: 'B',
    driver: 'T',
  };
  const isDriver = type === 'driver';
  const iconSize = isDriver ? [28, 28] : [24, 24];
  const iconAnchor = isDriver ? [14, 14] : [12, 12];

  return L.divIcon({
    className: `route-preview-map__point route-preview-map__point--${type}`,
    html: `<span>${labelByType[type] ?? '•'}</span>`,
    iconSize,
    iconAnchor,
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
    return 'Đường thẳng (dự phòng)';
  }

  return 'Dự phòng';
}

function renderRouteMap(container, pathPoints, pickup, destination, liveMarker, interactive) {
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

  if (liveMarker) {
    L.marker(liveMarker, { icon: createPointIcon('driver') }).addTo(map);
  }

  const boundsPoints = [...pathPoints, pickup, destination, liveMarker].filter(Boolean);

  if (boundsPoints.length >= 2) {
    const bounds = L.latLngBounds(boundsPoints);
    map.fitBounds(bounds, {
      padding: interactive ? [32, 32] : [20, 20],
      maxZoom: interactive ? 17 : 15,
    });
  } else if (boundsPoints.length === 1) {
    map.setView(boundsPoints[0], interactive ? 16 : 15);
  }

  return map;
}

export default function RoutePreviewMap({
  pickupPosition,
  destinationPosition,
  liveMarkerPosition = null,
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

  const pickup = useMemo(
    () => normalizePosition(pickupPosition),
    [pickupPosition?.lat, pickupPosition?.latitude, pickupPosition?.lng, pickupPosition?.longitude, pickupPosition?.lon],
  );
  const destination = useMemo(
    () => normalizePosition(destinationPosition),
    [destinationPosition?.lat, destinationPosition?.latitude, destinationPosition?.lng, destinationPosition?.longitude, destinationPosition?.lon],
  );
  const liveMarker = useMemo(
    () => normalizePosition(liveMarkerPosition),
    [liveMarkerPosition?.lat, liveMarkerPosition?.latitude, liveMarkerPosition?.lng, liveMarkerPosition?.longitude, liveMarkerPosition?.lon],
  );

  const pathPoints = useMemo(() => {
    const points = normalizeRouteGeometry(routeGeometry);

    if (points.length >= 2) {
      return points;
    }

    if (pickup && destination) {
      return [pickup, destination];
    }

    if (liveMarker && pickup) {
      return [liveMarker, pickup];
    }

    if (liveMarker && destination) {
      return [liveMarker, destination];
    }

    return [];
  }, [destination?.lat, destination?.lng, liveMarker?.lat, liveMarker?.lng, pickup?.lat, pickup?.lng, routeGeometry]);

  const mapDataSignature = useMemo(() => {
    const pathSignature = pathPoints.map((point) => buildPointSignature(point)).join('|');

    return [
      pathSignature,
      buildPointSignature(pickup),
      buildPointSignature(destination),
      buildPointSignature(liveMarker),
    ].join('::');
  }, [destination, liveMarker, pathPoints, pickup]);

  useEffect(() => {
    if (!previewMapContainerRef.current || pathPoints.length < 2) {
      return undefined;
    }

    const map = renderRouteMap(previewMapContainerRef.current, pathPoints, pickup, destination, liveMarker, false);
    previewMapRef.current = map;

    return () => {
      map.remove();
      previewMapRef.current = null;
    };
  }, [mapDataSignature]);

  useEffect(() => {
    if (!isExpanded || !expandedMapContainerRef.current || pathPoints.length < 2) {
      return undefined;
    }

    const map = renderRouteMap(expandedMapContainerRef.current, pathPoints, pickup, destination, liveMarker, true);
    expandedMapRef.current = map;

    const resizeId = window.setTimeout(() => {
      map.invalidateSize();
    }, 50);

    return () => {
      window.clearTimeout(resizeId);
      map.remove();
      expandedMapRef.current = null;
    };
  }, [isExpanded, mapDataSignature]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const releaseBodyScrollLock = acquireBodyScrollLock();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseBodyScrollLock();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  if (pathPoints.length < 2) {
    return (
      <div className="route-preview-map route-preview-map--empty">
        <p>Chưa có dữ liệu tuyến đường để hiển thị bản đồ.</p>
      </div>
    );
  }

  return (
    <>
      <div className={["route-preview-map", className, pathPoints.length < 2 ? 'route-preview-map--empty' : ''].filter(Boolean).join(' ')} aria-label="Bản đồ tuyến đường">
        <div className="route-preview-map__canvas" ref={previewMapContainerRef} />
        {showProviderLabel ? <span className="route-preview-map__provider">Tuyến đường: {getProviderLabel(routeProvider)}</span> : null}
        {showExpandButton ? (
          <button
            className="route-preview-map__expand"
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-label="Phóng to bản đồ"
          >
            Phóng to
          </button>
        ) : null}
      </div>

      {isExpanded
        ? createPortal(
            <div className="route-preview-modal" role="dialog" aria-modal="true" aria-label="Bản đồ tuyến đường mở rộng">
              <div className="route-preview-modal__backdrop" onClick={() => setIsExpanded(false)} aria-hidden="true" />

              <div className="route-preview-modal__panel">
                <div className="route-preview-modal__header">
                  <strong>Bản đồ tuyến đường</strong>

                  <button
                    className="route-preview-modal__close"
                    type="button"
                    onClick={() => setIsExpanded(false)}
                    aria-label="Đóng bản đồ"
                  >
                    Đóng
                  </button>
                </div>

                <div className="route-preview-modal__canvas" ref={expandedMapContainerRef} />

                <p className="route-preview-modal__note">
                  Sử dụng cuộn chuột để zoom và kéo để di chuyển bản đồ.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
