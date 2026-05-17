import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import CancelRideReasonDialog from './CancelRideReasonDialog';
import DriverLocationDialog from './DriverLocationDialog';
import TripChatDialog from './TripChatDialog';
import RoutePreviewMap from './RoutePreviewMap';
import { rideService } from '../../services/rideService';
import { clockIcon, closeIcon, motorbikeIcon, originIcon, phoneIcon, pinIcon, starIcon, userIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';

const CUSTOMER_TRACKING_STEPS = [
  {
    id: 'waiting',
    title: 'Đang chờ',
    description: 'Hệ thống đang tìm tài xế phù hợp quanh điểm đón.',
  },
  {
    id: 'assigned',
    title: 'Đã có tài xế',
    description: 'Tài xế đã nhận đơn và chuẩn bị di chuyển.',
  },
  {
    id: 'heading-pickup',
    title: 'Đang đến',
    description: 'Tài xế đang di chuyển đến vị trí đón của bạn.',
  },
  {
    id: 'picked-up',
    title: 'Đang di chuyển',
    description: 'Bạn đã lên xe và chuyến đang được thực hiện.',
  },
  {
    id: 'completed',
    title: 'Hoàn thành',
    description: 'Chuyến xe đã hoàn thành.',
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

function formatLicensePlate(value) {
  const normalizedValue = normalizeText(value).toUpperCase();

  if (!normalizedValue) {
    return '';
  }

  return normalizedValue.replace(/\s*-\s*/g, ' - ');
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePaymentStatusToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function extractTripHistoryItems(response) {
  if (Array.isArray(response?.items)) {
    return response.items;
  }

  if (Array.isArray(response?.history)) {
    return response.history;
  }

  if (Array.isArray(response?.data?.items)) {
    return response.data.items;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return [];
}

function normalizeTripStatusToken(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function getCustomerTrackingStepIndex(tripStatusToken) {
  if (tripStatusToken === 'dadon' || tripStatusToken === 'pickedup' || tripStatusToken === 'dangthuchien' || tripStatusToken === 'inprogress') {
    return 3;
  }

  if (tripStatusToken === 'dangden' || tripStatusToken === 'headingpickup') {
    return 2;
  }

  if (tripStatusToken === 'danhanchuyen' || tripStatusToken === 'accepted' || tripStatusToken === 'chotaixe' || tripStatusToken === 'choxacnhan') {
    return 1;
  }

  if (tripStatusToken === 'hoanthanh' || tripStatusToken === 'completed') {
    return 4;
  }

  return 0;
}

function getDriverInitials(name) {
  const parts = normalizeText(name)
    .split(' ')
    .filter(Boolean);

  if (parts.length === 0) {
    return 'TX';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function CopyGlyph() {
  return (
    <svg className="booking-tracking-modal__glyph-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="6" y="5" width="7" height="8" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="3" y="3" width="7" height="8" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg className="booking-tracking-modal__glyph-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 3.5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8.2L5.3 13v-2.5H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DriverPlateGlyph() {
  return (
    <svg className="booking-tracking-modal__plate-icon" viewBox="0 0 24 16" aria-hidden="true" focusable="false">
      <rect x="1.2" y="1.4" width="21.6" height="13.2" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.1 5.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 5.2h8.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.1 8.6h15.7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.1 11.4h9.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function isDriverAssignedTripStatus(tripStatusToken) {
  return [
    'danhanchuyen',
    'accepted',
    'dangden',
    'headingpickup',
    'dadon',
    'pickedup',
    'dangthuchien',
    'inprogress',
    'hoanthanh',
    'completed',
  ].includes(tripStatusToken);
}

function isDriverPrePickupTripStatus(tripStatusToken) {
  return ['danhanchuyen', 'accepted', 'dangden', 'headingpickup'].includes(tripStatusToken);
}

function isDriverOnTripTripStatus(tripStatusToken) {
  return ['dadon', 'pickedup', 'dangthuchien', 'inprogress', 'hoanthanh', 'completed'].includes(tripStatusToken);
}

function getAssignedStepIndex(tripStatusToken) {
  if (
    tripStatusToken === 'dadon'
    || tripStatusToken === 'pickedup'
    || tripStatusToken === 'dangthuchien'
    || tripStatusToken === 'inprogress'
    || tripStatusToken === 'hoanthanh'
    || tripStatusToken === 'completed'
  ) {
    return 2;
  }

  if (tripStatusToken === 'dangden' || tripStatusToken === 'headingpickup') {
    return 1;
  }

  return 0;
}

function getTripStatusCopy(tripStatusToken, driverName = '') {
  const normalizedDriverName = normalizeText(driverName);

  if (tripStatusToken === 'danhanchuyen' || tripStatusToken === 'accepted') {
    return {
      title: 'Tài xế đã nhận đơn',
      description: normalizedDriverName
        ? `${normalizedDriverName} đang trên đường đến điểm đón.`
        : 'Tài xế đang trên đường đến điểm đón.',
      badge: 'Đã nhận chuyến',
      progress: 58,
    };
  }

  if (tripStatusToken === 'dangden' || tripStatusToken === 'headingpickup') {
    return {
      title: 'Tài xế đang đến điểm đón',
      description: normalizedDriverName
        ? `${normalizedDriverName} đang di chuyển đến vị trí của bạn.`
        : 'Tài xế đang di chuyển đến vị trí của bạn.',
      badge: 'Đang đến điểm đón',
      progress: 74,
    };
  }

  if (
    tripStatusToken === 'dadon'
    || tripStatusToken === 'pickedup'
    || tripStatusToken === 'dangthuchien'
    || tripStatusToken === 'inprogress'
  ) {
    return {
      title: 'Tài xế đã đón khách',
      description: normalizedDriverName
        ? `${normalizedDriverName} đã đón bạn và chuyến đang được thực hiện.`
        : 'Chuyến đang được thực hiện.',
      badge: 'Đang di chuyển',
      progress: 90,
    };
  }

  if (tripStatusToken === 'hoanthanh' || tripStatusToken === 'completed') {
    return {
      title: 'Chuyến đã hoàn thành',
      description: 'Cảm ơn bạn đã sử dụng SmartRide.',
      badge: 'Hoàn tất',
      progress: 100,
    };
  }

  if (tripStatusToken === 'dahuy' || tripStatusToken === 'cancelled') {
    return {
      title: 'Chuyến đã hủy',
      description: 'Yêu cầu chuyến không còn hiệu lực.',
      badge: 'Đã hủy',
      progress: 0,
    };
  }

  return {
    title: 'Đang tìm tài xế gần đó',
    description: 'Hệ thống đang ghép chuyến với tài xế phù hợp quanh điểm đón để tạo cuốc xe nhanh nhất.',
    badge: 'Đang ghép chuyến',
    progress: 25,
  };
}

export default function RideTrackingModal({
  open = false,
  booking = null,
  onClose,
  onMinimize,
  onCancel,
  onNotify,
  onBookingSync,
}) {
  const [liveBooking, setLiveBooking] = useState(booking);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [driverInfoDialogOpen, setDriverInfoDialogOpen] = useState(false);
  const [driverLocationDialogOpen, setDriverLocationDialogOpen] = useState(false);
  const cancelRequestInFlightRef = useRef(false);
  const lastRefreshTimeRef = useRef(0);

  // Memoize normalized bookingCode and accountId to prevent effect from re-running on every render
  const { normalizedBookingCode, normalizedAccountId } = useMemo(() => ({
    normalizedBookingCode: normalizeText(booking?.bookingCode ?? ''),
    normalizedAccountId: normalizeText(booking?.customerAccountId ?? booking?.accountId ?? ''),
  }), [booking?.bookingCode, booking?.customerAccountId, booking?.accountId]);

  useEffect(() => {
    if (!open) {
      setCancelDialogOpen(false);
      setChatDialogOpen(false);
      setDriverInfoDialogOpen(false);
      setDriverLocationDialogOpen(false);
      setLiveBooking(booking);
      return undefined;
    }

    setLiveBooking(booking);
    setChatDialogOpen(false);
    setDriverInfoDialogOpen(false);
    setDriverLocationDialogOpen(false);

    const releaseBodyScrollLock = acquireBodyScrollLock();

    return () => {
      releaseBodyScrollLock();
    };
  }, [booking?.bookingCode, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLiveBooking(booking);
  }, [booking, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (!normalizedBookingCode || !normalizedAccountId) {
      return undefined;
    }

    let isMounted = true;

    const refreshLiveBooking = async () => {
      try {
        const response = await rideService.getTripHistory({
          accountId: normalizedAccountId,
          roleCode: 'Q2',
          limit: 24,
        });

        let matchedBooking = extractTripHistoryItems(response).find((item) => {
          const itemBookingCode = normalizeText(item?.bookingCode ?? item?.id ?? '');
          return itemBookingCode && itemBookingCode === normalizedBookingCode;
        });

        if (!matchedBooking) {
          const deepHistoryResponse = await rideService.getTripHistory({
            accountId: normalizedAccountId,
            roleCode: 'Q2',
            limit: 100,
          });

          matchedBooking = extractTripHistoryItems(deepHistoryResponse).find((item) => {
            const itemBookingCode = normalizeText(item?.bookingCode ?? item?.id ?? '');
            return itemBookingCode && itemBookingCode === normalizedBookingCode;
          });
        }

        if (isMounted && matchedBooking) {
          setLiveBooking((current) => ({
            ...current,
            ...matchedBooking,
          }));
          onBookingSync?.(matchedBooking);
        }
      } catch {
        // Keep the optimistic snapshot if the history refresh fails.
      }
    };

    // Only call if last refresh was more than 1 second ago (debounce rapid effect re-runs)
    const now = Date.now();
    if (now - lastRefreshTimeRef.current > 1000) {
      lastRefreshTimeRef.current = now;
      void refreshLiveBooking();
    }

    return () => {
      isMounted = false;
    };
  }, [normalizedBookingCode, normalizedAccountId, onBookingSync, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (driverInfoDialogOpen) {
          setDriverInfoDialogOpen(false);
          return;
        }

        if (driverLocationDialogOpen) {
          setDriverLocationDialogOpen(false);
          return;
        }

        if (chatDialogOpen) {
          setChatDialogOpen(false);
          return;
        }

        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [chatDialogOpen, driverInfoDialogOpen, driverLocationDialogOpen, onClose, open]);

  const bookingTimeLabel = formatBookingTime(booking?.createdAt);
  const currentBooking = liveBooking ?? booking;
  const pickupLabel = String(currentBooking?.pickup?.label ?? '').trim() || 'Điểm đón';
  const destinationLabel = String(currentBooking?.destination?.label ?? '').trim() || 'Điểm đến';
  const bookingCode = String(currentBooking?.bookingCode ?? '').trim();
  const rideTitle = String(currentBooking?.rideTitle ?? currentBooking?.vehicleLabel ?? '').trim() || 'Chuyến xe';
  const paymentSummary = String(currentBooking?.paymentSummary ?? currentBooking?.paymentMethodLabel ?? '').trim();
  const paymentStatus = String(currentBooking?.paymentStatusLabel ?? '').trim();
  const paymentStatusToken = normalizePaymentStatusToken(currentBooking?.paymentStatus ?? currentBooking?.paymentStatusLabel);
  const priceLabel = String(currentBooking?.priceFormatted ?? '').trim();
  const routeDistanceLabel = formatKilometers(currentBooking?.routeDistanceKm);
  const etaLabel = formatMinutes(currentBooking?.etaMinutes);
  const tripStatusToken = normalizeTripStatusToken(
    currentBooking?.tripStatus
    ?? currentBooking?.status
    ?? currentBooking?.tripStatusLabel
    ?? currentBooking?.statusLabel
    ?? '',
  );
  const liveStatus = getTripStatusCopy(tripStatusToken, currentBooking?.driverDisplayName ?? currentBooking?.driverName ?? '');
  const driverName = String(currentBooking?.driverDisplayName ?? currentBooking?.driverName ?? '').trim();
  const driverPhone = String(currentBooking?.driverPhone ?? '').trim();
  const driverVehicleLabel = String(currentBooking?.driverVehicleLabel ?? currentBooking?.vehicleLabel ?? currentBooking?.rideTitle ?? '').trim();
  const driverLicensePlateLabel = formatLicensePlate(currentBooking?.driverLicensePlate ?? currentBooking?.driverVehicleLicensePlate ?? '');
  const driverRatingValue = Number(currentBooking?.driverRating ?? currentBooking?.rating ?? 4) || 4;
  const driverRatingStars = Math.max(0, Math.min(5, Math.round(driverRatingValue)));
  const driverInitials = getDriverInitials(driverName);
  const isPrePickupAssignedState = isDriverPrePickupTripStatus(tripStatusToken);
  const isOnTripState = isDriverOnTripTripStatus(tripStatusToken);
  const isAssignedState = isPrePickupAssignedState || isOnTripState;
  const canCancelTrip = !isOnTripState;
  const trackingStepIndex = getCustomerTrackingStepIndex(tripStatusToken);
  const trackingSteps = CUSTOMER_TRACKING_STEPS;
  const activeStep = trackingSteps[trackingStepIndex] ?? trackingSteps[0];
  const progressValue = liveStatus.progress;
  const canCallDriver = Boolean(normalizeText(driverPhone));
  const driverVehicleDisplayLabel = driverVehicleLabel || 'RiBike';
  const shouldCloseTripFlow =
    tripStatusToken === 'hoanthanh' ||
    tripStatusToken === 'completed' ||
    tripStatusToken === 'dahuy' ||
    tripStatusToken === 'cancelled';
  const bookingEyebrow = isOnTripState
    ? 'Chuyến đang di chuyển'
    : paymentStatusToken === 'thatbai'
      ? 'Thanh toán không thành công'
      : paymentStatusToken === 'dathanhtoan'
        ? 'Đặt xe thành công'
        : 'Đang chờ thanh toán';

  const handleDismissTracking = () => {
    if (shouldCloseTripFlow) {
      onClose?.();
      return;
    }

    if (onMinimize) {
      onMinimize();
      return;
    }

    onClose?.();
  };

  const copyTextToClipboard = async (textToCopy) => {
    const normalizedText = normalizeText(textToCopy);

    if (!normalizedText) {
      return false;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(normalizedText);
        return true;
      }

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
      return copied;
    } catch {
      return false;
    }
  };

  const handleChatDriver = () => {
    if (!driverPhone) {
      onNotify?.('Số điện thoại tài xế đang được cập nhật.', 'error', 2200);
      return;
    }

    setCancelDialogOpen(false);
    setDriverInfoDialogOpen(false);
    setChatDialogOpen(true);
  };

  const handleOpenDriverInfoDialog = () => {
    if (!driverName) {
      return;
    }

    setCancelDialogOpen(false);
    setChatDialogOpen(false);
    setDriverInfoDialogOpen(true);
  };

  const handleCloseDriverInfoDialog = () => {
    setDriverInfoDialogOpen(false);
  };

  const handleOpenDriverLocationDialog = () => {
    if (!bookingCode || !isAssignedState) {
      onNotify?.('Vị trí tài xế sẽ hiển thị sau khi đơn được tài xế nhận.', 'error', 2200);
      return;
    }

    setCancelDialogOpen(false);
    setChatDialogOpen(false);
    setDriverInfoDialogOpen(false);
    setDriverLocationDialogOpen(true);
  };

  const handleCloseDriverLocationDialog = () => {
    setDriverLocationDialogOpen(false);
  };

  const handleDriverCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleOpenDriverInfoDialog();
  };

  const handleCancel = () => {
    if (!booking || cancelRequestInFlightRef.current || !canCancelTrip) {
      return;
    }

    setChatDialogOpen(false);
    setDriverInfoDialogOpen(false);
    setCancelDialogOpen(true);
  };

  const handleCancelDialogClose = () => {
    if (cancelRequestInFlightRef.current) {
      return;
    }

    setCancelDialogOpen(false);
  };

  const handleCancelDialogConfirm = async (cancelDetails = null) => {
    if (cancelRequestInFlightRef.current) {
      return;
    }

    cancelRequestInFlightRef.current = true;
    setCancelDialogOpen(false);

    try {
      await onCancel?.(cancelDetails);
    } catch (error) {
      onNotify?.(error?.message || 'Không thể hủy chuyến.', 'error', 2200);
    } finally {
      cancelRequestInFlightRef.current = false;
    }
  };

  const handleCloseChatDialog = () => {
    setChatDialogOpen(false);
  };

  const handleBackdropClick = () => {
    setCancelDialogOpen(false);
    setChatDialogOpen(false);
    setDriverInfoDialogOpen(false);
    setDriverLocationDialogOpen(false);

    handleDismissTracking();
  };

  const handleCopyText = async (textToCopy, successMessage) => {
    const copied = await copyTextToClipboard(textToCopy);

    if (copied) {
      onNotify?.(successMessage, 'success', 1800);
      return;
    }

    onNotify?.('Không thể sao chép nội dung này trên trình duyệt hiện tại.', 'error', 2200);
  };

  const handleCallDriver = () => {
    if (!canCallDriver) {
      return;
    }

    window.location.href = `tel:${normalizeText(driverPhone).replace(/\s+/g, '')}`;
  };

  const cancelRideDialogNode = (
    <CancelRideReasonDialog
      open={cancelDialogOpen}
      onCancel={handleCancelDialogClose}
      onConfirm={handleCancelDialogConfirm}
    />
  );

  const tripChatDialogNode = (
    <TripChatDialog
      open={chatDialogOpen}
      bookingCode={bookingCode}
      accountId={String(currentBooking?.customerAccountId ?? currentBooking?.accountId ?? '').trim()}
      roleCode="Q2"
      dialogTitle="Liên hệ tài xế"
      dialogSubtitle={`${driverVehicleDisplayLabel}${driverLicensePlateLabel ? ` · ${driverLicensePlateLabel}` : ''}`}
      statusLabel="Đang tới điểm đón"
      statusValue={driverPhone || 'Đang cập nhật'}
      contactName={driverName || 'Tài xế'}
      contactPhone={driverPhone}
      quickReplies={[
        'Dạ anh tới gần chưa ạ?',
        'Em đang đứng ở cổng chính ạ.',
        'Anh tới nơi gọi em giúp nhé.',
      ]}
      onClose={handleCloseChatDialog}
      onNotify={onNotify}
    />
  );

  const driverInfoDialogNode = driverInfoDialogOpen && driverName ? createPortal(
    <div className="booking-tracking-modal__driver-layer" role="dialog" aria-modal="true" aria-label={`Thông tin tài xế ${driverName}`}>
      <div className="booking-tracking-modal__driver-backdrop" onClick={handleCloseDriverInfoDialog} aria-hidden="true" />

      <section className="booking-tracking-modal__driver-sheet">
        <button className="booking-tracking-modal__driver-close" type="button" onClick={handleCloseDriverInfoDialog} aria-label="Đóng thông tin tài xế">
          <img className="booking-tracking-modal__driver-close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <section className="booking-tracking-modal__driver-card booking-tracking-modal__driver-card--profile">
          <div className="booking-tracking-modal__driver-head booking-tracking-modal__driver-head--profile">
            <div className="booking-tracking-modal__driver-avatar booking-tracking-modal__driver-avatar--profile" aria-hidden="true">
              {driverInitials || <img className="booking-tracking-modal__driver-avatar-icon" src={userIcon} alt="" aria-hidden="true" />}
            </div>

            <div className="booking-tracking-modal__driver-copy booking-tracking-modal__driver-copy--profile">
              <p className="booking-tracking-modal__section-kicker">Thông tin tài xế</p>
              <div className="booking-tracking-modal__driver-copy-title">
                <h4>{driverName || 'Tài xế'}</h4>
              </div>
              <p>{driverVehicleDisplayLabel || 'Đang cập nhật loại xe'}</p>
            </div>

            <div className="booking-tracking-modal__driver-profile-code">
              <span>Mã chuyến</span>
              <strong>{bookingCode || '--'}</strong>
            </div>
          </div>

          <div className="booking-tracking-modal__driver-profile-list">
            <div className="booking-tracking-modal__driver-profile-row">
              <span className="booking-tracking-modal__driver-profile-label">
                <img className="booking-tracking-modal__driver-profile-icon" src={phoneIcon} alt="" aria-hidden="true" />
                Số điện thoại
              </span>

              <strong>{driverPhone || 'Đang cập nhật'}</strong>
            </div>

            <div className="booking-tracking-modal__driver-profile-row">
              <span className="booking-tracking-modal__driver-profile-label">
                <img className="booking-tracking-modal__driver-profile-icon booking-tracking-modal__driver-profile-icon--vehicle" src={motorbikeIcon} alt="" aria-hidden="true" />
                Phương tiện
              </span>

              <strong>{driverVehicleDisplayLabel || 'Đang cập nhật'}</strong>
            </div>

            <div className="booking-tracking-modal__driver-profile-row">
              <span className="booking-tracking-modal__driver-profile-label">
                <span className="booking-tracking-modal__driver-profile-symbol" aria-hidden="true">#</span>
                Biển số
              </span>

              <strong>{driverLicensePlateLabel || 'Đang cập nhật'}</strong>
            </div>

            <div className="booking-tracking-modal__driver-profile-row">
              <span className="booking-tracking-modal__driver-profile-label">
                <img className="booking-tracking-modal__driver-profile-icon" src={clockIcon} alt="" aria-hidden="true" />
                Trạng thái
              </span>

              <strong>{liveStatus.title}</strong>
            </div>
          </div>

          <div className="booking-tracking-modal__driver-profile-actions">
            <button className="booking-tracking-modal__chat-button booking-tracking-modal__chat-button--dialog" type="button" onClick={handleChatDriver} disabled={!driverPhone}>
              <ChatGlyph />
              <span>Chat</span>
            </button>

            <button className="booking-tracking-modal__call-driver booking-tracking-modal__call-driver--dialog" type="button" onClick={() => { handleCloseDriverInfoDialog(); handleCallDriver(); }} disabled={!canCallDriver}>
              <img className="booking-tracking-modal__call-driver-icon" src={phoneIcon} alt="" aria-hidden="true" />
              Gọi tài xế
            </button>
          </div>
        </section>
      </section>
    </div>,
    document.body,
  ) : null;

  if (!open || !booking) {
    return null;
  }

  if (isPrePickupAssignedState) {
    return createPortal(
      <div className={classNames('booking-tracking-modal', 'booking-tracking-modal--assigned-preview')} role="dialog" aria-modal="true" aria-label="Tài xế đã nhận chuyến">
        <div className="booking-tracking-modal__backdrop" onClick={handleBackdropClick} aria-hidden="true" />

        <section className="booking-tracking-modal__window booking-tracking-modal__window--preview">
          <button className="booking-tracking-modal__close" type="button" onClick={handleDismissTracking} aria-label="Thu nhỏ">
            <img className="booking-tracking-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
          </button>

          <div className="booking-tracking-modal__assigned-preview">
            <div className="booking-tracking-modal__assigned-preview-grid">
              <div className="booking-tracking-modal__assigned-preview-left">
                <div className="booking-tracking-modal__assigned-card booking-tracking-modal__assigned-card--route">
                  <div className="booking-tracking-modal__route-row booking-tracking-modal__route-row--preview">
                    <span className="booking-tracking-modal__route-icon booking-tracking-modal__route-icon--pickup booking-tracking-modal__route-icon--preview">
                      <img className="booking-tracking-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
                    </span>

                    <div className="booking-tracking-modal__route-copy booking-tracking-modal__route-copy--preview">
                      <span>Điểm đón</span>
                      <strong>{pickupLabel}</strong>
                    </div>
                  </div>

                  <div className="booking-tracking-modal__route-divider booking-tracking-modal__route-divider--preview" />

                  <div className="booking-tracking-modal__route-row booking-tracking-modal__route-row--preview">
                    <span className="booking-tracking-modal__route-icon booking-tracking-modal__route-icon--destination booking-tracking-modal__route-icon--preview">
                      <img className="booking-tracking-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
                    </span>

                    <div className="booking-tracking-modal__route-copy booking-tracking-modal__route-copy--preview">
                      <span>Điểm đến</span>
                      <strong>{destinationLabel}</strong>
                    </div>
                  </div>
                </div>

                <div className="booking-tracking-modal__assigned-card booking-tracking-modal__assigned-card--trip">
                  <div className="booking-tracking-modal__trip-head booking-tracking-modal__trip-head--preview">
                    <div>
                      <span className="booking-tracking-modal__trip-kicker booking-tracking-modal__trip-kicker--preview">{rideTitle}</span>
                    </div>

                    <button className="booking-tracking-modal__booking-code booking-tracking-modal__booking-code--preview" type="button" onClick={() => void handleCopyText(bookingCode, 'Đã sao chép mã chuyến.') } aria-label="Sao chép mã chuyến">
                      <span>{bookingCode || '--'}</span>
                      <CopyGlyph />
                    </button>
                  </div>

                  <div className="booking-tracking-modal__trip-preview-grid">
                    <div className="booking-tracking-modal__trip-preview-row">
                      <span className="booking-tracking-modal__trip-preview-label">Thời gian</span>
                      <strong className="booking-tracking-modal__trip-preview-value">{bookingTimeLabel || '--'}</strong>
                    </div>

                    <div className="booking-tracking-modal__trip-preview-row booking-tracking-modal__trip-preview-row--payment">
                      <span className="booking-tracking-modal__payment-chip">{paymentSummary || 'Tiền mặt'}</span>
                      <strong className="booking-tracking-modal__trip-preview-value booking-tracking-modal__trip-preview-value--price">{priceLabel || '--'}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="booking-tracking-modal__assigned-preview-right">
                <div
                  className={classNames('booking-tracking-modal__driver-card', driverName && 'booking-tracking-modal__driver-card--interactive')}
                  role={driverName ? 'button' : undefined}
                  tabIndex={driverName ? 0 : undefined}
                  aria-haspopup={driverName ? 'dialog' : undefined}
                  aria-label={driverName ? `Xem thêm thông tin tài xế ${driverName}` : 'Thông tin tài xế đang được cập nhật'}
                  onClick={driverName ? handleOpenDriverInfoDialog : undefined}
                  onKeyDown={driverName ? handleDriverCardKeyDown : undefined}
                >
                  <div className="booking-tracking-modal__driver-avatar booking-tracking-modal__driver-avatar--preview" aria-hidden="true">
                    <img className="booking-tracking-modal__driver-avatar-icon" src={userIcon} alt="" aria-hidden="true" />
                  </div>

                  <div className="booking-tracking-modal__driver-name-row">
                    <strong className="booking-tracking-modal__driver-name">{driverName || 'Nguyễn Văn A'}</strong>
                    <span className="booking-tracking-modal__driver-more booking-tracking-modal__driver-more--inline">Thêm</span>
                  </div>

                  <div className="booking-tracking-modal__driver-rating" aria-label={`Đánh giá ${driverRatingStars} trên 5 sao`}>
                    {Array.from({ length: 5 }).map((_, index) => (
                      <img
                        key={`${index + 1}`}
                        className={classNames('booking-tracking-modal__driver-rating-star', index >= driverRatingStars && 'is-muted')}
                        src={starIcon}
                        alt=""
                        aria-hidden="true"
                      />
                    ))}
                  </div>

                  <div className="booking-tracking-modal__contact-row">
                    <div className="booking-tracking-modal__phone-block">
                      <img className="booking-tracking-modal__inline-icon" src={phoneIcon} alt="" aria-hidden="true" />
                      <span className="booking-tracking-modal__phone-number">{driverPhone || 'Đang cập nhật'}</span>
                      <button className="booking-tracking-modal__icon-button" type="button" onClick={() => void handleCopyText(driverPhone, 'Đã sao chép số điện thoại tài xế.') } aria-label="Sao chép số điện thoại tài xế">
                        <CopyGlyph />
                      </button>
                    </div>

                    <button className="booking-tracking-modal__chat-button" type="button" onClick={(event) => { event.stopPropagation(); handleChatDriver(); }} disabled={!driverPhone}>
                      <ChatGlyph />
                      <span>Chat</span>
                    </button>
                  </div>

                  <div className="booking-tracking-modal__driver-line">
                    <img className="booking-tracking-modal__inline-icon booking-tracking-modal__inline-icon--vehicle" src={motorbikeIcon} alt="" aria-hidden="true" />
                    <span>{driverVehicleDisplayLabel}</span>
                  </div>

                  <div className="booking-tracking-modal__driver-line">
                    <DriverPlateGlyph />
                    <span>{driverLicensePlateLabel || 'Đang cập nhật'}</span>
                  </div>
                </div>

                <footer className="booking-tracking-modal__preview-actions">
                  <button
                    className="booking-tracking-modal__cancel booking-tracking-modal__cancel--preview"
                    type="button"
                    onClick={handleCancel}
                    disabled={!canCancelTrip}
                    title={canCancelTrip ? 'Hủy chuyến' : 'Sau khi tài xế đã đón khách, chuyến không thể hủy.'}
                  >
                    Hủy chuyến
                  </button>

                  <button className="booking-tracking-modal__location-button" type="button" onClick={handleOpenDriverLocationDialog} disabled={!isAssignedState}>
                    Vị trí tài xế
                  </button>
                </footer>

                <p className="booking-tracking-modal__preview-note">Hủy chuyến sau khi tài xế nhận có thể phát sinh chi phí</p>
              </div>
            </div>
          </div>
        </section>

        {cancelRideDialogNode}
        {tripChatDialogNode}
        <DriverLocationDialog
          open={driverLocationDialogOpen}
          booking={currentBooking}
          onClose={handleCloseDriverLocationDialog}
          onNotify={onNotify}
        />
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className={classNames('booking-tracking-modal', 'booking-tracking-modal--tracking', isOnTripState && 'booking-tracking-modal--tracking-live', !driverName && 'booking-tracking-modal--tracking-search')} role="dialog" aria-modal="true" aria-label={isOnTripState ? 'Chuyến đi đang diễn ra' : 'Đang tìm tài xế'}>
      <div className="booking-tracking-modal__backdrop" onClick={handleBackdropClick} aria-hidden="true" />

      <section className="booking-tracking-modal__window booking-tracking-modal__window--tracking">
        <button className="booking-tracking-modal__close" type="button" onClick={handleDismissTracking} aria-label="Thu nhỏ">
          <img className="booking-tracking-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="booking-tracking-modal__header booking-tracking-modal__header--tracking">
          <p className="booking-tracking-modal__eyebrow">{bookingEyebrow}</p>
          <h3>{liveStatus.title}</h3>
          <p className="booking-tracking-modal__description">{liveStatus.description}</p>
          <div className="booking-tracking-modal__status-chip-row booking-tracking-modal__status-chip-row--tracking" aria-label="Trạng thái chuyến xe">
            <span className="booking-tracking-modal__status-chip booking-tracking-modal__status-chip--active">{liveStatus.badge}</span>
            <span className="booking-tracking-modal__status-chip">Theo dõi lộ trình</span>
            <span className="booking-tracking-modal__status-chip booking-tracking-modal__status-chip--tone">{activeStep.title}</span>
          </div>
        </header>

        <div className="booking-tracking-modal__tracking-stage">
          <div className="booking-tracking-modal__tracking-map-shell">
            <RoutePreviewMap
              className="booking-tracking-modal__map"
              pickupPosition={currentBooking?.pickup?.position}
              destinationPosition={currentBooking?.destination?.position}
              routeGeometry={currentBooking?.routeGeometry}
              routeProvider={currentBooking?.routeProvider}
              showExpandButton={false}
              showProviderLabel={false}
            />

            <div className="booking-tracking-modal__map-badge">{liveStatus.badge}</div>
          </div>

          <aside className="booking-tracking-modal__tracking-panel">
            <section className="booking-tracking-modal__tracking-status-card">
              <div className="booking-tracking-modal__tracking-status-head">
                <div>
                  <p className="booking-tracking-modal__section-kicker">TRẠNG THÁI CHUYẾN ĐI</p>
                  <strong>{activeStep.title}</strong>
                </div>

                <span className={classNames('booking-tracking-modal__tracking-status-pill', isOnTripState && 'is-live')}>
                  {liveStatus.badge}
                </span>
              </div>

              <div className="booking-tracking-modal__tracking-step-list" aria-label="Danh sách trạng thái chuyến xe">
                {trackingSteps.map((step, index) => {
                  const isComplete = index < trackingStepIndex;
                  const isActive = index === trackingStepIndex;

                  return (
                    <div
                      key={step.id}
                      className={classNames(
                        'booking-tracking-modal__tracking-step',
                        isComplete && 'is-complete',
                        isActive && 'is-active',
                      )}
                    >
                      <span className="booking-tracking-modal__tracking-step-marker" aria-hidden="true">
                        {isComplete ? '✓' : isActive ? '•' : '○'}
                      </span>

                      <div className="booking-tracking-modal__tracking-step-copy">
                        <strong>{step.title}</strong>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              className={classNames('booking-tracking-modal__tracking-driver-card', driverName && 'booking-tracking-modal__tracking-driver-card--interactive')}
              role={driverName ? 'button' : undefined}
              tabIndex={driverName ? 0 : undefined}
              aria-haspopup={driverName ? 'dialog' : undefined}
              aria-label={driverName ? `Xem thêm thông tin tài xế ${driverName}` : 'Thông tin tài xế đang được cập nhật'}
              onClick={driverName ? handleOpenDriverInfoDialog : undefined}
              onKeyDown={driverName ? handleDriverCardKeyDown : undefined}
            >
              <div className="booking-tracking-modal__tracking-driver-head">
                <p className="booking-tracking-modal__section-kicker">THÔNG TIN TÀI XẾ</p>
                <div className="booking-tracking-modal__tracking-driver-head-actions">
                  <span className={classNames('booking-tracking-modal__tracking-driver-badge', driverName ? 'is-live' : 'is-waiting')}>
                    {driverName ? (isOnTripState ? 'Đang di chuyển' : 'Đã có tài xế') : 'Đang chờ'}
                  </span>
                </div>
              </div>

              {driverName ? (
                <div className="booking-tracking-modal__tracking-driver-content">
                  <div className="booking-tracking-modal__tracking-driver-main">
                    <div className="booking-tracking-modal__driver-avatar booking-tracking-modal__driver-avatar--tracking" aria-hidden="true">
                      {driverInitials}
                    </div>

                    <div className="booking-tracking-modal__tracking-driver-copy">
                              <div className="booking-tracking-modal__tracking-driver-copy-title">
                                <strong>{driverName}</strong>
                                <span className="booking-tracking-modal__driver-more booking-tracking-modal__driver-more--inline">Thêm</span>
                              </div>
                    </div>
                  </div>

                  <div className="booking-tracking-modal__tracking-driver-lines">
                            <div className="booking-tracking-modal__tracking-driver-line">
                      <img className="booking-tracking-modal__tracking-driver-icon" src={phoneIcon} alt="" aria-hidden="true" />
                      <span>{driverPhone || 'Đang cập nhật'}</span>
                    </div>

                            <div className="booking-tracking-modal__tracking-driver-line booking-tracking-modal__tracking-driver-line--vehicle">
                      <img className="booking-tracking-modal__tracking-driver-icon booking-tracking-modal__tracking-driver-icon--vehicle" src={motorbikeIcon} alt="" aria-hidden="true" />
                              <span>{driverVehicleDisplayLabel}</span>
                              {driverPhone ? (
                                <button className="booking-tracking-modal__chat-button booking-tracking-modal__chat-button--tracking-inline" type="button" onClick={(event) => { event.stopPropagation(); handleChatDriver(); }} disabled={!driverPhone}>
                                  <ChatGlyph />
                                  <span>Chat</span>
                                </button>
                              ) : null}
                    </div>

                    <div className="booking-tracking-modal__tracking-driver-line">
                      <DriverPlateGlyph />
                      <span>{driverLicensePlateLabel || 'Đang cập nhật'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="booking-tracking-modal__tracking-driver-empty">
                  <div className="booking-tracking-modal__driver-avatar booking-tracking-modal__driver-avatar--tracking" aria-hidden="true">
                    <img className="booking-tracking-modal__tracking-driver-avatar-icon" src={userIcon} alt="" aria-hidden="true" />
                  </div>

                  <div className="booking-tracking-modal__tracking-driver-empty-copy">
                    <strong>Đang tìm tài xế phù hợp</strong>
                    <p>Thông tin tài xế sẽ hiện ngay khi có người nhận đơn.</p>
                  </div>
                </div>
              )}
            </section>

            <div className="booking-tracking-modal__tracking-actions">
              <button
                className="booking-tracking-modal__call-driver booking-tracking-modal__call-driver--tracking"
                type="button"
                onClick={handleCallDriver}
                disabled={!canCallDriver}
              >
                <img className="booking-tracking-modal__call-driver-icon" src={phoneIcon} alt="" aria-hidden="true" />
                {canCallDriver ? 'Gọi tài xế' : 'Đang cập nhật'}
              </button>

              <button
                className="booking-tracking-modal__cancel booking-tracking-modal__cancel--tracking"
                type="button"
                onClick={handleCancel}
                disabled={!canCancelTrip}
                title={canCancelTrip ? 'Hủy chuyến' : 'Sau khi tài xế đã đón khách, chuyến không thể hủy.'}
              >
                Hủy chuyến
              </button>
            </div>

            <p className="booking-tracking-modal__tracking-note">
              {isOnTripState
                ? 'Chuyến đã bắt đầu, bạn có thể theo dõi lộ trình và liên hệ tài xế ngay bên dưới.'
                : 'Màn hình sẽ tự cập nhật khi có tài xế nhận đơn.'}
            </p>
          </aside>
        </div>

        {driverInfoDialogNode}
        {cancelRideDialogNode}
        {tripChatDialogNode}
      </section>
    </div>,
    document.body,
  );
}