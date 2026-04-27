import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { closeIcon, originIcon, pinIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';

const STAR_VALUES = [1, 2, 3, 4, 5];

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getInitials(name) {
  const parts = normalizeText(name)
    .split(' ')
    .filter(Boolean);

  if (parts.length === 0) {
    return 'SR';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function getMoodIndex(rating) {
  const normalizedRating = Number(rating);

  if (!Number.isFinite(normalizedRating) || normalizedRating <= 2) {
    return 0;
  }

  if (normalizedRating === 3) {
    return 1;
  }

  return 2;
}

function getRatingLabel(rating) {
  const moodIndex = getMoodIndex(rating);

  if (moodIndex === 0) {
    return 'Tệ';
  }

  if (moodIndex === 1) {
    return 'Bình thường';
  }

  return 'Rất tốt';
}

export default function TripRatingDialog({
  open = false,
  booking = null,
  onClose,
  onSubmit,
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open) {
      setRating(5);
      setComment('');
      setSubmitting(false);
      setSubmitError('');
      return undefined;
    }

    setRating(5);
    setComment('');
    setSubmitting(false);
    setSubmitError('');
    return undefined;
  }, [booking?.bookingCode, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const releaseBodyScrollLock = acquireBodyScrollLock();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseBodyScrollLock();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !booking) {
    return null;
  }

  const bookingCode = normalizeText(booking.bookingCode);
  const driverName = normalizeText(booking.driverDisplayName ?? booking.driverName ?? 'Tài xế');
  const driverLicensePlate = normalizeText(booking.driverLicensePlate ?? booking.driverVehicleLicensePlate ?? '');
  const pickupLabel = normalizeText(booking.pickupLabel ?? booking.pickup?.label ?? '');
  const destinationLabel = normalizeText(booking.destinationLabel ?? booking.destination?.label ?? '');
  const rideTitle = normalizeText(booking.rideTitle ?? booking.vehicleLabel ?? 'Chuyến đi');
  const paymentSummary = normalizeText(booking.paymentSummary ?? booking.paymentMethodLabel ?? '');
  const priceLabel = normalizeText(booking.priceFormatted ?? '');
  const completedAt = normalizeText(booking.completedAt ?? booking.updatedAt ?? '');
  const ratingLabel = getRatingLabel(rating);
  const selectedMoodIndex = getMoodIndex(rating);

  const handleClose = () => {
    if (submitting) {
      return;
    }

    onClose?.();
  };

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      await onSubmit?.({
        booking,
        rating,
        comment: normalizeText(comment),
      });

      if (!onSubmit) {
        onClose?.();
      }
    } catch (error) {
      setSubmitError(error?.message || 'Không thể gửi đánh giá lúc này.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="trip-rating-modal" role="dialog" aria-modal="true" aria-label="Đánh giá chuyến đi">
      <div className="trip-rating-modal__backdrop" onClick={handleClose} aria-hidden="true" />

      <section className="trip-rating-modal__window">
        <button className="trip-rating-modal__close" type="button" onClick={handleClose} aria-label="Đóng popup đánh giá">
          <img className="trip-rating-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <div className="trip-rating-modal__layout">
          <aside className="trip-rating-modal__summary">
            <div className="trip-rating-modal__summary-head">
              <div className="trip-rating-modal__avatar" aria-hidden="true">
                {getInitials(driverName)}
              </div>

              <div className="trip-rating-modal__summary-copy">
                <p className="trip-rating-modal__eyebrow">Chuyến đã hoàn thành</p>
                <h3>{driverName || 'Tài xế'}</h3>
                <span>{driverLicensePlate || 'Đang cập nhật biển số'}</span>
                <p className="trip-rating-modal__summary-ride">{rideTitle || 'Chuyến đi'}</p>
              </div>
            </div>

            <div className="trip-rating-modal__route-card">
              <div className="trip-rating-modal__route-row">
                <span className="trip-rating-modal__route-icon trip-rating-modal__route-icon--pickup" aria-hidden="true">
                  <img className="trip-rating-modal__route-icon-img" src={originIcon} alt="" />
                </span>

                <div className="trip-rating-modal__route-copy">
                  <span>Điểm đón</span>
                  <strong>{pickupLabel || 'Đang cập nhật'}</strong>
                </div>
              </div>

              <div className="trip-rating-modal__route-divider" />

              <div className="trip-rating-modal__route-row">
                <span className="trip-rating-modal__route-icon trip-rating-modal__route-icon--destination" aria-hidden="true">
                  <img className="trip-rating-modal__route-icon-img" src={pinIcon} alt="" />
                </span>

                <div className="trip-rating-modal__route-copy">
                  <span>Điểm đến</span>
                  <strong>{destinationLabel || 'Đang cập nhật'}</strong>
                </div>
              </div>
            </div>

            <div className="trip-rating-modal__meta-grid">
              <article className="trip-rating-modal__meta-item">
                <span>Mã chuyến</span>
                <strong>{bookingCode || '--'}</strong>
              </article>

              <article className="trip-rating-modal__meta-item">
                <span>Thanh toán</span>
                <strong>{paymentSummary || '--'}</strong>
              </article>

              <article className="trip-rating-modal__meta-item">
                <span>Giá cước</span>
                <strong>{priceLabel || '--'}</strong>
              </article>

              <article className="trip-rating-modal__meta-item">
                <span>Hoàn thành lúc</span>
                <strong>{completedAt || '--'}</strong>
              </article>
            </div>
          </aside>

          <section className="trip-rating-modal__form">
            <div className="trip-rating-modal__form-head">
              <p className="trip-rating-modal__eyebrow">Bạn thấy chuyến đi như thế nào?</p>
              <h3>Đánh giá tài xế</h3>
              <p>
                Cảm ơn bạn đã đặt chuyến cùng SmartRide. Chia sẻ cảm nhận của bạn để SmartRide cải thiện chất lượng phục vụ.
                {' '}
                Mức hiện tại: {ratingLabel}.
              </p>
            </div>

            <div className="trip-rating-modal__stars" role="radiogroup" aria-label="Chọn số sao">
              {STAR_VALUES.map((value) => (
                <button
                  key={value}
                  className={classNames('trip-rating-modal__star', value <= rating && 'is-selected')}
                  type="button"
                  onClick={() => setRating(value)}
                  aria-label={`${value} sao`}
                  aria-pressed={value === rating}
                >
                  ★
                </button>
              ))}
            </div>

            <div className="trip-rating-modal__mood-row" aria-label="Mức đánh giá">
              {['Tệ', 'Bình thường', 'Rất tốt'].map((label, index) => (
                <span
                  key={label}
                  className={classNames('trip-rating-modal__mood', selectedMoodIndex === index && 'is-active')}
                >
                  {label}
                </span>
              ))}
            </div>

            <label className="trip-rating-modal__comment">
              <span>Nhập nhận xét của bạn...</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Ví dụ: Tài xế đến đúng giờ, chạy êm và thân thiện."
                rows={5}
              />
            </label>

            {submitError ? <p className="trip-rating-modal__error" role="alert">{submitError}</p> : null}

            <div className="trip-rating-modal__actions">
              <button className="trip-rating-modal__secondary" type="button" onClick={handleClose} disabled={submitting}>
                Để sau
              </button>

              <button className="trip-rating-modal__primary" type="button" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Đang gửi...' : 'Gửi đánh giá'}
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}