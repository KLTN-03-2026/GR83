import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import RoutePreviewMap from './RoutePreviewMap';
import { clockIcon, closeIcon, originIcon, pinIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';

const TRACKING_STEPS = [
  {
    id: 'created',
    title: 'Đã tạo cuốc xe',
    description: 'Yêu cầu vừa được tiếp nhận và chuyển sang bước ghép tài xế.',
  },
  {
    id: 'matching',
    title: 'Đang tìm tài xế gần đó',
    description: 'Hệ thống ưu tiên các tài xế quanh điểm đón để tạo cuốc nhanh nhất.',
  },
  {
    id: 'confirming',
    title: 'Chờ tài xế xác nhận',
    description: 'Khi có tài xế phù hợp nhận chuyến, cuốc xe sẽ được kích hoạt.',
  },
];

function formatBookingTime(timestamp) {
  const parsedDate = timestamp ? new Date(timestamp) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return format(parsedDate, 'HH:mm dd/MM/yyyy');
}

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

export default function RideTrackingModal({ open = false, booking = null, onClose, onCancel }) {
  const [trackingStepIndex, setTrackingStepIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setTrackingStepIndex(0);

    const firstTimerId = window.setTimeout(() => {
      setTrackingStepIndex(1);
    }, 2200);

    const secondTimerId = window.setTimeout(() => {
      setTrackingStepIndex(2);
    }, 4400);

    return () => {
      window.clearTimeout(firstTimerId);
      window.clearTimeout(secondTimerId);
    };
  }, [booking?.bookingCode, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const bookingTimeLabel = formatBookingTime(booking?.createdAt);
  const pickupLabel = String(booking?.pickup?.label ?? '').trim() || 'Điểm đón';
  const destinationLabel = String(booking?.destination?.label ?? '').trim() || 'Điểm đến';
  const bookingCode = String(booking?.bookingCode ?? '').trim();
  const rideTitle = String(booking?.rideTitle ?? booking?.vehicleLabel ?? '').trim() || 'Chuyến xe';
  const paymentSummary = String(booking?.paymentSummary ?? booking?.paymentMethodLabel ?? '').trim();
  const paymentStatus = String(booking?.paymentStatusLabel ?? '').trim();
  const priceLabel = String(booking?.priceFormatted ?? '').trim();
  const routeDistanceLabel = formatKilometers(booking?.routeDistanceKm);
  const etaLabel = formatMinutes(booking?.etaMinutes);
  const activeStep = TRACKING_STEPS[trackingStepIndex] ?? TRACKING_STEPS[TRACKING_STEPS.length - 1];
  const progressValue = trackingStepIndex === 0 ? 25 : trackingStepIndex === 1 ? 60 : 100;

  const handleCancel = () => {
    onCancel?.();
  };

  if (!open || !booking) {
    return null;
  }

  return createPortal(
    <div className="booking-tracking-modal" role="dialog" aria-modal="true" aria-label="Trạng thái tìm tài xế">
      <div className="booking-tracking-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="booking-tracking-modal__window">
        <button className="booking-tracking-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng">
          <img className="booking-tracking-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="booking-tracking-modal__header">
          <p className="booking-tracking-modal__eyebrow">Đặt xe thành công</p>
          <h3>Đang tìm tài xế gần đó</h3>
          <p className="booking-tracking-modal__description">
            Yêu cầu vừa được tạo. Hệ thống đang ghép chuyến với tài xế phù hợp quanh điểm đón để tạo cuốc xe nhanh nhất.
          </p>
        </header>

        <div className="booking-tracking-modal__body">
          <div className="booking-tracking-modal__left">
            <div className="booking-tracking-modal__route-card">
              <div className="booking-tracking-modal__route-row">
                <span className="booking-tracking-modal__route-icon booking-tracking-modal__route-icon--pickup">
                  <img className="booking-tracking-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
                </span>

                <div className="booking-tracking-modal__route-copy">
                  <span>Điểm đón</span>
                  <strong>{pickupLabel}</strong>
                </div>
              </div>

              <div className="booking-tracking-modal__route-divider" />

              <div className="booking-tracking-modal__route-row">
                <span className="booking-tracking-modal__route-icon booking-tracking-modal__route-icon--destination">
                  <img className="booking-tracking-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
                </span>

                <div className="booking-tracking-modal__route-copy">
                  <span>Điểm đến</span>
                  <strong>{destinationLabel}</strong>
                </div>
              </div>
            </div>

            <div className="booking-tracking-modal__trip-card">
              <div className="booking-tracking-modal__trip-head">
                <div>
                  <span className="booking-tracking-modal__trip-kicker">{booking?.vehicleLabel?.trim() || 'Cuốc xe'}</span>
                  <h4>{rideTitle}</h4>
                </div>

                <div className="booking-tracking-modal__booking-code">
                  <span>Mã chuyến</span>
                  <strong>{bookingCode || '--'}</strong>
                </div>
              </div>

              <div className="booking-tracking-modal__details">
                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">
                    <img className="booking-tracking-modal__detail-icon" src={clockIcon} alt="" aria-hidden="true" />
                    Thời gian
                  </span>
                  <strong>{bookingTimeLabel || '--'}</strong>
                </div>

                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">Thanh toán</span>
                  <strong>{paymentSummary || '--'}</strong>
                </div>

                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">Trạng thái</span>
                  <strong>{paymentStatus || '--'}</strong>
                </div>

                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">Giá cước</span>
                  <strong>{priceLabel || '--'}</strong>
                </div>

                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">Quãng đường</span>
                  <strong>{routeDistanceLabel || '--'}</strong>
                </div>

                <div className="booking-tracking-modal__detail-item">
                  <span className="booking-tracking-modal__detail-label">Dự kiến</span>
                  <strong>{etaLabel || '--'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="booking-tracking-modal__right">
            <div className="booking-tracking-modal__map-shell">
              <RoutePreviewMap
                className="booking-tracking-modal__map"
                pickupPosition={booking?.pickup?.position}
                destinationPosition={booking?.destination?.position}
                routeGeometry={booking?.routeGeometry}
                routeProvider={booking?.routeProvider}
                showExpandButton={false}
                showProviderLabel={false}
              />

              <div className="booking-tracking-modal__map-badge">Đang định vị tài xế phù hợp</div>
            </div>

            <div className="booking-tracking-modal__status-card">
              <div className="booking-tracking-modal__status-head">
                <span className="booking-tracking-modal__status-dot" aria-hidden="true" />
                <strong>{activeStep.title}</strong>
              </div>

              <p>{activeStep.description}</p>

              <div className="booking-tracking-modal__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
                <span style={{ width: `${progressValue}%` }} />
              </div>

              <div className="booking-tracking-modal__timeline" aria-label="Tiến trình tìm tài xế">
                {TRACKING_STEPS.map((step, index) => (
                  <div
                    key={step.id}
                    className={classNames(
                      'booking-tracking-modal__timeline-item',
                      index < trackingStepIndex && 'is-complete',
                      index === trackingStepIndex && 'is-active',
                    )}
                  >
                    <span className="booking-tracking-modal__timeline-index">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="booking-tracking-modal__footer">
          <button className="booking-tracking-modal__cancel" type="button" onClick={handleCancel}>
            Hủy chuyến
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}