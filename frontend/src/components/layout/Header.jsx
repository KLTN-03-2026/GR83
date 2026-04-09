import { closeIcon, globeIcon, helpIcon, logoIcon, menuIcon, userIcon } from '../../assets/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminUserManagementModal from '../admin/AdminUserManagementModal';
import AdminDriverManagementModal from '../admin/AdminDriverManagementModal';

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

export default function Header({
  isAuthenticated = false,
  accountDisplayName = '',
  accountRoleCode = '',
  onProfile,
  onBooking,
  onChangePassword,
  onLogout,
  onLogin,
}) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminUserModalOpen, setAdminUserModalOpen] = useState(false);
  const [adminDriverModalOpen, setAdminDriverModalOpen] = useState(false);
  const [selectedRoleItemId, setSelectedRoleItemId] = useState('');
  const [activeRolePopupItem, setActiveRolePopupItem] = useState(null);
  const roleMenuRef = useRef(null);
  const accountMenuRef = useRef(null);

  const normalizedRoleCode = normalizeRoleCode(isAuthenticated ? accountRoleCode : 'Q2');
  const activeRoleMenu = useMemo(() => ROLE_MENUS[normalizedRoleCode] ?? ROLE_MENUS.Q2, [normalizedRoleCode]);
  const activeRoleLabel = ROLE_LABELS[normalizedRoleCode] ?? ROLE_LABELS.Q2;

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
  }, [activeRoleMenu, activeRolePopupItem, adminDriverModalOpen, adminUserModalOpen, normalizedRoleCode, selectedRoleItemId]);

  useEffect(() => {
    if (!accountMenuOpen && !roleMenuOpen && !activeRolePopupItem && !adminDriverModalOpen && !adminUserModalOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (roleMenuOpen && !roleMenuRef.current?.contains(event.target)) {
        setRoleMenuOpen(false);
      }

      if (accountMenuOpen && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      setRoleMenuOpen(false);
      setAccountMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen, roleMenuOpen, activeRolePopupItem, adminDriverModalOpen, adminUserModalOpen]);

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
      setAdminUserModalOpen(true);
      return;
    }

    if (normalizedRoleCode === 'Q1' && item.id === 'admin-drivers') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(true);
      return;
    }

    if (item.action === 'booking-form') {
      setActiveRolePopupItem(null);
      setAdminUserModalOpen(false);
      setAdminDriverModalOpen(false);
      onBooking?.();
      return;
    }

    setAdminUserModalOpen(false);
    setAdminDriverModalOpen(false);
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
    callback?.();
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

          <button className="icon-button" type="button" aria-label="Ngôn ngữ">
            <img className="icon-button__img" src={globeIcon} alt="" aria-hidden="true" />
          </button>

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
    </header>
  );
}
