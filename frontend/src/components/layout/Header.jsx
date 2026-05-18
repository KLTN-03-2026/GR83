import { closeIcon, helpIcon, logoIcon, menuIcon, notificationIcon, userIcon } from '../../assets/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminPaymentManagementModal from '../admin/AdminPaymentManagementModal';
import AdminNotificationManagementModal from '../admin/AdminNotificationManagementModal';
import AdminUserManagementModal from '../admin/AdminUserManagementModal';
import AdminDriverManagementModal from '../admin/AdminDriverManagementModal';
import AdminPromotionManagementModal from '../admin/AdminPromotionManagementModal';
import AdminTripManagementModal from '../admin/AdminTripManagementModal';
import AdminRevenueReportModal from '../admin/AdminRevenueReportModal';
import AdminComplaintManagementModal from '../admin/AdminComplaintManagementModal';
import AdminDriverViolationManagementModal from '../admin/AdminDriverViolationManagementModal';
import AdminVehicleChangeRequestModal from '../admin/AdminVehicleChangeRequestModal';
import TripHistoryModal from '../ui/TripHistoryModal';
import DriverReviewModal from '../ui/DriverReviewModal';
import DriverWalletModal from '../ui/DriverWalletModal';
import CustomerWalletModal from '../ui/CustomerWalletModal';
import DriverPersonalInfoModal from '../ui/DriverPersonalInfoModal';
import DriverIncomeReportModal from '../ui/DriverIncomeReportModal';
import DriverRideReceiveSettingsModal from '../ui/DriverRideReceiveSettingsModal';
import DriverSupportSafetyModal from '../ui/DriverSupportSafetyModal';
import { notificationService } from '../../services/notificationService';
import { driverVehicleRequestService } from '../../services/driverVehicleRequestService';
import { connectRideEventStream } from '../../services/rideRealtimeService';
import { customerWalletService } from '../../services/customerWalletService';
import { driverWalletService } from '../../services/driverWalletService';

const WALLET_TOPUP_RETURN_STATE_KEY = 'smartride.wallet.topup.return.v1';
const WALLET_TOPUP_RETURN_MAX_AGE_MS = 15 * 60 * 1000;

function readWalletTopupReturnState() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(WALLET_TOPUP_RETURN_STATE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    const createdAt = Number(parsed?.createdAt ?? 0);
    const now = Date.now();

    if (!Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > WALLET_TOPUP_RETURN_MAX_AGE_MS) {
      window.sessionStorage.removeItem(WALLET_TOPUP_RETURN_STATE_KEY);
      return null;
    }

    return {
      userId: String(parsed?.userId ?? '').trim(),
      role: String(parsed?.role ?? '').trim().toLowerCase(),
      method: String(parsed?.method ?? '').trim().toLowerCase(),
      transactionId: String(parsed?.transactionId ?? '').trim(),
      createdAt,
    };
  } catch {
    window.sessionStorage.removeItem(WALLET_TOPUP_RETURN_STATE_KEY);
    return null;
  }
}

function clearWalletTopupReturnState() {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(WALLET_TOPUP_RETURN_STATE_KEY);
}

function parseFirstFiniteNumber(...values) {
  for (const value of values) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function parseWalletTopupReturnResultFromUrl() {
  if (typeof window === 'undefined') {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const searchParams = currentUrl.searchParams;
  const hashParams = new URLSearchParams(String(currentUrl.hash ?? '').replace(/^#/, ''));
  const getParam = (...keys) => {
    for (const key of keys) {
      const searchValue = searchParams.get(key);

      if (searchValue !== null && String(searchValue).trim()) {
        return String(searchValue).trim();
      }

      const hashValue = hashParams.get(key);

      if (hashValue !== null && String(hashValue).trim()) {
        return String(hashValue).trim();
      }
    }

    return '';
  };

  const providerToken = getParam('payment_provider', 'provider');
  const partnerCode = getParam('partnerCode');
  const hasMoMoSignal = Boolean(
    providerToken.toLowerCase() === 'momo'
    || partnerCode
    || getParam('orderId', 'requestId', 'transId', 'extraData'),
  );
  const hasZaloPaySignal = Boolean(
    providerToken.toLowerCase() === 'zalopay'
    || getParam('apptransid', 'app_trans_id', 'zp_trans_token', 'zptranstoken', 'checksum'),
  );

  if (!hasMoMoSignal && !hasZaloPaySignal) {
    return null;
  }

  const provider = hasMoMoSignal ? 'momo' : 'zalopay';
  const resultCode = parseFirstFiniteNumber(getParam('resultCode', 'errorCode'));
  const returnCode = parseFirstFiniteNumber(getParam('return_code', 'returnCode'));
  const status = parseFirstFiniteNumber(getParam('status'));
  const isCancelled = ['1', 'true', 'yes'].includes(getParam('cancel', 'cancelled', 'isCancelled').toLowerCase());
  const message = getParam('message', 'localMessage', 'return_message', 'returnMessage', 'errorMessage');

  if (provider === 'momo') {
    if (resultCode === 0) {
      return { provider, isFailure: false, isSuccess: true, message };
    }

    if (resultCode !== null || isCancelled) {
      return { provider, isFailure: true, isSuccess: false, message };
    }

    return { provider, isFailure: false, isSuccess: false, message };
  }

  if (returnCode === 1 || status === 1) {
    return { provider, isFailure: false, isSuccess: true, message };
  }

  if (returnCode !== null || status !== null || isCancelled) {
    return { provider, isFailure: true, isSuccess: false, message };
  }

  return { provider, isFailure: false, isSuccess: false, message };
}

function clearWalletTopupReturnParamsFromUrl() {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.search = '';
  currentUrl.hash = '';
  window.history.replaceState({}, document.title, currentUrl.toString());
}

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const ROLE_LABELS = {
  Q1: 'Quản trị viên',
  Q2: 'Khách hàng',
  Q3: 'Tài xế',
};

const ROLE_MENUS = {
    Q1: {
      columns: 3,
      rows: [
        [
          { id: 'admin-users', label: 'Quản lý người dùng' },
          { id: 'admin-payments', label: 'Quản lý thanh toán' },
          { id: 'admin-notifications', label: 'Quản lý thông báo' },
        ],
        [
          { id: 'admin-drivers', label: 'Quản lý tài xế' },
          { id: 'admin-complaints', label: 'Xử lý khiếu nại' },
          { id: 'admin-promotions', label: 'Quản lý ưu đãi' },
        ],
        [
          { id: 'admin-trips', label: 'Quản lý chuyến đi' },
          { id: 'admin-driver-violations', label: 'Xử lý vi phạm tài xế' },
          { id: 'admin-revenue', label: 'Xuất báo cáo doanh thu' },
        ],
      ],
    },
    Q2: {
      columns: 2,
      rows: [
        [{ id: 'customer-booking', label: 'Đặt xe', action: 'booking-form' }, { id: 'customer-wallet', label: 'Ví' }],
        [{ id: 'customer-history', label: 'Lịch sử chuyến', requiresAuth: true }, null],
        [{ id: 'customer-profile', label: 'Quản lý tài khoản cá nhân', action: 'profile', requiresAuth: true }, null],
        [{ id: 'customer-driver-signup', label: 'Đăng ký Tài xế', action: 'driver-signup' }, null],
      ],
    },
    Q3: {
      columns: 2,
      rows: [
        [
          { id: 'driver-wallet', label: 'Ví' },
          { id: 'driver-dispatch-settings', label: 'Cài đặt nhận chuyến' },
        ],
        [
          { id: 'driver-reviews', label: 'Xem đánh giá' },
          { id: 'driver-income-report', label: 'Quản lý thu nhập' },
        ],
        [
          { id: 'driver-trips', label: 'Lịch sử chuyến đi' },
          { id: 'driver-support-safety', label: 'Hỗ trợ và an toàn' },
        ],
      ],
    },
  };

  const ROLE_POPUP_PRESETS = {
    Q1: {
      contextTitle: 'Bảng điều phối quản trị',
      summaryPrefix: 'Theo dõi và xử lý tác vụ hệ thống cho',
      stats: [
        { label: 'Đang chờ xử lý', value: '18' },
        { label: 'Hoàn tất hôm nay', value: '46' },
        { label: 'Mức ưu tiên cao', value: '7' },
      ],
      checklist: ['Kiểm tra dữ liệu mới cập nhật', 'Ưu tiên tác vụ khẩn cấp', 'Đối soát trạng thái trước khi xác nhận'],
    },
    Q2: {
      contextTitle: 'Trung tâm dịch vụ khách hàng',
      summaryPrefix: 'Giao diện thao tác nhanh dành cho',
      stats: [
        { label: 'Yêu cầu hôm nay', value: '5' },
        { label: 'Đang hoạt động', value: '2' },
        { label: 'Thông báo mới', value: '3' },
      ],
      checklist: ['Xác nhận thông tin trước khi gửi', 'Theo dõi trạng thái theo thời gian thực', 'Liên hệ hỗ trợ khi có bất thường'],
    },
    Q3: {
      contextTitle: 'Bảng vận hành tài xế',
      summaryPrefix: 'Quản lý hiệu suất và vận hành cho',
      stats: [
        { label: 'Chuyến hôm nay', value: '12' },
        { label: 'Tỉ lệ nhận chuyến', value: '96%' },
        { label: 'Yêu cầu hỗ trợ', value: '1' },
      ],
      checklist: ['Giữ trạng thái trực tuyến ổn định', 'Xác nhận thông tin cuốc xe trước khi nhận', 'Ưu tiên phản hồi đánh giá quan trọng'],
    },
  };
function buildRoleFeaturePopup(item, roleCode, roleLabel) {
  const preset = ROLE_POPUP_PRESETS[roleCode] ?? ROLE_POPUP_PRESETS.Q2;

  return {
    ...item,
    roleLabel,
    contextTitle: preset.contextTitle,
    summary: `${preset.summaryPrefix} "${item.label}".`,
    stats: preset.stats,
    checklist: preset.checklist,
  };
}

function normalizeRoleCode(rawRoleCode) {
  const normalizedRoleCode = String(rawRoleCode ?? '')
    .trim()
    .toUpperCase();

  if (normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3') {
    return normalizedRoleCode;
  }

  const roleToken = String(rawRoleCode ?? '')
    .trim()
    .toLowerCase();

  if (roleToken.includes('admin') || roleToken.includes('quantri')) {
    return 'Q1';
  }

  if (roleToken.includes('taixe') || roleToken.includes('driver')) {
    return 'Q3';
  }

  return 'Q2';
}

function extractNotificationList(response) {
  if (Array.isArray(response?.notifications)) {
    return response.notifications;
  }

  if (Array.isArray(response?.data?.notifications)) {
    return response.data.notifications;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return [];
}

function normalizeNotification(notification, fallbackId = 0) {
  return {
    id: Number(notification?.id ?? fallbackId) || fallbackId,
    title: String(notification?.title ?? '').trim(),
    content: String(notification?.content ?? '').trim(),
    recipient: String(notification?.recipient ?? '').trim().toLowerCase(),
    status: String(notification?.status ?? '').trim().toLowerCase(),
    sendAt: String(notification?.sendAt ?? '').trim(),
  };
}

function parseRideRequestNotificationContent(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return null;
  }

  try {
    const parsedContent = JSON.parse(trimmedContent);

    if (!parsedContent || typeof parsedContent !== 'object' || Array.isArray(parsedContent)) {
      return null;
    }

    if (String(parsedContent.type ?? '').trim().toLowerCase() !== 'ride_request') {
      return null;
    }

    return parsedContent;
  } catch {
    return null;
  }
}

function isRideRequestNotification(notification) {
  return Boolean(parseRideRequestNotificationContent(notification?.content));
}

function formatNotificationDate(value) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isNotificationVisible(notification) {
  if (notification.status === 'sent') {
    return true;
  }

  if (notification.status !== 'scheduled' || !notification.sendAt) {
    return false;
  }

  const sendAtDate = new Date(notification.sendAt);
  return !Number.isNaN(sendAtDate.getTime()) && sendAtDate.getTime() <= Date.now();
}

const NOTIFICATION_READ_STORAGE_PREFIX = 'smartride.notification.readIds';

function normalizeStorageKeyPart(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  return normalizedValue ? encodeURIComponent(normalizedValue) : 'guest';
}

function getNotificationReadStorageKey(roleCode, accountIdentifier) {
  return [
    NOTIFICATION_READ_STORAGE_PREFIX,
    normalizeStorageKeyPart(roleCode ?? 'Q2'),
    normalizeStorageKeyPart(accountIdentifier ?? 'guest'),
  ].join('.');
}

function readNotificationReadIds(storageKey) {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    const nextValues = Array.isArray(parsedValue)
      ? parsedValue
      : Array.isArray(parsedValue?.ids)
        ? parsedValue.ids
        : [];

    return Array.from(new Set(nextValues.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));
  } catch {
    return [];
  }
}

function saveNotificationReadIds(storageKey, readIds) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalizedReadIds = Array.from(new Set((Array.isArray(readIds) ? readIds : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));

    window.localStorage.setItem(storageKey, JSON.stringify({ ids: normalizedReadIds }));
  } catch {
    // Ignore storage failures.
  }
}

export default function Header({
  isAuthenticated = false,
  accountId = '',
  accountDisplayName = '',
  accountIdentifier = '',
  accountRoleCode = '',
  accountPhone = '',
  onProfile,
  onBooking,
  onDriverSignup,
  onChangePassword,
  onLogout,
  onLogin,
  onNotify,
  onHelp,
  onForceTripCancelled,
  onCustomerWalletModalOpenChange,
  customerHasActiveTrip = false,
  driverCheckedIn = false,
  driverAutoReceiveEnabled = true,
  onDriverCheckedInChange,
}) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminUserModalOpen, setAdminUserModalOpen] = useState(false);
  const [adminDriverModalOpen, setAdminDriverModalOpen] = useState(false);
  const [adminPaymentModalOpen, setAdminPaymentModalOpen] = useState(false);
  const [adminNotificationModalOpen, setAdminNotificationModalOpen] = useState(false);
  const [adminPromotionModalOpen, setAdminPromotionModalOpen] = useState(false);
  const [adminTripModalOpen, setAdminTripModalOpen] = useState(false);
  const [adminRevenueModalOpen, setAdminRevenueModalOpen] = useState(false);
  const [adminComplaintModalOpen, setAdminComplaintModalOpen] = useState(false);
  const [adminDriverViolationModalOpen, setAdminDriverViolationModalOpen] = useState(false);
  const [driverWalletModalOpen, setDriverWalletModalOpen] = useState(false);
  const [customerWalletModalOpen, setCustomerWalletModalOpen] = useState(false);
  const [driverProfileModalOpen, setDriverProfileModalOpen] = useState(false);
  const [driverIncomeModalOpen, setDriverIncomeModalOpen] = useState(false);
  const [driverDispatchModalOpen, setDriverDispatchModalOpen] = useState(false);
  const [driverSupportModalOpen, setDriverSupportModalOpen] = useState(false);
  const [driverResolutionPopup, setDriverResolutionPopup] = useState(null);
  const [pendingVehicleRequests, setPendingVehicleRequests] = useState([]);
  const [adminVehicleModalOpen, setAdminVehicleModalOpen] = useState(false);
  const [adminVehicleViewMode, setAdminVehicleViewMode] = useState('summary');
  const [adminVehicleDetail, setAdminVehicleDetail] = useState(null);
  const [adminVehicleLoading, setAdminVehicleLoading] = useState(false);
  const [adminVehicleActionLoading, setAdminVehicleActionLoading] = useState(false);
  const [adminVehicleRejectNote, setAdminVehicleRejectNote] = useState('');
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationReadIds, setNotificationReadIds] = useState([]);
  const [selectedRoleItemId, setSelectedRoleItemId] = useState('');
  const [activeRolePopupItem, setActiveRolePopupItem] = useState(null);
  const [activeTripHistoryItemId, setActiveTripHistoryItemId] = useState('');
  const roleMenuRef = useRef(null);
  const accountMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const walletTopupReturnCheckInFlightRef = useRef(false);

  const normalizedRoleCode = normalizeRoleCode(isAuthenticated ? accountRoleCode : 'Q2');
  const activeRoleMenu = useMemo(() => ROLE_MENUS[normalizedRoleCode] ?? ROLE_MENUS.Q2, [normalizedRoleCode]);
  const activeRoleLabel = ROLE_LABELS[normalizedRoleCode] ?? ROLE_LABELS.Q2;
  const hasNotificationAccess = normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3';
  const canViewNotifications = isAuthenticated && hasNotificationAccess;
  const showNotificationButton = !isAuthenticated || hasNotificationAccess;
  const notificationRecipient = normalizedRoleCode === 'Q3' ? 'driver' : normalizedRoleCode === 'Q2' ? 'customer' : 'all';
  const notificationPanelTitle = normalizedRoleCode === 'Q1' ? 'Thông báo hệ thống' : 'Thông báo của bạn';
  const notificationStorageKey = useMemo(
    () => getNotificationReadStorageKey(normalizedRoleCode, accountIdentifier || accountDisplayName || 'guest'),
    [accountDisplayName, accountIdentifier, normalizedRoleCode],
  );
  const notificationReadIdSet = useMemo(() => new Set(notificationReadIds), [notificationReadIds]);
  const notificationUnreadCount = useMemo(
    () => notificationItems.filter((item) => !notificationReadIdSet.has(item.id)).length,
    [notificationItems, notificationReadIdSet],
  );

  useEffect(() => {
    onCustomerWalletModalOpenChange?.(customerWalletModalOpen);
  }, [customerWalletModalOpen, onCustomerWalletModalOpenChange]);

  useEffect(() => {
    if (!isAuthenticated || !accountId) {
      return undefined;
    }

    if (normalizedRoleCode !== 'Q2' && normalizedRoleCode !== 'Q3') {
      return undefined;
    }

    if (walletTopupReturnCheckInFlightRef.current) {
      return undefined;
    }

    const returnState = readWalletTopupReturnState();

    if (!returnState) {
      return undefined;
    }

    const accountIdToken = String(accountId).trim();
    const roleToken = normalizedRoleCode === 'Q3' ? 'driver' : 'customer';

    if (!accountIdToken || returnState.userId !== accountIdToken || returnState.role !== roleToken) {
      return undefined;
    }

    const returnResult = parseWalletTopupReturnResultFromUrl();

    walletTopupReturnCheckInFlightRef.current = true;
    let cancelled = false;

    const runSyncAfterReturn = async () => {
      const walletService = roleToken === 'driver' ? driverWalletService : customerWalletService;
      let isTopupSynced = false;

      if (!returnResult?.isFailure) {
        try {
          for (let attempt = 1; attempt <= 4; attempt += 1) {
            const response = await walletService.syncTopupWallet({ userId: accountIdToken, role: roleToken });
            const synchronizedItems = Array.isArray(response?.synchronized) ? response.synchronized : [];

            if (synchronizedItems.some((item) => item?.synced)) {
              isTopupSynced = true;
              break;
            }

            if (attempt < 4) {
              await waitFor(1800);
            }
          }
        } catch {
          // Ignore transient sync failures and let normal wallet flow handle retries.
        }
      }

      if (cancelled) {
        return;
      }

      clearWalletTopupReturnState();
      clearWalletTopupReturnParamsFromUrl();

      if (isTopupSynced) {
        onNotify?.('Đã nạp tiền thành công.', 'success', 2600);
      } else {
        onNotify?.(returnResult?.message || 'Nạp tiền thất bại.', 'error', 2600);
      }

      if (roleToken === 'driver') {
        setDriverWalletModalOpen(true);
      } else {
        setCustomerWalletModalOpen(true);
      }

      walletTopupReturnCheckInFlightRef.current = false;
    };

    void runSyncAfterReturn();

    return () => {
      cancelled = true;
      walletTopupReturnCheckInFlightRef.current = false;
    };
  }, [accountId, isAuthenticated, normalizedRoleCode, onNotify]);

  useEffect(() => {
    const availableItemIds = activeRoleMenu.rows
      .flat()
      .filter(Boolean)
      .map((item) => item.id);

    if (selectedRoleItemId && !availableItemIds.includes(selectedRoleItemId)) {
      setSelectedRoleItemId('');
    }

    if (activeRolePopupItem?.id && !availableItemIds.includes(activeRolePopupItem.id)) {
      setActiveRolePopupItem(null);
    }

    if (activeTripHistoryItemId && !availableItemIds.includes(activeTripHistoryItemId)) {
      setActiveTripHistoryItemId('');
    }

    if (normalizedRoleCode !== 'Q1' && adminUserModalOpen) {
      setAdminUserModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminDriverModalOpen) {
      setAdminDriverModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminPaymentModalOpen) {
      setAdminPaymentModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminNotificationModalOpen) {
      setAdminNotificationModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminPromotionModalOpen) {
      setAdminPromotionModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminTripModalOpen) {
      setAdminTripModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminComplaintModalOpen) {
      setAdminComplaintModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q1' && adminDriverViolationModalOpen) {
      setAdminDriverViolationModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverWalletModalOpen) {
      setDriverWalletModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q2' && customerWalletModalOpen) {
      setCustomerWalletModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverProfileModalOpen) {
      setDriverProfileModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverIncomeModalOpen) {
      setDriverIncomeModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverDispatchModalOpen) {
      setDriverDispatchModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverSupportModalOpen) {
      setDriverSupportModalOpen(false);
    }

    if (normalizedRoleCode !== 'Q3' && driverResolutionPopup) {
      setDriverResolutionPopup(null);
    }

    if (normalizedRoleCode !== 'Q1' && adminVehicleModalOpen) {
      setAdminVehicleModalOpen(false);
      setAdminVehicleViewMode('summary');
      setAdminVehicleDetail(null);
      setAdminVehicleRejectNote('');
      setPendingVehicleRequests([]);
    }

    if (!canViewNotifications && notificationMenuOpen) {
      setNotificationMenuOpen(false);
    }
  }, [
    activeRoleMenu,
    activeRolePopupItem,
    adminDriverModalOpen,
    adminPaymentModalOpen,
    adminNotificationModalOpen,
    adminUserModalOpen,
    activeTripHistoryItemId,
    adminComplaintModalOpen,
    adminDriverViolationModalOpen,
    canViewNotifications,
    driverProfileModalOpen,
    driverIncomeModalOpen,
    driverDispatchModalOpen,
    driverSupportModalOpen,
    driverResolutionPopup,
    driverWalletModalOpen,
    customerWalletModalOpen,
    adminVehicleModalOpen,
    notificationMenuOpen,
    normalizedRoleCode,
    selectedRoleItemId,
  ]);

  useEffect(() => {
    if (
      !accountMenuOpen &&
      !roleMenuOpen &&
      !notificationMenuOpen &&
      !activeRolePopupItem &&
      !adminDriverModalOpen &&
      !adminPaymentModalOpen &&
      !adminNotificationModalOpen &&
      !adminPromotionModalOpen &&
      !adminComplaintModalOpen &&
      !adminDriverViolationModalOpen &&
      !driverWalletModalOpen &&
      !customerWalletModalOpen &&
      !driverProfileModalOpen &&
      !driverIncomeModalOpen &&
      !driverDispatchModalOpen &&
      !driverSupportModalOpen &&
      !adminVehicleModalOpen &&
      !adminUserModalOpen
    ) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (roleMenuOpen && !roleMenuRef.current?.contains(event.target)) {
        setRoleMenuOpen(false);
      }

      if (accountMenuOpen && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }

      if (notificationMenuOpen && !notificationMenuRef.current?.contains(event.target)) {
        setNotificationMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminComplaintModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setDriverWalletModalOpen(false);
      setCustomerWalletModalOpen(false);
      setDriverProfileModalOpen(false);
      setDriverIncomeModalOpen(false);
      setDriverDispatchModalOpen(false);
      setDriverSupportModalOpen(false);
      setAdminVehicleModalOpen(false);
      setDriverResolutionPopup(null);
      setActiveTripHistoryItemId('');
      setRoleMenuOpen(false);
      setAccountMenuOpen(false);
      setNotificationMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    accountMenuOpen,
    roleMenuOpen,
    notificationMenuOpen,
    activeRolePopupItem,
    adminDriverModalOpen,
    adminNotificationModalOpen,
    adminPaymentModalOpen,
    adminPromotionModalOpen,
    adminComplaintModalOpen,
    adminDriverViolationModalOpen,
    driverWalletModalOpen,
    customerWalletModalOpen,
    driverProfileModalOpen,
    driverIncomeModalOpen,
    driverDispatchModalOpen,
    driverSupportModalOpen,
    adminVehicleModalOpen,
    adminUserModalOpen,
  ]);

  useEffect(() => {
    if (!canViewNotifications) {
      setNotificationMenuOpen(false);
      setNotificationItems([]);
      setNotificationError('');
      setNotificationLoading(false);
      setNotificationReadIds([]);
      return undefined;
    }

    setNotificationReadIds(readNotificationReadIds(notificationStorageKey));

    return undefined;
  }, [canViewNotifications, notificationStorageKey]);

  useEffect(() => {
    if (!canViewNotifications) {
      setNotificationMenuOpen(false);
      setNotificationItems([]);
      setNotificationError('');
      setNotificationLoading(false);
      return undefined;
    }

    const abortController = new AbortController();
    let isActive = true;
    const shouldShowLoading = notificationMenuOpen;

    if (shouldShowLoading) {
      setNotificationLoading(true);
    }

    setNotificationError('');

    notificationService
      .listNotifications(
        {
          recipient: notificationRecipient,
          // For individual roles (Q2/Q3) filter by their own accountId so they don't see
          // notifications targeted at other accounts (e.g. warning notifications for other drivers).
          ...(normalizedRoleCode !== 'Q1' && accountId ? { accountId } : {}),
        },
        { signal: abortController.signal },
      )
      .then((response) => {
        if (!isActive) {
          return;
        }

        const nextNotifications = extractNotificationList(response)
          .map((item, index) => normalizeNotification(item, index + 1))
          .filter((item) => {
            if (!isNotificationVisible(item)) {
              return false;
            }

            if (isRideRequestNotification(item)) {
              return false;
            }

            if (normalizedRoleCode === 'Q1') {
              return item.recipient === 'all';
            }

            return item.recipient === 'all' || item.recipient === notificationRecipient;
          });

        setNotificationItems(nextNotifications);
      })
      .catch((error) => {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        setNotificationItems([]);
        setNotificationError(error?.message || 'Không thể tải thông báo lúc này.');
      })
      .finally(() => {
        if (isActive && shouldShowLoading) {
          setNotificationLoading(false);
        }
      });

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [canViewNotifications, notificationMenuOpen, notificationRecipient, notificationStorageKey]);

  useEffect(() => {
    if (!isAuthenticated || normalizedRoleCode !== 'Q1') {
      setPendingVehicleRequests([]);
      return undefined;
    }

    let isActive = true;

    const loadPendingRequests = async () => {
      try {
        const response = await driverVehicleRequestService.listPendingRequests();

        if (!isActive) {
          return;
        }

        const nextRequests = Array.isArray(response?.requests) ? response.requests : [];
        setPendingVehicleRequests(nextRequests);

        if (nextRequests.length > 0) {
          setAdminVehicleModalOpen(true);
        }

        if (nextRequests.length === 0) {
          setAdminVehicleModalOpen(false);
          setAdminVehicleViewMode('summary');
          setAdminVehicleDetail(null);
          setAdminVehicleRejectNote('');
        }
      } catch {
        if (!isActive) {
          return;
        }

        setPendingVehicleRequests([]);
      }
    };

    void loadPendingRequests();

    return () => {
      isActive = false;
    };
  }, [isAuthenticated, normalizedRoleCode]);

  useEffect(() => {
    if (!isAuthenticated || normalizedRoleCode !== 'Q3' || !accountId) {
      setDriverResolutionPopup(null);
      return undefined;
    }

    let isActive = true;

    const loadDriverResolutions = async () => {
      try {
        const response = await driverVehicleRequestService.listDriverResolutions(accountId, { unseenOnly: true });

        if (!isActive) {
          return;
        }

        const nextRequests = Array.isArray(response?.requests) ? response.requests : [];

        if (nextRequests.length > 0) {
          setDriverResolutionPopup(nextRequests[0]);
        }
      } catch {
        // Skip transient initialization errors.
      }
    };

    void loadDriverResolutions();

    return () => {
      isActive = false;
    };
  }, [accountId, isAuthenticated, normalizedRoleCode]);

  useEffect(() => {
    if (!isAuthenticated || !accountId || (normalizedRoleCode !== 'Q1' && normalizedRoleCode !== 'Q3')) {
      return undefined;
    }

    const disconnectRideEventStream = connectRideEventStream({
      accountId,
      roleCode: normalizedRoleCode,
      onEvent: (eventPayload) => {
        const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();

        if (normalizedRoleCode === 'Q1' && eventType === 'admin.driver-violation.changed') {
          const createdCount = Number(eventPayload?.createdCount ?? 0) || 1;

          if (String(eventPayload?.action ?? '').trim().toLowerCase() === 'created') {
            onNotify?.(`Hệ thống vừa phát hiện ${createdCount} vi phạm tài xế mới.`, 'warning', 3200);
          }

          return;
        }

        if (eventType !== 'admin.driver.vehicle-change') {
          return;
        }

        const request = eventPayload?.request ?? null;
        const action = String(eventPayload?.action ?? '').trim().toLowerCase();

        if (normalizedRoleCode === 'Q1') {
          void reloadPendingVehicleRequests();

          if (action === 'requested') {
            setAdminVehicleModalOpen(true);
            onNotify?.('Có yêu cầu thay đổi thông tin xe mới cần xử lý.', 'info', 2600);
          }

          return;
        }

        if (normalizedRoleCode === 'Q3' && action === 'resolved') {
          const eventDriverId = String(request?.driverId ?? request?.MaTK ?? '').trim();

          if (!eventDriverId || eventDriverId !== String(accountId).trim()) {
            return;
          }

          setDriverResolutionPopup(request);

          const isApproved = String(request?.status ?? '').trim().toLowerCase() === 'approved';
          onNotify?.(
            isApproved
              ? 'Yêu cầu thay đổi thông tin xe của bạn đã được duyệt.'
              : 'Yêu cầu thay đổi thông tin xe của bạn đã bị từ chối.',
            isApproved ? 'success' : 'error',
            2800,
          );
        }
      },
    });

    return () => {
      disconnectRideEventStream();
    };
  }, [accountId, isAuthenticated, normalizedRoleCode, onNotify]);

  const markNotificationAsRead = (notificationId) => {
    const normalizedNotificationId = Number(notificationId);

    if (!Number.isInteger(normalizedNotificationId) || normalizedNotificationId <= 0) {
      return;
    }

    setNotificationReadIds((currentReadIds) => {
      if (currentReadIds.includes(normalizedNotificationId)) {
        return currentReadIds;
      }

      const nextReadIds = [...currentReadIds, normalizedNotificationId];
      saveNotificationReadIds(notificationStorageKey, nextReadIds);
      return nextReadIds;
    });
  };

  const markAllNotificationsAsRead = () => {
    if (notificationItems.length === 0) {
      return;
    }

    setNotificationReadIds((currentReadIds) => {
      const nextReadIds = Array.from(
        new Set([
          ...currentReadIds,
          ...notificationItems.map((item) => item.id).filter((notificationId) => !currentReadIds.includes(notificationId)),
        ]),
      );

      if (nextReadIds.length === currentReadIds.length) {
        return currentReadIds;
      }

      saveNotificationReadIds(notificationStorageKey, nextReadIds);
      return nextReadIds;
    });
  };

  const scrollToAnchor = (anchor) => {
    if (!anchor) {
      return;
    }

    const targetNode = document.querySelector(anchor);

    if (!targetNode) {
      return;
    }

    targetNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const executeRoleItemAction = (item) => {
    if (!item) {
      return;
    }

    if (item?.action === 'booking-form') {
      onBooking?.();
      return;
    }

    if (item?.action === 'driver-signup') {
      onDriverSignup?.();
      return;
    }

    if (item?.requiresAuth && !isAuthenticated) {
      onLogin?.();
      return;
    }

    if (item?.action === 'profile') {
      onProfile?.();
      return;
    }

    if (item?.anchor) {
      scrollToAnchor(item.anchor);
    }
  };

  const handleRoleItemClick = (item) => {
    if (!item) {
      return;
    }

    setSelectedRoleItemId(item.id);
    setRoleMenuOpen(false);

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-users') {
      setActiveRolePopupItem(null);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminUserModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-drivers') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminDriverModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-payments') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminPaymentModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-promotions') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminPromotionModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-notifications') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminTripModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminNotificationModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-trips') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminComplaintModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminTripModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-complaints') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminTripModalOpen(false);
      setAdminRevenueModalOpen(false);
      setAdminDriverViolationModalOpen(false);
      setAdminComplaintModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-driver-violations') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminPromotionModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminTripModalOpen(false);
      setAdminRevenueModalOpen(false);
      setAdminComplaintModalOpen(false);
      setAdminDriverViolationModalOpen(true);
      return;
    }

      if (normalizedRoleCode === 'Q1' && item.id === 'admin-revenue') {
        setActiveRolePopupItem(null);
        setAdminUserModalOpen(false);
        setAdminDriverModalOpen(false);
        setAdminPaymentModalOpen(false);
        setAdminPromotionModalOpen(false);
        setAdminNotificationModalOpen(false);
        setAdminTripModalOpen(false);
        setAdminComplaintModalOpen(false);
        setAdminDriverViolationModalOpen(false);
        setAdminRevenueModalOpen(true);
        return;
      }

    if (normalizedRoleCode === 'Q2' && item.id === 'customer-wallet') {
      setActiveRolePopupItem(null);
      setCustomerWalletModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q3' && item.id === 'driver-wallet') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setDriverProfileModalOpen(false);
      setDriverIncomeModalOpen(false);
      setDriverSupportModalOpen(false);
      setActiveTripHistoryItemId('');
      setDriverWalletModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q3' && item.id === 'driver-income-report') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setDriverProfileModalOpen(false);
      setDriverWalletModalOpen(false);
      setDriverDispatchModalOpen(false);
      setDriverSupportModalOpen(false);
      setActiveTripHistoryItemId('');
      setDriverIncomeModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q3' && item.id === 'driver-support-safety') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setDriverProfileModalOpen(false);
      setDriverWalletModalOpen(false);
      setDriverIncomeModalOpen(false);
      setDriverDispatchModalOpen(false);
      setActiveTripHistoryItemId('');
      setDriverSupportModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q3' && item.id === 'driver-dispatch-settings') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setDriverProfileModalOpen(false);
      setDriverWalletModalOpen(false);
      setDriverIncomeModalOpen(false);
      setDriverSupportModalOpen(false);
      setActiveTripHistoryItemId('');
      setDriverDispatchModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q3' && item.id === 'driver-profile') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setDriverWalletModalOpen(false);
      setDriverIncomeModalOpen(false);
      setDriverDispatchModalOpen(false);
      setDriverSupportModalOpen(false);
      setActiveTripHistoryItemId('');
      setDriverProfileModalOpen(true);
      return;
    }

    if (item.action === 'booking-form') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      onBooking?.();
      return;
    }

    if (item.action === 'driver-signup') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      onDriverSignup?.();
      return;
    }

    if (item.id === 'customer-history' || item.id === 'driver-trips' || item.id === 'driver-reviews') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPromotionModalOpen(false);
      setActiveTripHistoryItemId(item.id);
      return;
    }

    setAdminUserModalOpen(false);
    setAdminDriverModalOpen(false);
    setAdminPaymentModalOpen(false);
    setAdminNotificationModalOpen(false);
    setAdminPromotionModalOpen(false);
    setAdminComplaintModalOpen(false);
    setAdminDriverViolationModalOpen(false);
    setDriverWalletModalOpen(false);
    setDriverProfileModalOpen(false);
    setDriverIncomeModalOpen(false);
    setDriverDispatchModalOpen(false);
    setActiveTripHistoryItemId('');
    setActiveRolePopupItem(buildRoleFeaturePopup(item, normalizedRoleCode, activeRoleLabel));
  };

  const closeRoleFeaturePopup = () => {
    setActiveRolePopupItem(null);
  };

  const closeTripHistoryPopup = () => {
    setActiveTripHistoryItemId('');
  };

  const runRoleFeaturePrimaryAction = () => {
    const currentPopupItem = activeRolePopupItem;

    if (!currentPopupItem) {
      return;
    }

    closeRoleFeaturePopup();
    executeRoleItemAction(currentPopupItem);
  };

  const runAccountAction = (callback) => {
    setAccountMenuOpen(false);
    setNotificationMenuOpen(false);
    callback?.();
  };

  const toggleNotificationMenu = () => {
    if (!canViewNotifications) {
      return;
    }

    setNotificationMenuOpen((current) => !current);
    setRoleMenuOpen(false);
    setAccountMenuOpen(false);
  };

  const handleNotificationButtonClick = () => {
    setRoleMenuOpen(false);
    setAccountMenuOpen(false);

    if (!isAuthenticated) {
      setNotificationMenuOpen(false);
      onLogin?.();
      return;
    }

    toggleNotificationMenu();
  };

  const activeAdminVehicleRequest = pendingVehicleRequests[0] ?? null;

  const fetchAdminRequestDetail = async () => {
    if (!activeAdminVehicleRequest?.id) {
      return;
    }

    setAdminVehicleLoading(true);

    try {
      const response = await driverVehicleRequestService.getRequestDetail(activeAdminVehicleRequest.id);
      setAdminVehicleDetail(response ?? null);
    } catch (error) {
      onNotify?.(error?.message || 'Không thể tải chi tiết hồ sơ tài xế.', 'error', 2800);
    } finally {
      setAdminVehicleLoading(false);
    }
  };

  const reloadPendingVehicleRequests = async () => {
    try {
      const response = await driverVehicleRequestService.listPendingRequests();
      const nextRequests = Array.isArray(response?.requests) ? response.requests : [];
      setPendingVehicleRequests(nextRequests);

      if (nextRequests.length === 0) {
        setAdminVehicleModalOpen(false);
        setAdminVehicleViewMode('summary');
        setAdminVehicleDetail(null);
        setAdminVehicleRejectNote('');
      }
    } catch {
      setPendingVehicleRequests([]);
      setAdminVehicleModalOpen(false);
    }
  };

  const handleApproveVehicleRequest = async () => {
    if (!activeAdminVehicleRequest?.id || adminVehicleActionLoading) {
      return;
    }

    setAdminVehicleActionLoading(true);

    try {
      const response = await driverVehicleRequestService.approveRequest(activeAdminVehicleRequest.id, {
        approvedByAccountId: accountId,
      });
      onNotify?.(response?.message || 'Đã đồng ý yêu cầu thay đổi thông tin xe.', 'success', 2200);
      await reloadPendingVehicleRequests();
    } catch (error) {
      onNotify?.(error?.message || 'Không thể duyệt yêu cầu lúc này.', 'error', 2800);
    } finally {
      setAdminVehicleActionLoading(false);
    }
  };

  const handleRejectVehicleRequest = async () => {
    if (!activeAdminVehicleRequest?.id || adminVehicleActionLoading) {
      return;
    }

    setAdminVehicleActionLoading(true);

    try {
      const response = await driverVehicleRequestService.rejectRequest(activeAdminVehicleRequest.id, {
        approvedByAccountId: accountId,
        note: adminVehicleRejectNote,
      });
      onNotify?.(response?.message || 'Đã từ chối yêu cầu thay đổi thông tin xe.', 'success', 2200);
      await reloadPendingVehicleRequests();
    } catch (error) {
      onNotify?.(error?.message || 'Không thể từ chối yêu cầu lúc này.', 'error', 2800);
    } finally {
      setAdminVehicleActionLoading(false);
    }
  };

  const handleAcknowledgeDriverResolution = async () => {
    if (!driverResolutionPopup?.id || !accountId) {
      setDriverResolutionPopup(null);
      return;
    }

    try {
      await driverVehicleRequestService.acknowledgeResolution(accountId, driverResolutionPopup.id);
    } catch {
      // Skip ack errors to avoid blocking UI close.
    } finally {
      setDriverResolutionPopup(null);
    }
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#home" aria-label="SmartRide">
          <img className="brand-logo" src={logoIcon} alt="SmartRide" />
          <span className="brand-text">
            <strong>SMART</strong>
            <span>RIDE</span>
          </span>
        </a>

        <nav className="header-actions" aria-label="Điều hướng nhanh">
          <div className="role-menu" ref={roleMenuRef}>
            <button
              className={`icon-button role-menu__trigger${roleMenuOpen ? ' is-active' : ''}`}
              type="button"
              aria-label="Menu theo vai trò"
              aria-haspopup="menu"
              aria-expanded={roleMenuOpen}
              onClick={() => {
                setRoleMenuOpen((current) => !current);
                setAccountMenuOpen(false);
              }}
            >
              <img className="icon-button__img" src={menuIcon} alt="" aria-hidden="true" />
            </button>

            {roleMenuOpen ? (
              <div className="role-menu__panel" role="menu" aria-label={`Menu vai trò ${activeRoleLabel}`}>
                <div className="role-menu__header">
                  <strong>MENU</strong>
                  <span>{activeRoleLabel}</span>
                </div>

                <div className="role-menu__grid" style={{ '--role-menu-columns': activeRoleMenu.columns }}>
                  {activeRoleMenu.rows.flat().map((item, index) => (
                    <div key={item?.id ?? `empty-cell-${index}`} className={`role-menu__cell${item ? '' : ' is-empty'}`}>
                      {item ? (
                        <button
                          className={`role-menu__item${selectedRoleItemId === item.id ? ' is-selected' : ''}`}
                          type="button"
                          role="menuitem"
                          onClick={() => handleRoleItemClick(item)}
                        >
                          {item.label}
                        </button>
                      ) : (
                        <span className="role-menu__placeholder" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {showNotificationButton ? (
            <div className="notification-menu" ref={notificationMenuRef}>
              <button
                className={`icon-button notification-menu__trigger${notificationMenuOpen ? ' is-active' : ''}`}
                type="button"
                aria-label={isAuthenticated ? notificationPanelTitle : 'Đăng nhập để xem thông báo'}
                aria-haspopup="menu"
                aria-expanded={notificationMenuOpen}
                onClick={handleNotificationButtonClick}
              >
                <img className="icon-button__img" src={notificationIcon} alt="" aria-hidden="true" />
                {canViewNotifications && notificationUnreadCount > 0 ? (
                  <span className="notification-menu__indicator" aria-hidden="true" />
                ) : null}

                {canViewNotifications && notificationUnreadCount > 0 ? (
                  <span className="notification-menu__badge">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>
                ) : null}
              </button>

              {notificationMenuOpen ? (
                <div className="notification-menu__panel" role="menu" aria-label={notificationPanelTitle}>
                  <div className="notification-menu__header">
                    <strong>THÔNG BÁO</strong>
                    <div className="notification-menu__header-meta">
                      <span>{notificationPanelTitle}</span>
                      {canViewNotifications && notificationUnreadCount > 0 ? (
                        <button className="notification-menu__mark-all" type="button" onClick={markAllNotificationsAsRead}>
                          Đánh dấu tất cả đã đọc
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="notification-menu__body">
                    {notificationLoading ? <p className="notification-menu__state">Đang tải thông báo...</p> : null}

                    {!notificationLoading && notificationError ? (
                      <p className="notification-menu__state notification-menu__state--error">{notificationError}</p>
                    ) : null}

                    {!notificationLoading && !notificationError && notificationItems.length === 0 ? (
                      <p className="notification-menu__state">Bạn chưa có thông báo nào.</p>
                    ) : null}

                    {!notificationLoading && !notificationError && notificationItems.length > 0 ? (
                      <div className="notification-menu__list">
                        {notificationItems.map((item) => (
                          <article
                            className={`notification-menu__item${notificationReadIdSet.has(item.id) ? ' is-read' : ' is-unread'}`}
                            key={item.id}
                          >
                            <div className="notification-menu__item-head">
                              <div className="notification-menu__item-title">
                                <strong>{item.title || 'Thông báo'}</strong>
                                <span className={notificationReadIdSet.has(item.id) ? 'is-read' : 'is-unread'}>
                                  {notificationReadIdSet.has(item.id) ? 'Đã đọc' : 'Chưa đọc'}
                                </span>
                              </div>

                              {!notificationReadIdSet.has(item.id) ? (
                                <button
                                  className="notification-menu__mark-read"
                                  type="button"
                                  onClick={() => markNotificationAsRead(item.id)}
                                >
                                  Đánh dấu đã đọc
                                </button>
                              ) : null}
                            </div>

                            <p className="notification-menu__item-content">{item.content}</p>

                            {item.sendAt ? <time className="notification-menu__item-time">{formatNotificationDate(item.sendAt)}</time> : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="account-menu" ref={accountMenuRef}>
            <button
              className={`icon-button account-menu__trigger${accountMenuOpen ? ' is-active' : ''}`}
              type="button"
              aria-label="Tài khoản"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => {
                setAccountMenuOpen((current) => !current);
                setRoleMenuOpen(false);
              }}
            >
              <img className="icon-button__img" src={userIcon} alt="" aria-hidden="true" />
            </button>

            {accountMenuOpen ? (
              <div className="account-menu__panel" role="menu" aria-label="Menu tài khoản">
                <p className="account-menu__state">
                  {isAuthenticated ? `Đang đăng nhập: ${accountDisplayName || 'SmartRider'}` : 'Bạn chưa đăng nhập'}
                </p>

                {isAuthenticated ? (
                  <>
                    <button
                      className="account-menu__item"
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        runAccountAction(() => {
                          if (normalizedRoleCode === 'Q3') {
                            setActiveRolePopupItem(null);
                            setActiveTripHistoryItemId('');
                            setDriverIncomeModalOpen(false);
                            setDriverWalletModalOpen(false);
                            setDriverProfileModalOpen(true);
                            return;
                          }

                          onProfile?.();
                        })
                      }
                    >
                      Thông tin cá nhân
                    </button>
                    <button className="account-menu__item" type="button" role="menuitem" onClick={() => runAccountAction(onChangePassword)}>
                      Đổi Mật khẩu
                    </button>
                    <button
                      className="account-menu__item account-menu__item--danger"
                      type="button"
                      role="menuitem"
                      onClick={() => runAccountAction(onLogout)}
                    >
                      Đăng xuất
                    </button>
                  </>
                ) : (
                  <button className="account-menu__item" type="button" role="menuitem" onClick={() => runAccountAction(onLogin)}>
                    Đăng nhập
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <button className="icon-button" type="button" aria-label="Trợ giúp" onClick={() => onHelp?.()}>
            <img className="icon-button__img" src={helpIcon} alt="" aria-hidden="true" />
          </button>
        </nav>
      </div>

      {activeRolePopupItem
        ? createPortal(
            <div className="role-feature-modal" role="dialog" aria-modal="true" aria-label={`Giao diện ${activeRolePopupItem.label}`}>
              <div className="role-feature-modal__backdrop" onClick={closeRoleFeaturePopup} aria-hidden="true" />

              <div className="role-feature-modal__window">
                <button className="role-feature-modal__close" type="button" onClick={closeRoleFeaturePopup} aria-label="Đóng giao diện chức năng">
                  <img className="role-feature-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                </button>

                <p className="role-feature-modal__role">{activeRolePopupItem.roleLabel}</p>
                <h3 className="role-feature-modal__title">{activeRolePopupItem.label}</h3>
                <p className="role-feature-modal__summary">{activeRolePopupItem.summary}</p>

                <section className="role-feature-modal__section" aria-label="Tổng quan">
                  <h4>{activeRolePopupItem.contextTitle}</h4>

                  <div className="role-feature-modal__stats">
                    {activeRolePopupItem.stats.map((stat) => (
                      <article className="role-feature-modal__stat-card" key={stat.label}>
                        <strong>{stat.value}</strong>
                        <span>{stat.label}</span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="role-feature-modal__section" aria-label="Quy trình khuyến nghị">
                  <h4>Quy trình khuyến nghị</h4>

                  <ul className="role-feature-modal__checklist">
                    {activeRolePopupItem.checklist.map((checkItem) => (
                      <li key={checkItem}>{checkItem}</li>
                    ))}
                  </ul>
                </section>

                {activeRolePopupItem.requiresAuth && !isAuthenticated ? (
                  <p className="role-feature-modal__auth-note">Bạn cần đăng nhập để mở chức năng này.</p>
                ) : null}

                <div className="role-feature-modal__actions">
                  <button className="role-feature-modal__action role-feature-modal__action--ghost" type="button" onClick={closeRoleFeaturePopup}>
                    Đóng
                  </button>

                  <button className="role-feature-modal__action role-feature-modal__action--primary" type="button" onClick={runRoleFeaturePrimaryAction}>
                    {activeRolePopupItem.requiresAuth && !isAuthenticated ? 'Đăng nhập để tiếp tục' : 'Mở chức năng'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <TripHistoryModal
        open={activeTripHistoryItemId === 'customer-history' || activeTripHistoryItemId === 'driver-trips'}
        mode={activeTripHistoryItemId === 'driver-trips' ? 'driver' : 'customer'}
        roleLabel={activeTripHistoryItemId === 'driver-trips' ? 'Tài xế' : 'Khách hàng'}
        accountId={accountId}
        accountDisplayName={accountDisplayName}
        accountIdentifier={accountIdentifier}
        accountPhone={accountPhone}
        onNotify={onNotify}
        onClose={closeTripHistoryPopup}
      />

      <DriverReviewModal
        open={activeTripHistoryItemId === 'driver-reviews'}
        accountId={accountId}
        accountDisplayName={accountDisplayName}
        accountIdentifier={accountIdentifier}
        accountPhone={accountPhone}
        onClose={closeTripHistoryPopup}
      />

      <AdminUserManagementModal open={adminUserModalOpen} onClose={() => setAdminUserModalOpen(false)} />

      <AdminDriverManagementModal open={adminDriverModalOpen} onClose={() => setAdminDriverModalOpen(false)} />

      <AdminPaymentManagementModal
        open={adminPaymentModalOpen}
        onClose={() => setAdminPaymentModalOpen(false)}
        roleCode={normalizedRoleCode}
        accountId={accountId}
        accountIdentifier={accountIdentifier}
        onNotify={onNotify}
      />

      <AdminNotificationManagementModal
        open={adminNotificationModalOpen}
        onClose={() => setAdminNotificationModalOpen(false)}
      />

      <AdminPromotionManagementModal
        open={adminPromotionModalOpen}
        onClose={() => setAdminPromotionModalOpen(false)}
      />

      <AdminTripManagementModal
        open={adminTripModalOpen}
        onClose={() => setAdminTripModalOpen(false)}
        accountId={accountId}
      />

      <AdminComplaintManagementModal
        open={adminComplaintModalOpen}
        onClose={() => setAdminComplaintModalOpen(false)}
        accountId={accountId}
        onNotify={onNotify}
      />

      <AdminDriverViolationManagementModal
        open={adminDriverViolationModalOpen}
        onClose={() => setAdminDriverViolationModalOpen(false)}
        accountId={accountId}
        onNotify={onNotify}
      />

        <AdminRevenueReportModal
          open={adminRevenueModalOpen}
          onClose={() => setAdminRevenueModalOpen(false)}
          accountId={accountId}
        />

      <DriverWalletModal
        open={driverWalletModalOpen}
        onClose={() => setDriverWalletModalOpen(false)}
        driverId={accountId}
        driverName={accountDisplayName}
        onNotify={onNotify}
        onOpenIncomeReport={() => {
          setDriverWalletModalOpen(false);
          setDriverIncomeModalOpen(true);
        }}
      />

      <CustomerWalletModal
        open={customerWalletModalOpen}
        onClose={() => setCustomerWalletModalOpen(false)}
        customerId={accountId}
        customerName={accountDisplayName}
        onNotify={onNotify}
        suspendRealtimeSync={customerHasActiveTrip}
      />

      <DriverPersonalInfoModal
        open={driverProfileModalOpen}
        onClose={() => setDriverProfileModalOpen(false)}
        driverId={accountId}
        onNotify={onNotify}
        onRequestSubmitted={() => {
          if (normalizedRoleCode === 'Q1') {
            setAdminVehicleModalOpen(true);
          }
        }}
      />

      <DriverIncomeReportModal
        open={driverIncomeModalOpen}
        onClose={() => setDriverIncomeModalOpen(false)}
        accountId={accountId}
        accountIdentifier={accountIdentifier}
        onNotify={onNotify}
      />

      <DriverRideReceiveSettingsModal
        open={driverDispatchModalOpen}
        onClose={() => setDriverDispatchModalOpen(false)}
        checkedIn={driverCheckedIn}
        autoReceiveEnabled={driverAutoReceiveEnabled}
        onCheckedInChange={(nextValue) => {
          onDriverCheckedInChange?.(nextValue);
        }}
      />

      <DriverSupportSafetyModal
        open={driverSupportModalOpen}
        onClose={() => setDriverSupportModalOpen(false)}
        driverId={accountId}
        onNotify={onNotify}
        onForceTripCancelled={onForceTripCancelled}
      />

      <AdminVehicleChangeRequestModal
        open={adminVehicleModalOpen && normalizedRoleCode === 'Q1'}
        requestItem={activeAdminVehicleRequest}
        requestDetail={adminVehicleDetail}
        loading={adminVehicleLoading}
        actionLoading={adminVehicleActionLoading}
        viewMode={adminVehicleViewMode}
        rejectNote={adminVehicleRejectNote}
        onRejectNoteChange={setAdminVehicleRejectNote}
        onClose={() => setAdminVehicleModalOpen(false)}
        onViewProfile={() => {
          setAdminVehicleViewMode('profile');
          void fetchAdminRequestDetail();
        }}
        onBackToSummary={() => setAdminVehicleViewMode('summary')}
        onApprove={() => {
          void handleApproveVehicleRequest();
        }}
        onReject={() => {
          void handleRejectVehicleRequest();
        }}
      />

      {driverResolutionPopup && normalizedRoleCode === 'Q3'
        ? createPortal(
            <div className="role-feature-modal" role="dialog" aria-modal="true" aria-label="Kết quả yêu cầu thay đổi thông tin xe">
              <div className="role-feature-modal__backdrop" onClick={handleAcknowledgeDriverResolution} aria-hidden="true" />

              <div className="role-feature-modal__window role-feature-modal__window--driver-resolution">
                <h3 className="role-feature-modal__title">Thông báo từ Quản trị viên</h3>
                <p className="role-feature-modal__summary">
                  {driverResolutionPopup.status === 'approved'
                    ? 'Yêu cầu thay đổi thông tin xe của bạn đã được chấp nhận.'
                    : 'Yêu cầu thay đổi thông tin xe của bạn đã bị từ chối.'}
                </p>

                {driverResolutionPopup.status !== 'approved' && driverResolutionPopup.rejectReason ? (
                  <p className="role-feature-modal__auth-note">Lý do: {driverResolutionPopup.rejectReason}</p>
                ) : null}

                <div className="role-feature-modal__actions">
                  <button
                    className="role-feature-modal__action role-feature-modal__action--primary"
                    type="button"
                    onClick={handleAcknowledgeDriverResolution}
                  >
                    Đã hiểu
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}
