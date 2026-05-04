import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import RoutePreviewMap from './RoutePreviewMap';
import { clockIcon, originIcon, pinIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';

function formatKilometers(distanceKm) {
  const normalizedDistance = Number(distanceKm);

  if (!Number.isFinite(normalizedDistance)) {
    return '';
  }

  return `${normalizedDistance.toFixed(1)} km`;
}

function formatMinutes(minutes) {
  const normalizedMinutes = Number(minutes);

  if (!Number.isFinite(normalizedMinutes)) {
    return '';
  }

  return `${normalizedMinutes} phút`;
}

function normalizePaymentMethod(paymentMethod, paymentSummary = '') {
  const method = String(paymentMethod ?? '').trim().toLowerCase();

  if (method === 'wallet') {
    return 'wallet';
  }

  if (method === 'cash') {
    return 'cash';
  }

  const summaryText = String(paymentSummary ?? '').trim().toLowerCase();

  if (summaryText.includes('ví') || summaryText.includes('wallet')) {
    return 'wallet';
  }

  return 'cash';
}

export default function DriverRideRequestModal({
  open = false,
  request = null,
  distanceKm = null,
  isNearby = true,
  disableKeyboardShortcuts = false,
  onAccept,
  onReject,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const handleAccept = () => {
    if (isProcessing) {
      return;
    }

    setIsProcessing(true);

    Promise.resolve()
      .then(() => onAccept?.(request))
      .catch(() => {})
      .finally(() => {
        if (isMountedRef.current) {
          setIsProcessing(false);
        }
      });
  };

  const handleReject = () => {
    if (isProcessing) {
      return;
    }

    Promise.resolve()
      .then(() => onReject?.(request))
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) {
      setIsProcessing(false);
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (disableKeyboardShortcuts) {
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    const handleKeyDown = (event) => {
      if (event.repeat) {
        return;
      }

      if (event.key === 'Enter') {
        handleAccept();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [disableKeyboardShortcuts, handleAccept, open, request]);

  if (!open || !request) {
    return null;
  }

  const pickupLabel = String(request.pickup?.label ?? '').trim() || 'Điểm đón';
  const destinationLabel = String(request.destination?.label ?? '').trim() || 'Điểm đến';
  const bookingCode = String(request.bookingCode ?? request.requestId ?? '').trim();
  const rideTitle = String(request.rideTitle ?? request.vehicleLabel ?? '').trim() || 'Cuốc xe mới';
  const priceLabel = String(request.priceFormatted ?? '').trim();
  const paymentMethod = normalizePaymentMethod(request.paymentMethod, request.paymentSummary);
  const isWalletPayment = paymentMethod === 'wallet';
  const driverVisiblePriceLabel = isWalletPayment ? '0đ' : priceLabel;
  const etaLabel = formatMinutes(request.etaMinutes);
  const routeDistanceLabel = formatKilometers(request.routeDistanceKm ?? distanceKm);
  const distanceToPickupLabel = formatKilometers(distanceKm);

  return createPortal(
    <div className="driver-ride-request-modal" role="dialog" aria-modal="true" aria-label="Cuốc xe mới">
      <div className="driver-ride-request-modal__backdrop" aria-hidden="true" />

      <section className="driver-ride-request-modal__window">
        <header className="driver-ride-request-modal__header">
          <div className="driver-ride-request-modal__header-copy">
            <p className="driver-ride-request-modal__eyebrow">Ưu tiên cao · cuốc mới</p>
            <h3>CUỐC XE MỚI</h3>
            <p className="driver-ride-request-modal__subtitle">
              Xem nhanh lộ trình, khoảng cách và bấm nhận hoặc từ chối ngay trên một hộp thoại gọn, rõ.
            </p>
          </div>

          <div className={classNames('driver-ride-request-modal__live-badge', isNearby && 'is-nearby')}>
            {isNearby ? 'Tài xế gần điểm đón' : 'Chờ xác nhận'}
          </div>
        </header>

        <div className="driver-ride-request-modal__body">
          <div className="driver-ride-request-modal__left">
            <div className="driver-ride-request-modal__route-card">
              <div className="driver-ride-request-modal__route-row">
                <span className="driver-ride-request-modal__route-icon driver-ride-request-modal__route-icon--pickup">
                  <img className="driver-ride-request-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
                </span>

                <div className="driver-ride-request-modal__route-copy">
                  <span>Điểm đón</span>
                  <strong>{pickupLabel}</strong>
                </div>
              </div>

              <div className="driver-ride-request-modal__route-divider" />

              <div className="driver-ride-request-modal__route-row">
                <span className="driver-ride-request-modal__route-icon driver-ride-request-modal__route-icon--destination">
                  <img className="driver-ride-request-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
                </span>

                <div className="driver-ride-request-modal__route-copy">
                  <span>Điểm đến</span>
                  <strong>{destinationLabel}</strong>
                </div>
              </div>
            </div>

            <div className="driver-ride-request-modal__trip-card">
              <div className="driver-ride-request-modal__trip-head">
                <div>
                  <span className="driver-ride-request-modal__trip-kicker">{request.vehicleLabel?.trim() || 'Cuốc xe'}</span>
                  <h4>{rideTitle}</h4>
                </div>

                <div className="driver-ride-request-modal__booking-code">
                  <span>Mã chuyến</span>
                  <strong>{bookingCode || '--'}</strong>
                </div>
              </div>

              <div className="driver-ride-request-modal__details">
                <div className="driver-ride-request-modal__detail-item">
                  <span className="driver-ride-request-modal__detail-label">
                    <img className="driver-ride-request-modal__detail-icon" src={clockIcon} alt="" aria-hidden="true" />
                    Dự kiến
                  </span>
                  <strong>{etaLabel || '--'}</strong>
                </div>

                <div className={classNames('driver-ride-request-modal__detail-item', isWalletPayment && 'driver-ride-request-modal__detail-item--wallet-price')}>
                  <span className="driver-ride-request-modal__detail-label">Giá tiền</span>
                  <strong className={classNames(isWalletPayment && 'driver-ride-request-modal__wallet-price')}>{driverVisiblePriceLabel || '--'}</strong>
                </div>

                <div className="driver-ride-request-modal__detail-item">
                  <span className="driver-ride-request-modal__detail-label">Trạng thái</span>
                  <strong className="driver-ride-request-modal__status-text">Đang chờ....</strong>
                </div>

                <div className="driver-ride-request-modal__detail-item">
                  <span className="driver-ride-request-modal__detail-label">Quãng đường</span>
                  <strong>{routeDistanceLabel || '--'}</strong>
                </div>

                <div className="driver-ride-request-modal__detail-item">
                  <span className="driver-ride-request-modal__detail-label">Khoảng cách đến điểm đón</span>
                  <strong>{distanceToPickupLabel || (isNearby ? 'Gần bạn' : '--')}</strong>
                </div>

                <div className="driver-ride-request-modal__detail-item driver-ride-request-modal__detail-item--full">
                  <span className="driver-ride-request-modal__detail-label">Thông báo</span>
                  <strong>{isNearby ? 'Có cuốc xe phù hợp đang chờ bạn xác nhận.' : 'Cuốc xe này vừa khớp với vị trí hiện tại của bạn.'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="driver-ride-request-modal__right">
            <div className="driver-ride-request-modal__map-shell">
              <RoutePreviewMap
                className="driver-ride-request-modal__map"
                pickupPosition={request.pickup?.position}
                destinationPosition={request.destination?.position}
                routeGeometry={request.routeGeometry}
                routeProvider={request.routeProvider}
                showExpandButton={false}
                showProviderLabel={false}
              />

              <div className={classNames('driver-ride-request-modal__map-badge', isNearby && 'is-nearby')}>
                {isNearby ? 'Tài xế ở gần khu vực nhận chuyến' : 'Yêu cầu chuyến mới'}
              </div>
            </div>
          </div>
        </div>

        <footer className="driver-ride-request-modal__footer">
          <div className="driver-ride-request-modal__footer-copy">
            <span>Hành động ngay</span>
            <strong>Cuốc này được ghim lên đầu để bạn phản hồi nhanh nhưng không che quá nhiều màn hình.</strong>
          </div>

          <div className="driver-ride-request-modal__actions">
            <button className="driver-ride-request-modal__reject" type="button" onClick={handleReject} disabled={isProcessing}>
              ✕ TỪ CHỐI
            </button>

            <button className="driver-ride-request-modal__accept" type="button" onClick={handleAccept} disabled={isProcessing}>
              {isProcessing ? 'ĐANG XỬ LÝ...' : '✓ XÁC NHẬN'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}