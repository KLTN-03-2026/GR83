import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format as formatDate, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import { closeIcon } from '../../assets/icons';
import { rideService } from '../../services/rideService';
import { classNames } from '../../utils/classNames';
import CustomerTripIssueReportModal from './CustomerTripIssueReportModal';
import TripHistoryDetailModal from './TripHistoryDetailModal';
import TripInvoiceModal from './TripInvoiceModal';

registerLocale('vi-VN', vi);

const TRIP_HISTORY_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'scheduled', label: 'Đặt trước' },
  { value: 'in-progress', label: 'Đang chờ' },
  { value: 'cancelled', label: 'Đã hủy' },
];

const TRIP_HISTORY_PRESETS = {
  customer: {
    eyebrow: 'Lịch sử chuyến đi',
    title: 'LỊCH SỬ CHUYẾN ĐI',
    summary: 'Tra cứu các chuyến đã hoàn thành, đặt trước hoặc đã hủy trong cùng một bảng.',
    searchPlaceholder: 'Mã chuyến đi',
    accentLabel: 'Khách hàng',
    heroNote: 'Dữ liệu thật từ server.',
  },
  driver: {
    eyebrow: 'Lịch sử chuyến đi',
    title: 'LỊCH SỬ CHUYẾN ĐI',
    summary: 'Theo dõi danh sách booking theo trạng thái, thời gian và số tiền thanh toán.',
    searchPlaceholder: 'Mã chuyến / khách hàng',
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

function formatDateKey(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseDateForPicker(dateString) {
  const normalizedValue = String(dateString ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedDate = parse(normalizedValue, 'yyyy-MM-dd', new Date());

  if (isValid(parsedDate)) {
    return parsedDate;
  }

  const fallbackDate = new Date(normalizedValue);

  return isValid(fallbackDate) ? fallbackDate : null;
}

function formatDateForFilterValue(dateValue) {
  if (!(dateValue instanceof Date) || !isValid(dateValue)) {
    return '';
  }

  return formatDate(dateValue, 'yyyy-MM-dd');
}

function formatDistance(distanceKm) {
  const normalizedDistance = Number(distanceKm);

  if (!Number.isFinite(normalizedDistance)) {
    return '--';
  }

  return `${normalizedDistance.toFixed(1)} km`;
}

function trimWithEllipsis(value, maxLength) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue || normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function compressLocationSegment(value) {
  return normalizeText(value)
    .replace(/^Thành phố\s+/i, 'TP. ')
    .replace(/^Tp\.?\s+/i, 'TP. ')
    .replace(/^Phường\s+/i, 'P. ')
    .replace(/^Xã\s+/i, 'X. ')
    .replace(/^Quận\s+/i, 'Q. ')
    .replace(/^Huyện\s+/i, 'H. ')
    .replace(/^Ward\s+/i, 'Ward ')
    .replace(/^District\s+/i, 'District ')
    .replace(/^Province\s+/i, 'Province ');
}

function formatCompactLocationLabel(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return '--';
  }

  const parts = normalizedValue
    .split(',')
    .map((part) => compressLocationSegment(part))
    .map((part) => trimWithEllipsis(part, 28))
    .filter(Boolean)
    .filter((part) => !/^\d{4,}$/.test(part))
    .filter((part) => !/^(việt nam|vietnam)$/i.test(part));

  if (parts.length === 0) {
    return trimWithEllipsis(normalizedValue, 42);
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const cityPart = parts.find((part, index) => index > 0 && /(tp\.|đà nẵng|da nang|hà nội|ha noi|hồ chí minh|ho chi minh)/i.test(normalizeSearchText(part)));
  const secondaryPart = cityPart && cityPart !== parts[0] ? cityPart : parts[1];

  if (!secondaryPart || secondaryPart === parts[0]) {
    return parts[0];
  }

  return `${parts[0]} · ${secondaryPart}`;
}

function formatCompactBookingCode(value) {
  const normalizedValue = normalizeText(value).toUpperCase().replace(/\s+/g, '');

  if (!normalizedValue) {
    return '--';
  }

  const segments = normalizedValue.split('-').filter(Boolean);

  if (segments.length >= 4) {
    return `${segments.slice(0, 3).join('-')}…${segments[segments.length - 1]}`;
  }

  if (segments.length === 3) {
    return `${segments[0]}-${segments[1]}…${segments[2]}`;
  }

  if (normalizedValue.length > 14) {
    return `${normalizedValue.slice(0, 10)}…${normalizedValue.slice(-4)}`;
  }

  return normalizedValue;
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
  const tripStatus = normalizeText(rawItem.tripStatus);
  const vehicleLabel = normalizeText(rawItem.vehicleLabel) || 'Xe';
  const routeGeometry = normalizeRouteGeometry(rawItem.routeGeometry);
  const pickupPosition = normalizePosition(rawItem.pickupPosition);
  const destinationPosition = normalizePosition(rawItem.destinationPosition);
  const price = Number(rawItem.price ?? rawItem.basePrice ?? rawItem.paymentAmount ?? 0);
  const originalPrice = Number(rawItem.originalPrice ?? rawItem.paymentOriginalAmount ?? price);
  const discountAmount = Number(rawItem.discountAmount ?? rawItem.paymentDiscountAmount ?? Math.max(0, originalPrice - price));
  const promotionCode = normalizeText(rawItem.promotionCode ?? rawItem.paymentPromotionCode);
  const promotionTitle = normalizeText(rawItem.promotionTitle ?? rawItem.paymentPromotionTitle);
  const promotionSummary = normalizeText(rawItem.promotionSummary) || [
    promotionCode ? `Mã ${promotionCode}` : '',
    promotionTitle && promotionTitle !== promotionCode ? promotionTitle : '',
    discountAmount > 0 ? `Giảm ${formatCurrency(discountAmount)}` : '',
  ].filter(Boolean).join(' · ');

  return {
    id: normalizeText(rawItem.id ?? bookingCode ?? fallbackId),
    bookingCode,
    bookingCodeShortLabel: formatCompactBookingCode(bookingCode),
    tripCode: paymentCode,
    tripCodeShortLabel: formatCompactBookingCode(paymentCode),
    paymentCode,
    status,
    statusLabel,
    statusTone,
    tripStatus,
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
    ratingScore: Number(rawItem.ratingScore ?? 0),
    ratingComment: normalizeText(rawItem.ratingComment),
    driverDisplayName: normalizeText(rawItem.driverDisplayName ?? rawItem.driverName),
    driverAccountId: normalizeText(rawItem.driverAccountId),
    driverPhone: normalizeText(rawItem.driverPhone),
    driverVehicleName: normalizeText(rawItem.driverVehicleName),
    driverVehicleLicensePlate: normalizeText(rawItem.driverVehicleLicensePlate),
    driverLicensePlate: normalizeText(rawItem.driverLicensePlate ?? rawItem.driverVehicleLicensePlate),
    price,
    priceFormatted: normalizeText(rawItem.priceFormatted) || formatCurrency(price),
    originalPrice,
    originalPriceFormatted: normalizeText(rawItem.originalPriceFormatted) || formatCurrency(originalPrice),
    discountAmount,
    discountAmountFormatted: normalizeText(rawItem.discountAmountFormatted) || formatCurrency(discountAmount),
    promotionCode,
    promotionTitle,
    promotionSummary,
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
    pickupShortLabel: formatCompactLocationLabel(pickupLabel),
    destinationShortLabel: formatCompactLocationLabel(destinationLabel),
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
      summary.completedAmount += Number(trip.price ?? 0) || 0;
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
    completedAmount: 0,
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
    completedAmount: Number(responseSummary.completedAmount ?? 0) || 0,
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
    { value: formatCompactNumber(summary.cancelledTrips), label: 'Đã hủy' },
    { value: formatCurrency(summary.completedAmount ?? 0), label: 'Tổng chi' },
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
  onNotify,
  onClose,
}) {
  const normalizedMode = mode === 'driver' ? 'driver' : 'customer';
  const preset = TRIP_HISTORY_PRESETS[normalizedMode];
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [dateFilterPickerOpen, setDateFilterPickerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTripId, setSelectedTripId] = useState('');
  const [issueReportTripId, setIssueReportTripId] = useState('');
  const [invoiceTrip, setInvoiceTrip] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historySummary, setHistorySummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const resolvedAccountId = useMemo(() => normalizeText(accountId), [accountId]);
  const resolvedIdentifier = useMemo(() => normalizeText(accountIdentifier), [accountIdentifier]);

  const visibleTrips = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery);
    const normalizedDateFilter = normalizeText(dateFilter);

    return historyItems.filter((trip) => {
      if (statusFilter !== 'all' && trip.status !== statusFilter) {
        return false;
      }

      if (normalizedDateFilter) {
        const tripDateKey = formatDateKey(trip.completedAt || trip.bookedAt);

        if (tripDateKey !== normalizedDateFilter) {
          return false;
        }
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
          trip.vehicleLabel,
          trip.paymentLabel,
          trip.paymentStatusLabel,
          trip.statusLabel,
          trip.priceFormatted,
        ]
          .filter(Boolean)
          .join(' '),
      );

      return searchableText.includes(normalizedQuery);
    });
  }, [dateFilter, historyItems, searchQuery, statusFilter]);

  const selectedTrip = useMemo(() => {
    if (!visibleTrips.length) {
      return null;
    }

    return visibleTrips.find((trip) => trip.id === selectedTripId) ?? null;
  }, [selectedTripId, visibleTrips]);

  const issueReportTrip = useMemo(() => {
    if (!historyItems.length) {
      return null;
    }

    return historyItems.find((trip) => trip.id === issueReportTripId) ?? null;
  }, [historyItems, issueReportTripId]);

  const stats = useMemo(
    () => buildTripHistoryStats(normalizedMode, historySummary ?? deriveSummaryFromItems(historyItems)),
    [historyItems, historySummary, normalizedMode],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setSearchQuery('');
    setDateFilter('');
    setDateFilterPickerOpen(false);
    setStatusFilter('all');
    setSelectedTripId('');
    setIssueReportTripId('');
    setInvoiceTrip(null);
    setInvoiceLoading(false);
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

    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
    };
  }, [normalizedMode, onClose, open, resolvedAccountId, resolvedIdentifier]);

  useEffect(() => {
    if (!open) {
      setDateFilterPickerOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (dateFilterPickerOpen) {
        setDateFilterPickerOpen(false);
        return;
      }

      if (selectedTripId) {
        setSelectedTripId('');
        return;
      }

      if (invoiceTrip) {
        setInvoiceTrip(null);
        return;
      }

      if (issueReportTripId) {
        setIssueReportTripId('');
        return;
      }

      onClose?.();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dateFilterPickerOpen, invoiceTrip, issueReportTripId, open, onClose, selectedTripId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (selectedTripId && !visibleTrips.some((trip) => trip.id === selectedTripId)) {
      setSelectedTripId('');
    }

    if (issueReportTripId && !historyItems.some((trip) => trip.id === issueReportTripId)) {
      setIssueReportTripId('');
    }

    return undefined;
  }, [historyItems, issueReportTripId, open, selectedTripId, visibleTrips]);

  if (!open) {
    return null;
  }

  const selectedTripStatusLabel = selectedTrip?.statusLabel || '';
  const selectedTripStatusTone = selectedTrip?.statusTone || 'neutral';
  const selectedTripDateLabel = formatTripDate(selectedTrip?.completedAt || selectedTrip?.bookedAt);
  const selectedTripPriceLabel = selectedTrip?.priceFormatted || '--';

  const handleOpenInvoice = async (tripItem) => {
    const bookingCode = normalizeText(tripItem?.bookingCode);

    if (!bookingCode) {
      onNotify?.('Không tìm thấy mã chuyến để mở hóa đơn.', 'error', 2200);
      return;
    }

    setInvoiceLoading(true);

    try {
      const response = await rideService.getTripInvoice(bookingCode, {
        accountId: resolvedAccountId,
        identifier: resolvedIdentifier,
        roleCode: normalizedMode === 'driver' ? 'Q3' : 'Q2',
      });

      setInvoiceTrip(response?.item ?? tripItem);
    } catch (error) {
      onNotify?.(error?.message || 'Không thể tải hóa đơn chuyến đi.', 'error', 2400);
    } finally {
      setInvoiceLoading(false);
    }
  };

  return createPortal(
    <div className={classNames('trip-history-modal', `trip-history-modal--${normalizedMode}`)} role="dialog" aria-modal="true" aria-label={preset.title}>
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

        <section className="trip-history-modal__toolbar" aria-label="Bộ lọc lịch sử chuyến">
          <label className="trip-history-modal__field trip-history-modal__field--search">
            <span className="trip-history-modal__field-label">Mã chuyến đi</span>
            <input
              className="trip-history-modal__input"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={preset.searchPlaceholder}
            />
          </label>

          <label className="trip-history-modal__field">
            <span className="trip-history-modal__field-label">Ngày giờ</span>
            <DatePicker
              selected={parseDateForPicker(dateFilter)}
              onChange={(selectedDate) => {
                setDateFilter(formatDateForFilterValue(selectedDate));
                setDateFilterPickerOpen(false);
              }}
              onCalendarOpen={() => setDateFilterPickerOpen(true)}
              onCalendarClose={() => setDateFilterPickerOpen(false)}
              onClickOutside={() => setDateFilterPickerOpen(false)}
              onInputClick={() => setDateFilterPickerOpen(true)}
              locale="vi-VN"
              dateFormat="dd/MM/yyyy"
              placeholderText="dd/mm/yyyy"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              className="admin-user-modal__date-input"
              calendarClassName="admin-user-modal__date-calendar"
              popperClassName="admin-user-modal__date-popper"
              open={dateFilterPickerOpen}
              autoComplete="off"
              showPopperArrow={false}
            />
          </label>

          <label className="trip-history-modal__field">
            <span className="trip-history-modal__field-label">Trạng thái</span>
            <select
              className="trip-history-modal__input trip-history-modal__select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {TRIP_HISTORY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {selectedTrip ? (
          <section className="trip-history-modal__selection-strip" aria-label="Chuyến đang được xem">
            <div className="trip-history-modal__selection-copy">
              <span className="trip-history-modal__selection-kicker">Đang xem</span>
              <strong title={selectedTrip.bookingCode}>{selectedTrip.bookingCodeShortLabel}</strong>
              <p title={`${selectedTrip.pickupLabel || '--'} → ${selectedTrip.destinationLabel || '--'}`}>
                {selectedTrip.pickupShortLabel || '--'} → {selectedTrip.destinationShortLabel || '--'}
              </p>
            </div>

            <div className="trip-history-modal__selection-meta">
              <span className="trip-history-modal__selection-pill">{selectedTrip.vehicleLabel || '--'}</span>
              <span className="trip-history-modal__selection-pill">{selectedTripPriceLabel}</span>
              <span className="trip-history-modal__selection-pill">{selectedTripDateLabel}</span>
              <span className={classNames('trip-history-modal__status', `is-${selectedTripStatusTone}`)}>{selectedTripStatusLabel}</span>
              {selectedTrip.promotionSummary ? (
                <span className="trip-history-modal__selection-pill trip-history-modal__selection-pill--soft">{selectedTrip.promotionSummary}</span>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="trip-history-modal__table-card" aria-label="Danh sách chuyến đi">
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
            <div className="trip-history-modal__table-shell">
              <table className="trip-history-modal__table">
                <colgroup>
                  <col className="trip-history-modal__col trip-history-modal__col--code" />
                  <col className="trip-history-modal__col trip-history-modal__col--pickup" />
                  <col className="trip-history-modal__col trip-history-modal__col--destination" />
                  <col className="trip-history-modal__col trip-history-modal__col--vehicle" />
                  <col className="trip-history-modal__col trip-history-modal__col--money" />
                  <col className="trip-history-modal__col trip-history-modal__col--time" />
                  <col className="trip-history-modal__col trip-history-modal__col--status" />
                  <col className="trip-history-modal__col trip-history-modal__col--action" />
                </colgroup>

                <thead>
                  <tr>
                    <th>Mã chuyến</th>
                    <th>Điểm đón</th>
                    <th>Điểm đến</th>
                    <th>Loại xe</th>
                    <th>Số tiền</th>
                    <th>Ngày giờ</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleTrips.map((trip) => {
                    const isSelected = trip.id === selectedTrip?.id;
                    const tripTimeLabel = formatTripDate(trip.completedAt || trip.bookedAt);

                    return (
                      <tr key={trip.id} className={classNames('trip-history-modal__table-row', isSelected && 'is-selected')}>
                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--code">
                          <strong title={trip.bookingCode}>{trip.bookingCodeShortLabel}</strong>
                          <span title={trip.tripCode}>{trip.tripCodeShortLabel}</span>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--route">
                          <span title={trip.pickupLabel || '--'}>{trip.pickupShortLabel || '--'}</span>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--route">
                          <span title={trip.destinationLabel || '--'}>{trip.destinationShortLabel || '--'}</span>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--vehicle">
                          <strong>{trip.vehicleLabel || '--'}</strong>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--money">
                          <strong>{trip.priceFormatted}</strong>
                          <span>{trip.paymentLabel}</span>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--time">
                          <strong>{tripTimeLabel}</strong>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--status">
                          <span className={classNames('trip-history-modal__status', `is-${trip.statusTone}`)}>{trip.statusLabel}</span>
                        </td>

                        <td className="trip-history-modal__table-cell trip-history-modal__table-cell--action">
                          <button
                            className="trip-history-modal__detail-button"
                            type="button"
                            onClick={() => setSelectedTripId(trip.id)}
                          >
                            Xem
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="trip-history-modal__empty-state">
              <strong>Không tìm thấy chuyến phù hợp</strong>
              <p>Hãy đổi từ khóa, ngày giờ hoặc trạng thái để xem lại các chuyến khác.</p>
            </div>
          )}
        </section>

        {selectedTrip ? (
          <TripHistoryDetailModal
            open={Boolean(selectedTrip)}
            trip={selectedTrip}
            mode={normalizedMode}
            onOpenInvoice={(tripItem) => {
              void handleOpenInvoice(tripItem);
            }}
            invoiceLoading={invoiceLoading}
            accountDisplayName={accountDisplayName}
            accountIdentifier={accountIdentifier}
            accountPhone={accountPhone}
            onOpenIssueReport={async (tripItem) => {
              const nextTripId = tripItem?.id ?? '';
              const bookingCode = normalizeText(tripItem?.bookingCode);

              if (!nextTripId || !bookingCode || !resolvedAccountId) {
                onNotify?.('Không thể mở báo lỗi cho chuyến đi này.', 'error', 2200);
                return;
              }

              try {
                const metaResponse = await rideService.getTripIssueReportMeta(bookingCode, { accountId: resolvedAccountId });

                if (metaResponse?.alreadyReported) {
                  onNotify?.('Bạn đã khiếu nại cho chuyến đi này.', 'info', 2600);
                  return;
                }

                setIssueReportTripId(nextTripId);
              } catch (error) {
                onNotify?.(error?.message || 'Không thể kiểm tra trạng thái khiếu nại.', 'error', 2600);
              }
            }}
            onClose={() => setSelectedTripId('')}
          />
        ) : null}

        {issueReportTrip && normalizedMode === 'customer' ? (
          <CustomerTripIssueReportModal
            open={Boolean(issueReportTrip)}
            trip={issueReportTrip}
            accountId={resolvedAccountId}
            onClose={() => setIssueReportTripId('')}
          />
        ) : null}

        <TripInvoiceModal
          open={Boolean(invoiceTrip)}
          invoice={invoiceTrip}
          onClose={() => setInvoiceTrip(null)}
        />
      </section>
    </div>,
    document.body,
  );
}
