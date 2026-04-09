import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { closeIcon, locationIcon } from '../../assets/icons';
import { DA_NANG_AIRPORT } from '../../data/defaultLocations';
import { searchGooglePlaces } from '../../services/googlePlacesService';
import { loadGoogleMapsApi } from '../../services/googleMapsLoader';

const DEFAULT_CENTER = {
  lat: DA_NANG_AIRPORT.position.lat,
  lng: DA_NANG_AIRPORT.position.lng,
};

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

function createLeafletMarkerIcon() {
  return L.divIcon({
    className: 'smartride-leaflet-marker',
    html: '<div style="width:18px;height:18px;background:#ef4444;border:3px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 10px 20px rgba(0,0,0,.25);transform:rotate(-45deg);"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

export default function DestinationPickerModal({ open, value, onClose, onSelect, mode = 'destination' }) {
  const [query, setQuery] = useState(value);
  const [predictions, setPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
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
    setQuery(label);
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
    setQuery(label);
    setPredictions([]);
    setError('');
    setMapError('');
    focusMapOnLocation(position);
  };

  const clearMapInstances = () => {
    listenersRef.current.forEach((listener) => listener.remove());
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
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery(value);
    setPredictions([]);
    setError('');
    setMapError('');
    setMapReady(false);
    setSelectedLocation(value ? { label: value, position: null } : null);
    setPreviewLocation(null);
  }, [mode, open, value]);

  useEffect(() => {
    if (open) {
      return;
    }

    setIsLoading(false);
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

    let cancelled = false;
    const abortController = new AbortController();

    const syncLocation = (latLng) => {
      if (cancelled) {
        return;
      }

      const label = formatCoordinates(latLng.lat, latLng.lng);

      applySelection(label, latLng);
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
          syncLocation(toLatLngLiteral(event.latLng));
        }
      };

      const handleMarkerDragEnd = () => {
        const position = marker.getPosition();

        if (position) {
          syncLocation(toLatLngLiteral(position));
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

      await centerMapFromQuery(value.trim());
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
        syncLocation(event.latlng);
      };

      const handleMarkerDragEnd = () => {
        const position = marker.getLatLng();

        syncLocation({ lat: position.lat, lng: position.lng });
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

      await centerMapFromQuery(value.trim());
    };

    const initializeMap = async () => {
      try {
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
  }, [open, value]);

  useEffect(() => {
    if (!open) {
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
      try {
        const results = await searchGooglePlaces(trimmed, { signal: abortController.signal });

        if (!active) {
          return;
        }

        setPredictions(results);
        setError('');
      } catch (requestError) {
        if (requestError?.name === 'AbortError') {
          return;
        }

        if (!active) {
          return;
        }

        setPredictions([]);
        setError(requestError.message);
      } finally {
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
  }, [open, predictions]);

  if (!open) {
    return null;
  }

  const handleCurrentLocation = () => {
    if (mode !== 'pickup') {
      return;
    }

    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ lấy vị trí hiện tại.');
      return;
    }

    setIsLoading(true);
    setError('');
    setMapError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latLng = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        focusMapOnLocation(latLng);
        commitSelection({
          label: 'Vị trí hiện tại',
          position: latLng,
          kind: 'pickup',
          source: 'current-location',
        });
      },
      () => {
        setIsLoading(false);
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

      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const latLng = { lat: latitude, lng: longitude };
        const label = prediction.description ?? prediction.main_text ?? formatCoordinates(latitude, longitude);

        focusMapOnLocation(latLng);

        commitSelection({
          label,
          position: latLng,
          kind: mode,
          source: 'search',
        });
      } else {
        const placesService = googlePlacesServiceRef.current;

          if (!placesService || !window.google?.maps?.places?.PlacesService) {
          throw new Error('Địa điểm này chưa có tọa độ để hiển thị trên bản đồ. Hãy chọn địa điểm khác.');
        }

          const place = await getPlaceDetails(placesService, prediction.place_id);

          if (!place?.geometry?.location) {
            throw new Error('Không lấy được vị trí của gợi ý này.');
        }

          const latLng = place.geometry.location.toJSON();
          const label = place.formatted_address ?? prediction.description ?? prediction.main_text;

          focusMapOnLocation(latLng);

          commitSelection({
            label,
            position: latLng,
            kind: mode,
            source: 'search',
          });
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
              {isLoading
                ? 'Đang tìm kiếm địa điểm...'
                : error || 'Chọn một gợi ý hoặc nhấp trực tiếp lên bản đồ để chốt vị trí.'}
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
