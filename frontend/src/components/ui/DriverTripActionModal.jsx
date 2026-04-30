import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import DriverRideRejectModal from './DriverRideRejectModal';
import TripChatDialog from './TripChatDialog';
import {
  busIcon,
  carIcon,
  clockIcon,
  closeIcon,
  chatbotIcon,
  motorbikeIcon,
  originIcon,
  phoneIcon,
  pinIcon,
  userIcon,
} from '../../assets/icons';
import { classNames } from '../../utils/classNames';

const TRIP_STAGES = [
  {
    id: 'accepted',
    label: 'Đã nhận chuyến',
    description: 'Đơn đã được nhận và sẵn sàng để tài xế di chuyển.',
  },
  {
    id: 'heading-pickup',
    label: 'Đang đến điểm đón',
    description: 'Tài xế đang di chuyển đến vị trí đón khách.',
  },
  {
    id: 'picked-up',
    label: 'Đã đón khách',
    description: 'Khách đã lên xe và cuốc xe đang được thực hiện.',
  },
  {
    id: 'in-progress',
    label: 'Đang thực hiện chuyến',
    description: 'Khách đã lên xe và chuyến đang được thực hiện.',
  },
  {
    id: 'completed',
    label: 'Hoàn thành',
    description: 'Cảm ơn bạn đã hoàn thành chuyến và phục vụ khách hàng.',
  },
];

const STAGE_NEXT_MAP = {
  accepted: 'heading-pickup',
  'heading-pickup': 'picked-up',
  'picked-up': 'in-progress',
  'in-progress': 'completed',
  completed: 'completed',
};

const TRIP_STATUS_TO_STAGE = {
  chotaixe: 'accepted',
  choxacnhan: 'accepted',
  danhanchuyen: 'accepted',
  accepted: 'accepted',
  dangden: 'heading-pickup',
  headingpickup: 'heading-pickup',
  dadon: 'picked-up',
  pickedup: 'picked-up',
  dangthuchien: 'in-progress',
  dangthuchuyen: 'in-progress',
  inprogress: 'in-progress',
  hoanthanh: 'completed',
  completed: 'completed',
  dahuy: 'accepted',
  cancelled: 'accepted',
};

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function formatDateTime(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '--';
  }

  return format(parsedDate, 'dd/MM/yyyy - HH:mm');
}

function formatTimeOnly(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '--';
  }

  return format(parsedDate, 'HH:mm');
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

function formatCurrency(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return '0đ';
  }

  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.max(0, normalizedValue))}đ`;
}

function formatDialNumber(phone) {
  const normalizedPhone = normalizeText(phone)
    .replace(/[^0-9+]/g, '');

  return normalizedPhone || '';
}

function getVehicleIcon(vehicle) {
  const normalizedVehicle = normalizeText(vehicle).toLowerCase();

  if (normalizedVehicle.includes('bus') || normalizedVehicle.includes('minibus')) {
    return busIcon;
  }

  if (normalizedVehicle.includes('car') || normalizedVehicle.includes('oto') || normalizedVehicle.includes('ô tô')) {
    return carIcon;
  }

  return motorbikeIcon;
}

function getStageTone(stage) {
  if (stage === 'completed') {
    return 'success';
  }

  if (stage === 'in-progress') {
    return 'progress';
  }

  if (stage === 'picked-up') {
    return 'picked-up';
  }

  if (stage === 'heading-pickup') {
    return 'heading-pickup';
  }

  return 'accepted';
}

function getStatusLabel(stage) {
  const matchedStage = TRIP_STAGES.find((item) => item.id === stage);
  return matchedStage?.label ?? 'Đã nhận chuyến';
}

function getPrimaryActionLabel(stage) {
  if (stage === 'accepted') {
    return 'ĐANG ĐẾN ĐIỂM ĐÓN';
  }

  if (stage === 'heading-pickup') {
    return 'ĐÃ ĐÓN KHÁCH';
  }

  if (stage === 'picked-up') {
    return 'BẮT ĐẦU DI CHUYỂN';
  }

  if (stage === 'in-progress') {
    return 'HOÀN THÀNH CHUYẾN';
  }

  return 'ĐÃ HOÀN THÀNH';
}

function getStageDescription(stage) {
  const matchedStage = TRIP_STAGES.find((item) => item.id === stage);
  return matchedStage?.description ?? '';
}

function getStageIndex(stage) {
  const matchedIndex = TRIP_STAGES.findIndex((item) => item.id === stage);
  return matchedIndex >= 0 ? matchedIndex : 0;
}

function getInitialTripStage(request) {
  const normalizedTripStatus = normalizeText(request?.tripStatus ?? request?.status ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  return TRIP_STATUS_TO_STAGE[normalizedTripStatus] ?? 'accepted';
}

function getVehicleLabel(vehicle, vehicleLabel) {
  const normalizedVehicleLabel = normalizeText(vehicleLabel);

  if (normalizedVehicleLabel) {
    return normalizedVehicleLabel;
  }

  const normalizedVehicle = normalizeText(vehicle).toLowerCase();

  if (normalizedVehicle === 'motorbike') {
    return 'Xe máy';
  }

  if (normalizedVehicle === 'car') {
    return 'Ô tô';
  }

  if (normalizedVehicle === 'intercity') {
    return 'Xe liên tỉnh';
  }

  return normalizedVehicleLabel || 'Phương tiện';
}

function getCustomerInitials(name) {
  const parts = normalizeText(name)
    .split(' ')
    .filter(Boolean);

  if (parts.length === 0) {
    return 'KH';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const firstPart = parts[0] ?? '';
  const lastPart = parts[parts.length - 1] ?? '';

  return `${firstPart.slice(0, 1)}${lastPart.slice(0, 1)}`.toUpperCase();
}

function getNextStageLabel(stage) {
  const nextStage = STAGE_NEXT_MAP[stage] ?? 'completed';
  return getStatusLabel(nextStage);
}

function CustomerInfoDialog({
  open,
  bookingCode,
  customerName,
  vehicleLabel,
  customerPhone,
  paymentSummary,
  priceLabel,
  bookingTimeLabel,
  onClose,
  onOpenChat,
}) {
  if (!open) {
    return null;
  }

  return createPortal(
    <div className="driver-trip-action-modal__customer-layer" role="dialog" aria-modal="true" aria-label={`Thông tin khách hàng ${customerName || ''}`}>
      <div className="driver-trip-action-modal__customer-backdrop" onClick={onClose} aria-hidden="true" />

      <section className="driver-trip-action-modal__customer-sheet">
        <button className="driver-trip-action-modal__customer-close" type="button" onClick={onClose} aria-label="Đóng thông tin khách hàng">
          <img className="driver-trip-action-modal__customer-close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <section className="driver-trip-action-modal__customer-card driver-trip-action-modal__customer-card--profile">
          <div className="driver-trip-action-modal__customer-head driver-trip-action-modal__customer-head--profile">
            <div className="driver-trip-action-modal__customer-avatar driver-trip-action-modal__customer-avatar--profile" aria-hidden="true">
              <img className="driver-trip-action-modal__customer-avatar-icon" src={userIcon} alt="" />
            </div>

            <div className="driver-trip-action-modal__customer-copy driver-trip-action-modal__customer-copy--profile">
              <p className="driver-trip-action-modal__section-kicker">Thông tin khách hàng</p>
              <h4>{customerName || 'Khách hàng'}</h4>
              <p>{vehicleLabel || 'Phương tiện'}</p>
            </div>

            <div className="driver-trip-action-modal__customer-profile-code">
              <span>Mã chuyến</span>
              <strong>{bookingCode || '--'}</strong>
            </div>
          </div>

          <div className="driver-trip-action-modal__customer-profile-list">
            <div className="driver-trip-action-modal__customer-profile-row">
              <span className="driver-trip-action-modal__customer-profile-label">
                <img className="driver-trip-action-modal__customer-profile-icon" src={phoneIcon} alt="" aria-hidden="true" />
                Số điện thoại
              </span>
              <strong>{customerPhone || 'Đang cập nhật'}</strong>
            </div>

            <div className="driver-trip-action-modal__customer-profile-row">
              <span className="driver-trip-action-modal__customer-profile-label">
                <span className="driver-trip-action-modal__customer-profile-symbol" aria-hidden="true">💰</span>
                Giá cước
              </span>
              <strong>{priceLabel || '--'}</strong>
            </div>

            <div className="driver-trip-action-modal__customer-profile-row">
              <span className="driver-trip-action-modal__customer-profile-label">
                <img className="driver-trip-action-modal__customer-profile-icon" src={clockIcon} alt="" aria-hidden="true" />
                Thời gian
              </span>
              <strong>{bookingTimeLabel || '--'}</strong>
            </div>

            <div className="driver-trip-action-modal__customer-profile-row">
              <span className="driver-trip-action-modal__customer-profile-label">
                <span className="driver-trip-action-modal__customer-profile-symbol" aria-hidden="true">💳</span>
                Thanh toán
              </span>
              <strong>{paymentSummary || 'Thanh toán theo chuyến'}</strong>
            </div>
          </div>

          <div className="driver-trip-action-modal__customer-profile-actions">
            <button className="driver-trip-action-modal__customer-chat-button" type="button" onClick={onOpenChat}>
              <img className="driver-trip-action-modal__customer-chat-icon" src={chatbotIcon} alt="" aria-hidden="true" />
              CHAT
            </button>
          </div>
        </section>
      </section>
    </div>,
    document.body,
  );
}

export default function DriverTripActionModal({
  open = false,
  request = null,
  authenticatedAccountId = '',
  onClose,
  onMinimize,
  onCancel,
  onAdvanceStage,
}) {
  const [tripStage, setTripStage] = useState('accepted');
  const [updatedAt, setUpdatedAt] = useState(new Date().toISOString());
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [customerInfoDialogOpen, setCustomerInfoDialogOpen] = useState(false);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  useEffect(() => {
    if (!open || !request) {
      setCancelConfirmOpen(false);
      setCustomerInfoDialogOpen(false);
      setChatDialogOpen(false);
      setActionLoading(false);
      setActionError('');
      setLocationLoading(false);
      setLocationMessage('');
      return undefined;
    }

    setTripStage(getInitialTripStage(request));
    setUpdatedAt(new Date().toISOString());
    setActionLoading(false);
    setActionError('');
    setLocationLoading(false);
    setLocationMessage('');
    return undefined;
  }, [open, request?.bookingCode, request?.tripStatus, request?.status]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (actionLoading || locationLoading) {
          return;
        }

        if (cancelConfirmOpen) {
          setCancelConfirmOpen(false);
          return;
        }

        if (customerInfoDialogOpen) {
          setCustomerInfoDialogOpen(false);
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionLoading, cancelConfirmOpen, chatDialogOpen, customerInfoDialogOpen, locationLoading, onClose, open]);

  if (!open || !request) {
    return null;
  }

  const bookingCode = normalizeText(request.bookingCode ?? request.requestId ?? '');
  const pickupLabel = normalizeText(request.pickup?.label ?? '') || 'Điểm đón';
  const destinationLabel = normalizeText(request.destination?.label ?? '') || 'Điểm đến';
  const customerName = normalizeText(request.customerName ?? '') || 'Khách hàng';
  const customerInitials = getCustomerInitials(customerName);
  const customerPhone = normalizeText(request.customerPhone ?? '') || 'Chưa có số liên hệ';
  const priceLabel = normalizeText(request.priceFormatted ?? '') || formatCurrency(request.price);
  const bookingTimeLabel = formatDateTime(request.createdAt);
  const lastUpdatedLabel = formatDateTime(updatedAt);
  const rideTitle = normalizeText(request.rideTitle ?? request.vehicleLabel ?? '') || 'Cuốc xe mới';
  const vehicleLabel = getVehicleLabel(request.vehicle, request.vehicleLabel);
  const seatLabel = normalizeText(request.seatLabel ?? '') || 'Đang cập nhật';
  const paymentSummary = normalizeText(request.paymentSummary ?? '') || 'Thanh toán theo chuyến';
  const chatAccountId = String(authenticatedAccountId ?? request.driverAccountId ?? '').trim();
  const statusLabel = getStatusLabel(tripStage);
  const statusTone = getStageTone(tripStage);
  const stageIndex = getStageIndex(tripStage);
  const nextStageLabel = getNextStageLabel(tripStage);
  const vehicleIcon = getVehicleIcon(request.vehicle ?? request.vehicleLabel);
  const phoneNumber = formatDialNumber(request.customerPhone);
  const canAdvance = tripStage !== 'completed';
  const routeDistanceLabel = formatKilometers(request.routeDistanceKm);
  const etaLabel = formatMinutes(request.etaMinutes);
  const hasLocationBusyState = actionLoading || locationLoading;
  const isPrePickupState = tripStage !== 'completed';
  const canCancelTrip = ['accepted', 'heading-pickup'].includes(tripStage);
  const lastUpdatedTimeLabel = formatTimeOnly(updatedAt);

  const handleClose = () => {
    if (hasLocationBusyState) {
      return;
    }

    setCancelConfirmOpen(false);
    setCustomerInfoDialogOpen(false);
    setChatDialogOpen(false);

    if (onMinimize) {
      onMinimize();
      return;
    }

    onClose?.();
  };

  const handleBackdropClick = () => {
    if (hasLocationBusyState) {
      return;
    }

    setCancelConfirmOpen(false);
    setCustomerInfoDialogOpen(false);
    setChatDialogOpen(false);

    if (onMinimize) {
      onMinimize();
      return;
    }

    onClose?.();
  };

  const handleAdvanceStage = async () => {
    if (!canAdvance) {
      return;
    }

    const nextStage = STAGE_NEXT_MAP[tripStage] ?? 'completed';
    setActionLoading(true);
    setActionError('');

    try {
      await onAdvanceStage?.(request, nextStage);
      setTripStage(nextStage);
      setUpdatedAt(new Date().toISOString());

      if (nextStage === 'completed') {
        onClose?.();
      }
    } catch (error) {
      setActionError(error?.message || 'Không thể cập nhật trạng thái chuyến.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCallCustomer = () => {
    if (!phoneNumber) {
      return;
    }

    setUpdatedAt(new Date().toISOString());
    window.location.href = `tel:${phoneNumber}`;
  };

  const handleOpenChatDialog = () => {
    setCancelConfirmOpen(false);
    setCustomerInfoDialogOpen(false);
    setChatDialogOpen(true);
  };

  const handleOpenCustomerInfoDialog = () => {
    setCancelConfirmOpen(false);
    setChatDialogOpen(false);
    setCustomerInfoDialogOpen(true);
  };

  const handleOpenCancelConfirmDialog = () => {
    if (!canCancelTrip || hasLocationBusyState) {
      return;
    }

    setChatDialogOpen(false);
    setCustomerInfoDialogOpen(false);
    setCancelConfirmOpen(true);
  };

  const handleCloseCustomerInfoDialog = () => {
    setCustomerInfoDialogOpen(false);
  };

  const handleCustomerCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleOpenCustomerInfoDialog();
  };

  const handleViewDriverLocation = () => {
    if (hasLocationBusyState) {
      return;
    }

    setActionError('');
    setLocationMessage('');

    if (typeof window === 'undefined' || !navigator.geolocation) {
      setActionError('Trình duyệt không hỗ trợ lấy vị trí hiện tại.');
      return;
    }

    const previewWindow = window.open('', '_blank');

    if (!previewWindow) {
      setActionError('Trình duyệt đã chặn cửa sổ bản đồ. Hãy cho phép pop-up để xem vị trí tài xế.');
      return;
    }

    previewWindow.document.title = 'Đang xác định vị trí tài xế';
    previewWindow.document.body.style.margin = '0';
    previewWindow.document.body.style.fontFamily = 'system-ui, sans-serif';
    previewWindow.document.body.style.background = '#f8fafc';
    previewWindow.document.body.style.color = '#0f1720';
    previewWindow.document.body.innerHTML = '<div style="padding:24px;font-size:16px;line-height:1.5">Đang xác định vị trí tài xế...</div>';

    setLocationLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

        try {
          previewWindow.location.href = mapsUrl;
        } catch {
          previewWindow.close();
          setActionError('Không thể mở vị trí tài xế trên bản đồ.');
          setLocationLoading(false);
          return;
        }

        setLocationMessage(`Đã mở vị trí hiện tại của tài xế trên bản đồ (${latitude.toFixed(5)}, ${longitude.toFixed(5)}).`);
        setUpdatedAt(new Date().toISOString());
        setLocationLoading(false);
      },
      (error) => {
        previewWindow.close();
        setLocationLoading(false);

        if (error?.code === error.PERMISSION_DENIED) {
          setActionError('Không thể lấy vị trí tài xế vì trình duyệt đã từ chối quyền truy cập.');
          return;
        }

        setActionError('Không thể lấy vị trí tài xế lúc này. Vui lòng thử lại.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const handleCancelConfirm = async (cancelDetails = null) => {
    setCancelConfirmOpen(false);
    setActionLoading(true);
    setActionError('');

    try {
      await onCancel?.(request, cancelDetails);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setActionError(error?.message || 'Không thể hủy chuyến.');
    } finally {
      setActionLoading(false);
    }
  };

  const customerInfoDialog = (
    <CustomerInfoDialog
      open={customerInfoDialogOpen}
      bookingCode={bookingCode}
      customerName={customerName}
      vehicleLabel={vehicleLabel}
      customerPhone={customerPhone}
      paymentSummary={paymentSummary}
      priceLabel={priceLabel}
      bookingTimeLabel={bookingTimeLabel}
      onClose={handleCloseCustomerInfoDialog}
      onOpenChat={handleOpenChatDialog}
    />
  );

  const tripChatDialog = (
    <TripChatDialog
      open={chatDialogOpen}
      bookingCode={bookingCode}
      accountId={chatAccountId}
      roleCode="Q3"
      dialogTitle="Liên hệ khách hàng"
      dialogSubtitle={`Chuyến #${bookingCode || '--'} · ${vehicleLabel}`}
      contactName={customerName}
      contactPhone={request.customerPhone ?? ''}
      quickReplies={[
        'Tôi đang trên đường đến điểm đón.',
        'Anh/chị cho tôi xin vị trí cụ thể nhé.',
        'Tôi sẽ tới trong ít phút nữa.',
      ]}
      onClose={() => setChatDialogOpen(false)}
    />
  );

  if (isPrePickupState) {
    return createPortal(
      <>
        {customerInfoDialog}
        {tripChatDialog}

        <div className="driver-trip-action-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết chuyến ${bookingCode || ''}`}>
        <div className="driver-trip-action-modal__backdrop" onClick={handleBackdropClick} aria-hidden="true" />

        <section className="driver-trip-action-modal__window driver-trip-action-modal__window--track">
          <button className="driver-trip-action-modal__close" type="button" onClick={handleClose} aria-label="Đóng popup thao tác">
            <img className="driver-trip-action-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
          </button>

          <div className="driver-trip-action-modal__content driver-trip-action-modal__content--track">
            <header className="driver-trip-action-modal__track-header">
              <p className="driver-trip-action-modal__track-title">
                <span className="driver-trip-action-modal__track-title-icon" aria-hidden="true">
                  <img className="driver-trip-action-modal__track-title-icon-img" src={vehicleIcon} alt="" />
                </span>
                Chuyến #{bookingCode || '--'}
              </p>
            </header>

            <div className="driver-trip-action-modal__track-grid">
              <section className="booking-tracking-modal__route-card driver-trip-action-modal__track-route-card">
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
              </section>

              <section
                className="driver-trip-action-modal__info-card driver-trip-action-modal__info-card--interactive"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-label={`Xem thông tin khách hàng ${customerName}`}
                onClick={handleOpenCustomerInfoDialog}
                onKeyDown={handleCustomerCardKeyDown}
              >
                <div className="driver-trip-action-modal__info-head">
                  <div className="driver-trip-action-modal__info-avatar" aria-hidden="true">
                    <img className="driver-trip-action-modal__info-avatar-icon" src={userIcon} alt="" />
                  </div>

                  <div className="driver-trip-action-modal__info-copy">
                      <div className="driver-trip-action-modal__info-copy-title">
                        <strong>Khách: {customerName}</strong>
                        <span className="driver-trip-action-modal__customer-more driver-trip-action-modal__customer-more--inline">Thêm</span>
                      </div>
                      <span>{vehicleLabel}</span>
                  </div>
                </div>

                <div className="driver-trip-action-modal__info-list">
                  <div className="driver-trip-action-modal__info-row">
                    <span className="driver-trip-action-modal__info-label">
                      <img className="driver-trip-action-modal__info-icon" src={phoneIcon} alt="" aria-hidden="true" />
                      {customerPhone}
                    </span>
                  </div>

                  <div className="driver-trip-action-modal__info-row">
                    <span className="driver-trip-action-modal__info-label">
                      <span className="driver-trip-action-modal__info-symbol" aria-hidden="true">💰</span>
                      Giá: {priceLabel || '--'}
                    </span>
                  </div>

                  <div className="driver-trip-action-modal__info-row">
                    <span className="driver-trip-action-modal__info-label">
                      <img className="driver-trip-action-modal__info-icon" src={clockIcon} alt="" aria-hidden="true" />
                      Thời gian: {bookingTimeLabel || '--'}
                    </span>
                  </div>
                </div>
              </section>
            </div>

            <section className="driver-trip-action-modal__timeline-card" aria-label="Tiến trình chuyến xe">
              <div className="driver-trip-action-modal__timeline">
                {TRIP_STAGES.map((step, index) => {
                  const isComplete = index < stageIndex;
                  const isActive = index === stageIndex;

                  return (
                    <div
                      key={step.id}
                      className={classNames(
                        'driver-trip-action-modal__timeline-step',
                        isComplete && 'is-complete',
                        isActive && 'is-active',
                      )}
                    >
                      <span className="driver-trip-action-modal__timeline-dot" aria-hidden="true">
                        {isComplete ? '✓' : isActive ? '→' : '○'}
                      </span>
                      <strong>{step.label}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="driver-trip-action-modal__status-row">
              <span>Trạng thái: {statusLabel}</span>
              <span>Cập nhật lúc: {lastUpdatedTimeLabel || '--'}</span>
            </div>
          </div>

          <footer className="driver-trip-action-modal__footer driver-trip-action-modal__footer--track">
            {actionError ? (
              <div className="driver-trip-action-modal__error" role="alert">
                {actionError}
              </div>
            ) : null}

            <div className="driver-trip-action-modal__actions driver-trip-action-modal__actions--track">
              <button className="driver-trip-action-modal__primary driver-trip-action-modal__primary--track" type="button" onClick={handleAdvanceStage} disabled={!canAdvance || actionLoading}>
                {actionLoading ? 'Đang lưu...' : getPrimaryActionLabel(tripStage)}
              </button>

              <button className="driver-trip-action-modal__secondary" type="button" onClick={handleCallCustomer} disabled={!phoneNumber || hasLocationBusyState}>
                GỌI KHÁCH
              </button>

              <button
                className="driver-trip-action-modal__danger"
                type="button"
                onClick={handleOpenCancelConfirmDialog}
                disabled={!canCancelTrip || hasLocationBusyState}
                title={canCancelTrip ? 'Hủy chuyến' : 'Sau khi đã đón khách, chuyến không thể hủy.'}
              >
                HỦY CHUYẾN
              </button>
            </div>

            <p className="driver-trip-action-modal__footer-note">
              {canCancelTrip
                ? 'Hủy chuyến sau khi tài xế nhận có thể phát sinh chi phí.'
                : 'Sau khi đã đón khách, chuyến không thể hủy.'}
            </p>
          </footer>
        </section>

        <DriverRideRejectModal
          open={cancelConfirmOpen}
          request={request}
          confirmLabel="Hủy chuyến"
          onCancel={() => setCancelConfirmOpen(false)}
          onSubmit={handleCancelConfirm}
        />
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <>
      {customerInfoDialog}

      <div className="driver-trip-action-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết chuyến ${bookingCode || ''}`}>
      <div className="driver-trip-action-modal__backdrop" onClick={handleBackdropClick} aria-hidden="true" />

      <section className="driver-trip-action-modal__window">
        <button className="driver-trip-action-modal__close" type="button" onClick={handleClose} aria-label="Đóng popup thao tác">
          <img className="driver-trip-action-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="driver-trip-action-modal__header">
          <div className="driver-trip-action-modal__header-copy">
            <p className="driver-trip-action-modal__eyebrow">Chuyến đang hoạt động</p>

            <div className="driver-trip-action-modal__title-row">
              <span className="driver-trip-action-modal__vehicle-badge" aria-hidden="true">
                <img className="driver-trip-action-modal__vehicle-icon" src={vehicleIcon} alt="" />
              </span>

              <div className="driver-trip-action-modal__header-text">
                <h3>{rideTitle}</h3>
                <p className="driver-trip-action-modal__subtitle">
                  Mã chuyến {bookingCode || '--'} · {bookingTimeLabel || '--'}
                </p>
              </div>
            </div>

            <div className="driver-trip-action-modal__meta-chip-row" aria-label="Thông tin nhanh chuyến xe">
              <span className="driver-trip-action-modal__meta-chip driver-trip-action-modal__meta-chip--primary">{vehicleLabel}</span>
              <span className="driver-trip-action-modal__meta-chip">{seatLabel}</span>
              <span className="driver-trip-action-modal__meta-chip driver-trip-action-modal__meta-chip--soft">{paymentSummary || 'Thanh toán theo chuyến'}</span>
            </div>
          </div>

          <div className={classNames('driver-trip-action-modal__status-badge', `is-${statusTone}`)}>{statusLabel}</div>
        </header>

        <div className="driver-trip-action-modal__body">
          <div className="driver-trip-action-modal__left">
            <section className="driver-trip-action-modal__route-card">
              <div className="driver-trip-action-modal__section-head">
                <p className="driver-trip-action-modal__section-kicker">Lộ trình</p>
                <h4>Điểm đón và điểm đến</h4>
              </div>

              <div className="driver-trip-action-modal__route-row">
                <span className="driver-trip-action-modal__route-icon driver-trip-action-modal__route-icon--pickup">
                  <img className="driver-trip-action-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
                </span>

                <div className="driver-trip-action-modal__route-copy">
                  <span>Điểm đón</span>
                  <strong>{pickupLabel}</strong>
                </div>
              </div>

              <div className="driver-trip-action-modal__route-divider" />

              <div className="driver-trip-action-modal__route-row">
                <span className="driver-trip-action-modal__route-icon driver-trip-action-modal__route-icon--destination">
                  <img className="driver-trip-action-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
                </span>

                <div className="driver-trip-action-modal__route-copy">
                  <span>Điểm đến</span>
                  <strong>{destinationLabel}</strong>
                </div>
              </div>
            </section>

            <section className="driver-trip-action-modal__summary-card">
              <div className="driver-trip-action-modal__section-head">
                <p className="driver-trip-action-modal__section-kicker">Tổng quan</p>
                <h4>Thông tin cuốc xe</h4>
              </div>

              <div className="driver-trip-action-modal__stats-grid">
                <article className="driver-trip-action-modal__stat-card">
                  <span>Mã chuyến</span>
                  <strong>{bookingCode || '--'}</strong>
                </article>

                <article className="driver-trip-action-modal__stat-card">
                  <span>Giá cước</span>
                  <strong>{priceLabel || '--'}</strong>
                </article>

                <article className="driver-trip-action-modal__stat-card">
                  <span>Quãng đường</span>
                  <strong>{routeDistanceLabel || '--'}</strong>
                </article>

                <article className="driver-trip-action-modal__stat-card">
                  <span>Dự kiến</span>
                  <strong>{etaLabel || '--'}</strong>
                </article>

                <article className="driver-trip-action-modal__stat-card">
                  <span>Cập nhật</span>
                  <strong>{lastUpdatedLabel || '--'}</strong>
                </article>
              </div>
            </section>
          </div>

          <div className="driver-trip-action-modal__right">
            <section
              className="driver-trip-action-modal__customer-card driver-trip-action-modal__customer-card--interactive"
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-label={`Xem thêm thông tin khách hàng ${customerName}`}
              onClick={handleOpenCustomerInfoDialog}
              onKeyDown={handleCustomerCardKeyDown}
            >
              <div className="driver-trip-action-modal__customer-head">
                <div className="driver-trip-action-modal__customer-avatar" aria-hidden="true">
                  {customerInitials}
                </div>

                <div className="driver-trip-action-modal__customer-copy">
                  <p className="driver-trip-action-modal__section-kicker">Khách hàng</p>
                  <h4>{customerName}</h4>
                  <p>{rideTitle}</p>
                </div>

                <span className="driver-trip-action-modal__customer-more driver-trip-action-modal__customer-more--head">Thêm</span>
              </div>

              <div className="driver-trip-action-modal__customer-contact">
                <div className="driver-trip-action-modal__contact-copy">
                  <span>Số liên hệ</span>
                  <strong>{customerPhone}</strong>
                </div>

                <button className="driver-trip-action-modal__contact-button" type="button" onClick={(event) => { event.stopPropagation(); handleCallCustomer(); }} disabled={!phoneNumber || hasLocationBusyState}>
                  <img className="driver-trip-action-modal__contact-button-icon" src={phoneIcon} alt="" aria-hidden="true" />
                  Gọi khách
                </button>
              </div>
            </section>

            <section className="driver-trip-action-modal__stage-card">
              <div className="driver-trip-action-modal__stage-head">
                <div>
                  <p className="driver-trip-action-modal__section-kicker">Trạng thái chuyến</p>
                  <h4>{statusLabel}</h4>
                </div>

                <span className={classNames('driver-trip-action-modal__stage-badge', `is-${statusTone}`)}>{statusLabel}</span>
              </div>

              <p className="driver-trip-action-modal__stage-description">
                {getStageDescription(tripStage) || 'Sẵn sàng chuyển sang bước tiếp theo của chuyến xe.'}
              </p>

              <div className="driver-trip-action-modal__stage-rail" aria-label="Tiến trình chuyến xe">
                {TRIP_STAGES.map((step, index) => (
                  <div
                    key={step.id}
                    className={classNames(
                      'driver-trip-action-modal__stage-pill',
                      index < stageIndex && 'is-complete',
                      index === stageIndex && 'is-active',
                    )}
                  >
                    <span aria-hidden="true">{index + 1}</span>
                    <strong>{step.label}</strong>
                  </div>
                ))}
              </div>

              <p className="driver-trip-action-modal__stage-next">Bước tiếp theo: {nextStageLabel}</p>

              <button className="driver-trip-action-modal__primary" type="button" onClick={handleAdvanceStage} disabled={!canAdvance || actionLoading}>
                {actionLoading ? 'Đang lưu...' : getPrimaryActionLabel(tripStage)}
              </button>

              {locationMessage ? <p className="driver-trip-action-modal__location-note">{locationMessage}</p> : null}
            </section>
          </div>
        </div>

        <footer className="driver-trip-action-modal__footer">
          <div className="driver-trip-action-modal__footer-copy">
            <span>Thao tác nhanh</span>
            <strong>{locationMessage || (canCancelTrip
              ? 'Kiểm tra vị trí tài xế, gọi khách hoặc hủy chuyến ngay từ màn hình này.'
              : 'Kiểm tra vị trí tài xế, gọi khách hoặc theo dõi chuyến cho đến khi hoàn thành.')}</strong>
          </div>

          {actionError ? (
            <div className="driver-trip-action-modal__error" role="alert">
              {actionError}
            </div>
          ) : null}

          <div className="driver-trip-action-modal__actions">
            <button
              className="driver-trip-action-modal__danger"
              type="button"
              onClick={handleOpenCancelConfirmDialog}
              disabled={!canCancelTrip || hasLocationBusyState}
              title={canCancelTrip ? 'Hủy chuyến' : 'Sau khi đã đón khách, chuyến không thể hủy.'}
            >
              HỦY CHUYẾN
            </button>

            <button className="driver-trip-action-modal__secondary" type="button" onClick={handleViewDriverLocation} disabled={hasLocationBusyState}>
              {locationLoading ? 'ĐANG MỞ...' : 'VỊ TRÍ TÀI XẾ'}
            </button>
          </div>
        </footer>
      </section>

      <DriverRideRejectModal
        open={cancelConfirmOpen}
        request={request}
        confirmLabel="Hủy chuyến"
        onCancel={() => setCancelConfirmOpen(false)}
        onSubmit={handleCancelConfirm}
      />
      {tripChatDialog}
      </div>
    </>,
    document.body,
  );
}