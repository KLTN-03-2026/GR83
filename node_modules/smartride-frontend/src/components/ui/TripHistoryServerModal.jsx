import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { carIcon, clockIcon, closeIcon, originIcon, pinIcon, starIcon, userIcon } from '../../assets/icons';
import { rideService } from '../../services/rideService';
import RoutePreviewMap from './RoutePreviewMap';
import { classNames } from '../../utils/classNames';

const TRIP_HISTORY_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'scheduled', label: 'Đặt trước' },
  { value: 'in-progress', label: 'Đang chờ' },
  { value: 'cancelled', label: 'Đã hủy' },
];

const TRIP_HISTORY_PRESETS = {
  customer: {
    eyebrow: 'Lịch sử chuyến của khách hàng',
    title: 'Xem lại các chuyến đã đặt',
    summary: 'Dữ liệu booking, thanh toán và tuyến đường được lấy trực tiếp từ server.',
    searchPlaceholder: 'Tìm theo mã chuyến, điểm đón, điểm đến...',
    accentLabel: 'Khách hàng',
    heroNote: 'Dữ liệu thật từ server.',
  },
  driver: {
    eyebrow: 'Lịch sử chuyến của tài xế',
    title: 'Bảng quản lý chuyến đi',
    summary: 'Theo dõi các booking mới nhất, trạng thái thanh toán và tuyến đường thực tế.',
    searchPlaceholder: 'Tìm theo mã chuyến, khách hàng, điểm đến...',
    accentLabel: 'Tài xế',
    heroNote: 'Dữ liệu thật từ server.',
  },
};

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.longitude ?? position.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function normalizeRouteGeometry(routeGeometry) {
  if (!Array.isArray(routeGeometry)) {
    return [];
  }

  return routeGeometry.map(normalizePosition).filter(Boolean);
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

function getStatusLabel(status) {
  if (status === 'completed') {
    return 'Hoàn thành';
  }

  if (status === 'scheduled') {
    return 'Đặt trước';
  }

  if (status === 'in-progress') {
    return 'Đang chờ';
  }

  if (status === 'cancelled') {
    return 'Đã hủy';
  }

  return 'Không xác định';
}

function getStatusTone(status) {
  if (status === 'completed') {
    return 'success';
  }

  if (status === 'scheduled') {
    return 'scheduled';
  }

  if (status === 'in-progress') {
    return 'progress';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  return 'neutral';
}

function getPaymentStatusLabel(paymentStatus) {
  const normalizedStatus = normalizeText(paymentStatus).toLowerCase();

  if (normalizedStatus === 'dathanhtoan') {
    return 'Đã thanh toán';
  }

  if (normalizedStatus === 'choxacthanh' || normalizedStatus === 'choxacnhan') {
    return 'Chờ xác nhận';
  }

  if (normalizedStatus === 'chothutien') {
    return 'Chờ thu tiền';
  }

  if (normalizedStatus === 'thatbai') {
    return 'Thanh toán thất bại';
  }

  return 'Chưa xác định';
}

function getPaymentMethodLabel(paymentMethod, paymentProvider) {
  const normalizedMethod = normalizeText(paymentMethod).toLowerCase();
  const normalizedProvider = normalizeText(paymentProvider);

  if (normalizedMethod === 'qr') {
    return normalizedProvider ? `QR code - ${normalizedProvider}` : 'QR code';
  }

  if (normalizedMethod === 'wallet') {
    return normalizedProvider ? `Ví điện tử - ${normalizedProvider}` : 'Ví điện tử';
  }

  return 'Tiền mặt';
}

function buildTripStatus(rawStatus, scheduleEnabled) {
  const normalizedStatus = normalizeText(rawStatus).toLowerCase();

  if (normalizedStatus === 'completed' || normalizedStatus === 'scheduled' || normalizedStatus === 'in-progress' || normalizedStatus === 'cancelled') {
    return normalizedStatus;
  }

  if (scheduleEnabled) {
    return 'scheduled';
  }

  return 'in-progress';
}

function normalizeTripHistoryItem(rawItem = {}, fallbackId = 0) {
  const bookingCode = normalizeText(rawItem.bookingCode ?? rawItem.id ?? `trip-${fallbackId}`);
  const paymentCode = normalizeText(rawItem.paymentCode ?? rawItem.tripCode ?? bookingCode);
  const scheduleEnabled = Boolean(rawItem.scheduleEnabled);
  const status = buildTripStatus(rawItem.status ?? rawItem.statusCode, scheduleEnabled);
  const statusLabel = normalizeText(rawItem.statusLabel) || getStatusLabel(status);
  const statusTone = normalizeText(rawItem.statusTone) || getStatusTone(status);
  const bookedAt = normalizeText(rawItem.bookedAt ?? rawItem.completedAt ?? rawItem.createdAt);
  const completedAt = normalizeText(rawItem.completedAt ?? rawItem.paidAt ?? rawItem.bookedAt ?? rawItem.createdAt);
  const pickupLabel = normalizeText(rawItem.pickupLabel);
  const destinationLabel = normalizeText(rawItem.destinationLabel);
  const vehicle = normalizeText(rawItem.vehicle).toLowerCase();
  const vehicleLabel = normalizeText(rawItem.vehicleLabel) || 'Xe';
  const routeGeometry = normalizeRouteGeometry(rawItem.routeGeometry);
  const pickupPosition = normalizePosition(rawItem.pickupPosition);
  const destinationPosition = normalizePosition(rawItem.destinationPosition);

  return {
    id: normalizeText(rawItem.id ?? bookingCode ?? fallbackId),
    bookingCode,
    tripCode: paymentCode,
    paymentCode,
    status,
    statusLabel,
    statusTone,
    bookedAt,
    completedAt,
    rideTitle: normalizeText(rawItem.rideTitle),
    vehicle,
    vehicleLabel,
    customerName: normalizeText(rawItem.customerName),
    customerPhone: normalizeText(rawItem.customerPhone),
    paymentLabel: normalizeText(rawItem.paymentLabel) || getPaymentMethodLabel(rawItem.paymentMethod, rawItem.paymentProvider),
    paymentMethod: normalizeText(rawItem.paymentMethod),
    paymentProvider: normalizeText(rawItem.paymentProvider),
    paymentStatus: normalizeText(rawItem.paymentStatus),
    paymentStatusLabel: normalizeText(rawItem.paymentStatusLabel) || getPaymentStatusLabel(rawItem.paymentStatus),
    price: Number(rawItem.price ?? 0),
    priceFormatted: normalizeText(rawItem.priceFormatted) || formatCurrency(rawItem.price),
    routeDistanceKm: Number(rawItem.routeDistanceKm ?? 0),
    etaMinutes: Number(rawItem.etaMinutes ?? 0),
    pickupLabel,
    destinationLabel,
    pickupPosition,
    destinationPosition,
    routeProvider: normalizeText(rawItem.routeProvider) || 'haversine',
    routeGeometry: routeGeometry.length >= 2 ? routeGeometry : pickupPosition && destinationPosition ? [pickupPosition, destinationPosition] : routeGeometry,
    note: normalizeText(rawItem.note),
    scheduleEnabled,
    accountDisplayName: normalizeText(rawItem.accountDisplayName),
    accountIdentifier: normalizeText(rawItem.accountIdentifier),
    accountPhone: normalizeText(rawItem.accountPhone),
  };
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

function deriveSummaryFromItems(items) {
  return items.reduce((summary, trip) => {
    summary.totalTrips += 1;
    summary.totalAmount += Number(trip.price ?? 0) || 0;
    summary.totalDistanceKm += Number(trip.routeDistanceKm ?? 0) || 0;

    if (trip.status === 'completed') {
      summary.completedTrips += 1;
    }

    if (trip.status === 'scheduled') {
      summary.scheduledTrips += 1;
    }

    if (trip.status === 'in-progress') {
      summary.inProgressTrips += 1;
    }

    if (trip.status === 'cancelled') {
      summary.cancelledTrips += 1;
    }

    return summary;
  }, {
    totalTrips: 0,
    completedTrips: 0,
    scheduledTrips: 0,
    inProgressTrips: 0,
    cancelledTrips: 0,
    totalAmount: 0,
    totalDistanceKm: 0,
  });
}

function normalizeTripHistorySummary(responseSummary = {}, items = []) {
  const summary = {
    totalTrips: Number(responseSummary.totalTrips ?? responseSummary.totalCount ?? 0) || 0,
    completedTrips: Number(responseSummary.completedTrips ?? 0) || 0,
    scheduledTrips: Number(responseSummary.scheduledTrips ?? 0) || 0,
    inProgressTrips: Number(responseSummary.inProgressTrips ?? 0) || 0,
    cancelledTrips: Number(responseSummary.cancelledTrips ?? 0) || 0,
    totalAmount: Number(responseSummary.totalAmount ?? 0) || 0,
    totalDistanceKm: Number(responseSummary.totalDistanceKm ?? 0) || 0,
  };

  if (summary.totalTrips === 0 && items.length > 0) {
    return deriveSummaryFromItems(items);
  }

  return summary;
}

function buildTripHistoryStats(mode, summary) {
  if (mode === 'driver') {
    return [
      { value: formatCompactNumber(summary.totalTrips), label: 'Tổng chuyến' },
      { value: formatCompactNumber(summary.completedTrips), label: 'Hoàn thành' },
      { value: formatCompactNumber(summary.inProgressTrips), label: 'Đang chờ' },
      { value: formatCurrency(summary.totalAmount), label: 'Tổng giá trị' },
    ];
  }

  return [
    { value: formatCompactNumber(summary.totalTrips), label: 'Tổng chuyến' },
    { value: formatCompactNumber(summary.completedTrips), label: 'Hoàn thành' },
    { value: formatCompactNumber(summary.scheduledTrips), label: 'Đặt trước' },
    { value: formatCurrency(summary.totalAmount), label: 'Tổng chi' },
  ];
}

function buildTripHighlights(mode, trip, accountDisplayName, accountIdentifier, accountPhone) {
  const counterpartName = mode === 'driver'
    ? trip.customerName || '--'
    : accountDisplayName || accountIdentifier || '--';
  const counterpartContact = mode === 'driver'
    ? trip.customerPhone || 'Chưa có số liên hệ'
    : accountPhone || accountIdentifier || 'Chưa có số liên hệ';

  return [
    {
      label: mode === 'driver' ? 'Khách hàng' : 'Tài khoản',
      value: counterpartName,
      icon: userIcon,
    },
    {
      label: 'Trạng thái',
      value: trip.statusLabel,
      icon: starIcon,
    },
    {
      label: 'Quãng đường',
      value: formatDistance(trip.routeDistanceKm),
      icon: pinIcon,
    },
    {
      label: 'Đặt lúc',
      value: formatTripDate(trip.bookedAt || trip.completedAt),
      icon: clockIcon,
    },
  ].map((item) => ({ ...item, counterpartContact }));
}

function buildTripSubtitle(mode, trip) {
  if (mode === 'driver') {
    return [trip.customerName, trip.rideTitle].filter(Boolean).join(' · ');
  }

  return [trip.paymentLabel, trip.rideTitle].filter(Boolean).join(' · ');
}

export default function TripHistoryServerModal({
  open = false,
  mode = 'customer',
  roleLabel = '',
  accountId = '',
  accountDisplayName = '',
  accountIdentifier = '',
  accountPhone = '',
  onClose,
}) {
  const normalizedMode = mode === 'driver' ? 'driver' : 'customer';
  const preset = TRIP_HISTORY_PRESETS[normalizedMode];
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTripId, setSelectedTripId] = useState('');
  const [historyItems, setHistoryItems] = useState([]);
  const [historySummary, setHistorySummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const resolvedAccountId = useMemo(() => normalizeText(accountId), [accountId]);
  const resolvedIdentifier = useMemo(() => normalizeText(accountIdentifier), [accountIdentifier]);

  const visibleTrips = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery);

    return historyItems.filter((trip) => {
      if (statusFilter !== 'all' && trip.status !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = normalizeSearchText(
        [
          trip.bookingCode,
          trip.tripCode,
          trip.pickupLabel,
          trip.destinationLabel,
          trip.customerName,
          trip.rideTitle,
          trip.paymentLabel,
          trip.paymentStatusLabel,
          trip.statusLabel,
        ]
          .filter(Boolean)
          .join(' '),
      );

      return searchableText.includes(normalizedQuery);
    });
  }, [historyItems, searchQuery, statusFilter]);

  const selectedTrip = useMemo(() => {
    if (!visibleTrips.length) {
      return null;
    }

    return visibleTrips.find((trip) => trip.id === selectedTripId) ?? visibleTrips[0];
  }, [selectedTripId, visibleTrips]);

  const stats = useMemo(
    () => buildTripHistoryStats(normalizedMode, historySummary ?? deriveSummaryFromItems(historyItems)),
    [historyItems, historySummary, normalizedMode],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setSearchQuery('');
    setStatusFilter('all');
    setSelectedTripId('');
    setHistoryItems([]);
    setHistorySummary(null);
    setHistoryError('');
    setHistoryLoading(true);

    const controller = new AbortController();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const loadHistory = async () => {
      try {
        const response = await rideService.getTripHistory(
          {
            accountId: resolvedAccountId,
            identifier: resolvedIdentifier,
            roleCode: normalizedMode === 'driver' ? 'Q3' : 'Q2',
            limit: 24,
          },
          { signal: controller.signal },
        );

        const normalizedItems = extractTripHistoryItems(response).map((item, index) => normalizeTripHistoryItem(item, index + 1));
        const normalizedSummary = normalizeTripHistorySummary(response?.summary ?? response?.data?.summary ?? {}, normalizedItems);

        setHistoryItems(normalizedItems);
        setHistorySummary(normalizedSummary);
        setSelectedTripId(normalizedItems[0]?.id ?? '');
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }

        setHistoryItems([]);
        setHistorySummary(null);
        setHistoryError(error?.message || 'Không thể tải lịch sử chuyến từ server.');
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [normalizedMode, onClose, open, resolvedAccountId, resolvedIdentifier]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (!visibleTrips.length) {
      setSelectedTripId('');
      return undefined;
    }

    if (!selectedTripId || !visibleTrips.some((trip) => trip.id === selectedTripId)) {
      setSelectedTripId(visibleTrips[0].id);
    }

    return undefined;
  }, [open, selectedTripId, visibleTrips]);

  if (!open) {
    return null;
  }

  const counterpartLabel = normalizedMode === 'driver' ? 'Khách hàng' : 'Tài khoản';
  const counterpartName = normalizedMode === 'driver'
    ? selectedTrip?.customerName || '--'
    : accountDisplayName || resolvedIdentifier || 'Người dùng SmartRide';
  const counterpartContact = normalizedMode === 'driver'
    ? selectedTrip?.customerPhone || 'Chưa có số liên hệ'
    : accountPhone || resolvedIdentifier || 'Chưa có số liên hệ';
  const selectedStatusLabel = selectedTrip?.statusLabel || '';
  const selectedStatusTone = selectedTrip?.statusTone || 'neutral';
  const selectedTimeLabel = formatTripDate(selectedTrip?.completedAt || selectedTrip?.bookedAt);
  const detailHighlights = selectedTrip ? buildTripHighlights(normalizedMode, selectedTrip, accountDisplayName, resolvedIdentifier, accountPhone) : [];

  return createPortal(
    <div className="trip-history-modal" role="dialog" aria-modal="true" aria-label={preset.title}>
      <div className="trip-history-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="trip-history-modal__window">
        <button className="trip-history-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng lịch sử chuyến">
          <img className="trip-history-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="trip-history-modal__hero">
          <div className="trip-history-modal__hero-copy">
            <p className="trip-history-modal__eyebrow">{preset.eyebrow}</p>
            <h3>{preset.title}</h3>
            <p className="trip-history-modal__summary">{preset.summary}</p>
          </div>

          <div className="trip-history-modal__hero-meta">
            <span className="trip-history-modal__hero-chip">{preset.accentLabel}</span>
            <span className="trip-history-modal__hero-chip trip-history-modal__hero-chip--soft">
              {accountDisplayName || roleLabel || 'Người dùng SmartRide'}
            </span>
            <span className="trip-history-modal__hero-note">{preset.heroNote}</span>
          </div>
        </header>

        <section className="trip-history-modal__stats" aria-label="Tổng quan chuyến đi">
          {stats.map((stat) => (
            <article className="trip-history-modal__stat-card" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </article>
          ))}
        </section>

        <div className="trip-history-modal__content">
          <aside className="trip-history-modal__sidebar">
            <div className="trip-history-modal__search-bar">
              <input
                className="trip-history-modal__search-input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={preset.searchPlaceholder}
              />
            </div>

            <div className="trip-history-modal__filters" aria-label="Lọc theo trạng thái">
              {TRIP_HISTORY_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={classNames('trip-history-modal__filter-chip', statusFilter === option.value && 'is-active')}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="trip-history-modal__list">
              {historyLoading ? (
                <div className="trip-history-modal__empty-state">
                  <strong>Đang tải lịch sử chuyến</strong>
                  <p>Hệ thống đang đồng bộ dữ liệu thật từ server.</p>
                </div>
              ) : historyError ? (
                <div className="trip-history-modal__empty-state">
                  <strong>Không thể tải dữ liệu</strong>
                  <p>{historyError}</p>
                </div>
              ) : visibleTrips.length > 0 ? (
                visibleTrips.map((trip) => {
                  const isSelected = trip.id === selectedTrip?.id;
                  const subtitle = buildTripSubtitle(normalizedMode, trip);
                  const timeLabel = formatTripDate(trip.completedAt || trip.bookedAt);

                  return (
                    <button
                      key={trip.id}
                      className={classNames('trip-history-modal__item', isSelected && 'is-selected')}
                      type="button"
                      onClick={() => setSelectedTripId(trip.id)}
                    >
                      <div className="trip-history-modal__item-head">
                        <div className="trip-history-modal__item-title">
                          <span className={classNames('trip-history-modal__status', `is-${trip.statusTone}`)}>{trip.statusLabel}</span>
                          <strong>{trip.bookingCode}</strong>
                          <span className="trip-history-modal__item-subtitle">{subtitle || trip.rideTitle}</span>
                        </div>

                        <span className="trip-history-modal__item-time">{timeLabel}</span>
                      </div>

                      <div className="trip-history-modal__item-route">
                        <span>{trip.pickupLabel || '--'}</span>
                        <span>{trip.destinationLabel || '--'}</span>
                      </div>

                      <div className="trip-history-modal__item-meta">
                        <span className="trip-history-modal__item-pill">
                          <img className="trip-history-modal__item-pill-icon" src={clockIcon} alt="" aria-hidden="true" />
                          {formatDistance(trip.routeDistanceKm)}
                        </span>
                        <span className="trip-history-modal__item-pill">{trip.paymentLabel}</span>
                        <span className="trip-history-modal__item-pill">{trip.priceFormatted}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="trip-history-modal__empty-state">
                  <strong>Không tìm thấy chuyến phù hợp</strong>
                  <p>Hãy đổi từ khóa hoặc bộ lọc để xem lại các chuyến khác.</p>
                </div>
              )}
            </div>
          </aside>

          <section className="trip-history-modal__detail" aria-label="Chi tiết chuyến đi">
            {historyLoading ? (
              <div className="trip-history-modal__empty-detail">
                <strong>Đang đồng bộ dữ liệu</strong>
                <p>Chi tiết chuyến sẽ xuất hiện ngay sau khi server trả kết quả.</p>
              </div>
            ) : historyError ? (
              <div className="trip-history-modal__empty-detail">
                <strong>Không thể hiển thị chi tiết</strong>
                <p>{historyError}</p>
              </div>
            ) : selectedTrip ? (
              <>
                <div className="trip-history-modal__detail-header">
                  <div className="trip-history-modal__detail-copy">
                    <p className="trip-history-modal__detail-kicker">{selectedTrip.tripCode}</p>
                    <h4>{selectedTrip.rideTitle || selectedTrip.vehicleLabel}</h4>
                    <p className="trip-history-modal__detail-summary">
                      {selectedTrip.pickupLabel || '--'} → {selectedTrip.destinationLabel || '--'}
                    </p>
                  </div>

                  <div className="trip-history-modal__detail-badges">
                    <span className={classNames('trip-history-modal__status', `is-${selectedStatusTone}`)}>{selectedStatusLabel}</span>
                    <span className="trip-history-modal__detail-time">
                      <img className="trip-history-modal__detail-time-icon" src={clockIcon} alt="" aria-hidden="true" />
                      {selectedTimeLabel}
                    </span>
                  </div>
                </div>

                <div className="trip-history-modal__detail-grid">
                  <div className="trip-history-modal__stack">
                    <article className="trip-history-modal__route-card">
                      <div className="trip-history-modal__route-row">
                        <span className="trip-history-modal__route-icon trip-history-modal__route-icon--pickup">
                          <img className="trip-history-modal__route-icon-img" src={originIcon} alt="" aria-hidden="true" />
                        </span>

                        <div className="trip-history-modal__route-copy">
                          <span>Điểm đón</span>
                          <strong>{selectedTrip.pickupLabel || '--'}</strong>
                        </div>
                      </div>

                      <div className="trip-history-modal__route-divider" />

                      <div className="trip-history-modal__route-row">
                        <span className="trip-history-modal__route-icon trip-history-modal__route-icon--destination">
                          <img className="trip-history-modal__route-icon-img" src={pinIcon} alt="" aria-hidden="true" />
                        </span>

                        <div className="trip-history-modal__route-copy">
                          <span>Điểm đến</span>
                          <strong>{selectedTrip.destinationLabel || '--'}</strong>
                        </div>
                      </div>
                    </article>

                    <article className="trip-history-modal__person-card">
                      <div className="trip-history-modal__person-head">
                        <span className="trip-history-modal__person-icon">
                          <img className="trip-history-modal__person-icon-img" src={userIcon} alt="" aria-hidden="true" />
                        </span>

                        <div>
                          <span className="trip-history-modal__person-kicker">{counterpartLabel}</span>
                          <strong>{counterpartName}</strong>
                          <p>{counterpartContact}</p>
                        </div>
                      </div>

                      <div className="trip-history-modal__person-meta">
                        <span className="trip-history-modal__person-pill">{selectedTrip.vehicleLabel || '--'}</span>
                        <span className="trip-history-modal__person-pill">{selectedTrip.paymentStatusLabel || '--'}</span>
                        <span className="trip-history-modal__person-pill">{formatDistance(selectedTrip.routeDistanceKm)}</span>
                      </div>
                    </article>

                    <article className="trip-history-modal__note-card">
                      <span className="trip-history-modal__note-label">Ghi chú</span>
                      <p>{selectedTrip.note || 'Dữ liệu booking được lấy trực tiếp từ server.'}</p>
                    </article>
                  </div>

                  <div className="trip-history-modal__stack">
                    <article className="trip-history-modal__highlight-grid">
                      {detailHighlights.map((highlight) => (
                        <div className="trip-history-modal__highlight-card" key={highlight.label}>
                          <span className="trip-history-modal__highlight-icon">
                            <img className="trip-history-modal__highlight-icon-img" src={highlight.icon} alt="" aria-hidden="true" />
                          </span>
                          <span className="trip-history-modal__highlight-label">{highlight.label}</span>
                          <strong>{highlight.value}</strong>
                        </div>
                      ))}
                    </article>

                    <article className="trip-history-modal__map-shell">
                      <RoutePreviewMap
                        className="trip-history-modal__map"
                        pickupPosition={selectedTrip.pickupPosition}
                        destinationPosition={selectedTrip.destinationPosition}
                        routeGeometry={selectedTrip.routeGeometry}
                        routeProvider={selectedTrip.routeProvider}
                        showExpandButton={false}
                        showProviderLabel={false}
                      />

                      <div className="trip-history-modal__map-badge">
                        {selectedTrip.rideTitle || selectedTrip.vehicleLabel} · {formatDistance(selectedTrip.routeDistanceKm)}
                      </div>
                    </article>

                    <article className="trip-history-modal__summary-card">
                      <div>
                        <span className="trip-history-modal__summary-label">Giá chuyến</span>
                        <strong>{selectedTrip.priceFormatted}</strong>
                      </div>

                      <div>
                        <span className="trip-history-modal__summary-label">Thanh toán</span>
                        <strong>{selectedTrip.paymentLabel}</strong>
                      </div>

                      <div>
                        <span className="trip-history-modal__summary-label">Trạng thái thanh toán</span>
                        <strong>{selectedTrip.paymentStatusLabel}</strong>
                      </div>

                      <div>
                        <span className="trip-history-modal__summary-label">Mã chuyến</span>
                        <strong>{selectedTrip.bookingCode}</strong>
                      </div>
                    </article>
                  </div>
                </div>
              </>
            ) : (
              <div className="trip-history-modal__empty-detail">
                <strong>Chưa có chuyến phù hợp</strong>
                <p>Hãy thay đổi bộ lọc hoặc từ khóa để xem chi tiết chuyến khác.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}
