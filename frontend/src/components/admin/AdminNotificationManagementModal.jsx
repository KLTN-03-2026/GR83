import { closeIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';
import { adminNotificationService } from '../../services/adminNotificationService';
import ConfirmDialog from '../ui/ConfirmDialog';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('vi-VN', vi);

const RECIPIENT_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'customer', label: 'Khách hàng' },
  { value: 'driver', label: 'Tài xế' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'scheduled', label: 'Hẹn gửi' },
  { value: 'sent', label: 'Đã gửi' },
];

const STATUS_META = {
  sent: { label: 'Đã gửi', tone: 'sent' },
  scheduled: { label: 'Hẹn gửi', tone: 'scheduled' },
};

function getApiErrorMessage(error, fallbackMessage) {
  const apiMessage = String(error?.body?.message ?? error?.message ?? '').trim();
  return apiMessage || fallbackMessage;
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

function extractNotificationRecord(response, fallbackNotification = null) {
  if (response?.notification && typeof response.notification === 'object') {
    return response.notification;
  }

  if (response?.data?.notification && typeof response.data.notification === 'object') {
    return response.data.notification;
  }

  if (response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return response.data;
  }

  return fallbackNotification;
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

function normalizeRecipient(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'customer' || normalizedValue === 'driver' || normalizedValue === 'all') {
    return normalizedValue;
  }

  return 'customer';
}

function normalizeStatus(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'scheduled' || normalizedValue === 'sent') {
    return normalizedValue;
  }

  return 'scheduled';
}

function normalizeNotification(notification, fallbackId = 0) {
  return {
    id: Number(notification?.id ?? fallbackId) || fallbackId,
    title: String(notification?.title ?? '').trim(),
    recipient: normalizeRecipient(notification?.recipient),
    status: normalizeStatus(notification?.status),
    createdAt: String(notification?.createdAt ?? '').trim(),
    updatedAt: String(notification?.updatedAt ?? '').trim(),
    sendAt: String(notification?.sendAt ?? '').trim(),
    content: String(notification?.content ?? '').trim(),
  };
}

function formatDateTime(value) {
  const date = new Date(value);

  if (!value || !isValid(date)) {
    return '--';
  }

  return format(date, 'dd/MM HH:mm');
}

function formatInputDateTime(value) {
  const date = new Date(value);

  if (!value || !isValid(date)) {
    return '';
  }

  return format(date, "yyyy-MM-dd'T'HH:mm");
}

function formatScheduleDisplay(value) {
  const date = new Date(value);

  if (!value || !isValid(date)) {
    return '';
  }

  return format(date, 'dd/MM/yyyy HH:mm');
}

function parseInputDateTime(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedDate = parse(normalizedValue, "yyyy-MM-dd'T'HH:mm", new Date());

  if (isValid(parsedDate)) {
    return parsedDate;
  }

  const fallbackDate = new Date(normalizedValue);
  return isValid(fallbackDate) ? fallbackDate : null;
}

function resolveNotificationStatus(sendAt, fallbackStatus = 'scheduled') {
  const parsedDate = new Date(sendAt);

  if (!sendAt || !isValid(parsedDate)) {
    return normalizeStatus(fallbackStatus);
  }

  return parsedDate.getTime() <= Date.now() ? 'sent' : 'scheduled';
}

function createEmptyNotificationForm() {
  return {
    title: '',
    recipient: 'customer',
    status: 'scheduled',
    sendAt: '',
    content: '',
  };
}

function buildNotificationForm(notification = null) {
  if (!notification) {
    return createEmptyNotificationForm();
  }

  return {
    title: String(notification.title ?? '').trim(),
    recipient: normalizeRecipient(notification.recipient),
    status: normalizeStatus(notification.status),
    sendAt: formatInputDateTime(notification.sendAt),
    content: String(notification.content ?? '').trim(),
  };
}

function normalizeNotificationForm(form = {}) {
  return {
    title: String(form.title ?? '').trim(),
    recipient: normalizeRecipient(form.recipient),
    status: normalizeStatus(form.status),
    sendAt: String(form.sendAt ?? '').trim(),
    content: String(form.content ?? '').trim(),
  };
}

function hasNotificationFormChanged(currentForm, originalForm) {
  return JSON.stringify(normalizeNotificationForm(currentForm)) !== JSON.stringify(normalizeNotificationForm(originalForm));
}

function getRecipientLabel(value) {
  return RECIPIENT_OPTIONS.find((option) => option.value === value)?.label ?? 'Khách hàng';
}

function getStatusMeta(value) {
  return STATUS_META[normalizeStatus(value)] ?? STATUS_META.scheduled;
}

export default function AdminNotificationManagementModal({ open = false, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [searchTitle, setSearchTitle] = useState('');
  const [recipientFilter, setRecipientFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editorMode, setEditorMode] = useState('none');
  const [editingNotificationId, setEditingNotificationId] = useState('');
  const [notificationForm, setNotificationForm] = useState(createEmptyNotificationForm);
  const [notificationSnapshot, setNotificationSnapshot] = useState(createEmptyNotificationForm);
  const [formError, setFormError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [actionLoadingNotificationId, setActionLoadingNotificationId] = useState('');
  const [notificationDeleteConfirm, setNotificationDeleteConfirm] = useState(null);

  const filterCounts = useMemo(() => {
    const nextCounts = {
      all: notifications.length,
      scheduled: 0,
      sent: 0,
    };

    notifications.forEach((notification) => {
      const status = normalizeStatus(notification.status);
      nextCounts[status] += 1;
    });

    return nextCounts;
  }, [notifications]);

  const isViewMode = editorMode === 'view';
  const isEditMode = editorMode === 'edit';
  const isCreateMode = editorMode === 'create';
  const editorPrimaryLabel = isSaving ? 'Đang lưu...' : isCreateMode ? 'Thêm' : isEditMode ? 'Cập nhật' : 'Sửa';
  const editorSecondaryLabel = isViewMode ? 'Đóng' : 'Hủy';
  const editorSecondaryTone = isViewMode ? 'ghost' : 'danger';
  const editorTitleLabel = isCreateMode ? 'Thêm thông báo' : isEditMode ? 'Sửa thông báo' : 'Chi tiết thông báo';
  const editorDescriptionLabel = isCreateMode
    ? 'Nhập nội dung và chọn người nhận cho thông báo mới.'
    : isEditMode
      ? 'Chỉnh sửa thông tin của thông báo đã chọn.'
      : 'Xem chi tiết thông báo đã chọn.';

  const filteredNotifications = useMemo(() => {
    const normalizedSearchTitle = normalizeToken(searchTitle);

    return notifications.filter((notification) => {
      if (recipientFilter !== 'all' && notification.recipient !== recipientFilter) {
        return false;
      }

      if (statusFilter !== 'all' && notification.status !== statusFilter) {
        return false;
      }

      if (!normalizedSearchTitle) {
        return true;
      }

      const searchableText = normalizeToken(`${notification.title} ${notification.content}`);
      return searchableText.includes(normalizedSearchTitle);
    });
  }, [notifications, recipientFilter, searchTitle, statusFilter]);

  useEffect(() => {
    if (!open) {
      setNotifications([]);
      setSchedulePickerOpen(false);
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
    if (open) {
      const abortController = new AbortController();
      let isActive = true;

      setIsLoading(true);
      setLoadError('');

      adminNotificationService
        .listNotifications({}, { signal: abortController.signal })
        .then((response) => {
          if (!isActive) {
            return;
          }

          const nextNotifications = extractNotificationList(response).map((item, index) => normalizeNotification(item, index + 1));
          setNotifications(nextNotifications);
        })
        .catch((error) => {
          if (!isActive || error?.name === 'AbortError') {
            return;
          }

          setNotifications([]);
          setLoadError(getApiErrorMessage(error, 'Không thể tải danh sách thông báo lúc này.'));
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
    }

    setSearchTitle('');
    setRecipientFilter('all');
    setStatusFilter('all');
    setEditorMode('none');
    setEditingNotificationId('');
    setNotificationForm(createEmptyNotificationForm());
    setNotificationSnapshot(createEmptyNotificationForm());
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setIsLoading(false);
    setIsSaving(false);
    setSchedulePickerOpen(false);
    setActionLoadingNotificationId('');
    setNotificationDeleteConfirm(null);
    setNotifications([]);
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
    setEditorMode('create');
    setEditingNotificationId('');
    setNotificationForm(createEmptyNotificationForm());
    setNotificationSnapshot(createEmptyNotificationForm());
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setSchedulePickerOpen(false);
    setNotificationDeleteConfirm(null);
  };

  const openViewForm = (notification) => {
    setEditorMode('view');
    setEditingNotificationId(String(notification.id));
    const nextForm = buildNotificationForm(notification);

    setNotificationForm(nextForm);
    setNotificationSnapshot(nextForm);
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setSchedulePickerOpen(false);
    setNotificationDeleteConfirm(null);
  };

  const openEditForm = (notification) => {
    setEditorMode('edit');
    setEditingNotificationId(String(notification.id));
    const nextForm = buildNotificationForm(notification);

    setNotificationForm(nextForm);
    setNotificationSnapshot(nextForm);
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setSchedulePickerOpen(false);
    setNotificationDeleteConfirm(null);
  };

  const closeEditor = () => {
    setEditorMode('none');
    setEditingNotificationId('');
    setNotificationForm(createEmptyNotificationForm());
    setNotificationSnapshot(createEmptyNotificationForm());
    setFormError('');
    setIsSaving(false);
    setSchedulePickerOpen(false);
    setActionLoadingNotificationId('');
    setNotificationDeleteConfirm(null);
  };

  const updateField = (field, value) => {
    setNotificationForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'sendAt' ? { status: resolveNotificationStatus(value, current.status) } : {}),
    }));
  };

  const handleDeleteNotification = async (notification) => {
    const notificationId = String(notification.id);

    if (normalizeStatus(notification.status) !== 'scheduled') {
      setFeedbackMessage('Chỉ có thể xóa thông báo hẹn gửi.');
      return;
    }

    setNotificationDeleteConfirm({
      notificationId,
      notificationTitle: String(notification.title ?? '').trim() || 'thông báo này',
    });
  };

  const confirmDeleteNotification = async () => {
    if (!notificationDeleteConfirm) {
      return;
    }

    const { notificationId, notificationTitle } = notificationDeleteConfirm;
    setNotificationDeleteConfirm(null);
    setActionLoadingNotificationId(notificationId);

    try {
      await adminNotificationService.deleteNotification(notificationId);

      setNotifications((current) => current.filter((item) => String(item.id) !== notificationId));
      setFeedbackMessage('Đã xóa thông báo hẹn gửi.');

      if (String(editingNotificationId) === notificationId) {
        closeEditor();
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      setFeedbackMessage(getApiErrorMessage(error, 'Không thể xóa thông báo lúc này.'));
    } finally {
      setActionLoadingNotificationId('');
    }
  };

  const cancelDeleteNotificationConfirm = () => {
    setNotificationDeleteConfirm(null);
  };

  const handleStartEditingNotification = (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    setEditorMode('edit');
    setFormError('');
    setFeedbackMessage('');
    setLoadError('');
    setSchedulePickerOpen(false);
  };

  const handleEditorPrimaryAction = async () => {
    if (editorMode === 'view') {
      handleStartEditingNotification();
      return;
    }

    const normalizedTitle = String(notificationForm.title ?? '').trim();
    const normalizedContent = String(notificationForm.content ?? '').trim();
    const normalizedSendAt = String(notificationForm.sendAt ?? '').trim();

    if (!normalizedTitle || !normalizedContent) {
      setFormError('Vui lòng nhập tiêu đề và nội dung thông báo.');
      return;
    }

    if (!normalizedSendAt) {
      setFormError('Vui lòng chọn thời gian gửi.');
      return;
    }

    if (editorMode === 'edit' && !hasNotificationFormChanged(notificationForm, notificationSnapshot)) {
      setFormError('Thông tin chưa thay đổi. Hãy chỉnh sửa trước khi Cập nhật.');
      return;
    }

    const resolvedSendAt = normalizedSendAt;
    const resolvedStatus = resolveNotificationStatus(resolvedSendAt, notificationForm.status);
    const nextNotification = {
      title: normalizedTitle,
      recipient: normalizeRecipient(notificationForm.recipient),
      status: resolvedStatus,
      sendAt: resolvedSendAt,
      content: normalizedContent,
    };

    setIsSaving(true);
    setFormError('');

    try {
      if (editorMode === 'create') {
        const response = await adminNotificationService.createNotification(nextNotification);
        const createdNotification = normalizeNotification(
          extractNotificationRecord(response, nextNotification),
          Number(extractNotificationRecord(response, nextNotification)?.id ?? notifications.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1),
        );

        setNotifications((current) => [createdNotification, ...current]);
        setFeedbackMessage('Đã tạo thông báo mới.');
      } else {
        const response = await adminNotificationService.updateNotification(editingNotificationId, nextNotification);
        const updatedNotification = normalizeNotification(
          extractNotificationRecord(response, { ...nextNotification, id: editingNotificationId }),
          Number(editingNotificationId) || 0,
        );

        setNotifications((current) =>
          current.map((notification) =>
            String(notification.id) === String(editingNotificationId) ? updatedNotification : notification,
          ),
        );
        setFeedbackMessage('Đã lưu thay đổi thông báo.');
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
            ? 'Không thể tạo thông báo lúc này.'
            : 'Không thể lưu thông báo lúc này.',
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currentEditorTitle =
    editorMode === 'create'
      ? 'Tạo thông báo mới'
      : editorMode === 'edit'
        ? 'Chỉnh sửa thông báo'
        : 'Chi tiết thông báo';
  const editorReadOnly = isViewMode || isSaving;

  return createPortal(
    <div className="admin-notification-modal" role="dialog" aria-modal="true" aria-label="Quản lý thông báo">
      <div className="admin-notification-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="admin-notification-modal__window">
        <button className="admin-notification-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng">
          <img className="admin-notification-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="admin-notification-modal__header">
          <div className="admin-notification-modal__header-copy">
            <p className="admin-notification-modal__eyebrow">ADMIN / THÔNG BÁO</p>
            <h3>QUẢN LÝ THÔNG BÁO</h3>
            <p>
              Quản lý toàn bộ thông báo đã gửi và hẹn gửi cho khách hàng và tài xế trong cùng một màn hình.
            </p>
          </div>

          <div className="admin-notification-modal__header-stats" aria-label="Thống kê thông báo">
            <div className="admin-notification-modal__stat-card">
              <strong>{filterCounts.all}</strong>
              <span>Tổng thông báo</span>
            </div>

            <div className="admin-notification-modal__stat-card">
              <strong>{filterCounts.scheduled}</strong>
              <span>Hẹn gửi</span>
            </div>

            <div className="admin-notification-modal__stat-card">
              <strong>{filterCounts.sent}</strong>
              <span>Đã gửi</span>
            </div>
          </div>
        </header>

        <div className="admin-notification-modal__toolbar" role="search" aria-label="Bộ lọc thông báo">
          <label className="admin-notification-modal__field admin-notification-modal__field--search">
            <span className="admin-notification-modal__sr-only">Tìm theo tiêu đề hoặc nội dung</span>
            <input
              type="search"
              value={searchTitle}
              onChange={(event) => setSearchTitle(event.target.value)}
              placeholder="Tiêu đề thông báo"
            />
          </label>

          <label className="admin-notification-modal__field">
            <span className="admin-notification-modal__sr-only">Người nhận</span>
            <select value={recipientFilter} onChange={(event) => setRecipientFilter(event.target.value)}>
              {RECIPIENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-notification-modal__field">
            <span className="admin-notification-modal__sr-only">Trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="admin-notification-modal__add-button" type="button" onClick={openCreateForm}>
            Thêm thông báo
          </button>
        </div>

        {loadError ? <p className="admin-notification-modal__notice admin-notification-modal__notice--error">{loadError}</p> : null}

        {isLoading ? <p className="admin-notification-modal__notice admin-notification-modal__notice--loading">Đang tải danh sách thông báo...</p> : null}

        {feedbackMessage ? <p className="admin-notification-modal__feedback">{feedbackMessage}</p> : null}

        <div className="admin-notification-modal__table-wrap">
          <table className="admin-notification-modal__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tiêu đề</th>
                <th>Người nhận</th>
                <th>Thời gian tạo</th>
                <th>Thời gian gửi</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>

            <tbody>
              {filteredNotifications.length > 0 ? (
                filteredNotifications.map((notification) => {
                  const statusMeta = getStatusMeta(notification.status);

                  return (
                    <tr key={notification.id}>
                      <td className="admin-notification-modal__id-cell">{notification.id}</td>
                      <td>
                        <div className="admin-notification-modal__title-cell">
                          <strong>{notification.title}</strong>
                        </div>
                      </td>
                      <td>{getRecipientLabel(notification.recipient)}</td>
                      <td>{formatDateTime(notification.createdAt)}</td>
                      <td>{formatDateTime(notification.sendAt)}</td>
                      <td>
                        <span className={classNames('admin-notification-modal__status-badge', `admin-notification-modal__status-badge--${statusMeta.tone}`)}>
                          <span className={classNames('admin-notification-modal__status-dot', `admin-notification-modal__status-dot--${statusMeta.tone}`)} />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="admin-notification-modal__row-actions">
                          <button
                            className="admin-notification-modal__action admin-notification-modal__action--view"
                            type="button"
                            onClick={() => openViewForm(notification)}
                          >
                            Xem
                          </button>
                          <button
                            className="admin-notification-modal__action admin-notification-modal__action--edit"
                            type="button"
                            onClick={() => openEditForm(notification)}
                          >
                            Sửa
                          </button>
                          {normalizeStatus(notification.status) === 'scheduled' ? (
                            <button
                              className="admin-notification-modal__action admin-notification-modal__action--delete"
                              type="button"
                              onClick={() => handleDeleteNotification(notification)}
                              disabled={actionLoadingNotificationId === String(notification.id)}
                            >
                              {actionLoadingNotificationId === String(notification.id) ? 'Đang xóa...' : 'Xóa'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : !isLoading ? (
                <tr>
                  <td className="admin-notification-modal__empty-row" colSpan={7}>
                    Không có thông báo nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="admin-notification-modal__hint">
          Màn hình này quản lý cả thông báo đã gửi và thông báo hẹn gửi cho khách hàng, tài xế hoặc cả hai nhóm.
        </p>
      </section>

      {editorMode !== 'none'
        ? createPortal(
            <div className="admin-notification-modal__editor-overlay" role="dialog" aria-modal="true" aria-label={currentEditorTitle}>
              <div className="admin-notification-modal__editor-backdrop" onClick={closeEditor} aria-hidden="true" />

              <section className="admin-notification-modal__editor-sheet">
                <div className="admin-notification-modal__editor-head">
                  <div>
                    <h4>{editorTitleLabel}</h4>
                    <p>{editorDescriptionLabel}</p>
                  </div>

                  <button className="admin-notification-modal__editor-close" type="button" onClick={closeEditor}>
                    Đóng
                  </button>
                </div>

                {formError ? <p className="admin-notification-modal__editor-error">{formError}</p> : null}

                <form className="admin-notification-modal__editor-form" onSubmit={(event) => {
                  event.preventDefault();
                  handleEditorPrimaryAction();
                }}>
                  <div className="admin-notification-modal__editor-grid">
                    <label>
                      <span>Tiêu đề</span>
                      <input
                        type="text"
                        value={notificationForm.title}
                        onChange={(event) => updateField('title', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="Tiêu đề"
                      />
                    </label>

                    <label>
                      <span>Người nhận</span>
                      <select
                        value={notificationForm.recipient}
                        onChange={(event) => updateField('recipient', event.target.value)}
                        disabled={editorReadOnly}
                      >
                        {RECIPIENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="is-wide">
                      <span>Nội dung</span>
                      <textarea
                        value={notificationForm.content}
                        onChange={(event) => updateField('content', event.target.value)}
                        disabled={editorReadOnly}
                        placeholder="Nội dung"
                        rows={4}
                      />
                    </label>

                    <label className="is-wide admin-notification-modal__schedule-field">
                      <span>Thời gian gửi dự kiến</span>
                      <input
                        type="text"
                        value={formatScheduleDisplay(notificationForm.sendAt)}
                        onClick={() => {
                          if (!editorReadOnly) {
                            setSchedulePickerOpen((current) => !current);
                          }
                        }}
                        onFocus={() => {
                          if (!editorReadOnly) {
                            setSchedulePickerOpen(true);
                          }
                        }}
                        readOnly
                        disabled={editorReadOnly}
                        placeholder="dd/mm/yyyy hh:mm"
                        className="admin-user-modal__date-input admin-notification-modal__schedule-trigger"
                        aria-expanded={schedulePickerOpen}
                        aria-haspopup="dialog"
                      />

                      {schedulePickerOpen && !editorReadOnly ? (
                        <div className="admin-notification-modal__schedule-panel">
                          <DatePicker
                            inline
                            selected={parseInputDateTime(notificationForm.sendAt)}
                            onChange={(selectedDate) => {
                              updateField('sendAt', formatInputDateTime(selectedDate));
                              setSchedulePickerOpen(false);
                            }}
                            locale="vi-VN"
                            dateFormat="dd/MM/yyyy HH:mm"
                            timeFormat="HH:mm"
                            timeIntervals={15}
                            timeCaption="Giờ"
                            showMonthDropdown
                            showYearDropdown
                            dropdownMode="select"
                            showTimeSelect
                            calendarClassName="admin-user-modal__date-calendar admin-notification-modal__date-calendar"
                          />
                        </div>
                      ) : null}
                      <span className="admin-notification-modal__schedule-hint">Chọn ngày và giờ gửi, hệ thống sẽ tự chuyển trạng thái sang Đã gửi khi đến hạn.</span>
                    </label>
                  </div>

                  <div className="admin-notification-modal__editor-actions">
                    <button
                      className={`admin-notification-modal__editor-button admin-notification-modal__editor-button--${editorSecondaryTone}`}
                      type="button"
                      onClick={closeEditor}
                    >
                      {editorSecondaryLabel}
                    </button>

                    <button
                      className="admin-notification-modal__editor-button admin-notification-modal__editor-button--primary"
                      type="button"
                      onClick={isViewMode ? handleStartEditingNotification : handleEditorPrimaryAction}
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
        open={Boolean(notificationDeleteConfirm)}
        title="Xác nhận xóa thông báo"
        description={`Bạn có chắc chắn muốn xóa thông báo hẹn gửi ${notificationDeleteConfirm?.notificationTitle ?? 'này'} không? Hành động này không thể hoàn tác.`}
        confirmLabel={actionLoadingNotificationId === notificationDeleteConfirm?.notificationId ? 'Đang xóa...' : 'Xóa thông báo'}
        cancelLabel="Hủy"
        confirmTone="danger"
        busy={actionLoadingNotificationId === notificationDeleteConfirm?.notificationId}
        onCancel={cancelDeleteNotificationConfirm}
        onConfirm={confirmDeleteNotification}
        ariaLabel="Xác nhận xóa thông báo"
      />
    </div>,
    document.body,
  );
}
