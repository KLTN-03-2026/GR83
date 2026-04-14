import { closeIcon, helpIcon, logoIcon, menuIcon, notificationIcon, userIcon } from '../../assets/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminPaymentManagementModal from '../admin/AdminPaymentManagementModal';
import AdminNotificationManagementModal from '../admin/AdminNotificationManagementModal';
import AdminUserManagementModal from '../admin/AdminUserManagementModal';
import AdminDriverManagementModal from '../admin/AdminDriverManagementModal';
import { notificationService } from '../../services/notificationService';

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
        { id: 'admin-revenue', label: 'Xuất báo cáo doanh thu' },
      ],
      [
        { id: 'admin-trips', label: 'Quản lý chuyến đi' },
        { id: 'admin-driver-violations', label: 'Xử lý vi phạm tài xế' },
        null,
      ],
    ],
  },
  Q2: {
    columns: 2,
    rows: [
      [{ id: 'customer-booking', label: 'Đặt xe', action: 'booking-form' }, null],
      [{ id: 'customer-history', label: 'Lịch sử chuyến', requiresAuth: true }, null],
      [{ id: 'customer-profile', label: 'Quản lý tài khoản cá nhân', action: 'profile', requiresAuth: true }, null],
      [{ id: 'customer-driver-signup', label: 'Đăng ký Tài xế', action: 'driver-signup' }, null],
    ],
  },
  Q3: {
    columns: 2,
    rows: [
      [
        { id: 'driver-income', label: 'Quản lý thu nhập' },
        { id: 'driver-support', label: 'Hỗ trợ và an toàn' },
      ],
      [
        { id: 'driver-reviews', label: 'Xem đánh giá' },
        { id: 'driver-settings', label: 'Cài đặt nhận chuyến' },
      ],
      [{ id: 'driver-trips', label: 'Quản lý chuyến đi' }, null],
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
  accountDisplayName = '',
  accountIdentifier = '',
  accountRoleCode = '',
  onProfile,
  onBooking,
  onDriverSignup,
  onChangePassword,
  onLogout,
  onLogin,
}) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminUserModalOpen, setAdminUserModalOpen] = useState(false);
  const [adminDriverModalOpen, setAdminDriverModalOpen] = useState(false);
  const [adminPaymentModalOpen, setAdminPaymentModalOpen] = useState(false);
  const [adminNotificationModalOpen, setAdminNotificationModalOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationReadIds, setNotificationReadIds] = useState([]);
  const [selectedRoleItemId, setSelectedRoleItemId] = useState('');
  const [activeRolePopupItem, setActiveRolePopupItem] = useState(null);
  const roleMenuRef = useRef(null);
  const accountMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);

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
    canViewNotifications,
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
  }, [accountMenuOpen, roleMenuOpen, notificationMenuOpen, activeRolePopupItem, adminDriverModalOpen, adminNotificationModalOpen, adminPaymentModalOpen, adminUserModalOpen]);

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
      .listNotifications({ recipient: notificationRecipient }, { signal: abortController.signal })
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
      setAdminUserModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-drivers') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminDriverModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-payments') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminNotificationModalOpen(false);
      setAdminPaymentModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-notifications') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(true);
      return;
    }

    if (item.action === 'booking-form') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      onBooking?.();
      return;
    }

    if (item.action === 'driver-signup') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setAdminPaymentModalOpen(false);
      setAdminNotificationModalOpen(false);
      onDriverSignup?.();
      return;
    }

    setAdminUserModalOpen(false);
    setAdminDriverModalOpen(false);
    setAdminPaymentModalOpen(false);
    setAdminNotificationModalOpen(false);
    setActiveRolePopupItem(buildRoleFeaturePopup(item, normalizedRoleCode, activeRoleLabel));
  };

  const closeRoleFeaturePopup = () => {
    setActiveRolePopupItem(null);
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
                    <button className="account-menu__item" type="button" role="menuitem" onClick={() => runAccountAction(onProfile)}>
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

          <button className="icon-button" type="button" aria-label="Trợ giúp">
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

      <AdminUserManagementModal open={adminUserModalOpen} onClose={() => setAdminUserModalOpen(false)} />

      <AdminDriverManagementModal open={adminDriverModalOpen} onClose={() => setAdminDriverModalOpen(false)} />

      <AdminPaymentManagementModal open={adminPaymentModalOpen} onClose={() => setAdminPaymentModalOpen(false)} />

      <AdminNotificationManagementModal
        open={adminNotificationModalOpen}
        onClose={() => setAdminNotificationModalOpen(false)}
      />
    </header>
  );
}
