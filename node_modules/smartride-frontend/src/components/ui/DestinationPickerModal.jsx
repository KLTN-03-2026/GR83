import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { closeIcon, locationIcon } from '../../assets/icons';
import { DA_NANG_AIRPORT } from '../../data/defaultLocations';
import { reverseGeocodeCoordinates, searchGooglePlaces } from '../../services/googlePlacesService';
import { loadGoogleMapsApi } from '../../services/googleMapsLoader';

const DEFAULT_CENTER = {
  lat: DA_NANG_AIRPORT.position.lat,
  lng: DA_NANG_AIRPORT.position.lng,
};
const PLACES_SEARCH_TIMEOUT_MS = 7000;

let googleMapsRenderAvailable = true;

function getPlaceDetails(placesService, placeId) {
  return new Promise((resolve, reject) => {
    placesService.getDetails(
      {
        placeId,
        fields: ['place_id', 'formatted_address', 'geometry', 'name'],
      },
      (place, status) => {
        if (status === 'OK' && place) {
          resolve(place);
          return;
        }

        if (status === 'ZERO_RESULTS') {
          resolve(null);
          return;
        }

        reject(new Error(`Google Places trả về trạng thái ${status}`));
      },
    );
  });
}

function toLatLngLiteral(latLng) {
  return {
    lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
    lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng,
  };
}

function formatCoordinates(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function isCoordinateLikeLabel(label) {
  const normalized = String(label ?? '').trim();
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(normalized);
}

function calculateDistanceMeters(from, to) {
  const fromLat = Number(from?.lat);
  const fromLng = Number(from?.lng);
  const toLat = Number(to?.lat);
  const toLng = Number(to?.lng);

  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
    return null;
  }

  const earthRadius = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}

function canUseReverseLabel(reverseResult, targetPosition) {
  const label = String(reverseResult?.label ?? '').trim();

  if (!label || isCoordinateLikeLabel(label)) {
    return false;
  }

  const distance = calculateDistanceMeters(targetPosition, {
    lat: reverseResult?.lat,
    lng: reverseResult?.lng,
  });

  if (distance === null) {
    return true;
  }

  return distance <= 700;
}

function looksLikeStreetLevelLabel(label) {
  const raw = String(label ?? '').trim();
  const normalized = raw.toLowerCase();

  if (!raw || isCoordinateLikeLabel(raw)) {
    return false;
  }

  if (raw.length < 5) {
    return false;
  }

  const hasStreetKeyword = /\b(số|so)\s*\d+|đường|street|road|lane|alley|ngõ|hẻm|phố|avenue|boulevard|way|rd|st\b/u.test(normalized);
  const hasHouseNumber = /\b\d+[a-z0-9\/.-]*\b/u.test(normalized);
  const hasMultipleParts = (raw.match(/,/g) || []).length >= 1;

  return (
    (hasStreetKeyword && (hasHouseNumber || hasMultipleParts))
    || (hasHouseNumber && hasMultipleParts)
  );
}

function normalizeIncomingLocation(value, mode) {
  if (typeof value === 'string') {
    const label = String(value).trim();
    return label ? { label, position: null, kind: mode, source: 'manual' } : null;
  }

  const label = String(value?.label ?? '').trim();
  const lat = Number(value?.position?.lat);
  const lng = Number(value?.position?.lng);
  const position = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  if (!label && !position) {
    return null;
  }

  return {
    label: label || (position ? formatCoordinates(position.lat, position.lng) : ''),
    position,
    kind: value?.kind ?? mode,
    source: value?.source ?? 'manual',
  };
}

function createLeafletMarkerIcon() {
  return L.divIcon({
    className: 'smartride-leaflet-marker',
    html: '<div style="width:18px;height:18px;background:#ef4444;border:3px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 10px 20px rgba(0,0,0,.25);transform:rotate(-45deg);"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

export default function DestinationPickerModal({ open, value, onClose, onSelect, mode = 'destination' }) {
  const [query, setQuery] = useState(() => normalizeIncomingLocation(value, mode)?.label ?? '');
  const [predictions, setPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolvingCurrentLocation, setIsResolvingCurrentLocation] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [previewLocation, setPreviewLocation] = useState(null);

  const mapContainerRef = useRef(null);
  const googleMapRef = useRef(null);
  const googleMarkerRef = useRef(null);
  const googlePlacesServiceRef = useRef(null);
  const googlePlacesContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletMarkerRef = useRef(null);
  const mapProviderRef = useRef('none');
  const listenersRef = useRef([]);
  const authFailureObserverRef = useRef(null);
  const reverseGeocodeRequestIdRef = useRef(0);
  const autoCommitTimeoutRef = useRef(null);
  const skipNextSearchRef = useRef(false);

  const setQueryFromSelection = (value) => {
    skipNextSearchRef.current = true;
    setQuery(value);
  };

  const clearAutoCommitTimeout = () => {
    if (autoCommitTimeoutRef.current) {
      window.clearTimeout(autoCommitTimeoutRef.current);
      autoCommitTimeoutRef.current = null;
    }
  };

  const focusMapOnLocation = (position) => {
    if (!position) {
      return;
    }

    if (mapProviderRef.current === 'google' && googleMapRef.current && googleMarkerRef.current) {
      googleMarkerRef.current.setPosition(position);
      googleMapRef.current.panTo(position);
      googleMapRef.current.setZoom(16);
      return;
    }

    if (mapProviderRef.current === 'leaflet' && leafletMapRef.current && leafletMarkerRef.current) {
      leafletMarkerRef.current.setLatLng(position);
      leafletMapRef.current.panTo(position);
      leafletMapRef.current.setZoom(16);
    }
  };

  const commitSelection = (selection) => {
    const label = String(selection?.label ?? '').trim();

    if (!label) {
      return;
    }

    const position = selection?.position
      ? {
          lat: Number(selection.position.lat),
          lng: Number(selection.position.lng),
        }
      : null;

    const normalizedSelection = {
      label,
      position,
      kind: selection?.kind ?? mode,
      source: selection?.source ?? 'manual',
    };

    setSelectedLocation(normalizedSelection);
    setQueryFromSelection(label);
    setPredictions([]);
    setError('');
    setMapError('');
    onSelect(normalizedSelection);
    onClose();
  };

  const applySelection = (label, position = null) => {
    const normalizedSelection = {
      label,
      position,
      kind: mode,
      source: 'search',
    };

    setSelectedLocation(normalizedSelection);
    setQueryFromSelection(label);
    setPredictions([]);
    setError('');
    setMapError('');
    focusMapOnLocation(position);
  };

  const clearMapInstances = () => {
    clearAutoCommitTimeout();

    listenersRef.current.forEach((listener) => {
      if (typeof listener?.remove === 'function') {
        listener.remove();
      }
    });
    listenersRef.current = [];

    if (authFailureObserverRef.current) {
      authFailureObserverRef.current.disconnect();
      authFailureObserverRef.current = null;
    }

    if (googleMarkerRef.current) {
      googleMarkerRef.current.setMap(null);
      googleMarkerRef.current = null;
    }

    if (googlePlacesContainerRef.current) {
      googlePlacesContainerRef.current.remove();
      googlePlacesContainerRef.current = null;
    }

    if (leafletMarkerRef.current) {
      leafletMapRef.current?.removeLayer(leafletMarkerRef.current);
      leafletMarkerRef.current = null;
    }

    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    googleMapRef.current = null;
    googlePlacesServiceRef.current = null;
    mapProviderRef.current = 'none';

    if (mapContainerRef.current) {
      mapContainerRef.current.replaceChildren();
    }
  };

  useEffect(() => {
    if (!open) {
      clearAutoCommitTimeout();
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      clearAutoCommitTimeout();
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    const initialLocation = normalizeIncomingLocation(value, mode);

    if (!open) {
      return;
    }

    setQueryFromSelection(initialLocation?.label ?? '');
    setPredictions([]);
    setError('');
    setMapError('');
    setMapReady(false);
    setSelectedLocation(initialLocation);
    setPreviewLocation(null);
  }, [mode, open, value]);

  useEffect(() => {
    if (open) {
      return;
    }

    setIsLoading(false);
    setIsResolvingCurrentLocation(false);
    setPredictions([]);
    setError('');
    setMapError('');
    setMapReady(false);
    setSelectedLocation(null);
    setPreviewLocation(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const initialLocation = normalizeIncomingLocation(value, mode);

    let cancelled = false;
    const abortController = new AbortController();

    const syncLocation = async (latLng) => {
      if (cancelled) {
        return;
      }

      const fallbackLabel = formatCoordinates(latLng.lat, latLng.lng);
      const currentRequestId = reverseGeocodeRequestIdRef.current + 1;
      reverseGeocodeRequestIdRef.current = currentRequestId;

      applySelection(fallbackLabel, latLng);

      try {
        const reverseResult = await reverseGeocodeCoordinates(latLng.lat, latLng.lng, {
          signal: abortController.signal,
        });

        if (cancelled || currentRequestId !== reverseGeocodeRequestIdRef.current) {
          return;
        }

        const resolvedLabel = String(reverseResult?.label ?? '').trim();

        if (canUseReverseLabel(reverseResult, latLng)) {
          applySelection(resolvedLabel, latLng);
        }
      } catch (error) {
        if (error?.name === 'AbortError' || cancelled || currentRequestId !== reverseGeocodeRequestIdRef.current) {
          return;
        }
      }
    };

    const centerMapFromQuery = async (initialQuery) => {
      if (!initialQuery || cancelled) {
        return;
      }

      try {
        const results = await searchGooglePlaces(initialQuery, { signal: abortController.signal });

        if (cancelled) {
          return;
        }

        const firstResult = results[0];
        const latitude = Number(firstResult?.lat);
        const longitude = Number(firstResult?.lng);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }

        applySelection(firstResult.description ?? firstResult.main_text ?? initialQuery, {
          lat: latitude,
          lng: longitude,
        });
      } catch (error) {
        if (error?.name === 'AbortError' || cancelled) {
          return;
        }

        // Keep the default center if the lookup fails.
      }
    };

    const initializeGoogleMap = async (google) => {
      clearMapInstances();

      if (cancelled || !mapContainerRef.current) {
        return;
      }

      const map = new google.maps.Map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });

      const marker = new google.maps.Marker({
        map,
        position: DEFAULT_CENTER,
        draggable: true,
        animation: google.maps.Animation.DROP,
      });

      googleMapRef.current = map;
      googleMarkerRef.current = marker;
      googlePlacesServiceRef.current = google.maps.places?.PlacesService ? new google.maps.places.PlacesService(map) : null;
      mapProviderRef.current = 'google';
      setMapReady(true);
      setMapError('');

      const container = mapContainerRef.current;

      if (container) {
        const observer = new MutationObserver(() => {
          const hasGoogleError = container.querySelector(
            '.gm-err-container, .gm-err-content, .gm-err-title, .gm-err-message',
          );

          if (hasGoogleError) {
            observer.disconnect();
            authFailureObserverRef.current = null;
            googleMapsRenderAvailable = false;
            window.setTimeout(() => {
              if (!cancelled) {
                void initializeLeafletMap('Google Maps không khả dụng. Đang dùng bản đồ dự phòng.');
              }
            }, 0);
          }
        });

        observer.observe(container, {
          childList: true,
          subtree: true,
        });

        authFailureObserverRef.current = observer;
      }

      const handleMapClick = (event) => {
        if (event.latLng) {
          void syncLocation(toLatLngLiteral(event.latLng));
        }
      };

      const handleMarkerDragEnd = () => {
        const position = marker.getPosition();

        if (position) {
          void syncLocation(toLatLngLiteral(position));
        }
      };

      listenersRef.current = [map.addListener('click', handleMapClick), marker.addListener('dragend', handleMarkerDragEnd)];

      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        google.maps.event.trigger(map, 'resize');
        map.setCenter(DEFAULT_CENTER);
      });

      if (initialLocation?.position) {
        applySelection(initialLocation.label, initialLocation.position);
        focusMapOnLocation(initialLocation.position);
        return;
      }

      await centerMapFromQuery(initialLocation?.label ?? '');
    };

    const initializeLeafletMap = async (statusMessage = 'Google Maps chưa sẵn sàng. Đang dùng bản đồ dự phòng.') => {
      clearMapInstances();

      if (cancelled || !mapContainerRef.current) {
        return;
      }

      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const marker = L.marker(DEFAULT_CENTER, {
        draggable: true,
        icon: createLeafletMarkerIcon(),
      }).addTo(map);

      leafletMapRef.current = map;
      leafletMarkerRef.current = marker;
      if (window.google?.maps?.places?.PlacesService) {
        const container = document.createElement('div');
        container.setAttribute('aria-hidden', 'true');
        container.style.position = 'absolute';
        container.style.width = '1px';
        container.style.height = '1px';
        container.style.overflow = 'hidden';
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        container.style.left = '-9999px';
        document.body.appendChild(container);
        googlePlacesContainerRef.current = container;
        googlePlacesServiceRef.current = new window.google.maps.places.PlacesService(container);
      }
      mapProviderRef.current = 'leaflet';
      setMapReady(true);
      setMapError(statusMessage);

      const handleMapClick = (event) => {
        void syncLocation(event.latlng);
      };

      const handleMarkerDragEnd = () => {
        const position = marker.getLatLng();

        void syncLocation({ lat: position.lat, lng: position.lng });
      };

      map.on('click', handleMapClick);
      marker.on('dragend', handleMarkerDragEnd);

      listenersRef.current = [
        { remove: () => map.off('click', handleMapClick) },
        { remove: () => marker.off('dragend', handleMarkerDragEnd) },
      ];

      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        map.invalidateSize();
        map.setView(DEFAULT_CENTER, 13);
      });

      if (initialLocation?.position) {
        applySelection(initialLocation.label, initialLocation.position);
        focusMapOnLocation(initialLocation.position);
        return;
      }

      await centerMapFromQuery(initialLocation?.label ?? '');
    };

    const initializeMap = async () => {
      try {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          googleMapsRenderAvailable = false;
          await initializeLeafletMap('Google Maps không khả dụng trên môi trường local. Đang dùng bản đồ dự phòng.');
          return;
        }

        if (!googleMapsRenderAvailable) {
          await initializeLeafletMap('Google Maps không khả dụng. Đang dùng bản đồ dự phòng.');
          return;
        }

        const google = await loadGoogleMapsApi();

        if (cancelled || !mapContainerRef.current) {
          return;
        }

        await initializeGoogleMap(google);
      } catch (mapLoadError) {
        if (cancelled) {
          return;
        }

        console.warn('Google Maps unavailable, using Leaflet fallback.', mapLoadError);
        googleMapsRenderAvailable = false;

        try {
          await initializeLeafletMap('Google Maps không khả dụng. Đang dùng bản đồ dự phòng.');
        } catch (leafletError) {
          if (cancelled) {
            return;
          }

          console.warn('Leaflet map unavailable.', leafletError);
          setMapReady(false);
          setMapError(leafletError.message || 'Không thể tải bản đồ.');
        }
      }
    };

    initializeMap();

    return () => {
      cancelled = true;
      abortController.abort();
      clearMapInstances();
      setMapReady(false);
    };
  }, [mode, open, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setIsLoading(false);
      setError('');
      return undefined;
    }

    const trimmed = query.trim();
    const abortController = new AbortController();

    if (trimmed.length < 2) {
      setPredictions([]);
      setError('');
      setIsLoading(false);
      return undefined;
    }

    let active = true;
    setIsLoading(true);

    const timeoutId = window.setTimeout(async () => {
      let didSearchTimeout = false;
      const searchTimeoutId = window.setTimeout(() => {
        didSearchTimeout = true;
        abortController.abort();
      }, PLACES_SEARCH_TIMEOUT_MS);

      try {
        const results = await searchGooglePlaces(trimmed, { signal: abortController.signal });

        if (!active) {
          return;
        }

        setPredictions(results);
        setError('');
      } catch (requestError) {
        if (requestError?.name === 'AbortError') {
          if (active && didSearchTimeout) {
            setPredictions([]);
            setError('Tìm địa điểm quá lâu, vui lòng thử lại.');
          }
          return;
        }

        if (!active) {
          return;
        }

        setPredictions([]);
        setError(requestError.message);
      } finally {
        window.clearTimeout(searchTimeoutId);

        if (active) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (selectedLocation?.position) {
      setPreviewLocation(null);
      return undefined;
    }

    const previewPrediction = predictions.find(
      (prediction) => Number.isFinite(Number(prediction.lat)) && Number.isFinite(Number(prediction.lng)),
    );

    if (!previewPrediction) {
      setPreviewLocation(null);
      return undefined;
    }

    const latitude = Number(previewPrediction.lat);
    const longitude = Number(previewPrediction.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setPreviewLocation(null);
      return undefined;
    }

    const latLng = { lat: latitude, lng: longitude };
    setPreviewLocation({
      label: previewPrediction.description ?? previewPrediction.main_text ?? formatCoordinates(latitude, longitude),
      position: latLng,
    });
    focusMapOnLocation(latLng);

    return undefined;
  }, [open, predictions, selectedLocation?.position]);

  if (!open) {
    return null;
  }

  const handleCurrentLocation = () => {
    if (mode !== 'pickup') {
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setError('Trang web cần chạy trên HTTPS để lấy vị trí hiện tại.');
      return;
    }

    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ lấy vị trí hiện tại.');
      return;
    }

    setIsResolvingCurrentLocation(true);
    setIsLoading(true);
    setError('');
    setMapError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latLng = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        let resolvedLabel = `Vị trí hiện tại (${formatCoordinates(latLng.lat, latLng.lng)})`;

        try {
          const reverseResult = await reverseGeocodeCoordinates(latLng.lat, latLng.lng);
          const address = String(reverseResult?.label ?? '').trim();

          if (canUseReverseLabel(reverseResult, latLng)) {
            resolvedLabel = address;
          }
        } catch {
          // Keep coordinate label when reverse geocode is unavailable.
        }

        focusMapOnLocation(latLng);
        setPreviewLocation({
          label: resolvedLabel,
          position: latLng,
        });
        setIsResolvingCurrentLocation(false);
        setIsLoading(false);
        setSelectedLocation({
          label: resolvedLabel,
          position: latLng,
          kind: 'pickup',
          source: 'current-location',
        });
        setQueryFromSelection(resolvedLabel);
        setPredictions([]);

        clearAutoCommitTimeout();
        autoCommitTimeoutRef.current = window.setTimeout(() => {
          commitSelection({
            label: resolvedLabel,
            position: latLng,
            kind: 'pickup',
            source: 'current-location',
          });
        }, 250);
      },
      (geoError) => {
        setIsResolvingCurrentLocation(false);
        setIsLoading(false);

        if (geoError?.code === 1) {
          setError('Bạn đã từ chối quyền vị trí. Hãy cho phép truy cập vị trí trên trình duyệt.');
          return;
        }

        if (geoError?.code === 2) {
          setError('Không thể xác định vị trí hiện tại. Hãy kiểm tra GPS hoặc mạng.');
          return;
        }

        if (geoError?.code === 3) {
          setError('Yêu cầu lấy vị trí bị quá thời gian. Vui lòng thử lại.');
          return;
        }

        setError('Không thể lấy vị trí hiện tại. Hãy cho phép truy cập vị trí trên trình duyệt.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  const handleUseValue = () => {
    const finalValue = selectedLocation?.label ?? query.trim();

    if (finalValue) {
      commitSelection({
        label: finalValue,
        position: selectedLocation?.position ?? null,
        kind: mode,
        source: selectedLocation?.source ?? 'manual',
      });
      return;
    }

    setError('Vui lòng chọn một vị trí trên bản đồ hoặc nhập tên địa điểm.');
  };

  const handlePick = async (prediction) => {
    setError('');
    setMapError('');
    setIsLoading(true);

    try {
      const latitude = Number(prediction.lat);
      const longitude = Number(prediction.lng);
      const fallbackLabel = String(prediction.description ?? prediction.main_text ?? '').trim();

      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const latLng = { lat: latitude, lng: longitude };
        let label = prediction.description ?? prediction.main_text ?? formatCoordinates(latitude, longitude);

        try {
          const reverseResult = await reverseGeocodeCoordinates(latitude, longitude);
          const resolvedLabel = String(reverseResult?.label ?? '').trim();

          if (canUseReverseLabel(reverseResult, latLng)) {
            label = resolvedLabel;
          }
        } catch {
          // Keep prediction label when reverse geocoding is unavailable.
        }

        focusMapOnLocation(latLng);

        commitSelection({
          label,
          position: latLng,
          kind: mode,
          source: 'search',
        });
      } else if (fallbackLabel) {
        const placesService = googlePlacesServiceRef.current;

        if (placesService && window.google?.maps?.places?.PlacesService) {
          const place = await getPlaceDetails(placesService, prediction.place_id);

          if (place?.geometry?.location) {
            const latLng = place.geometry.location.toJSON();
            const label = place.formatted_address ?? fallbackLabel;

            focusMapOnLocation(latLng);

            commitSelection({
              label,
              position: latLng,
              kind: mode,
              source: 'search',
            });

            setPredictions([]);
            return;
          }
        }

        commitSelection({
          label: fallbackLabel,
          position: null,
          kind: mode,
          source: 'search',
        });
      } else {
        setMapError('Không thể xác định địa điểm này trên bản đồ.');
        return;
      }

      setPredictions([]);
    } catch (pickError) {
      setMapError(pickError.message);
    } finally {
      setIsLoading(false);
    }
  };

  const pickerTitle = mode === 'pickup' ? 'Chọn điểm đón' : 'Chọn điểm đến';
  const pickerPlaceholder = mode === 'pickup' ? 'Nhập điểm đón' : 'Nhập địa điểm muốn đến';
  const pickerHint = mode === 'pickup' ? 'Nhấp vào bản đồ hoặc kéo ghim để chọn điểm đón' : 'Nhấp vào bản đồ hoặc kéo ghim để chọn điểm đến';
  const mapLabel = previewLocation?.label ?? selectedLocation?.label ?? '';
  const statusMessage = isResolvingCurrentLocation
    ? 'Đang lấy vị trí hiện tại...'
    : isLoading
      ? 'Đang tìm kiếm địa điểm...'
      : error || 'Chọn một gợi ý hoặc nhấp trực tiếp lên bản đồ để chốt vị trí.';

  return createPortal(
    <div className="destination-modal" role="dialog" aria-modal="true" aria-label={pickerTitle}>
      <div className="destination-modal__backdrop" onClick={onClose} aria-hidden="true" />

      <div className="destination-modal__panel">
        <div className="destination-modal__header">
          <div className="destination-modal__heading">
            <img className="destination-modal__icon" src={locationIcon} alt="" aria-hidden="true" />
            <div>
              <p>SmartRide</p>
              <h3>{pickerTitle}</h3>
            </div>
          </div>

          <button className="destination-modal__close" type="button" onClick={onClose} aria-label="Đóng">
            <img className="destination-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>

        <div className="destination-modal__body">
          <aside className="destination-modal__sidebar">
            <label className="destination-modal__search">
              <span>Tìm địa điểm</span>
              <input
                value={query}
                onChange={(event) => {
                  skipNextSearchRef.current = false;
                  setQuery(event.target.value);
                  setSelectedLocation(null);
                }}
                placeholder={pickerPlaceholder}
                autoFocus
              />
            </label>

            {mode === 'pickup' ? (
              <button className="destination-modal__current-location" type="button" onClick={handleCurrentLocation}>
                <img className="destination-modal__current-location-icon" src={locationIcon} alt="" aria-hidden="true" />
                <div>
                  <span>Vị trí hiện tại</span>
                  <strong>Lấy vị trí đang đứng</strong>
                </div>
              </button>
            ) : null}

            <div className="destination-modal__status">
              {statusMessage}
            </div>

            <div className="destination-modal__results" role="listbox" aria-label="Kết quả gợi ý">
              {predictions.map((prediction) => (
                <button
                  key={prediction.place_id}
                  className="destination-modal__result"
                  type="button"
                  onClick={() => handlePick(prediction)}
                >
                  <strong>{prediction.main_text ?? prediction.description}</strong>
                  <span>{prediction.secondary_text ?? prediction.description}</span>
                </button>
              ))}

              {!isLoading && predictions.length === 0 && query.trim().length >= 2 && !error ? (
                <div className="destination-modal__empty">Không tìm thấy kết quả phù hợp.</div>
              ) : null}

              <div className="destination-modal__selection">
                <span>Đã chọn</span>
                <strong>{selectedLocation?.label ?? 'Chưa chọn vị trí trên bản đồ'}</strong>
              </div>
            </div>
          </aside>

          <section className="destination-modal__map-stage">
            <div className="destination-modal__map" ref={mapContainerRef} />

            {!mapReady ? (
              <div className="destination-modal__map-placeholder">
                Đang tải Google Maps...
              </div>
            ) : null}

            {mapError ? <div className="destination-modal__map-error">{mapError}</div> : null}

            {mapLabel ? <div className="destination-modal__map-preview">{mapLabel}</div> : null}

            <div className="destination-modal__map-hint">{pickerHint}</div>
          </section>
        </div>

        <div className="destination-modal__footer">
          <button className="destination-modal__cancel" type="button" onClick={onClose}>
            Hủy
          </button>

          <button className="destination-modal__use-value" type="button" onClick={handleUseValue}>
            Chọn vị trí này
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
