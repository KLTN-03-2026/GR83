import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { rideService } from '../../services/rideService';
import { connectRideEventStream } from '../../services/rideRealtimeService';
import { closeIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeRoleCode(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue === 'q2' || normalizedValue === 'customer' || normalizedValue === 'khach' || normalizedValue === 'khachhang' || normalizedValue === 'passenger') {
    return 'Q2';
  }

  if (normalizedValue === 'q3' || normalizedValue === 'driver' || normalizedValue === 'taixe') {
    return 'Q3';
  }

  return normalizeText(value).toUpperCase();
}

function formatDialNumber(phone) {
  return normalizeText(phone).replace(/[^0-9+]/g, '');
}

function getInitials(name) {
  const parts = normalizeText(name)
    .split(' ')
    .filter(Boolean);

  if (parts.length === 0) {
    return 'SM';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function formatMessageTime(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(parsedDate);
}

function copyTextToClipboard(textToCopy) {
  const normalizedText = normalizeText(textToCopy);

  if (!normalizedText) {
    return Promise.resolve(false);
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(normalizedText).then(() => true).catch(() => false);
  }

  return new Promise((resolve) => {
    try {
      const temporaryTextArea = document.createElement('textarea');
      temporaryTextArea.value = normalizedText;
      temporaryTextArea.setAttribute('readonly', 'true');
      temporaryTextArea.style.position = 'fixed';
      temporaryTextArea.style.opacity = '0';
      temporaryTextArea.style.pointerEvents = 'none';
      document.body.appendChild(temporaryTextArea);
      temporaryTextArea.focus();
      temporaryTextArea.select();

      const copied = document.execCommand('copy');
      document.body.removeChild(temporaryTextArea);
      resolve(copied);
    } catch {
      resolve(false);
    }
  });
}

function buildBubbleClass(message, accountId, roleCode) {
  const senderAccountId = normalizeText(message?.senderAccountId);
  const senderRoleCode = normalizeRoleCode(message?.senderRoleCode);
  const normalizedAccountId = normalizeText(accountId);
  const normalizedRoleCode = normalizeRoleCode(roleCode);
  const isOwnMessage = senderAccountId && normalizedAccountId && senderAccountId.toLowerCase() === normalizedAccountId.toLowerCase();

  if (isOwnMessage) {
    return 'booking-tracking-modal__chat-bubble--customer';
  }

  if (senderRoleCode && normalizedRoleCode) {
    return senderRoleCode === normalizedRoleCode
      ? 'booking-tracking-modal__chat-bubble--customer'
      : 'booking-tracking-modal__chat-bubble--driver';
  }

  return 'booking-tracking-modal__chat-bubble--driver';
}

export default function TripChatDialog({
  open = false,
  bookingCode = '',
  accountId = '',
  roleCode = '',
  dialogTitle = 'Liên hệ tài xế',
  dialogSubtitle = '',
  statusLabel = '',
  statusValue = '',
  contactName = 'Đối tác chuyến xe',
  contactPhone = '',
  quickReplies = [],
  onClose,
  onNotify,
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const threadRef = useRef(null);
  const draftRef = useRef(null);
  const activeBookingCode = normalizeText(bookingCode);
  const activeAccountId = normalizeText(accountId);
  const activeRoleCode = normalizeRoleCode(roleCode);
  const contactDialNumber = formatDialNumber(contactPhone);
  const contactInitials = getInitials(contactName);
  const canMessage = Boolean(open && activeBookingCode && activeAccountId && activeRoleCode);

  useEffect(() => {
    if (!open) {
      setMessages([]);
      setDraft('');
      setLoading(false);
      setSending(false);
      setLoadError('');
      setSendError('');
      return undefined;
    }

    setDraft('');
    setLoadError('');
    setSendError('');

    const loadMessages = async () => {
      if (!canMessage) {
        setMessages([]);
        return;
      }

      setLoading(true);

      try {
        const response = await rideService.getTripMessages(activeBookingCode, {
          accountId: activeAccountId,
          roleCode: activeRoleCode,
          limit: 100,
        });

        const nextMessages = Array.isArray(response?.messages) ? response.messages : [];
        setMessages(nextMessages);
        setLoadError('');
      } catch (error) {
        const errorMessage = error?.message || 'Không thể tải hội thoại chuyến xe.';
        setLoadError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    const handleRideEvent = (event = {}) => {
      const eventType = normalizeText(event?.type ?? '').toLowerCase();
      const eventBookingCode = normalizeText(event?.bookingCode ?? event?.booking?.bookingCode ?? '');

      if (!eventBookingCode || eventBookingCode !== activeBookingCode) {
        return;
      }

      if (eventType === 'ride.trip.message.created') {
        void loadMessages();
      }
    };

    void loadMessages();

    const disconnectRideEventStream = canMessage
      ? connectRideEventStream({
          accountId: activeAccountId,
          roleCode: activeRoleCode,
          onEvent: handleRideEvent,
        })
      : () => {};

    const refreshTimerId = window.setInterval(() => {
      void loadMessages();
    }, 6000);

    if (typeof refreshTimerId.unref === 'function') {
      refreshTimerId.unref();
    }

    return () => {
      disconnectRideEventStream();
      window.clearInterval(refreshTimerId);
    };
  }, [activeAccountId, activeBookingCode, activeRoleCode, canMessage, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleEscapeKey = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleClose();
    };

    document.addEventListener('keydown', handleEscapeKey, true);

    return () => {
      document.removeEventListener('keydown', handleEscapeKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    window.requestAnimationFrame(() => {
      draftRef.current?.focus();
    });
  }, [open]);

  if (!open) {
    return null;
  }

  const handleClose = () => {
    onClose?.();
  };

  const handleCopyPhone = async () => {
    const copied = await copyTextToClipboard(contactPhone);

    if (copied) {
      onNotify?.('Đã sao chép số liên hệ.', 'success', 1800);
      return;
    }

    onNotify?.('Không thể sao chép số liên hệ trên trình duyệt hiện tại.', 'error', 2200);
  };

  const handleCallContact = () => {
    if (!contactDialNumber) {
      onNotify?.('Số điện thoại liên hệ đang được cập nhật.', 'error', 2200);
      return;
    }

    window.location.href = `tel:${contactDialNumber}`;
  };

  const handlePresetSelect = (presetText) => {
    setDraft(normalizeText(presetText));
    window.requestAnimationFrame(() => {
      draftRef.current?.focus();
    });
  };

  const handleSubmit = async () => {
    const normalizedDraft = normalizeText(draft);

    if (!normalizedDraft || sending || !canMessage) {
      return;
    }

    setSending(true);
    setSendError('');

    try {
      const response = await rideService.sendTripMessage(activeBookingCode, {
        accountId: activeAccountId,
        roleCode: activeRoleCode,
        messageText: normalizedDraft,
      });

      setDraft('');

      const sentMessage = response?.message;
      if (sentMessage) {
        setMessages((currentMessages) => [...currentMessages.filter((message) => String(message.messageId) !== String(sentMessage.messageId)), sentMessage]);
      }

      const refreshedMessages = await rideService.getTripMessages(activeBookingCode, {
        accountId: activeAccountId,
        roleCode: activeRoleCode,
        limit: 100,
      });

      setMessages(Array.isArray(refreshedMessages?.messages) ? refreshedMessages.messages : []);
    } catch (error) {
      const errorMessage = error?.message || 'Không thể gửi tin nhắn lúc này.';
      setSendError(errorMessage);
      onNotify?.(errorMessage, 'error', 2400);
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="booking-tracking-modal__chat-layer" role="dialog" aria-modal="true" aria-label={dialogTitle}>
      <div className="booking-tracking-modal__chat-backdrop" onClick={handleClose} aria-hidden="true" />

      <section className="booking-tracking-modal__chat-sheet">
        <button className="booking-tracking-modal__chat-close" type="button" onClick={handleClose} aria-label="Đóng khung chat">
          <img className="booking-tracking-modal__chat-close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="booking-tracking-modal__chat-header">
          <div className="booking-tracking-modal__chat-header-copy">
            <span className="booking-tracking-modal__chat-eyebrow">{dialogTitle}</span>
            <h4>{contactName || 'Đối tác chuyến xe'}</h4>
            <p>{dialogSubtitle || 'Trao đổi trực tiếp về chuyến xe.'}</p>
          </div>

          {statusLabel || statusValue ? (
            <div className="booking-tracking-modal__chat-status">
              <span className="booking-tracking-modal__chat-status-dot" aria-hidden="true" />
              <strong>{statusLabel || 'Đang trò chuyện'}</strong>
              <span>{statusValue || 'Đang cập nhật'}</span>
            </div>
          ) : null}
        </header>

        <div className="booking-tracking-modal__chat-body">
          <section className="booking-tracking-modal__chat-thread" ref={threadRef} aria-label="Nội dung trao đổi">
            <div className="booking-tracking-modal__chat-thread-inner">
              {messages.length > 0 ? messages.map((message) => (
                <div
                  key={message.messageId}
                  className={classNames(
                    'booking-tracking-modal__chat-bubble',
                    buildBubbleClass(message, activeAccountId, activeRoleCode),
                  )}
                  title={formatMessageTime(message.createdAt)}
                >
                  <p>{message.messageText}</p>
                </div>
              )) : (
                <div className="booking-tracking-modal__chat-empty">
                  Chưa có tin nhắn nào trong chuyến này.
                </div>
              )}
            </div>
          </section>

          <aside className="booking-tracking-modal__chat-side">
            <div className="booking-tracking-modal__chat-contact-card">
              <div className="booking-tracking-modal__chat-contact-avatar" aria-hidden="true">
                {contactInitials}
              </div>

              <strong>{contactName || 'Đối tác chuyến xe'}</strong>
              <span>{contactPhone || 'Đang cập nhật số điện thoại'}</span>

              <div className="booking-tracking-modal__chat-contact-actions">
                <button className="booking-tracking-modal__chat-action-button" type="button" onClick={handleCallContact} disabled={!contactDialNumber}>
                  Gọi ngay
                </button>

                <button className="booking-tracking-modal__chat-action-button booking-tracking-modal__chat-action-button--ghost" type="button" onClick={handleCopyPhone} disabled={!contactDialNumber}>
                  Sao chép SĐT
                </button>
              </div>
            </div>

            {quickReplies.length > 0 ? (
              <div className="booking-tracking-modal__chat-presets" aria-label="Gợi ý nhắn nhanh">
                {quickReplies.map((presetText) => (
                  <button
                    key={presetText}
                    className="booking-tracking-modal__chat-preset"
                    type="button"
                    onClick={() => handlePresetSelect(presetText)}
                  >
                    {presetText}
                  </button>
                ))}
              </div>
            ) : null}
          </aside>
        </div>

        <footer className="booking-tracking-modal__chat-footer">
          <textarea
            ref={draftRef}
            className="booking-tracking-modal__chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Nhập tin nhắn..."
            rows={2}
            disabled={!canMessage || sending}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />

          <button
            className="booking-tracking-modal__chat-send"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!normalizeText(draft) || sending || !canMessage}
          >
            {sending ? 'Đang gửi...' : 'Gửi'}
          </button>
        </footer>

        {loadError ? <p className="booking-tracking-modal__chat-error" role="alert">{loadError}</p> : null}
        {sendError ? <p className="booking-tracking-modal__chat-error" role="alert">{sendError}</p> : null}
        {loading && messages.length === 0 ? <p className="booking-tracking-modal__chat-loading">Đang tải hội thoại...</p> : null}
      </section>
    </div>,
    document.body,
  );
}
