import { useState } from 'react';
import { createPortal } from 'react-dom';
import { closeIcon } from '../../assets/icons';

export default function DriverRideReceiveSettingsModal({
  open = false,
  onClose,
  checkedIn = false,
  autoReceiveEnabled = true,
  onCheckedInChange,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingState, setPendingState] = useState(null);

  if (!open) {
    return null;
  }

  const handleCheckinButtonClick = () => {
    setPendingState(!checkedIn);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    onCheckedInChange?.(pendingState);
    setConfirmOpen(false);
    setPendingState(null);
  };

  const handleConfirmCancel = () => {
    setConfirmOpen(false);
    setPendingState(null);
  };

  const confirmMessage = pendingState
    ? 'Bạn có muốn Check-in để bắt đầu nhận chuyến không?'
    : 'Bạn có muốn Check-out và dừng nhận chuyến không?';

  return createPortal(
    <div className="driver-dispatch-modal" role="dialog" aria-modal="true" aria-label="Cài đặt nhận chuyến">
      <div className="driver-dispatch-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="driver-dispatch-modal__window">
        <button className="driver-dispatch-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng cài đặt nhận chuyến">
          <img className="driver-dispatch-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="driver-dispatch-modal__header">
          <span className="driver-dispatch-modal__header-dot" aria-hidden="true">✽</span>
          <h3>Cài đặt nhận chuyến</h3>
        </header>

        <div className="driver-dispatch-modal__body">
          <article className="driver-dispatch-modal__row">
            <div>
              <strong>Trạng thái</strong>
              <p>{checkedIn ? 'Đang Check-in...' : 'Đang Check-out...'}</p>
            </div>

            <button
              className={`driver-dispatch-modal__switch${checkedIn ? ' is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={checkedIn}
              onClick={handleCheckinButtonClick}
            >
              <span className="driver-dispatch-modal__switch-thumb" aria-hidden="true" />
              <span className="driver-dispatch-modal__switch-label">{checkedIn ? 'ON' : 'OFF'}</span>
            </button>
          </article>

          <article className="driver-dispatch-modal__row">
            <div>
              <strong>Tự động nhận chuyến</strong>
              <p>Bắt buộc bật trên web để đồng bộ điều phối.</p>
            </div>

            <button
              className="driver-dispatch-modal__switch is-on"
              type="button"
              role="switch"
              aria-checked={autoReceiveEnabled}
              aria-disabled="true"
              disabled
            >
              <span className="driver-dispatch-modal__switch-thumb" aria-hidden="true" />
              <span className="driver-dispatch-modal__switch-label">ON</span>
            </button>
          </article>
        </div>

        {confirmOpen ? (
          <div className="driver-dispatch-modal__confirm" role="alertdialog" aria-modal="true">
            <p className="driver-dispatch-modal__confirm-msg">{confirmMessage}</p>
            <div className="driver-dispatch-modal__confirm-actions">
              <button className="driver-dispatch-modal__confirm-cancel" type="button" onClick={handleConfirmCancel}>
                Hủy
              </button>
              <button className="driver-dispatch-modal__confirm-ok" type="button" onClick={handleConfirm}>
                Xác nhận
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
