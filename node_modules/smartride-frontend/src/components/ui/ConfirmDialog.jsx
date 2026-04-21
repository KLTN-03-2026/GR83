import { createPortal } from 'react-dom';
import { useEffect } from 'react';

export default function ConfirmDialog({
  open = false,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy',
  busy = false,
  busyLabel = 'Đang xử lý...',
  confirmTone = 'danger',
  onCancel,
  onConfirm,
  ariaLabel,
}) {
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

  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  return createPortal(
    <div className="confirm-dialog__overlay" role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
      <div className="confirm-dialog__backdrop" onClick={() => onCancel?.()} aria-hidden="true" />

      <section
        className="confirm-dialog__sheet"
        onMouseDown={stopPropagation}
        onClick={stopPropagation}
      >
        <div className="confirm-dialog__head">
          <h4>{title}</h4>
          <p>{description}</p>
        </div>

        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__button confirm-dialog__button--ghost" type="button" onClick={() => onCancel?.()} disabled={busy}>
            {cancelLabel}
          </button>

          <button
            className={`confirm-dialog__button confirm-dialog__button--${confirmTone}`}
            type="button"
            onClick={() => onConfirm?.()}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}