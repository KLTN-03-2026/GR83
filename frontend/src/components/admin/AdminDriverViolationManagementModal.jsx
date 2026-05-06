import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeIcon } from '../../assets/icons';
import { adminDriverViolationService } from '../../services/adminDriverViolationService';
import { connectRideEventStream } from '../../services/rideRealtimeService';

const VIOLATION_REFRESH_INTERVAL_MS = 12000;

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Chưa xử lí' },
  { value: 'resolved', label: 'Đã xử lí' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'Loại vi phạm' },
  { value: 'cancel-trip', label: 'Hủy chuyến' },
  { value: 'driver-attitude', label: 'Thái độ' },
  { value: 'unsafe-driving', label: 'Vi phạm tốc độ' },
  { value: 'fraud-risk', label: 'Gian lận' },
  { value: 'other', label: 'Khác' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Nhẹ' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'high', label: 'Nặng' },
];

const ACTION_OPTIONS = [
  { value: 'warning', label: 'Cảnh cáo' },
  { value: 'suspend-3-days', label: 'Tạm ngưng 3 ngày' },
  { value: 'permanent-lock', label: 'Khóa vĩnh viễn' },
];

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminDriverViolationManagementModal({ open = false, onClose, accountId = '', onNotify }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailItem, setDetailItem] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [formSeverity, setFormSeverity] = useState('medium');
  const [formAction, setFormAction] = useState('warning');
  const [formNote, setFormNote] = useState('');
  const listAbortRef = useRef(null);
  const detailAbortRef = useRef(null);

  const loadViolationDetail = useCallback(async (violationId, { retries = 1 } = {}) => {
    if (!violationId) {
      return null;
    }

    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
    }

    const controller = new AbortController();
    detailAbortRef.current = controller;

    const loadOnce = async () => {
      const response = await adminDriverViolationService.getViolationDetail(violationId, { signal: controller.signal });
      return response?.item ?? null;
    };

    try {
      return await loadOnce();
    } catch (error) {
      if (error?.name === 'AbortError' || retries <= 0) {
        throw error;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 220);
      });

      return loadViolationDetail(violationId, { retries: retries - 1 });
    } finally {
      if (detailAbortRef.current === controller) {
        detailAbortRef.current = null;
      }
    }
  }, []);

  const fetchViolations = useCallback(({ silent = false } = {}) => {
    if (listAbortRef.current) {
      listAbortRef.current.abort();
    }

    const controller = new AbortController();
    listAbortRef.current = controller;

    if (!silent) {
      setLoading(true);
      setError('');
    }

    adminDriverViolationService
      .listViolations({ status: statusFilter, violationType: typeFilter, keyword, limit: 80 }, { signal: controller.signal })
      .then((response) => {
        setItems(Array.isArray(response?.items) ? response.items : []);
        setSummary(response?.summary ?? null);
      })
      .catch((loadError) => {
        if (loadError?.name === 'AbortError') {
          return;
        }

        if (!silent) {
          setItems([]);
          setSummary(null);
          setError(loadError?.message || 'Không thể tải danh sách vi phạm tài xế.');
        }
      })
      .finally(() => {
        if (listAbortRef.current === controller) {
          listAbortRef.current = null;
        }

        if (!silent && !controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, [keyword, statusFilter, typeFilter]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    fetchViolations();

    const refreshTimerId = window.setInterval(() => {
      fetchViolations({ silent: true });
    }, VIOLATION_REFRESH_INTERVAL_MS);

    // Trigger one extra silent refresh shortly after open to avoid transient first-open empty state.
    const warmupTimerId = window.setTimeout(() => {
      fetchViolations({ silent: true });
    }, 450);

    return () => {
      clearInterval(refreshTimerId);
      clearTimeout(warmupTimerId);

      if (listAbortRef.current) {
        listAbortRef.current.abort();
      }

      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
      }
    };
  }, [fetchViolations, open]);

  useEffect(() => {
    if (!open || !normalizeText(accountId)) {
      return undefined;
    }

    const disconnect = connectRideEventStream({
      accountId: normalizeText(accountId),
      roleCode: 'Q1',
      onEvent: (eventPayload) => {
        const eventType = normalizeText(eventPayload?.type).toLowerCase();

        if (eventType !== 'admin.driver-violation.changed') {
          return;
        }

        if (normalizeText(eventPayload?.action).toLowerCase() === 'created') {
          onNotify?.('Hệ thống vừa phát hiện thêm vi phạm tài xế mới.', 'info', 2400);
        }

        fetchViolations({ silent: true });

        if (detailOpen && Number(eventPayload?.violationId ?? 0) === Number(detailItem?.id ?? 0)) {
          loadViolationDetail(detailItem.id, { retries: 0 }).then((item) => {
            if (!item) {
              return;
            }

            setDetailItem(item);
            setFormSeverity(item?.severity || 'medium');
            setFormAction(item?.resolutionAction || 'warning');
            setFormNote(item?.adminNote || '');
          }).catch(() => {
            // Ignore transient refresh errors.
          });
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [accountId, detailItem?.id, detailOpen, fetchViolations, loadViolationDetail, onNotify, open]);

  useEffect(() => {
    if (open) {
      return;
    }

    setTypeFilter('all');
    setStatusFilter('all');
    setKeyword('');
    setLoading(false);
    setError('');
    setItems([]);
    setSummary(null);
    setDetailOpen(false);
    setDetailLoading(false);
    setDetailError('');
    setDetailItem(null);
    setSaveLoading(false);
    setFormSeverity('medium');
    setFormAction('warning');
    setFormNote('');
  }, [open]);

  const openDetail = async (violationTarget) => {
    const violationId = Number(
      typeof violationTarget === 'object' && violationTarget !== null
        ? violationTarget.id
        : violationTarget,
    );

    if (!Number.isFinite(violationId) || violationId <= 0) {
      return;
    }

    const previewItem = typeof violationTarget === 'object' && violationTarget !== null ? violationTarget : null;

    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setDetailItem(previewItem);

    if (previewItem) {
      setFormSeverity(previewItem?.severity || 'medium');
      setFormAction(previewItem?.resolutionAction || 'warning');
      setFormNote(previewItem?.adminNote || '');
    }

    try {
      const item = await loadViolationDetail(violationId, { retries: 1 });
      setDetailItem(item);
      setFormSeverity(item?.severity || 'medium');
      setFormAction(item?.resolutionAction || 'warning');
      setFormNote(item?.adminNote || '');
    } catch (loadError) {
      if (loadError?.name === 'AbortError') {
        return;
      }

      setDetailError(loadError?.message || 'Không thể tải chi tiết vi phạm.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSave = async () => {
    if (!detailItem?.id || saveLoading) {
      return;
    }

    setSaveLoading(true);
    setDetailError('');

    try {
      const response = await adminDriverViolationService.updateViolation(detailItem.id, {
        severity: formSeverity,
        status: 'resolved',
        resolutionAction: formAction,
        adminNote: normalizeText(formNote),
        handledByAccountId: normalizeText(accountId) || 'Q1_ADMIN',
      });
      const updated = response?.item ?? null;
      setDetailItem(updated);
      setItems((currentItems) => currentItems.map((item) => (item.id === updated?.id ? updated : item)));
      fetchViolations({ silent: true });
      onNotify?.('Đã cập nhật biên bản vi phạm tài xế.', 'success', 2200);
      setDetailOpen(false);
    } catch (saveError) {
      setDetailError(saveError?.message || 'Không thể cập nhật vi phạm.');
    } finally {
      setSaveLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="admin-driver-violation-modal" role="dialog" aria-modal="true" aria-label="Xử lí vi phạm tài xế">
      <div className="admin-driver-violation-modal__backdrop" onClick={onClose} aria-hidden="true" />

      <div className="admin-driver-violation-modal__window" onClick={(event) => event.stopPropagation()}>
        <header className="admin-driver-violation-modal__header">
          <div className="admin-driver-violation-modal__header-copy">
            <p className="admin-driver-violation-modal__eyebrow">Kiểm soát nội bộ</p>
            <h2>Xử lí vi phạm</h2>
            <p>Hệ thống tự quét dữ liệu chuyến đi, đánh giá và phản ánh để tạo danh sách vi phạm tài xế cho admin xử lí.</p>
          </div>

          <div className="admin-driver-violation-modal__header-stats" aria-label="Thống kê vi phạm tài xế">
            <article className="admin-driver-violation-modal__stat-card">
              <strong>{Number(summary?.totalCount ?? 0)}</strong>
              <span>Tổng vi phạm</span>
            </article>
            <article className="admin-driver-violation-modal__stat-card">
              <strong>{Number(summary?.pendingCount ?? 0)}</strong>
              <span>Chưa xử lí</span>
            </article>
            <article className="admin-driver-violation-modal__stat-card">
              <strong>{Number(summary?.resolvedCount ?? 0)}</strong>
              <span>Đã xử lí</span>
            </article>
          </div>

          <button type="button" className="admin-driver-violation-modal__close" onClick={onClose} aria-label="Đóng">
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </header>

        <div className="admin-driver-violation-modal__toolbar">
          <label className="admin-driver-violation-modal__field">
            <span>Loại vi phạm</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="admin-driver-violation-modal__field">
            <span>Trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="admin-driver-violation-modal__field admin-driver-violation-modal__field--search">
            <span>Tìm kiếm</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tài xế, mã chuyến, mô tả..."
            />
          </label>
        </div>

        <div className="admin-driver-violation-modal__table-wrap">
          <table className="admin-driver-violation-modal__table">
            <thead>
              <tr>
                <th>Mã VP</th>
                <th>Tài xế</th>
                <th>Mã chuyến</th>
                <th>Loại vi phạm</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="admin-driver-violation-modal__empty-row">Đang tải dữ liệu...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="admin-driver-violation-modal__empty-row admin-driver-violation-modal__empty-row--error">{error}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-driver-violation-modal__empty-row">Chưa phát hiện vi phạm phù hợp.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>VP{String(item.id).padStart(4, '0')}</td>
                    <td>
                      <strong>{item.driverName || '--'}</strong>
                      <small>{item.driverPhone || '--'}</small>
                    </td>
                    <td>{item.bookingCode || '--'}</td>
                    <td>
                      <strong className={`admin-driver-violation-modal__type is-${item.violationTone || 'neutral'}`}>{item.violationLabel}</strong>
                      <small>{item.sourceLabel || 'Hệ thống'}</small>
                    </td>
                    <td>
                      <span className={`admin-driver-violation-modal__status is-${item.status || 'pending'}`}>
                        <span className="admin-driver-violation-modal__status-dot" aria-hidden="true" />
                        {item.statusLabel}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="admin-driver-violation-modal__action" onClick={() => openDetail(item)}>
                        Xem
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailOpen ? (
        <div className="admin-driver-violation-detail" role="dialog" aria-modal="true" aria-label="Chi tiết vi phạm tài xế">
          <div className="admin-driver-violation-detail__backdrop" onClick={() => setDetailOpen(false)} aria-hidden="true" />

          <div className="admin-driver-violation-detail__sheet" onClick={(event) => event.stopPropagation()}>
            <header className="admin-driver-violation-detail__header">
              <div>
                <h3>Xử lí vi phạm</h3>
                <p>{detailItem?.violationLabel || 'Biên bản vi phạm tài xế'}</p>
              </div>

              <button type="button" onClick={() => setDetailOpen(false)} aria-label="Đóng chi tiết">
                <img src={closeIcon} alt="" aria-hidden="true" />
              </button>
            </header>

            {detailLoading ? <p className="admin-driver-violation-detail__state">Đang tải chi tiết...</p> : null}
            {!detailLoading && detailError ? <p className="admin-driver-violation-detail__state admin-driver-violation-detail__state--error">{detailError}</p> : null}

            {!detailLoading && detailItem ? (
              <>
                <section className="admin-driver-violation-detail__info-grid">
                  <div><span>Tài xế</span><strong>{detailItem.driverName || '--'}</strong></div>
                  <div><span>Mã chuyến</span><strong>{detailItem.bookingCode || '--'}</strong></div>
                  <div><span>Loại vi phạm</span><strong>{detailItem.violationLabel || '--'}</strong></div>
                  <div><span>Phát hiện lúc</span><strong>{formatDateTime(detailItem.detectedAt)}</strong></div>
                </section>

                <section className="admin-driver-violation-detail__description">
                  <span>Mô tả vi phạm</span>
                  <div>{detailItem.description || '--'}</div>
                </section>

                <section className="admin-driver-violation-detail__group">
                  <strong>Mức độ</strong>
                  <div className="admin-driver-violation-detail__choice-grid">
                    {SEVERITY_OPTIONS.map((option) => (
                      <label key={option.value} className="admin-driver-violation-detail__choice">
                        <input
                          type="radio"
                          name="violation-severity"
                          value={option.value}
                          checked={formSeverity === option.value}
                          onChange={(event) => setFormSeverity(event.target.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="admin-driver-violation-detail__group">
                  <strong>Hình thức xử lí</strong>
                  <div className="admin-driver-violation-detail__choice-grid">
                    {ACTION_OPTIONS.map((option) => (
                      <label key={option.value} className="admin-driver-violation-detail__choice">
                        <input
                          type="radio"
                          name="violation-action"
                          value={option.value}
                          checked={formAction === option.value}
                          onChange={(event) => setFormAction(event.target.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <label className="admin-driver-violation-detail__note">
                  <span>Ghi chú admin</span>
                  <textarea
                    rows={4}
                    value={formNote}
                    onChange={(event) => setFormNote(event.target.value)}
                    placeholder="Nhập kết luận xử lí cho tài xế..."
                  />
                </label>

                <footer className="admin-driver-violation-detail__footer">
                  <button type="button" className="admin-driver-violation-detail__button admin-driver-violation-detail__button--ghost" onClick={() => setDetailOpen(false)}>
                    Hủy
                  </button>
                  <button type="button" className="admin-driver-violation-detail__button admin-driver-violation-detail__button--primary" onClick={handleSave} disabled={saveLoading}>
                    {saveLoading ? 'Đang cập nhật...' : 'Cập nhật'}
                  </button>
                </footer>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}