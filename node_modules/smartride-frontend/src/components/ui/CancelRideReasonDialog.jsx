import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { classNames } from '../../utils/classNames';

const CANCEL_RIDE_REASONS = [
  { id: 'plan-change', label: 'Tôi thay đổi kế hoạch' },
  { id: 'driver-change', label: 'Đổi tài' },
  { id: 'price-too-high', label: 'Giá quá cao' },
  { id: 'other', label: 'Khác' },
];

function normalizeReasonText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export default function CancelRideReasonDialog({
  open = false,
  title = 'Vui lòng chọn lý do hủy chuyến',
  description = 'Chọn một lý do phù hợp trước khi xác nhận hủy chuyến.',
  confirmLabel = 'Hủy chuyến',
  onCancel,
  onConfirm,
  ariaLabel,
}) {
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const otherReasonInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setSelectedReasonId('');
      setOtherReason('');
      return undefined;
    }
  }, [open]);

  useEffect(() => {
    if (open && selectedReasonId === 'other') {
      window.requestAnimationFrame(() => {
        otherReasonInputRef.current?.focus();
      });
    }
  }, [open, selectedReasonId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCancel?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const selectedReason = CANCEL_RIDE_REASONS.find((reason) => reason.id === selectedReasonId) ?? null;
  const normalizedOtherReason = normalizeReasonText(otherReason);
  const canConfirm = Boolean(selectedReasonId) && (selectedReasonId !== 'other' || Boolean(normalizedOtherReason));

  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!canConfirm) {
      return;
    }

    const reasonText = selectedReasonId === 'other' ? normalizedOtherReason : selectedReason?.label ?? '';

    onConfirm?.({
      reasonId: selectedReasonId,
      reasonLabel: selectedReason?.label ?? '',
      reasonText,
      customReason: selectedReasonId === 'other' ? reasonText : '',
    });
  };

  return createPortal(
    <div className="cancel-ride-dialog" role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
      <div className="cancel-ride-dialog__backdrop" onClick={() => onCancel?.()} aria-hidden="true" />

      <section className="cancel-ride-dialog__sheet" onMouseDown={stopPropagation} onClick={stopPropagation}>
        <form className="cancel-ride-dialog__form" onSubmit={handleSubmit}>
          <header className="cancel-ride-dialog__header">
            <h4>{title}</h4>
            <p>{description}</p>
          </header>

          <fieldset className="cancel-ride-dialog__reasons" aria-label="Lý do hủy chuyến">
            {CANCEL_RIDE_REASONS.map((reason) => (
              <label
                key={reason.id}
                className={classNames(
                  'cancel-ride-dialog__reason',
                  selectedReasonId === reason.id && 'is-selected',
                )}
              >
                <input
                  className="cancel-ride-dialog__reason-input"
                  type="radio"
                  name="cancel-ride-reason"
                  value={reason.id}
                  checked={selectedReasonId === reason.id}
                  onChange={() => setSelectedReasonId(reason.id)}
                />
                <span className="cancel-ride-dialog__reason-mark" aria-hidden="true" />
                <span className="cancel-ride-dialog__reason-label">{reason.label}</span>
              </label>
            ))}
          </fieldset>

          {selectedReasonId === 'other' ? (
            <label className="cancel-ride-dialog__custom-field">
              <span>Nhập lý do khác</span>
              <input
                ref={otherReasonInputRef}
                type="text"
                value={otherReason}
                onChange={(event) => setOtherReason(event.target.value)}
                placeholder="Nhập lý do của bạn"
              />
            </label>
          ) : null}

          <footer className="cancel-ride-dialog__footer">
            <button className="cancel-ride-dialog__confirm" type="submit" disabled={!canConfirm}>
              {confirmLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}