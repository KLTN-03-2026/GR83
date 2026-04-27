import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { closeIcon, originIcon, pinIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';

const REJECT_REASONS = [
  { id: 'wrong-location', label: 'Khách đặt sai vị trí' },
  { id: 'unreachable', label: 'Không liên lạc được với khách' },
  { id: 'vehicle-issue', label: 'Xe gặp sự cố' },
  { id: 'other', label: 'Lý do khác' },
];

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export default function DriverRideRejectModal({
  open = false,
  request = null,
  onCancel,
  onSubmit,
}) {
  const [selectedReasonId, setSelectedReasonId] = useState(REJECT_REASONS[0].id);
  const [customNote, setCustomNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const selectedReason = REJECT_REASONS.find((reason) => reason.id === selectedReasonId) ?? REJECT_REASONS[0];
  const isCustomReason = selectedReasonId === 'other';

  useEffect(() => {
    if (!open || !request) {
      setSelectedReasonId(REJECT_REASONS[0].id);
      setCustomNote('');
      setIsSubmitting(false);
      setErrorMessage('');
      return undefined;
    }

    setSelectedReasonId(REJECT_REASONS[0].id);
    setCustomNote('');
    setIsSubmitting(false);
    setErrorMessage('');
    return undefined;
  }, [open, request?.bookingCode]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || isSubmitting) {
        return;
      }

      onCancel?.();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubmitting, onCancel, open]);

  if (!open || !request) {
    return null;
  }

  const bookingCode = normalizeText(request.bookingCode ?? request.requestId ?? '');
  const pickupLabel = normalizeText(request.pickup?.label ?? '') || 'Điểm đón';
  const destinationLabel = normalizeText(request.destination?.label ?? '') || 'Điểm đến';
  const routeSummary = `${pickupLabel} → ${destinationLabel}`;
  const vehicleLabel = normalizeText(request.vehicleLabel ?? request.rideTitle ?? '') || 'Cuốc xe mới';

  const handleCancel = () => {
    if (isSubmitting) {
      return;
    }

    onCancel?.();
  };

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    const note = customNote.trim();

    if (isCustomReason && !note) {
      setErrorMessage('Vui lòng nhập lý do cụ thể để gửi từ chối.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      await onSubmit?.({
        request,
        reasonId: selectedReason.id,
        reasonLabel: selectedReason.label,
        note,
        summary: note ? `${selectedReason.label}: ${note}` : selectedReason.label,
      });
    } catch (error) {
      setErrorMessage(error?.message || 'Không thể gửi từ chối.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="driver-ride-reject-modal" role="dialog" aria-modal="true" aria-label="Từ chối chuyến">
      <div className="driver-ride-reject-modal__backdrop" onClick={handleCancel} aria-hidden="true" />

      <section
        className="driver-ride-reject-modal__window"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="driver-ride-reject-modal__header">
          <div className="driver-ride-reject-modal__title-copy">
            <span className="driver-ride-reject-modal__icon" aria-hidden="true">
              <img className="driver-ride-reject-modal__icon-img" src={closeIcon} alt="" />
            </span>

            <div className="driver-ride-reject-modal__title-text">
              <p className="driver-ride-reject-modal__eyebrow">Popup từ chối chuyến</p>
              <h3>TỪ CHỐI CHUYẾN</h3>
              <p className="driver-ride-reject-modal__subtitle">
                Chọn một lý do trước khi gửi phản hồi để hệ thống lưu đúng trạng thái.
              </p>
            </div>
          </div>

          <div className="driver-ride-reject-modal__booking-code">
            <span>Mã chuyến</span>
            <strong>{bookingCode || '--'}</strong>
            <small>{vehicleLabel}</small>
          </div>
        </header>

        <div className="driver-ride-reject-modal__body">
          <section className="driver-ride-reject-modal__summary-card">
            <div className="driver-ride-reject-modal__summary-label">Chuyến đi</div>

            <div className="driver-ride-reject-modal__route-row">
              <span className="driver-ride-reject-modal__route-icon driver-ride-reject-modal__route-icon--pickup">
                <img className="driver-ride-reject-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
              </span>

              <div className="driver-ride-reject-modal__route-copy">
                <span>Điểm đón</span>
                <strong>{pickupLabel}</strong>
              </div>
            </div>

            <div className="driver-ride-reject-modal__route-divider" />

            <div className="driver-ride-reject-modal__route-row">
              <span className="driver-ride-reject-modal__route-icon driver-ride-reject-modal__route-icon--destination">
                <img className="driver-ride-reject-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
              </span>

              <div className="driver-ride-reject-modal__route-copy">
                <span>Điểm đến</span>
                <strong>{destinationLabel}</strong>
              </div>
            </div>

            <p className="driver-ride-reject-modal__summary-text">{routeSummary}</p>
          </section>

          <section className="driver-ride-reject-modal__form-card">
            <p className="driver-ride-reject-modal__form-title">Vui lòng chọn lý do từ chối:</p>

            <div className="driver-ride-reject-modal__form-grid">
              <div className="driver-ride-reject-modal__reason-list" role="radiogroup" aria-label="Lý do từ chối chuyến">
                {REJECT_REASONS.map((reason) => (
                  <label
                    key={reason.id}
                    className={classNames(
                      'driver-ride-reject-modal__reason-item',
                      selectedReasonId === reason.id && 'is-selected',
                    )}
                  >
                    <input
                      type="radio"
                      name="driver-ride-reject-reason"
                      value={reason.id}
                      checked={selectedReasonId === reason.id}
                      onChange={() => {
                        setSelectedReasonId(reason.id);
                        setErrorMessage('');
                      }}
                    />
                    <span className="driver-ride-reject-modal__reason-dot" aria-hidden="true" />
                    <span className="driver-ride-reject-modal__reason-label">{reason.label}</span>
                  </label>
                ))}
              </div>

              <label className={classNames('driver-ride-reject-modal__note-box', !isCustomReason && 'is-disabled')}>
                <span className="driver-ride-reject-modal__note-label">Nhập lý do thêm...</span>
                <strong className="driver-ride-reject-modal__note-kicker">
                  {isCustomReason ? 'Ghi rõ nguyên nhân nếu danh sách chưa phù hợp.' : 'Chọn "Lý do khác" để nhập thêm.'}
                </strong>
                <textarea
                  className="driver-ride-reject-modal__note-input"
                  value={customNote}
                  onChange={(event) => {
                    setCustomNote(event.target.value);
                    setErrorMessage('');
                  }}
                  placeholder={isCustomReason ? 'Nhập lý do thêm....' : 'Chọn "Lý do khác" để nhập thêm.'}
                  disabled={!isCustomReason}
                  rows={4}
                />
              </label>
            </div>

            {errorMessage ? (
              <div className="driver-ride-reject-modal__error" role="alert">
                {errorMessage}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="driver-ride-reject-modal__footer">
          <div className="driver-ride-reject-modal__footer-copy">
            <span>Hành động ngay</span>
            <strong>Bấm gửi từ chối khi bạn đã chọn lý do phù hợp, hoặc quay lại nếu thao tác nhầm.</strong>
          </div>

          <div className="driver-ride-reject-modal__actions">
            <button className="driver-ride-reject-modal__cancel" type="button" onClick={handleCancel} disabled={isSubmitting}>
              HỦY
            </button>

            <button className="driver-ride-reject-modal__submit" type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'ĐANG GỬI...' : 'GỬI TỪ CHỐI'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
