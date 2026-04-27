import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { format } from 'date-fns';
import { clockIcon, closeIcon, userIcon } from '../../assets/icons';
import RoutePreviewMap from './RoutePreviewMap';
import { classNames } from '../../utils/classNames';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function formatTripDate(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '--';
  }

  return format(parsedDate, 'HH:mm · dd/MM/yyyy');
}

function formatDistance(distanceKm) {
  const normalizedDistance = Number(distanceKm);

  if (!Number.isFinite(normalizedDistance)) {
    return '--';
  }

  return `${normalizedDistance.toFixed(1)} km`;
}

function formatCompactNumber(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return '0';
  }

  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.max(0, normalizedValue));
}

function formatCurrency(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return '0đ';
  }

  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.max(0, normalizedValue))}đ`;
}

function isOlderThanDays(value, days) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return false;
  }

  const thresholdMs = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
  return Date.now() - parsedDate.getTime() > thresholdMs;
}

async function copyTextToClipboard(textToCopy) {
  const normalizedText = normalizeText(textToCopy);

  if (!normalizedText) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    }
  } catch {
    // Ignore clipboard errors and fall back below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = normalizedText;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9 9.5V7.25A2.25 2.25 0 0 1 11.25 5h5.5A2.25 2.25 0 0 1 19 7.25v5.5A2.25 2.25 0 0 1 16.75 15H14.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.25 9h5.5A2.25 2.25 0 0 1 16 11.25v5.5A2.25 2.25 0 0 1 13.75 19h-5.5A2.25 2.25 0 0 1 6 16.75v-5.5A2.25 2.25 0 0 1 8.25 9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TripHistoryDetailModal({
  trip = null,
  mode = 'customer',
  open = false,
  onClose,
  accountDisplayName = '',
  accountIdentifier = '',
  accountPhone = '',
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    return acquireBodyScrollLock();
  }, [open]);

  if (!open || !trip) {
    return null;
  }

  const normalizedMode = mode === 'driver' ? 'driver' : 'customer';
  const tripDateLabel = formatTripDate(trip.completedAt || trip.bookedAt);
  const routeDistanceLabel = formatDistance(trip.routeDistanceKm);
  const tripMinutesLabel = Number.isFinite(Number(trip.etaMinutes)) && Number(trip.etaMinutes) > 0
    ? `${formatCompactNumber(trip.etaMinutes)} phút`
    : '--';
  const bookingCodeLabel = trip.bookingCodeShortLabel || trip.bookingCode || '--';
  const tripCodeLabel = trip.tripCodeShortLabel || trip.tripCode || '--';
  const actionWindowExpired = normalizedMode === 'customer' && isOlderThanDays(trip.completedAt || trip.bookedAt, 7);
  const noticeText = normalizedMode === 'customer'
    ? actionWindowExpired
      ? 'Bạn không thể xếp hạng, gửi tiền tip hoặc báo lỗi sau 7 ngày.'
      : 'Bạn có thể xếp hạng, gửi tiền tip hoặc báo lỗi trong 7 ngày sau chuyến đi.'
    : 'Tài xế xem lại hành trình, thanh toán và đánh giá của chuyến này.';
  const partyLabel = normalizedMode === 'customer' ? 'Tài xế' : 'Khách hàng';
  const partyName = normalizedMode === 'customer'
    ? normalizeText(trip.driverDisplayName || trip.driverName) || 'Tài xế'
    : normalizeText(trip.accountDisplayName || trip.customerName || accountDisplayName) || 'Khách hàng';
  const customerSummaryFields = normalizedMode === 'customer'
    ? [
        {
          key: 'driver-name',
          label: partyLabel,
          value: partyName,
          primary: true,
        },
        {
          key: 'license-plate',
          label: 'Biển số',
          value: normalizeText(trip.driverLicensePlate || trip.driverVehicleLicensePlate) || 'Đang cập nhật',
        },
        {
          key: 'rating',
          label: 'Đánh giá chuyến đi',
          value: Number(trip.ratingScore) > 0 ? Number(trip.ratingScore).toFixed(0) : 'Chưa đánh giá',
          suffix: Number(trip.ratingScore) > 0 ? '★' : '',
        },
      ]
    : [];
  const customerInfoFields = normalizedMode === 'driver'
    ? [
        {
          label: 'Khách hàng',
          value: normalizeText(trip.customerName || trip.accountDisplayName || accountDisplayName) || 'Khách hàng',
          primary: true,
        },
        {
          label: 'SDT',
          value: normalizeText(trip.customerPhone || accountPhone || trip.accountPhone) || 'Đang cập nhật',
        },
        {
          label: 'Đánh giá',
          value: Number(trip.ratingScore) > 0 ? `${Number(trip.ratingScore).toFixed(0)} ★` : 'Chưa đánh giá',
          secondary: true,
        },
      ]
    : [];
  const driverSummaryFields = normalizedMode === 'driver'
    ? [
        {
          key: 'role',
          label: 'Khách hàng',
          value: normalizeText(trip.customerName || trip.accountDisplayName || accountDisplayName) || 'Khách hàng',
          primary: true,
        },
        {
          key: 'phone',
          label: 'SDT',
          value: normalizeText(trip.customerPhone || accountPhone || trip.accountPhone) || 'Đang cập nhật',
        },
        {
          key: 'rating',
          label: 'Đánh giá',
          value: Number(trip.ratingScore) > 0 ? Number(trip.ratingScore).toFixed(0) : 'Chưa đánh giá',
          suffix: Number(trip.ratingScore) > 0 ? '★' : '',
        },
      ]
    : [];
  const paymentMethodLabel = normalizeText(trip.paymentLabel) || 'Tiền mặt';
  const paymentStatusLabel = normalizeText(trip.paymentStatusLabel) || '--';
  const totalPriceLabel = normalizeText(trip.priceFormatted) || formatCurrency(trip.price);
  const originalPriceLabel = normalizeText(trip.originalPriceFormatted) || formatCurrency(trip.originalPrice);
  const discountAmountLabel = normalizeText(trip.discountAmountFormatted) || formatCurrency(trip.discountAmount);

  const handleCopy = async (value) => {
    await copyTextToClipboard(value);
  };

  return createPortal(
    <div
      className={classNames('trip-history-modal__detail-layer', `trip-history-modal__detail-layer--${normalizedMode}`)}
      role="dialog"
      aria-modal="true"
      aria-label={`Chi tiết chuyến ${bookingCodeLabel}`}
    >
      <div className="trip-history-modal__detail-backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="trip-history-modal__detail">
        <button className="trip-history-modal__close trip-history-modal__detail-close" type="button" onClick={() => onClose?.()} aria-label="Đóng chi tiết chuyến">
          <img className="trip-history-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="trip-history-modal__detail-header">
          <div className="trip-history-modal__detail-copy">
            <p className="trip-history-modal__detail-kicker">Xem chi tiết</p>
            <h4>{trip.rideTitle || trip.vehicleLabel || 'Chi tiết chuyến đi'}</h4>
            <p className="trip-history-modal__detail-summary">
              {[trip.statusLabel, tripDateLabel, routeDistanceLabel].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="trip-history-modal__detail-badges">
            <span className="trip-history-modal__detail-time">
              <img className="trip-history-modal__detail-time-icon" src={clockIcon} alt="" aria-hidden="true" />
              {tripDateLabel}
            </span>
            <span className={classNames('trip-history-modal__status', `is-${trip.statusTone || 'neutral'}`)}>{trip.statusLabel || '--'}</span>
          </div>
        </header>

        <div className="trip-history-modal__detail-grid">
          <div className="trip-history-modal__stack">
            <div className="trip-history-modal__map-shell">
              <div className="trip-history-modal__map-badge">
                {tripMinutesLabel} · {routeDistanceLabel}
              </div>

              <RoutePreviewMap
                pickupPosition={trip.pickupPosition}
                destinationPosition={trip.destinationPosition}
                routeGeometry={trip.routeGeometry}
                routeProvider={trip.routeProvider}
                showExpandButton={false}
                showProviderLabel={false}
              />
            </div>

            <div className="trip-history-modal__summary-card">
              <div>
                <span className="trip-history-modal__summary-label">Thời gian</span>
                <strong>{tripDateLabel}</strong>
              </div>

              <div>
                <span className="trip-history-modal__summary-label">Loại xe</span>
                <strong>{trip.vehicleLabel || '--'}</strong>
              </div>

              <div>
                <span className="trip-history-modal__summary-label">Quãng đường</span>
                <strong>{routeDistanceLabel}</strong>
              </div>

              <div>
                <span className="trip-history-modal__summary-label">Ước tính</span>
                <strong>{tripMinutesLabel}</strong>
              </div>
            </div>

            <div className="trip-history-modal__route-card">
              <div className="trip-history-modal__route-row">
                <span className="trip-history-modal__route-icon trip-history-modal__route-icon--pickup">
                  <img className="trip-history-modal__route-icon-img" src={clockIcon} alt="" aria-hidden="true" />
                </span>

                <div className="trip-history-modal__route-copy">
                  <span>Điểm đón</span>
                  <strong title={trip.pickupLabel || '--'}>{trip.pickupLabel || '--'}</strong>
                </div>
              </div>

              <div className="trip-history-modal__route-divider" />

              <div className="trip-history-modal__route-row">
                <span className="trip-history-modal__route-icon trip-history-modal__route-icon--destination">
                  <img className="trip-history-modal__route-icon-img" src={clockIcon} alt="" aria-hidden="true" />
                </span>

                <div className="trip-history-modal__route-copy">
                  <span>Điểm đến</span>
                  <strong title={trip.destinationLabel || '--'}>{trip.destinationLabel || '--'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="trip-history-modal__detail-panel">
            <div className="trip-history-modal__identity-card">
              <div className="trip-history-modal__identity-row">
                <span className="trip-history-modal__identity-label">Mã đặt xe</span>
                <strong className="trip-history-modal__identity-value" title={trip.bookingCode || bookingCodeLabel}>{bookingCodeLabel}</strong>
                <button className="trip-history-modal__identity-copy" type="button" onClick={() => void handleCopy(trip.bookingCode || bookingCodeLabel)} aria-label={`Sao chép mã đặt xe ${bookingCodeLabel}`}>
                  <CopyGlyph />
                </button>
              </div>

              <div className="trip-history-modal__identity-row">
                <span className="trip-history-modal__identity-label">Mã chuyến</span>
                <strong className="trip-history-modal__identity-value" title={trip.tripCode || tripCodeLabel}>{tripCodeLabel}</strong>
                <button className="trip-history-modal__identity-copy" type="button" onClick={() => void handleCopy(trip.tripCode || tripCodeLabel)} aria-label={`Sao chép mã chuyến ${tripCodeLabel}`}>
                  <CopyGlyph />
                </button>
              </div>
            </div>

            <div className="trip-history-modal__note-card">
              <span className="trip-history-modal__note-icon" aria-hidden="true">
                <img className="trip-history-modal__note-icon-img" src={clockIcon} alt="" aria-hidden="true" />
              </span>

              <div className="trip-history-modal__note-copy">
                <span className="trip-history-modal__note-label">{normalizedMode === 'customer' ? 'Thông báo' : 'Chế độ tài xế'}</span>
                <p>{noticeText}</p>
              </div>
            </div>

            <div className="trip-history-modal__person-card">
              <div
                className={classNames(
                  'trip-history-modal__person-head',
                  normalizedMode === 'customer' && 'trip-history-modal__person-head--customer',
                  normalizedMode === 'driver' && 'trip-history-modal__person-head--driver',
                )}
              >
                <span className="trip-history-modal__person-icon" aria-hidden="true">
                  <img className="trip-history-modal__person-icon-img" src={userIcon} alt="" aria-hidden="true" />
                </span>

                {normalizedMode === 'driver' ? (
                  <div className="trip-history-modal__person-summary trip-history-modal__person-summary--driver">
                    {driverSummaryFields.map((field) => (
                      <div
                        className={classNames(
                          'trip-history-modal__person-summary-item',
                          field.primary && 'trip-history-modal__person-summary-item--primary',
                          field.secondary && 'trip-history-modal__person-summary-item--secondary',
                          field.suffix && 'trip-history-modal__person-summary-item--rating',
                        )}
                        key={field.key}
                      >
                        <span className="trip-history-modal__person-label">{field.label}</span>
                        <strong title={field.suffix ? `${field.value} ${field.suffix}` : field.value}>
                          <span>{field.value}</span>
                          {field.suffix ? <span className="trip-history-modal__person-star" aria-hidden="true">{field.suffix}</span> : null}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="trip-history-modal__person-summary trip-history-modal__person-summary--customer">
                    {customerSummaryFields.map((field) => (
                      <div
                        className={classNames(
                          'trip-history-modal__person-summary-item',
                          field.primary && 'trip-history-modal__person-summary-item--primary',
                          field.suffix && 'trip-history-modal__person-summary-item--rating',
                        )}
                        key={field.key}
                      >
                        <span className="trip-history-modal__person-label">{field.label}</span>
                        <strong title={field.suffix ? `${field.value} ${field.suffix}` : field.value}>
                          <span>{field.value}</span>
                          {field.suffix ? <span className="trip-history-modal__person-star" aria-hidden="true">{field.suffix}</span> : null}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="trip-history-modal__payment-card">
              <div className="trip-history-modal__payment-header">
                <div>
                  <span className="trip-history-modal__payment-kicker">Thanh toán</span>
                  <strong>{paymentMethodLabel}</strong>
                </div>

                <div className="trip-history-modal__payment-total">
                  <span className="trip-history-modal__payment-kicker">Tổng cộng</span>
                  <strong>{totalPriceLabel}</strong>
                </div>
              </div>

              <div className="trip-history-modal__payment-grid">
                <div className="trip-history-modal__payment-line">
                  <span>Giá theo km</span>
                  <strong>{originalPriceLabel}</strong>
                </div>

                <div className="trip-history-modal__payment-line">
                  <span>Giảm giá</span>
                  <strong>{discountAmountLabel}</strong>
                </div>

                <div className="trip-history-modal__payment-line">
                  <span>Phương thức thanh toán</span>
                  <strong>{paymentMethodLabel}</strong>
                </div>

                <div className="trip-history-modal__payment-line">
                  <span>Trạng thái thanh toán</span>
                  <strong>{paymentStatusLabel}</strong>
                </div>
              </div>
            </div>

            {normalizedMode === 'customer' ? (
              <div className="trip-history-modal__action-row">
                <button className="trip-history-modal__action-button trip-history-modal__action-button--invoice" type="button">
                  Hóa đơn
                </button>

                <button className="trip-history-modal__action-button trip-history-modal__action-button--report" type="button">
                  Báo lỗi
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
