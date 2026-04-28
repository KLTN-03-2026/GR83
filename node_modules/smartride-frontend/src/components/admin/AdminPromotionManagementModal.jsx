import { closeIcon } from '../../assets/icons';
import { adminPromotionService } from '../../services/adminPromotionService';
import { classNames } from '../../utils/classNames';
import { dispatchPromotionCatalogChanged } from '../../utils/promotionEvents';
import ConfirmDialog from '../ui/ConfirmDialog';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import './AdminPromotionManagementModal.css';

registerLocale('vi-VN', vi);

const PROMOTION_STATUS_META = {
  active: { label: 'Hoạt động', tone: 'active' },
  expired: { label: 'Hết hạn', tone: 'expired' },
  scheduled: { label: 'Sắp mở', tone: 'scheduled' },
};

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Hoạt động' },
  { value: 'scheduled', label: 'Sắp mở' },
  { value: 'expired', label: 'Hết hạn' },
];

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'percent', label: 'Giảm theo %' },
  { value: 'fixed', label: 'Giảm tiền cố định' },
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Công khai' },
  { value: 'hidden', label: 'Ẩn' },
];

function getApiErrorMessage(error, fallbackMessage) {
  const apiMessage = String(error?.body?.message ?? error?.message ?? '').trim();
  return apiMessage || fallbackMessage;
}

function extractPromotionList(response) {
  if (Array.isArray(response?.promotions)) {
    return response.promotions;
  }

  if (Array.isArray(response?.data?.promotions)) {
    return response.data.promotions;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return [];
}

function extractPromotionRecord(response, fallbackPromotion = null) {
  if (response?.promotion && typeof response.promotion === 'object') {
    return response.promotion;
  }

  if (response?.data?.promotion && typeof response.data.promotion === 'object') {
    return response.data.promotion;
  }

  if (response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return response.data;
  }

  return fallbackPromotion;
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function normalizeStatus(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'active' || normalizedValue === 'expired' || normalizedValue === 'scheduled') {
    return normalizedValue;
  }

  return 'scheduled';
}

function normalizeCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function getCreatePromotionDefaults(code = '') {
  const normalizedCode = normalizeCode(code);

  if (!normalizedCode) {
    return {
      title: 'Ưu đãi mới',
      description: 'Ưu đãi áp dụng cho khách hàng đủ điều kiện.',
      audience: 'customer',
    };
  }

  return {
    title: `Ưu đãi ${normalizedCode}`,
    description: `Ưu đãi áp dụng cho mã ${normalizedCode}.`,
    audience: 'customer',
  };
}

function createEmptyPromotionForm() {
  return {
    code: '',
    title: 'Ưu đãi mới',
    description: 'Ưu đãi áp dụng cho khách hàng đủ điều kiện.',
    discountType: 'percent',
    discountPercent: '10',
    discountAmount: '',
    maxAmount: '',
    minOrderAmount: '',
    usageLimit: '',
    startsAt: '',
    expiresAt: '',
    scope: 'customer', // legacy placeholder; actual field is audience
    audience: 'customer',
    visibility: 'public',
  };
}

function formatDateDisplay(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return '--';
  }

  const dateKey = normalizedValue.slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const [year, month, day] = dateKey.split('-');
    return `${day}/${month}/${year}`;
  }

  const parsedDate = new Date(normalizedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return '--';
  }

  const day = String(parsedDate.getDate()).padStart(2, '0');
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const year = parsedDate.getFullYear();

  return `${day}/${month}/${year}`;
}

function formatInputDate(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  return normalizedValue.slice(0, 10);
}

function parseDateForPicker(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedDate = parse(normalizedValue.slice(0, 10), 'yyyy-MM-dd', new Date());
  return isValid(parsedDate) ? parsedDate : null;
}

function formatDateForPayload(value) {
  if (!value) {
    return '';
  }

  return format(value, 'yyyy-MM-dd');
}

function formatMoneyValue(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function formatDiscountDisplay(promotion = {}) {
  const discountType = String(promotion.discountType ?? 'percent').trim().toLowerCase();

  if (discountType === 'fixed') {
    const fixedAmount = Number(promotion.discountAmount ?? 0) || 0;
    return fixedAmount > 0 ? `${formatMoneyValue(fixedAmount)}đ` : '0đ';
  }

  const discountPercent = Number(promotion.discountPercent ?? 0) || 0;
  return `${discountPercent}%`;
}

function getStatusMeta(value) {
  return PROMOTION_STATUS_META[normalizeStatus(value)] ?? PROMOTION_STATUS_META.scheduled;
}

function normalizePromotion(promotion = {}, fallbackId = 0) {
  const discountType = String(promotion.discountType ?? promotion.LoaiUuDai ?? 'percent').trim().toLowerCase();

  return {
    id: Number(promotion.id ?? promotion.MaUD ?? fallbackId) || fallbackId,
    code: normalizeCode(promotion.code ?? promotion.MaUuDai),
    title: String(promotion.title ?? promotion.TenUuDai ?? '').trim(),
    description: String(promotion.description ?? promotion.MoTa ?? '').trim(),
    discountType: discountType === 'fixed' ? 'fixed' : 'percent',
    discountPercent: Number(promotion.discountPercent ?? promotion.PhanTramGiam ?? 0) || 0,
    discountAmount: Number(promotion.discountAmount ?? promotion.SoTienGiam ?? 0) || 0,
    maxAmount: Number(promotion.maxAmount ?? promotion.GiaTriToiDa ?? 0) || 0,
    minOrderAmount: Number(promotion.minOrderAmount ?? promotion.DonToiThieu ?? 0) || 0,
    scope: String(promotion.scope ?? promotion.PhamViApDung ?? '').trim(),
    audience: String(promotion.audience ?? promotion.scope ?? 'customer').trim().toLowerCase()
      .replace('all', 'all').replace('driver', 'driver').replace('admin', 'admin') || 'customer',
    visibility: String(promotion.visibility ?? promotion.HienThi ?? 'public').trim().toLowerCase() === 'hidden' ? 'hidden' : 'public',
    status: normalizeStatus(promotion.status ?? promotion.TrangThai),
    usageCount: Number(promotion.usageCount ?? promotion.SoLuotDaDung ?? 0) || 0,
    usageLimit:
      promotion.usageLimit === null ||
      promotion.usageLimit === undefined ||
      promotion.usageLimit === ''
        ? ''
        : String(promotion.usageLimit),
    startsAt: formatInputDate(promotion.startsAt ?? promotion.NgayBatDau),
    expiresAt: formatInputDate(promotion.expiresAt ?? promotion.NgayHetHan),
    createdAt: String(promotion.createdAt ?? promotion.NgayTao ?? '').trim(),
    updatedAt: String(promotion.updatedAt ?? promotion.NgayCapNhat ?? '').trim(),
  };
}

function buildPromotionForm(promotion = null) {
  if (!promotion) {
    return createEmptyPromotionForm();
  }

  return {
    code: String(promotion.code ?? '').trim(),
    title: String(promotion.title ?? '').trim(),
    description: String(promotion.description ?? '').trim(),
    discountType: String(promotion.discountType ?? 'percent').trim() === 'fixed' ? 'fixed' : 'percent',
    discountPercent: String(promotion.discountPercent ?? '').trim() || '10',
    discountAmount: String(promotion.discountAmount ?? '').trim(),
    maxAmount: String(promotion.maxAmount ?? '').trim(),
    minOrderAmount: String(promotion.minOrderAmount ?? '').trim(),
    usageLimit: promotion.usageLimit === null || promotion.usageLimit === undefined ? '' : String(promotion.usageLimit),
    startsAt: formatInputDate(promotion.startsAt),
    expiresAt: formatInputDate(promotion.expiresAt),
    scope: String(promotion.scope ?? '').trim(),
    audience: String(promotion.audience ?? 'customer').trim(),
    visibility: String(promotion.visibility ?? 'public').trim() === 'hidden' ? 'hidden' : 'public',
  };
}

function normalizePromotionForm(form = {}) {
  return {
    code: normalizeCode(form.code),
    title: String(form.title ?? '').trim(),
    description: String(form.description ?? '').trim(),
    discountType: String(form.discountType ?? 'percent').trim() === 'fixed' ? 'fixed' : 'percent',
    discountPercent: String(form.discountPercent ?? '').trim(),
    discountAmount: String(form.discountAmount ?? '').trim(),
    maxAmount: String(form.maxAmount ?? '').trim(),
    minOrderAmount: String(form.minOrderAmount ?? '').trim(),
    usageLimit: String(form.usageLimit ?? '').trim(),
    startsAt: String(form.startsAt ?? '').trim().slice(0, 10),
    expiresAt: String(form.expiresAt ?? '').trim().slice(0, 10),
    scope: String(form.scope ?? '').trim(),
    audience: String(form.audience ?? 'customer').trim(),
    visibility: String(form.visibility ?? 'public').trim() === 'hidden' ? 'hidden' : 'public',
  };
}

function hasPromotionFormChanged(currentForm, originalForm) {
  return JSON.stringify(normalizePromotionForm(currentForm)) !== JSON.stringify(normalizePromotionForm(originalForm));
}

function validatePromotionForm(form = {}) {
  const code = normalizeCode(form.code);
  const title = String(form.title ?? '').trim();
  const description = String(form.description ?? '').trim();
  const VALID_AUDIENCE = new Set(['all', 'customer', 'driver', 'admin']);
  const scope = String(form.scope ?? '').trim();
  const audience = VALID_AUDIENCE.has(String(form.audience ?? '').trim()) ? String(form.audience).trim() : 'customer';
  const discountType = String(form.discountType ?? 'percent').trim() === 'fixed' ? 'fixed' : 'percent';
  const discountPercentValue = String(form.discountPercent ?? '').trim();
  const discountAmountValue = String(form.discountAmount ?? '').trim();
  const maxAmountValue = String(form.maxAmount ?? '').trim();
  const minOrderAmountValue = String(form.minOrderAmount ?? '').trim();
  const usageLimitValue = String(form.usageLimit ?? '').trim();
  const startsAtValue = String(form.startsAt ?? '').trim().slice(0, 10);
  const expiresAtValue = String(form.expiresAt ?? '').trim().slice(0, 10);
  const visibility = String(form.visibility ?? 'public').trim() === 'hidden' ? 'hidden' : 'public';

  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return 'Mã ưu đãi chỉ được chứa chữ cái, số, dấu gạch ngang hoặc gạch dưới và dài từ 3 đến 40 ký tự.';
  }

  if (!title) {
    return 'Tên ưu đãi không được để trống.';
  }

  if (title.length > 120) {
    return 'Tên ưu đãi không được vượt quá 120 ký tự.';
  }

  if (!description) {
    return 'Mô tả ưu đãi không được để trống.';
  }

  if (description.length > 1000) {
    return 'Mô tả ưu đãi không được vượt quá 1000 ký tự.';
  }

  if (!audience) {
    return 'Đối tượng áp dụng không được để trống.';
  }

  if (!startsAtValue || !/^\d{4}-\d{2}-\d{2}$/.test(startsAtValue)) {
    return 'Ngày bắt đầu không hợp lệ.';
  }

  if (!expiresAtValue || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAtValue)) {
    return 'Ngày kết thúc không hợp lệ.';
  }

  if (startsAtValue > expiresAtValue) {
    return 'Ngày bắt đầu không được lớn hơn ngày kết thúc.';
  }

  let discountPercent = null;
  let discountAmount = null;
  let maxAmount = null;

  if (discountType === 'percent') {
    discountPercent = Number.parseInt(discountPercentValue, 10);

    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      return 'Phần trăm giảm phải là số nguyên từ 1 đến 100.';
    }

    maxAmount = Number.parseInt(maxAmountValue, 10);

    if (!Number.isInteger(maxAmount) || maxAmount < 0) {
      return 'Giảm tối đa phải là số nguyên không âm khi chọn giảm theo %.';
    }
  } else {
    discountAmount = Number.parseInt(discountAmountValue, 10);

    if (!Number.isInteger(discountAmount) || discountAmount <= 0) {
      return 'Số tiền giảm phải là số nguyên dương khi chọn giảm tiền cố định.';
    }
  }

  let minOrderAmount = 0;

  if (minOrderAmountValue) {
    minOrderAmount = Number.parseInt(minOrderAmountValue, 10);

    if (!Number.isInteger(minOrderAmount) || minOrderAmount < 0) {
      return 'Đơn tối thiểu phải là số nguyên không âm.';
    }
  }

  let usageLimit = null;

  if (usageLimitValue) {
    usageLimit = Number.parseInt(usageLimitValue, 10);

    if (!Number.isInteger(usageLimit) || usageLimit < 0) {
      return 'Giới hạn lượt dùng phải là số nguyên không âm.';
    }
  }

  return {
    code,
    title,
    description,
    discountType,
    discountPercent,
    discountAmount,
    maxAmount,
    minOrderAmount,
    usageLimit,
    startsAt: startsAtValue,
    expiresAt: expiresAtValue,
    scope,
    audience,
    visibility,
  };
}

function StatCard({ tone, label, value }) {
  return (
    <article className={classNames('admin-promotion-modal__stat-card', `admin-promotion-modal__stat-card--${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default function AdminPromotionManagementModal({ open = false, onClose }) {
  const [promotions, setPromotions] = useState([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expiryKeyword, setExpiryKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editorMode, setEditorMode] = useState('none');
  const [editingPromotionId, setEditingPromotionId] = useState('');
  const [promotionForm, setPromotionForm] = useState(createEmptyPromotionForm);
  const [promotionSnapshot, setPromotionSnapshot] = useState(createEmptyPromotionForm);
  const [formError, setFormError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionLoadingPromotionId, setActionLoadingPromotionId] = useState('');
  const [deleteTargetPromotion, setDeleteTargetPromotion] = useState(null);

  const promotionStats = useMemo(() => {
    return promotions.reduce(
      (accumulator, promotion) => {
        accumulator.total += 1;

        const normalizedStatus = normalizeStatus(promotion.status);

        if (normalizedStatus === 'active') {
          accumulator.active += 1;
        } else if (normalizedStatus === 'scheduled') {
          accumulator.scheduled += 1;
        } else if (normalizedStatus === 'expired') {
          accumulator.expired += 1;
        }

        return accumulator;
      },
      { total: 0, active: 0, scheduled: 0, expired: 0 },
    );
  }, [promotions]);

  const filteredPromotions = useMemo(() => {
    const normalizedSearchKeyword = normalizeToken(searchKeyword);
    const normalizedExpiryKeyword = normalizeToken(expiryKeyword);

    return promotions.filter((promotion) => {
      if (statusFilter !== 'all' && normalizeStatus(promotion.status) !== statusFilter) {
        return false;
      }

      if (normalizedSearchKeyword) {
        const searchableText = normalizeToken(
          `${promotion.code} ${promotion.title} ${promotion.description} ${promotion.audience} ${promotion.visibility} ${promotion.discountType}`,
        );

        if (!searchableText.includes(normalizedSearchKeyword)) {
          return false;
        }
      }

      if (normalizedExpiryKeyword) {
        const expiryText = normalizeToken(formatDateDisplay(promotion.expiresAt));

        if (!expiryText.includes(normalizedExpiryKeyword)) {
          return false;
        }
      }

      return true;
    });
  }, [expiryKeyword, promotions, searchKeyword, statusFilter]);

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
      setPromotions([]);
      setSearchKeyword('');
      setExpiryKeyword('');
      setStatusFilter('all');
      setEditorMode('none');
      setEditingPromotionId('');
      setPromotionForm(createEmptyPromotionForm());
      setPromotionSnapshot(createEmptyPromotionForm());
      setFormError('');
      setFeedbackMessage('');
      setLoadError('');
      setIsLoading(false);
      setIsSaving(false);
      setActionLoadingPromotionId('');
      setDeleteTargetPromotion(null);
      return undefined;
    }

    const abortController = new AbortController();
    let isActive = true;

    setIsLoading(true);
    setLoadError('');

    adminPromotionService
      .listPromotions({}, { signal: abortController.signal })
      .then((response) => {
        if (!isActive) {
          return;
        }

        const nextPromotions = extractPromotionList(response).map((item, index) => normalizePromotion(item, index + 1));
        setPromotions(nextPromotions);
      })
      .catch((error) => {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        setPromotions([]);
        setLoadError(getApiErrorMessage(error, 'Không thể tải danh sách ưu đãi lúc này.'));
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [open]);

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

  if (!open) {
    return null;
  }

  const openCreateForm = () => {
    const emptyForm = createEmptyPromotionForm();

    setEditorMode('create');
    setEditingPromotionId('');
    setPromotionForm(emptyForm);
    setPromotionSnapshot(emptyForm);
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setDeleteTargetPromotion(null);
  };

  const openViewForm = (promotion) => {
    const nextForm = buildPromotionForm(promotion);

    setEditorMode('view');
    setEditingPromotionId(String(promotion.id));
    setPromotionForm(nextForm);
    setPromotionSnapshot(nextForm);
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setDeleteTargetPromotion(null);
  };

  const openEditForm = (promotion) => {
    const nextForm = buildPromotionForm(promotion);

    setEditorMode('edit');
    setEditingPromotionId(String(promotion.id));
    setPromotionForm(nextForm);
    setPromotionSnapshot(nextForm);
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setDeleteTargetPromotion(null);
  };

  const closeEditor = () => {
    setEditorMode('none');
    setEditingPromotionId('');
    setPromotionForm(createEmptyPromotionForm());
    setPromotionSnapshot(createEmptyPromotionForm());
    setFormError('');
    setIsSaving(false);
    setDeleteTargetPromotion(null);
  };

  const updateField = (field, value) => {
    setPromotionForm((current) => ({
      ...current,
      [field]: value,
      ...(editorMode === 'create' && field === 'code' ? getCreatePromotionDefaults(value) : null),
    }));

    if (formError) {
      setFormError('');
    }
  };

  const handleDeletePromotion = (promotion) => {
    setDeleteTargetPromotion(promotion);
  };

  const cancelDeletePromotion = () => {
    setDeleteTargetPromotion(null);
  };

  const confirmDeletePromotion = async () => {
    if (!deleteTargetPromotion) {
      return;
    }

    const promotionToDelete = deleteTargetPromotion;
    const promotionId = String(promotionToDelete.id);
    setDeleteTargetPromotion(null);
    setActionLoadingPromotionId(promotionId);

    try {
      await adminPromotionService.deletePromotion(promotionId);
      setPromotions((current) => current.filter((promotion) => String(promotion.id) !== promotionId));
      setFeedbackMessage(`Đã xóa ưu đãi ${promotionToDelete.code}.`);
      dispatchPromotionCatalogChanged({
        action: 'delete',
        promotion: promotionToDelete,
        promotionId,
      });

      if (String(editingPromotionId) === promotionId) {
        closeEditor();
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      setFeedbackMessage(getApiErrorMessage(error, 'Không thể xóa ưu đãi lúc này.'));
    } finally {
      setActionLoadingPromotionId('');
    }
  };

  const handleEditorPrimaryAction = async () => {
    if (editorMode === 'view') {
      setEditorMode('edit');
      return;
    }

    const validationResult = validatePromotionForm(promotionForm);

    if (typeof validationResult === 'string') {
      setFormError(validationResult);
      return;
    }

    if (editorMode === 'edit' && !hasPromotionFormChanged(promotionForm, promotionSnapshot)) {
      setFormError('Thông tin chưa thay đổi. Vui lòng chỉnh sửa rồi lưu.');
      return;
    }

    const nextPayload = validationResult;
    setIsSaving(true);
    setFormError('');

    try {
      if (editorMode === 'create') {
        const response = await adminPromotionService.createPromotion(nextPayload);
        const promotionRecord = extractPromotionRecord(response, null);
        const createdPromotion = normalizePromotion(
          promotionRecord ?? { ...nextPayload, id: promotions.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1 },
          promotions.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1,
        );

        setPromotions((current) => [createdPromotion, ...current.filter((item) => String(item.id) !== String(createdPromotion.id))]);
        setFeedbackMessage(`Đã tạo ưu đãi ${createdPromotion.code}.`);
        dispatchPromotionCatalogChanged({
          action: 'create',
          promotion: createdPromotion,
          promotionId: String(createdPromotion.id),
        });
      } else {
        const response = await adminPromotionService.updatePromotion(editingPromotionId, nextPayload);
        const promotionRecord = extractPromotionRecord(response, null);
        const updatedPromotion = normalizePromotion(
          promotionRecord ?? { ...nextPayload, id: editingPromotionId },
          Number(editingPromotionId) || 0,
        );

        setPromotions((current) =>
          current.map((promotion) =>
            String(promotion.id) === String(editingPromotionId) ? updatedPromotion : promotion,
          ),
        );
        setFeedbackMessage(`Đã cập nhật ưu đãi ${updatedPromotion.code}.`);
        dispatchPromotionCatalogChanged({
          action: 'update',
          promotion: updatedPromotion,
          promotionId: String(updatedPromotion.id),
        });
      }

      closeEditor();
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      setFormError(
        getApiErrorMessage(
          error,
          editorMode === 'create'
            ? 'Không thể tạo ưu đãi lúc này.'
            : 'Không thể lưu ưu đãi lúc này.',
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const editorReadOnly = editorMode === 'view' || isSaving;
  const editorTitleLabel =
    editorMode === 'create'
      ? 'Thêm mã ưu đãi'
      : editorMode === 'edit'
        ? 'Sửa mã ưu đãi'
        : 'Xem mã ưu đãi';
  const editorPrimaryLabel =
    isSaving
      ? 'Đang lưu...'
      : editorMode === 'view'
        ? 'Sửa'
        : 'Lưu';
  const editorSecondaryLabel = editorMode === 'view' ? 'Đóng' : 'Hủy';

  return createPortal(
    <div className="admin-promotion-modal" role="dialog" aria-modal="true" aria-label="Quản lý ưu đãi">
      <div className="admin-promotion-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="admin-promotion-modal__window">
        <button className="admin-promotion-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng">
          <img className="admin-promotion-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="admin-promotion-modal__header">
          <div className="admin-promotion-modal__header-copy">
            <p className="admin-promotion-modal__eyebrow">ADMIN / ƯU ĐÃI</p>
            <h3>QUẢN LÝ MÃ ƯU ĐÃI</h3>
            <p>
              Theo dõi, lọc và chỉnh sửa toàn bộ mã ưu đãi trong một màn hình duy nhất.
            </p>
          </div>

          <div className="admin-promotion-modal__header-stats" aria-label="Thống kê ưu đãi">
            <StatCard tone="blue" label="Tổng mã" value={promotionStats.total} />
            <StatCard tone="green" label="Hoạt động" value={promotionStats.active} />
            <StatCard tone="yellow" label="Sắp mở" value={promotionStats.scheduled} />
            <StatCard tone="red" label="Hết hạn" value={promotionStats.expired} />
          </div>
        </header>

        <div className="admin-promotion-modal__toolbar" role="search" aria-label="Bộ lọc ưu đãi">
          <label className="admin-promotion-modal__field admin-promotion-modal__field--search">
            <span className="admin-promotion-modal__sr-only">Tìm mã, tên hoặc mô tả</span>
            <input
              type="search"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="Tìm mã, tên hoặc mô tả"
            />
          </label>

          <label className="admin-promotion-modal__field admin-promotion-modal__field--search">
            <span className="admin-promotion-modal__sr-only">Ngày hết hạn</span>
            <input
              type="text"
              value={expiryKeyword}
              onChange={(event) => setExpiryKeyword(event.target.value)}
              placeholder="dd/mm/yyyy"
            />
          </label>

          <label className="admin-promotion-modal__field">
            <span className="admin-promotion-modal__sr-only">Trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="admin-promotion-modal__add-button" type="button" onClick={openCreateForm}>
            <span aria-hidden="true">+</span>
            <strong>Thêm ưu đãi</strong>
          </button>
        </div>

        {loadError ? <p className="admin-promotion-modal__notice admin-promotion-modal__notice--error">{loadError}</p> : null}

        {isLoading ? <p className="admin-promotion-modal__notice admin-promotion-modal__notice--loading">Đang tải danh sách ưu đãi...</p> : null}

        {feedbackMessage ? <p className="admin-promotion-modal__feedback">{feedbackMessage}</p> : null}

        <div className="admin-promotion-modal__table-wrap">
          <table className="admin-promotion-modal__table" aria-label="Danh sách mã ưu đãi">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Loại ưu đãi</th>
                <th>Mức giảm</th>
                <th>Hiển thị</th>
                <th>Kết thúc</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>

            <tbody>
              {filteredPromotions.length > 0 ? (
                filteredPromotions.map((promotion) => {
                  const statusMeta = getStatusMeta(promotion.status);
                  const isActionLoading = actionLoadingPromotionId === String(promotion.id);

                  return (
                    <tr key={promotion.id}>
                      <td className="admin-promotion-modal__code-cell">
                        <strong>{promotion.code}</strong>
                        <span>{promotion.title || 'Ưu đãi'}</span>
                        <em>
                          {{all: 'Tất cả', customer: 'Khách hàng', driver: 'Tài xế', admin: 'Admin'}[promotion.audience] ?? promotion.audience ?? 'Tất cả'}
                          {' · '}{promotion.usageCount} lượt dùng
                        </em>
                      </td>
                      <td>{promotion.discountType === 'fixed' ? 'Giảm cố định' : 'Giảm theo %'}</td>
                      <td className="admin-promotion-modal__discount-cell">{formatDiscountDisplay(promotion)}</td>
                      <td>{promotion.visibility === 'hidden' ? 'Ẩn' : 'Công khai'}</td>
                      <td className="admin-promotion-modal__date-cell">{formatDateDisplay(promotion.expiresAt)}</td>
                      <td>
                        <span
                          className={classNames(
                            'admin-promotion-modal__status-badge',
                            `admin-promotion-modal__status-badge--${statusMeta.tone}`,
                          )}
                        >
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="admin-promotion-modal__row-actions">
                          <button
                            className="admin-promotion-modal__action admin-promotion-modal__action--view"
                            type="button"
                            onClick={() => openViewForm(promotion)}
                            disabled={isActionLoading}
                          >
                            Xem
                          </button>
                          <button
                            className="admin-promotion-modal__action admin-promotion-modal__action--edit"
                            type="button"
                            onClick={() => openEditForm(promotion)}
                            disabled={isActionLoading}
                          >
                            Sửa
                          </button>
                          <button
                            className="admin-promotion-modal__action admin-promotion-modal__action--delete"
                            type="button"
                            onClick={() => handleDeletePromotion(promotion)}
                            disabled={isActionLoading}
                          >
                            {isActionLoading ? 'Đang xóa...' : 'Xóa'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : !isLoading ? (
                <tr>
                  <td className="admin-promotion-modal__empty-row" colSpan={7}>
                    Không có mã ưu đãi nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="admin-promotion-modal__hint">
          Dữ liệu đang được đồng bộ trực tiếp từ backend SQL Server.
        </p>
      </section>

      {editorMode !== 'none'
        ? createPortal(
            <div className="admin-promotion-modal__editor-overlay" role="dialog" aria-modal="true" aria-label={editorTitleLabel}>
              <div className="admin-promotion-modal__editor-backdrop" onClick={closeEditor} aria-hidden="true" />

              <section className="admin-promotion-modal__editor-sheet admin-promotion-modal__editor-sheet--compact">
                <div className="admin-promotion-modal__editor-head">
                  <div>
                    <h4>{editorTitleLabel}</h4>
                  </div>

                  <button className="admin-promotion-modal__editor-close" type="button" onClick={closeEditor}>
                    Đóng
                  </button>
                </div>

                {formError ? <p className="admin-promotion-modal__editor-error">{formError}</p> : null}

                <form
                  className="admin-promotion-modal__editor-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleEditorPrimaryAction();
                  }}
                >
                  <div className="admin-promotion-modal__editor-grid">
                    <label>
                      <span>Mã ưu đãi</span>
                      <input
                        className="admin-promotion-modal__input--code"
                        type="text"
                        value={promotionForm.code}
                        onChange={(event) => updateField('code', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="VD: SALE20"
                      />
                    </label>

                    <label>
                      <span>Tên chương trình</span>
                      <input
                        type="text"
                        value={promotionForm.title}
                        onChange={(event) => updateField('title', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="VD: KHUYENMAI02"
                      />
                    </label>

                    <label>
                      <span>Loại ưu đãi</span>
                      <select
                        value={promotionForm.discountType}
                        onChange={(event) => updateField('discountType', event.target.value)}
                        disabled={editorReadOnly}
                      >
                        {DISCOUNT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {promotionForm.discountType === 'fixed' ? (
                      <label>
                        <span>Số tiền giảm</span>
                        <input
                          type="number"
                          min="1"
                          value={promotionForm.discountAmount}
                          onChange={(event) => updateField('discountAmount', event.target.value)}
                          disabled={editorReadOnly}
                          placeholder="VD: 50000"
                        />
                      </label>
                    ) : (
                      <>
                        <label>
                          <span>Phần trăm giảm (%)</span>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={promotionForm.discountPercent}
                            onChange={(event) => updateField('discountPercent', event.target.value)}
                            disabled={editorReadOnly}
                            placeholder="VD: 20"
                          />
                        </label>

                        <label>
                          <span>Giảm tối đa</span>
                          <input
                            type="number"
                            min="0"
                            value={promotionForm.maxAmount}
                            onChange={(event) => updateField('maxAmount', event.target.value)}
                            disabled={editorReadOnly}
                            placeholder="VD: 50000"
                          />
                        </label>
                      </>
                    )}

                    <label>
                      <span>Đơn tối thiểu</span>
                      <input
                        type="number"
                        min="0"
                        value={promotionForm.minOrderAmount}
                        onChange={(event) => updateField('minOrderAmount', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="VD: 20000"
                      />
                    </label>

                    <label>
                      <span>Ngày bắt đầu</span>
                      <DatePicker
                        selected={parseDateForPicker(promotionForm.startsAt)}
                        onChange={(selectedDate) => updateField('startsAt', formatDateForPayload(selectedDate))}
                        locale="vi-VN"
                        dateFormat="dd/MM/yyyy"
                        placeholderText="dd/mm/yyyy"
                        showMonthDropdown
                        showYearDropdown
                        dropdownMode="select"
                        className="admin-user-modal__date-input"
                        calendarClassName="admin-user-modal__date-calendar"
                        disabled={editorReadOnly}
                      />
                    </label>

                    <label>
                      <span>Ngày kết thúc</span>
                      <DatePicker
                        selected={parseDateForPicker(promotionForm.expiresAt)}
                        onChange={(selectedDate) => updateField('expiresAt', formatDateForPayload(selectedDate))}
                        locale="vi-VN"
                        dateFormat="dd/MM/yyyy"
                        placeholderText="dd/mm/yyyy"
                        showMonthDropdown
                        showYearDropdown
                        dropdownMode="select"
                        className="admin-user-modal__date-input"
                        calendarClassName="admin-user-modal__date-calendar"
                        disabled={editorReadOnly}
                      />
                    </label>

                    <label>
                      <span>Hiển thị</span>
                      <select
                        value={promotionForm.visibility}
                        onChange={(event) => updateField('visibility', event.target.value)}
                        disabled={editorReadOnly}
                      >
                        {VISIBILITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Đối tượng</span>
                      <select
                        value={promotionForm.audience ?? 'customer'}
                        onChange={(event) => updateField('audience', event.target.value)}
                        disabled={editorReadOnly}
                      >
                        <option value="all">Tất cả</option>
                        <option value="customer">Khách hàng</option>
                        <option value="driver">Tài xế</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>

                    <label>
                      <span>Giới hạn lượt dùng</span>
                      <input
                        type="number"
                        min="0"
                        value={promotionForm.usageLimit}
                        onChange={(event) => updateField('usageLimit', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="VD: 100"
                      />
                    </label>

                    <label className="is-wide">
                      <span>Mô tả</span>
                      <textarea
                        value={promotionForm.description}
                        onChange={(event) => updateField('description', event.target.value)}
                        disabled={editorReadOnly}
                        rows={4}
                        placeholder="Mô tả chi tiết chương trình"
                      />
                    </label>
                  </div>

                  <div className="admin-promotion-modal__editor-actions">
                    <button
                      className={classNames(
                        'admin-promotion-modal__editor-button',
                        editorMode === 'view'
                          ? 'admin-promotion-modal__editor-button--neutral'
                          : 'admin-promotion-modal__editor-button--danger',
                      )}
                      type="button"
                      onClick={closeEditor}
                    >
                      {editorSecondaryLabel}
                    </button>

                    <button
                      className="admin-promotion-modal__editor-button admin-promotion-modal__editor-button--primary"
                      type={editorMode === 'view' ? 'button' : 'submit'}
                      onClick={editorMode === 'view' ? () => setEditorMode('edit') : undefined}
                    >
                      {editorPrimaryLabel}
                    </button>
                  </div>
                </form>
              </section>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={Boolean(deleteTargetPromotion)}
        title="Xóa mã ưu đãi"
        description={
          deleteTargetPromotion
            ? `Bạn có chắc muốn xóa mã ưu đãi ${deleteTargetPromotion.code}?`
            : 'Bạn có chắc muốn xóa mã ưu đãi này?'
        }
        confirmLabel={actionLoadingPromotionId === String(deleteTargetPromotion?.id ?? '') ? 'Đang xóa...' : 'Xóa'}
        cancelLabel="Hủy"
        confirmTone="danger"
        busy={actionLoadingPromotionId === String(deleteTargetPromotion?.id ?? '')}
        onCancel={cancelDeletePromotion}
        onConfirm={confirmDeletePromotion}
        ariaLabel="Xác nhận xóa mã ưu đãi"
      />
    </div>,
    document.body,
  );
}