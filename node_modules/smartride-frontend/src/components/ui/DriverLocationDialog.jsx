import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { motorbikeIcon } from '../../assets/icons';
import { createRideSocketConnection } from '../../services/rideRealtimeService';
import { rideService } from '../../services/rideService';
import RoutePreviewMap from './RoutePreviewMap';
import { classNames } from '../../utils/classNames';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.longitude ?? position.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const normalizedPosition = { lat, lng };

  const accuracy = Number(position.accuracy);
  const heading = Number(position.heading);
  const speed = Number(position.speed);

  if (Number.isFinite(accuracy)) {
    normalizedPosition.accuracy = accuracy;
  }

  if (Number.isFinite(heading)) {
    normalizedPosition.heading = heading;
  }

  if (Number.isFinite(speed)) {
    normalizedPosition.speed = speed;
  }

  return normalizedPosition;
}

function formatLicensePlate(value) {
  const normalizedValue = normalizeText(value).toUpperCase();

  if (!normalizedValue) {
    return '';
  }

  return normalizedValue.replace(/\s*[-–]\s*/g, ' - ');
}

function normalizeTripStatusToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function getLocationStatusCopy(tripStatusToken, hasLivePosition) {
  if (tripStatusToken === 'dadon' || tripStatusToken === 'pickedup' || tripStatusToken === 'dangthuchien' || tripStatusToken === 'inprogress') {
    return {
      title: 'Tài xế đang chở khách',
      description: 'Vị trí hiện tại được cập nhật theo thời gian thực từ thiết bị của tài xế.',
      badge: hasLivePosition ? 'Đang di chuyển' : 'Chờ tín hiệu',
    };
  }

  if (tripStatusToken === 'dangden' || tripStatusToken === 'headingpickup' || tripStatusToken === 'danhanchuyen' || tripStatusToken === 'accepted' || tripStatusToken === 'chotaixe' || tripStatusToken === 'choxacnhan') {
    return {
      title: 'Tài xế đang đến điểm đón',
      description: 'Bản đồ tự cập nhật vị trí tài xế mỗi khi có tín hiệu mới.',
      badge: hasLivePosition ? 'Đang tới điểm đón' : 'Đang kết nối',
    };
  }

  if (tripStatusToken === 'hoanthanh' || tripStatusToken === 'completed') {
    return {
      title: 'Chuyến đã hoàn thành',
      description: 'Bạn có thể xem lại vị trí cuối cùng của tài xế trong chuyến này.',
      badge: 'Hoàn tất',
    };
  }

  if (tripStatusToken === 'dahuy' || tripStatusToken === 'cancelled') {
    return {
      title: 'Chuyến đã hủy',
      description: 'Vị trí tài xế sẽ không còn được cập nhật cho chuyến này.',
      badge: 'Đã hủy',
    };
  }

  return {
    title: 'Đang chờ cập nhật vị trí',
    description: 'Hệ thống sẽ nhận vị trí mới ngay khi tài xế bắt đầu chia sẻ.',
    badge: hasLivePosition ? 'Đã kết nối' : 'Đang chờ',
  };
}

export default function DriverLocationDialog({ open = false, booking = null, onClose, onNotify }) {
  const [driverPosition, setDriverPosition] = useState(null);
  const [socketState, setSocketState] = useState('idle');

  const bookingCode = normalizeText(booking?.bookingCode);
  const customerAccountId = normalizeText(booking?.customerAccountId ?? booking?.accountId);
  const driverAccountId = normalizeText(booking?.driverAccountId ?? booking?.driverId);
  const pickupPosition = normalizePosition(booking?.pickup?.position);
  const destinationPosition = normalizePosition(booking?.destination?.position);
  const driverName = normalizeText(booking?.driverDisplayName ?? booking?.driverName);
  const driverVehicleLabel = normalizeText(booking?.driverVehicleLabel ?? booking?.vehicleLabel ?? booking?.rideTitle);
  const driverLicensePlate = formatLicensePlate(booking?.driverLicensePlate ?? booking?.driverVehicleLicensePlate);
  const tripStatusToken = normalizeTripStatusToken(booking?.tripStatus ?? booking?.status);

  const mapRouteGeometry = useMemo(() => {
    const bookingRouteGeometry = Array.isArray(booking?.routeGeometry)
      ? booking.routeGeometry.map(normalizePosition).filter(Boolean)
      : [];

    if (bookingRouteGeometry.length >= 2) {
      return bookingRouteGeometry;
    }

    if (pickupPosition && destinationPosition) {
      return [pickupPosition, destinationPosition];
    }

    if (driverPosition && pickupPosition) {
      return [driverPosition, pickupPosition];
    }

    return [];
  }, [booking?.routeGeometry, destinationPosition, driverPosition, pickupPosition]);

  const statusCopy = getLocationStatusCopy(tripStatusToken, Boolean(driverPosition));

  useEffect(() => {
    if (!open) {
      setDriverPosition(null);
      setSocketState('idle');
      return undefined;
    }

    setDriverPosition(null);

    if ((!bookingCode && !driverAccountId) || !customerAccountId) {
      setSocketState('idle');
      return undefined;
    }

    setSocketState('connecting');

    let isMounted = true;
    let socket = null;

    const handleRideEvent = (event = {}) => {
      const eventBookingCode = normalizeText(event?.bookingCode ?? event?.booking?.bookingCode);

      if (!eventBookingCode || eventBookingCode.toLowerCase() !== bookingCode.toLowerCase()) {
        return;
      }

      if (event?.type !== 'ride.location.updated' && event?.type !== 'ride.location.snapshot') {
        return;
      }

      const nextPosition = normalizePosition(event?.position ?? event?.driverPosition ?? event?.location ?? event?.coordinates);

      if (!nextPosition || !isMounted) {
        return;
      }

      setDriverPosition(nextPosition);
      setSocketState('connected');
    };

    socket = createRideSocketConnection({
      accountId: customerAccountId,
      roleCode: 'Q2',
      onConnect: () => {
        if (!isMounted) {
          return;
        }

        setSocketState('connected');
        socket?.emit('ride.location.subscribe', {
          bookingCode,
          driverAccountId,
        });
      },
      onDisconnect: () => {
        if (!isMounted) {
          return;
        }

        setSocketState('disconnected');
      },
      onError: () => {
        if (!isMounted) {
          return;
        }

        setSocketState('error');
      },
      onEvent: handleRideEvent,
    });

    if (!socket) {
      setSocketState('error');
      onNotify?.('Không thể kết nối realtime để theo dõi vị trí tài xế.', 'error', 2200);
      return undefined;
    }

    let fallbackActive = true;

    void rideService.getTripLocation(bookingCode, {
      driverAccountId,
    }).then((response) => {
      if (!isMounted || !fallbackActive || !response?.success || !response?.location) {
        return;
      }

      const nextPosition = normalizePosition(
        response.location.position ?? response.location.driverPosition ?? response.location.location ?? response.location.coordinates,
      );

      if (nextPosition) {
        setDriverPosition(nextPosition);
        setSocketState('connected');
      }
    }).catch(() => {
      // Keep waiting for the live socket snapshot.
    });

    return () => {
      isMounted = false;
      fallbackActive = false;
      socket.emit('ride.location.unsubscribe', {
        bookingCode,
      });
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [bookingCode, customerAccountId, driverAccountId, onNotify, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const releaseBodyScrollLock = acquireBodyScrollLock();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseBodyScrollLock();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const hasMapRoute = Boolean(mapRouteGeometry.length >= 2 || (driverPosition && pickupPosition));
  const connectionBadge = socketState === 'connected'
    ? 'Đang cập nhật realtime'
    : socketState === 'disconnected'
      ? 'Mất kết nối tạm thời'
      : socketState === 'error'
        ? 'Chưa kết nối'
        : 'Đang kết nối';

  return createPortal(
    <div className="route-preview-modal booking-tracking-modal__location-modal" role="dialog" aria-modal="true" aria-label="Vị trí tài xế">
      <div className="route-preview-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <div className="route-preview-modal__panel booking-tracking-modal__location-panel">
        <div className="route-preview-modal__header booking-tracking-modal__location-header">
          <div>
            <strong>Vị trí tài xế</strong>
            <p className="booking-tracking-modal__location-subtitle">{bookingCode ? `Mã chuyến ${bookingCode}` : 'Đang theo dõi vị trí theo thời gian thực'}</p>
          </div>

          <button className="route-preview-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng">
            Đóng
          </button>
        </div>

        <div className="booking-tracking-modal__location-summary">
          <div className="booking-tracking-modal__location-summary-copy">
            <span className={classNames('booking-tracking-modal__status-chip', 'booking-tracking-modal__status-chip--active')}>
              {statusCopy.badge}
            </span>
            <h4>{statusCopy.title}</h4>
            <p>{statusCopy.description}</p>
          </div>

          <div className="booking-tracking-modal__location-summary-vehicle">
            <img className="booking-tracking-modal__location-summary-icon" src={motorbikeIcon} alt="" aria-hidden="true" />
            <div>
              <strong>{driverName || 'Tài xế'}</strong>
              <p>{driverVehicleLabel || 'Đang cập nhật thông tin xe'}{driverLicensePlate ? ` · ${driverLicensePlate}` : ''}</p>
            </div>
          </div>
        </div>

        <div className="booking-tracking-modal__location-map-shell">
          {hasMapRoute ? (
            <RoutePreviewMap
              className="booking-tracking-modal__location-map"
              pickupPosition={pickupPosition}
              destinationPosition={destinationPosition}
              liveMarkerPosition={driverPosition}
              routeGeometry={mapRouteGeometry}
              routeProvider={booking?.routeProvider}
              showExpandButton={false}
              showProviderLabel={false}
            />
          ) : (
            <div className="booking-tracking-modal__location-empty-state">
              <strong>Đang chờ dữ liệu bản đồ</strong>
              <p>Chưa có đủ thông tin để vẽ lộ trình, nhưng vị trí tài xế vẫn sẽ được cập nhật ngay khi có tín hiệu.</p>
            </div>
          )}

          <div className="booking-tracking-modal__location-float-note">
            <span className={classNames('booking-tracking-modal__status-chip', socketState === 'connected' && 'booking-tracking-modal__status-chip--active')}>
              {connectionBadge}
            </span>
            <span className="booking-tracking-modal__status-chip booking-tracking-modal__status-chip--tone">Cập nhật theo thời gian thực</span>
          </div>
        </div>

        <div className="booking-tracking-modal__location-footer">
          <span className="booking-tracking-modal__location-footer-item">{driverName || 'Tài xế'}</span>
          <span className="booking-tracking-modal__location-footer-item">{tripStatusToken ? statusCopy.title : 'Đang theo dõi'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
