import { closeIcon } from '../../assets/icons';
import ConfirmDialog from '../ui/ConfirmDialog';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import { adminUserService } from '../../services/adminUserService';

registerLocale('vi-VN', vi);

const USER_STATUS_META = {
  active: { label: 'Hoạt động', tone: 'active' },
  locked: { label: 'Bị khóa', tone: 'locked' },
  pending: { label: 'Chờ duyệt', tone: 'pending' },
};

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Hoạt động' },
  { value: 'locked', label: 'Bị khóa' },
  { value: 'pending', label: 'Chờ duyệt' },
];

const ROLE_OPTIONS = [
  { value: 'Q1', label: 'Quản trị viên' },
  { value: 'Q2', label: 'Khách hàng' },
  { value: 'Q3', label: 'Tài xế' },
];
const frontendApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const backendPublicBaseUrl = frontendApiBaseUrl.replace(/\/?api\/?$/, '');

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function sanitizePhone(value, maxLength = 15) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, maxLength);
}

function sanitizeUsername(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

function resolveAvatarUrl(avatarValue) {
  const normalizedValue = String(avatarValue ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(normalizedValue) || normalizedValue.startsWith('data:')) {
    return normalizedValue;
  }

  const normalizedPath = normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`;
  return `${backendPublicBaseUrl}${normalizedPath}`;
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

function formatDateForUserValue(dateValue) {
  if (!(dateValue instanceof Date) || !isValid(dateValue)) {
    return '';
  }

  return format(dateValue, 'yyyy-MM-dd');
}

function normalizeRoleCode(value) {
  const normalizedRoleCode = String(value ?? '')
    .trim()
    .toUpperCase();

  if (normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3') {
    return normalizedRoleCode;
  }

  return 'Q2';
}

function normalizeUserStatus(status) {
  const normalizedStatus = normalizeToken(status);

  if (
    normalizedStatus === 'locked' ||
    normalizedStatus === 'khoa'
  ) {
    return 'locked';
  }

  if (normalizedStatus === 'pending' || normalizedStatus === 'choduyet') {
    return 'pending';
  }

  if (normalizedStatus === 'active' || normalizedStatus === 'hoatdong' || !normalizedStatus) {
    return 'active';
  }

  return 'active';
}

function createEmptyUserForm() {
  return {
    id: '',
    username: '',
    fullName: '',
    email: '',
    phone: '',
    address: '',
    dateOfBirth: '',
    gender: '',
    avatar: '',
    roleCode: 'Q2',
    status: 'active',
  };
}

function buildUserFormFromUser(user = null) {
  if (!user) {
    return createEmptyUserForm();
  }

  return {
    id: String(user.id ?? '').trim(),
    username: String(user.username ?? '').trim(),
    fullName: String(user.fullName ?? '').trim(),
    email: String(user.email ?? '').trim(),
    phone: String(user.phone ?? '').trim(),
    address: String(user.address ?? '').trim(),
    dateOfBirth: String(user.dateOfBirth ?? '').trim(),
    gender: String(user.gender ?? '').trim(),
    avatar: String(user.avatar ?? '').trim(),
    roleCode: normalizeRoleCode(user.roleCode ?? 'Q2'),
    status: normalizeUserStatus(user.status ?? 'active'),
  };
}

function buildUserFormSnapshot(userForm = null) {
  if (!userForm) {
    return createEmptyUserForm();
  }

  return {
    id: String(userForm.id ?? '').trim(),
    username: sanitizeUsername(userForm.username),
    fullName: String(userForm.fullName ?? '').trim(),
    email: String(userForm.email ?? '').trim(),
    phone: sanitizePhone(userForm.phone),
    address: String(userForm.address ?? '').trim(),
    dateOfBirth: String(userForm.dateOfBirth ?? '').trim(),
    gender: String(userForm.gender ?? '').trim(),
    avatar: String(userForm.avatar ?? '').trim(),
    roleCode: normalizeRoleCode(userForm.roleCode ?? 'Q2'),
    status: normalizeUserStatus(userForm.status ?? 'active'),
  };
}

function validateUserForm(userForm = {}, { requirePhone = true, requireUsername = false } = {}) {
  const fullName = String(userForm.fullName ?? '').trim();
  const email = String(userForm.email ?? '').trim();
  const phone = String(userForm.phone ?? '').trim();
  const username = sanitizeUsername(userForm.username);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phonePattern = /^\d{8,15}$/;

  if (!fullName || !email || (requirePhone && !phone) || (requireUsername && !username)) {
    return requirePhone
      ? requireUsername
        ? 'Vui lòng nhập đầy đủ họ tên, tên đăng nhập, email và số điện thoại.'
        : 'Vui lòng nhập đầy đủ họ tên, email và số điện thoại.'
      : requireUsername
        ? 'Vui lòng nhập đầy đủ họ tên, tên đăng nhập và email.'
        : 'Vui lòng nhập đầy đủ họ tên và email.';
  }

  if (!emailPattern.test(email)) {
    return 'Email chưa đúng định dạng hợp lệ.';
  }

  if (phone && !phonePattern.test(phone)) {
    return 'Số điện thoại phải chứa từ 8 đến 15 chữ số.';
  }

  return '';
}

function normalizeApiUser(account = {}, index = 0) {
  const accountId = String(account.id ?? account.accountId ?? account.MaTK ?? '').trim() || `account-${index + 1}`;
  const fullName = String(account.fullName ?? account.name ?? account.Ten ?? account.username ?? '').trim();
  const username = String(account.username ?? account.TaiKhoan ?? '').trim();
  const resolvedFullName = fullName || username || `Người dùng ${index + 1}`;

  return {
    id: accountId,
    username,
    fullName: resolvedFullName,
    email: String(account.email ?? account.Email ?? '').trim(),
    phone: sanitizePhone(account.phone ?? account.SDT ?? ''),
    address: String(account.address ?? account.DiaChi ?? '').trim(),
    dateOfBirth: String(account.dateOfBirth ?? account.NgaySinh ?? '').trim(),
    gender: String(account.gender ?? account.GioiTinh ?? '').trim(),
    avatar: String(account.avatar ?? account.Avatar ?? '').trim(),
    roleCode: normalizeRoleCode(account.roleCode ?? account.MaQuyen),
    roleLabel: String(account.roleLabel ?? '').trim(),
    status: normalizeUserStatus(account.status ?? account.accountStatus ?? account.TrangThai),
    statusLabel: String(account.statusLabel ?? '').trim(),
    accountStatus: String(account.accountStatus ?? account.TrangThai ?? '').trim(),
    driverStatus: String(account.driverStatus ?? account.DriverTrangThai ?? '').trim(),
    driverBankId: String(account.driverBankId ?? account.DriverBankId ?? '').trim(),
    isAdmin: Boolean(account.isAdmin ?? String(account.roleCode ?? account.MaQuyen ?? '').trim().toUpperCase() === 'Q1'),
    canDelete: account.canDelete ?? String(account.roleCode ?? account.MaQuyen ?? '').trim().toUpperCase() !== 'Q1',
    canLock: account.canLock ?? String(account.roleCode ?? account.MaQuyen ?? '').trim().toUpperCase() !== 'Q1',
  };
}

function getUserInitials(fullName = '') {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return 'U';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export default function AdminUserManagementModal({ open = false, onClose }) {
  const [users, setUsers] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [searchContact, setSearchContact] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editorMode, setEditorMode] = useState('none');
  const [editingUserId, setEditingUserId] = useState('');
  const [userForm, setUserForm] = useState(createEmptyUserForm);
  const [userInitialSnapshot, setUserInitialSnapshot] = useState(createEmptyUserForm);
  const [formError, setFormError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [actionLoadingUserId, setActionLoadingUserId] = useState('');
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [userLockConfirm, setUserLockConfirm] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [birthDatePickerOpen, setBirthDatePickerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const avatarInputRef = useRef(null);

  const editingUser = useMemo(
    () => users.find((user) => String(user.id) === String(editingUserId)) ?? null,
    [users, editingUserId],
  );

  const filterCounts = useMemo(() => {
    const nextCounts = {
      all: users.length,
      active: 0,
      locked: 0,
      pending: 0,
    };

    users.forEach((user) => {
      if (user.status === 'active') {
        nextCounts.active += 1;
      }

      if (user.status === 'locked') {
        nextCounts.locked += 1;
      }

      if (user.status === 'pending') {
        nextCounts.pending += 1;
      }
    });

    return nextCounts;
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalizedName = normalizeToken(searchName);
    const normalizedContact = normalizeToken(searchContact);

    return users.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) {
        return false;
      }

      const matchesName = !normalizedName || normalizeToken(user.fullName).includes(normalizedName);
      const matchesContact =
        !normalizedContact ||
        normalizeToken(`${user.email ?? ''} ${user.phone ?? ''}`).includes(normalizedContact);

      return matchesName && matchesContact;
    });
  }, [searchContact, searchName, statusFilter, users]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const controller = new AbortController();
    let isActive = true;

    setIsLoading(true);
    setLoadError('');

    adminUserService
      .listUsers({ signal: controller.signal })
      .then((response) => {
        if (!isActive) {
          return;
        }

        const accountList = Array.isArray(response?.accounts)
          ? response.accounts
          : Array.isArray(response?.users)
            ? response.users
            : [];

        setUsers(accountList.map((account, index) => normalizeApiUser(account, index)));
      })
      .catch((error) => {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        setUsers([]);
        setLoadError(error?.message ?? 'Không thể tải danh sách tài khoản từ API.');
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [open, reloadToken]);

  useEffect(() => {
    if (open) {
      return;
    }

    setUsers([]);
    setSearchName('');
    setSearchContact('');
    setStatusFilter('all');
    setEditorMode('none');
    setEditingUserId('');
    setUserForm(createEmptyUserForm());
    setUserInitialSnapshot(createEmptyUserForm());
    setFormError('');
    setFeedbackMessage('');
    setEditorLoading(false);
    setActionLoadingUserId('');
    setDeleteTargetUser(null);
    setUserLockConfirm(null);
    setAvatarFile(null);
    setAvatarPreviewUrl('');
    setBirthDatePickerOpen(false);
    setIsLoading(false);
    setLoadError('');
  }, [open]);

  useEffect(() => {
    if (!open || editorMode === 'none' || editorMode === 'create' || !editingUserId) {
      return undefined;
    }

    const controller = new AbortController();
    let isActive = true;

    setEditorLoading(true);
    setFormError('');

    adminUserService
      .getUser(editingUserId, { signal: controller.signal })
      .then((response) => {
        if (!isActive) {
          return;
        }

        const accountRecord = response?.account ?? response?.user ?? response?.profile ?? response;
        const normalizedUser = normalizeApiUser(accountRecord);
        const nextUserForm = buildUserFormFromUser(normalizedUser);

        setUserForm(nextUserForm);
        setUserInitialSnapshot(buildUserFormSnapshot(nextUserForm));
      })
      .catch((error) => {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        setFormError(error?.message ?? 'Không thể tải chi tiết tài khoản từ API.');
      })
      .finally(() => {
        if (isActive) {
          setEditorLoading(false);
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [editingUserId, editorMode, open, reloadToken]);

  useEffect(() => {
    if (!feedbackMessage) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setFeedbackMessage('');
    }, 2600);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [feedbackMessage]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatarFile]);

  if (!open) {
    return null;
  }

  const refreshUsers = () => {
    setReloadToken((current) => current + 1);
  };

  const clearAvatarSelection = () => {
    setAvatarFile(null);

    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const closeEditor = () => {
    setEditorMode('none');
    setEditingUserId('');
    setUserForm(createEmptyUserForm());
    setUserInitialSnapshot(createEmptyUserForm());
    setFormError('');
    setEditorLoading(false);
    setActionLoadingUserId('');
    setDeleteTargetUser(null);
    setBirthDatePickerOpen(false);
    clearAvatarSelection();
  };

  const openCreateUserForm = () => {
    setEditorMode('create');
    setEditingUserId('');
    setUserForm(createEmptyUserForm());
    setUserInitialSnapshot(createEmptyUserForm());
    setFormError('');
    setFeedbackMessage('');
    setDeleteTargetUser(null);
    setUserLockConfirm(null);
    setBirthDatePickerOpen(false);
    clearAvatarSelection();
  };

  const openViewUser = (user) => {
    setEditorMode('view');
    setEditingUserId(user.id);
    const nextUserForm = buildUserFormFromUser(user);

    setUserForm(nextUserForm);
    setUserInitialSnapshot(buildUserFormSnapshot(nextUserForm));
    setFormError('');
    setFeedbackMessage('');
    setDeleteTargetUser(null);
    setUserLockConfirm(null);
    setBirthDatePickerOpen(false);
    clearAvatarSelection();
  };

  const openEditUser = (user) => {
    setEditorMode('edit');
    setEditingUserId(user.id);
    const nextUserForm = buildUserFormFromUser(user);

    setUserForm(nextUserForm);
    setUserInitialSnapshot(buildUserFormSnapshot(nextUserForm));
    setFormError('');
    setFeedbackMessage('');
    setDeleteTargetUser(null);
    setUserLockConfirm(null);
    setBirthDatePickerOpen(false);
    clearAvatarSelection();
  };

  const switchViewerToEditMode = (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (!editingUser && !userForm.id) {
      return;
    }

    setEditorMode('edit');
    setFormError('');
    setFeedbackMessage('');
  };

  const handleUserFormChange = (field, value) => {
    const normalizedValue = field === 'phone' ? sanitizePhone(value) : value;
    const nextValue = field === 'roleCode' ? normalizeRoleCode(normalizedValue) : field === 'username' ? sanitizeUsername(normalizedValue) : normalizedValue;

    setUserForm((current) => ({
      ...current,
      ...(field === 'roleCode' && nextValue === 'Q1' ? { status: 'active' } : {}),
      [field]: nextValue,
    }));
  };

  const handleSaveUser = async (event) => {
    event.preventDefault();

    if (editorMode === 'view') {
      return;
    }

    const validationError = validateUserForm(userForm, {
      requirePhone: editorMode === 'create',
      requireUsername: editorMode === 'create',
    });

    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (editorMode === 'edit' && !avatarFile) {
      const currentSnapshot = buildUserFormSnapshot(userForm);
      const baselineSnapshot = userInitialSnapshot ?? createEmptyUserForm();

      if (JSON.stringify(currentSnapshot) === JSON.stringify(baselineSnapshot)) {
        setFormError('Thông tin chưa thay đổi. Hãy chỉnh sửa trước khi Lưu thay đổi.');
        return;
      }
    }

    const baseUserRecord = {
      username: sanitizeUsername(userForm.username),
      fullName: String(userForm.fullName ?? '').trim(),
      email: String(userForm.email ?? '').trim().toLowerCase(),
      phone: String(userForm.phone ?? '').trim(),
      roleCode: normalizeRoleCode(userForm.roleCode ?? 'Q2'),
      status: normalizeUserStatus(userForm.status ?? 'active'),
    };

    const nextUserRecord =
      editorMode === 'create'
        ? baseUserRecord
        : {
            ...baseUserRecord,
            address: String(userForm.address ?? '').trim(),
            dateOfBirth: String(userForm.dateOfBirth ?? '').trim(),
            gender: String(userForm.gender ?? '').trim(),
          };

    if (editorMode === 'create') {
      setActionLoadingUserId('create');

      try {
        const response = await adminUserService.createUser(nextUserRecord);
        const createdAccount = normalizeApiUser(response?.account ?? response?.user ?? response?.profile ?? response);

        setUsers((current) => [createdAccount, ...current]);
        setFeedbackMessage(response?.message ?? 'Đã thêm tài khoản mới.');
        closeEditor();
        refreshUsers();
      } catch (error) {
        setFormError(error?.message ?? 'Không thể tạo tài khoản lúc này.');
      } finally {
        setActionLoadingUserId('');
      }

      return;
    }

    setActionLoadingUserId(editingUserId);

    try {
      const payload =
        avatarFile && editorMode === 'edit'
          ? (() => {
              const formData = new FormData();

              Object.entries(nextUserRecord).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                  formData.append(key, String(value));
                }
              });

              formData.append('avatar', avatarFile);

              return formData;
            })()
          : nextUserRecord;

      const response = await adminUserService.updateUser(editingUserId, payload);
      const updatedAccount = normalizeApiUser(response?.account ?? response?.user ?? response?.profile ?? response);

      setUsers((current) =>
        current.map((user) =>
          String(user.id) === String(editingUserId)
            ? {
                ...user,
                ...updatedAccount,
              }
            : user,
        ),
      );

      setFeedbackMessage(response?.message ?? 'Đã cập nhật người dùng.');
      closeEditor();
      refreshUsers();
    } catch (error) {
      setFormError(error?.message ?? 'Không thể cập nhật tài khoản lúc này.');
    } finally {
      setActionLoadingUserId('');
    }
  };

  const requestDeleteUser = (user) => {
    if (!user.canDelete || user.isAdmin || user.roleCode === 'Q1') {
      setFeedbackMessage('Tài khoản quản trị không thể bị xóa hoặc khóa.');
      return;
    }

    setDeleteTargetUser(user);
  };

  const cancelDeleteUser = () => {
    setDeleteTargetUser(null);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTargetUser) {
      return;
    }

    const targetUser = deleteTargetUser;
    setActionLoadingUserId(targetUser.id);

    try {
      const response = await adminUserService.deleteUser(targetUser.id);

      setUsers((current) => current.filter((entry) => String(entry.id) !== String(targetUser.id)));
      setFeedbackMessage(response?.message ?? `Đã xóa ${targetUser.fullName} khỏi danh sách.`);

      if (String(editingUserId) === String(targetUser.id)) {
        closeEditor();
      }

      setDeleteTargetUser(null);
      refreshUsers();
    } catch (error) {
      setFeedbackMessage(error?.message ?? 'Không thể xóa tài khoản lúc này.');
    } finally {
      setActionLoadingUserId('');
    }
  };

  const handleToggleUserLock = async (user) => {
    if (!user.canLock || user.isAdmin || user.roleCode === 'Q1') {
      setFeedbackMessage('Tài khoản quản trị không thể bị xóa hoặc khóa.');
      return;
    }

    const isLocked = user.status === 'locked';
    const userLabel = String(user.fullName ?? user.username ?? 'tài khoản này').trim() || 'tài khoản này';

    setUserLockConfirm({
      userId: String(user.id),
      userLabel,
      action: isLocked ? 'unlock' : 'lock',
    });
  };

  const confirmUserLockAction = async () => {
    if (!userLockConfirm) {
      return;
    }

    const { userId, userLabel, action } = userLockConfirm;
    setUserLockConfirm(null);

    setActionLoadingUserId(userId);

    try {
      const response = action === 'unlock'
        ? await adminUserService.unlockUser(userId)
        : await adminUserService.lockUser(userId);
      const updatedAccount = normalizeApiUser(response?.account ?? response?.user ?? response?.profile ?? response);

      setUsers((current) =>
        current.map((entry) =>
          String(entry.id) === String(userId)
            ? {
                ...entry,
                ...updatedAccount,
              }
            : entry,
        ),
      );

      setFeedbackMessage(response?.message ?? (action === 'unlock' ? `Đã mở khóa tài khoản ${userLabel}.` : `Đã khóa tài khoản ${userLabel}.`));
      refreshUsers();
    } catch (error) {
      setFeedbackMessage(error?.message ?? 'Không thể cập nhật trạng thái tài khoản lúc này.');
    } finally {
      setActionLoadingUserId('');
    }
  };

  const cancelUserLockConfirm = () => {
    setUserLockConfirm(null);
  };

  const editorTitle =
    editorMode === 'create'
      ? 'Thêm tài khoản mới'
      : editorMode === 'edit'
        ? 'Chỉnh sửa thông tin người dùng'
        : 'Xem thông tin người dùng';

  const editorDescription =
    editorMode === 'create'
      ? 'Chỉ nhập các trường bắt buộc để tạo tài khoản mới.'
      : editorMode === 'view'
        ? 'Kiểm tra chi tiết tài khoản trước khi chuyển sang chế độ chỉnh sửa.'
        : 'Điều chỉnh thông tin cơ bản của tài khoản trong khung này.';

  const editorRoleCode = normalizeRoleCode(userForm.roleCode ?? 'Q2');
  const editorStatusMeta = USER_STATUS_META[normalizeUserStatus(userForm.status ?? 'active')] ?? USER_STATUS_META.active;
  const editorIsProtectedAdmin = Boolean(editingUser?.isAdmin);
  const editorStatusOptions =
    editorMode === 'create'
      ? STATUS_FILTER_OPTIONS.filter((option) => option.value !== 'all' && option.value !== 'pending')
      : STATUS_FILTER_OPTIONS.filter((option) => option.value !== 'all');
  const editorAvatarInitials = getUserInitials(userForm.fullName || editingUser?.fullName || userForm.username);
  const editorAvatarSource = avatarPreviewUrl || resolveAvatarUrl(userForm.avatar);
  const isSavingCurrentUser = editorMode === 'create' ? actionLoadingUserId === 'create' : actionLoadingUserId === editingUserId;

  return createPortal(
    <div className="admin-user-modal" role="dialog" aria-modal="true" aria-label="Quản lý người dùng">
      <div className="admin-user-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <div className="admin-user-modal__window">
        <button className="admin-user-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng quản lý người dùng">
          <img className="admin-user-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="admin-user-modal__header">
          <div className="admin-user-modal__header-copy">
            <h3>QUẢN LÝ NGƯỜI DÙNG</h3>
            <p>Điều phối thông tin tài khoản trong một khung làm việc gọn mắt.</p>
          </div>

          <div className="admin-user-modal__header-stats" aria-label="Thống kê nhanh">
            <article className="admin-user-modal__stat-card">
              <strong>{filterCounts.all}</strong>
              <span>Tài khoản</span>
            </article>
            <article className="admin-user-modal__stat-card">
              <strong>{filterCounts.active}</strong>
              <span>Hoạt động</span>
            </article>
            <article className="admin-user-modal__stat-card">
              <strong>{filterCounts.pending}</strong>
              <span>Chờ duyệt</span>
            </article>
            <article className="admin-user-modal__stat-card">
              <strong>{filterCounts.locked}</strong>
              <span>Bị khóa</span>
            </article>
          </div>
        </header>

        <div className="admin-user-modal__toolbar">
          <label className="admin-user-modal__field" htmlFor="admin-user-search-name">
            <span>Tìm theo tên</span>
            <input
              id="admin-user-search-name"
              type="text"
              value={searchName}
              onChange={(event) => setSearchName(event.target.value)}
              placeholder="Nhập tên người dùng"
            />
          </label>

          <label className="admin-user-modal__field" htmlFor="admin-user-search-contact">
            <span>Email / SĐT</span>
            <input
              id="admin-user-search-contact"
              type="text"
              value={searchContact}
              onChange={(event) => setSearchContact(event.target.value)}
              placeholder="Nhập email hoặc số điện thoại"
            />
          </label>

          <label className="admin-user-modal__field" htmlFor="admin-user-status-filter">
            <span>Trạng thái</span>
            <select
              id="admin-user-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="admin-user-modal__add-button" type="button" onClick={openCreateUserForm}>
            + Thêm
          </button>
        </div>

        {loadError ? (
          <div className="admin-user-modal__state-banner admin-user-modal__state-banner--error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Thử lại
            </button>
          </div>
        ) : isLoading ? (
          <div className="admin-user-modal__state-banner" role="status" aria-live="polite">
            Đang tải danh sách tài khoản từ API...
          </div>
        ) : null}

        {feedbackMessage ? <p className="admin-user-modal__feedback">{feedbackMessage}</p> : null}

        <div className="admin-user-modal__table-wrap">
          <table className="admin-user-modal__table" aria-label="Danh sách người dùng">
            <thead>
              <tr>
                <th>ID</th>
                <th>Họ tên</th>
                <th>Email</th>
                <th>SĐT</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>

            <tbody>
              {isLoading && users.length === 0 ? (
                <tr>
                  <td className="admin-user-modal__empty-row" colSpan={6}>
                    Đang tải danh sách tài khoản từ API...
                  </td>
                </tr>
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user, index) => {
                  const statusMeta = USER_STATUS_META[user.status] ?? USER_STATUS_META.active;
                  const isProtectedAccount = user.isAdmin || user.roleCode === 'Q1';
                  const isBusy = actionLoadingUserId === user.id;

                  return (
                    <tr key={user.id}>
                      <td className="admin-user-modal__id-cell">{index + 1}</td>
                      <td>
                        <strong className="admin-user-modal__name">{user.fullName}</strong>
                      </td>
                      <td>{user.email || '—'}</td>
                      <td>{user.phone || '—'}</td>
                      <td>
                        <span className={`admin-user-modal__status-badge admin-user-modal__status-badge--${statusMeta.tone}`}>
                          <span className={`admin-user-modal__status-dot admin-user-modal__status-dot--${statusMeta.tone}`} aria-hidden="true" />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="admin-user-modal__row-actions">
                          <button
                            className="admin-user-modal__action admin-user-modal__action--view"
                            type="button"
                            onClick={() => openViewUser(user)}
                            disabled={isBusy}
                          >
                            Xem
                          </button>
                          <button
                            className="admin-user-modal__action admin-user-modal__action--edit"
                            type="button"
                            onClick={() => openEditUser(user)}
                            disabled={isBusy}
                          >
                            Sửa
                          </button>
                          <button
                            className="admin-user-modal__action admin-user-modal__action--delete"
                            type="button"
                            onClick={() => requestDeleteUser(user)}
                            disabled={isProtectedAccount || isBusy}
                            title={isProtectedAccount ? 'Tài khoản quản trị không thể bị xóa.' : 'Xóa tài khoản'}
                          >
                            Xóa
                          </button>
                          <button
                            className={`admin-user-modal__action ${user.status === 'locked' ? 'admin-user-modal__action--unlock' : 'admin-user-modal__action--lock'}`}
                            type="button"
                            onClick={() => handleToggleUserLock(user)}
                            disabled={isProtectedAccount || isBusy}
                            title={isProtectedAccount ? 'Tài khoản quản trị không thể bị khóa.' : user.status === 'locked' ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
                          >
                            {user.status === 'locked' ? 'Mở' : 'Khóa'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="admin-user-modal__empty-row" colSpan={6}>
                    Không có người dùng phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editorMode !== 'none' ? (
        <div className="admin-user-modal__editor-overlay" role="dialog" aria-modal="true" aria-label={editorTitle}>
          <div
            className="admin-user-modal__editor-backdrop"
            onClick={() => {
              closeEditor();
            }}
            aria-hidden="true"
          />

          <section
            className="admin-user-modal__editor-sheet"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="admin-user-modal__editor-head">
              <h4>{editorTitle}</h4>
              <p>{editorDescription}</p>
            </div>

            {editorLoading ? (
              <div className="admin-user-modal__state-banner" role="status" aria-live="polite">
                Đang tải chi tiết tài khoản...
              </div>
            ) : null}

            {editorMode !== 'create' ? (
              <div className="admin-user-modal__editor-summary">
                <button
                  className={`admin-user-modal__editor-avatar ${editorMode === 'edit' ? 'admin-user-modal__editor-avatar--interactive' : ''}`}
                  type="button"
                  onClick={() => {
                    if (editorMode === 'edit' && !editorLoading) {
                      avatarInputRef.current?.click();
                    }
                  }}
                  disabled={editorMode !== 'edit' || editorLoading}
                  aria-label={editorMode === 'edit' ? 'Chọn ảnh đại diện' : 'Ảnh đại diện hiện tại'}
                >
                  {editorAvatarSource ? <img src={editorAvatarSource} alt="" /> : <span>{editorAvatarInitials}</span>}
                  {editorMode === 'edit' ? <span className="admin-user-modal__editor-avatar-label">Bấm để đổi ảnh</span> : null}
                </button>

                <div className="admin-user-modal__editor-summary-copy">
                  <strong>{userForm.fullName || 'Chưa có tên'}</strong>
                  <span>{userForm.username || 'Chưa có tên đăng nhập'}</span>

                  <div className="admin-user-modal__editor-tags">
                    <span>Mã: {userForm.id || editingUserId || '—'}</span>
                    <span>Vai trò: {ROLE_OPTIONS.find((option) => option.value === editorRoleCode)?.label ?? 'Khách hàng'}</span>
                    <span>Trạng thái: {editorStatusMeta.label}</span>
                  </div>

                  {editorMode === 'edit' ? <span className="admin-user-modal__editor-avatar-hint">Nhấn vào ảnh để thay avatar.</span> : null}
                </div>
              </div>
            ) : (
              <div className="admin-user-modal__editor-create-note">Chỉ nhập các trường bắt buộc để tạo tài khoản. Avatar và thông tin bổ sung sẽ được cập nhật sau nếu cần.</div>
            )}

            <input
              ref={avatarInputRef}
              className="admin-user-modal__editor-avatar-input"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0] ?? null;

                if (!selectedFile) {
                  setAvatarFile(null);
                  return;
                }

                if (!selectedFile.type.startsWith('image/')) {
                  setFormError('Vui lòng chọn tệp ảnh hợp lệ cho avatar.');
                  event.target.value = '';
                  return;
                }

                setFormError('');
                setAvatarFile(selectedFile);
              }}
            />

            <form
              className="admin-user-modal__editor-form"
              onMouseDownCapture={(event) => {
                const targetElement = event.target;
                const isInsideDatePicker =
                  targetElement instanceof Element &&
                  (targetElement.closest('.admin-user-modal__date-calendar') || targetElement.closest('.admin-user-modal__date-input'));

                if (birthDatePickerOpen && !isInsideDatePicker) {
                  setBirthDatePickerOpen(false);
                }
              }}
              onSubmit={handleSaveUser}
            >
              <section className="admin-user-modal__editor-group">
                <h5>{editorMode === 'create' ? 'Thông tin bắt buộc' : 'Thông tin tài khoản'}</h5>

                <div className="admin-user-modal__editor-grid">
                  <label className="is-wide">
                    <span>Họ và tên</span>
                    <input
                      type="text"
                      value={userForm.fullName}
                      onChange={(event) => handleUserFormChange('fullName', event.target.value)}
                      disabled={editorMode === 'view' || editorLoading}
                      placeholder="Nguyễn Văn A"
                    />
                  </label>

                  <label>
                    <span>Tên đăng nhập</span>
                    <input
                      type="text"
                      value={userForm.username}
                      onChange={(event) => handleUserFormChange('username', event.target.value)}
                      disabled={editorMode !== 'create' || editorLoading}
                      placeholder="ten.dangnhap"
                      maxLength={150}
                    />
                  </label>

                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      value={userForm.email}
                      onChange={(event) => handleUserFormChange('email', event.target.value)}
                      disabled={editorMode === 'view' || editorLoading}
                      placeholder="a@gmail.com"
                    />
                  </label>

                  <label>
                    <span>Số điện thoại</span>
                    <input
                      type="text"
                      value={userForm.phone}
                      onChange={(event) => handleUserFormChange('phone', event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={15}
                      disabled={editorMode === 'view' || editorLoading}
                      placeholder="0123456789"
                    />
                  </label>

                  <label>
                    <span>Vai trò</span>
                    <select
                      value={userForm.roleCode}
                      onChange={(event) => handleUserFormChange('roleCode', event.target.value)}
                      disabled={editorMode === 'view' || editorLoading || editorIsProtectedAdmin}
                    >
                      {ROLE_OPTIONS.map((roleOption) => (
                        <option key={roleOption.value} value={roleOption.value}>
                          {roleOption.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Trạng thái</span>
                    <select
                      value={userForm.status}
                      onChange={(event) => handleUserFormChange('status', event.target.value)}
                      disabled={editorMode === 'view' || editorLoading || editorIsProtectedAdmin || editorRoleCode === 'Q1'}
                    >
                      {editorStatusOptions.map((statusOption) => (
                        <option key={statusOption.value} value={statusOption.value}>
                          {statusOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {editorMode !== 'create' ? (
                <section className="admin-user-modal__editor-group">
                  <h5>Thông tin bổ sung</h5>

                  <div className="admin-user-modal__editor-grid">
                    <label>
                      <span>Ngày sinh</span>
                      <DatePicker
                        selected={parseDateForPicker(userForm.dateOfBirth)}
                        onChange={(selectedDate) => {
                          handleUserFormChange('dateOfBirth', formatDateForUserValue(selectedDate));
                          setBirthDatePickerOpen(false);
                        }}
                        onCalendarOpen={() => setBirthDatePickerOpen(true)}
                        onCalendarClose={() => setBirthDatePickerOpen(false)}
                        onClickOutside={() => setBirthDatePickerOpen(false)}
                        onInputClick={() => setBirthDatePickerOpen(true)}
                        locale="vi-VN"
                        dateFormat="dd/MM/yyyy"
                        placeholderText="dd/mm/yyyy"
                        showMonthDropdown
                        showYearDropdown
                        dropdownMode="select"
                        maxDate={new Date()}
                        className="admin-user-modal__date-input"
                        calendarClassName="admin-user-modal__date-calendar"
                        popperClassName="admin-user-modal__date-popper"
                        open={editorMode !== 'view' && birthDatePickerOpen}
                        disabled={editorMode === 'view' || editorLoading}
                        autoComplete="off"
                        showPopperArrow={false}
                      />
                    </label>

                    <label>
                      <span>Giới tính</span>
                      <select
                        value={userForm.gender}
                        onChange={(event) => handleUserFormChange('gender', event.target.value)}
                        disabled={editorMode === 'view' || editorLoading}
                      >
                        <option value="">Chưa xác định</option>
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                        <option value="Khác">Khác</option>
                      </select>
                    </label>

                    <label className="is-wide">
                      <span>Địa chỉ</span>
                      <textarea
                        rows="4"
                        value={userForm.address}
                        onChange={(event) => handleUserFormChange('address', event.target.value)}
                        disabled={editorMode === 'view' || editorLoading}
                        placeholder="Địa chỉ hiện tại"
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {formError ? <p className="admin-user-modal__editor-hint admin-user-modal__editor-hint--error">{formError}</p> : null}

              <div className="admin-user-modal__editor-actions">
                <button className="admin-user-modal__editor-button admin-user-modal__editor-button--ghost" type="button" onClick={closeEditor}>
                  {editorMode === 'view' ? 'Đóng' : 'Hủy'}
                </button>

                {editorMode === 'view' ? (
                  <button
                    className="admin-user-modal__editor-button admin-user-modal__editor-button--primary"
                    type="button"
                    onClick={switchViewerToEditMode}
                  >
                    Chỉnh sửa
                  </button>
                ) : (
                  <button
                    className="admin-user-modal__editor-button admin-user-modal__editor-button--primary"
                    type="submit"
                    disabled={editorLoading || isSavingCurrentUser}
                  >
                    {editorMode === 'create' ? (isSavingCurrentUser ? 'Đang tạo...' : 'Thêm tài khoản') : isSavingCurrentUser ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTargetUser ? (
        <div className="admin-user-modal__confirm-overlay" role="dialog" aria-modal="true" aria-label="Xác nhận xóa tài khoản">
          <div className="admin-user-modal__confirm-backdrop" onClick={cancelDeleteUser} aria-hidden="true" />

          <section
            className="admin-user-modal__confirm-sheet"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="admin-user-modal__confirm-head">
              <h4>Xác nhận xóa tài khoản</h4>
              <p>
                {`Bạn có chắc chắn muốn xóa tài khoản ${deleteTargetUser.fullName} (${deleteTargetUser.email || deleteTargetUser.username || deleteTargetUser.id}) không?`}
              </p>
            </div>

            <div className="admin-user-modal__confirm-actions">
              <button className="admin-user-modal__confirm-button admin-user-modal__confirm-button--ghost" type="button" onClick={cancelDeleteUser}>
                Hủy
              </button>

              <button
                className="admin-user-modal__confirm-button admin-user-modal__confirm-button--danger"
                type="button"
                onClick={confirmDeleteUser}
                disabled={actionLoadingUserId === deleteTargetUser.id}
              >
                {actionLoadingUserId === deleteTargetUser.id ? 'Đang xóa...' : 'Xóa tài khoản'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(userLockConfirm)}
        title={userLockConfirm?.action === 'unlock' ? 'Xác nhận mở khóa tài khoản' : 'Xác nhận khóa tài khoản'}
        description={
          userLockConfirm?.action === 'unlock'
            ? `Bạn có chắc chắn muốn mở khóa tài khoản ${userLockConfirm?.userLabel ?? 'này'} không?`
            : `Bạn có chắc chắn muốn khóa tài khoản ${userLockConfirm?.userLabel ?? 'này'} không?`
        }
        confirmLabel={userLockConfirm?.action === 'unlock' ? 'Mở khóa' : 'Khóa tài khoản'}
        cancelLabel="Hủy"
        confirmTone="danger"
        onCancel={cancelUserLockConfirm}
        onConfirm={confirmUserLockAction}
        ariaLabel={userLockConfirm?.action === 'unlock' ? 'Xác nhận mở khóa tài khoản' : 'Xác nhận khóa tài khoản'}
      />
    </div>,
    document.body,
  );
}