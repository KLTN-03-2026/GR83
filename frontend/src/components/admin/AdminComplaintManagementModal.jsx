import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closeIcon } from '../../assets/icons';
import { adminComplaintService } from '../../services/adminComplaintService';
import { connectRideEventStream } from '../../services/rideRealtimeService';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'processing', label: 'Đang xử lí' },
  { value: 'resolved', label: 'Đã giải quyết' },
];

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function formatReporter(item) {
  const label = normalizeText(item?.reporterRoleLabel) || 'Người dùng';
  return label;
}

function formatStatusLabel(status) {
  return String(status ?? '').trim().toLowerCase() === 'resolved' ? 'Đã giải quyết' : 'Đang xử lí';
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

function ContactCard({ title, name, phone }) {
  return (
    <article className="admin-complaint-detail__contact-card">
      <span>{title}</span>
      <strong>{name || 'Đang cập nhật'}</strong>
      <small>{phone || '--'}</small>
    </article>
  );
}

export default function AdminComplaintManagementModal({ open = false, onClose, accountId = '', onNotify }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailItem, setDetailItem] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [formStatus, setFormStatus] = useState('processing');
  const [formReply, setFormReply] = useState('');
  const listAbortRef = useRef(null);

  const fetchComplaintList = useCallback(({ silent = false } = {}) => {
    if (listAbortRef.current) {
      listAbortRef.current.abort();
    }

    const controller = new AbortController();
    listAbortRef.current = controller;

    if (!silent) {
      setLoading(true);
      setError('');
    }

    adminComplaintService
      .listComplaints({ status: statusFilter, keyword, limit: 60 }, { signal: controller.signal })
      .then((response) => {
        const nextItems = Array.isArray(response?.items) ? response.items : [];
        setItems(nextItems);
      })
      .catch((loadError) => {
        if (loadError?.name === 'AbortError') {
          return;
        }

        if (!silent) {
          setItems([]);
          setError(loadError?.message || 'Không thể tải danh sách khiếu nại.');
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
  }, [keyword, statusFilter]);

  useEffect(() => {
    if (!open) {
      return;
    }

    fetchComplaintList();

    return () => {
      if (listAbortRef.current) {
        listAbortRef.current.abort();
      }
    };
  }, [fetchComplaintList, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const normalizedAccountId = String(accountId ?? '').trim();

    if (!normalizedAccountId) {
      return undefined;
    }

    const disconnect = connectRideEventStream({
      accountId: normalizedAccountId,
      roleCode: 'Q1',
      onEvent: (eventPayload) => {
        const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();

        if (eventType !== 'admin.complaint.changed') {
          return;
        }

        const action = String(eventPayload?.action ?? '').trim().toLowerCase();
        const complaintId = Number(eventPayload?.complaintId ?? 0);

        if (action === 'created') {
          onNotify?.('Có khiếu nại mới cần xử lý.', 'info', 2200);
        }

        fetchComplaintList({ silent: true });

        if (detailOpen && detailItem?.id && complaintId > 0 && complaintId === Number(detailItem.id)) {
          adminComplaintService.getComplaintDetail(complaintId).then((response) => {
            const item = response?.item ?? null;

            if (!item) {
              return;
            }

            setDetailItem(item);
            setFormStatus(String(item?.status ?? 'processing').toLowerCase() === 'resolved' ? 'resolved' : 'processing');
            setFormReply(item?.adminReply || 'SmartRide cảm ơn bạn đã báo cáo!');
          }).catch(() => {
            // Ignore transient realtime detail refresh errors.
          });
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [accountId, detailItem?.id, detailOpen, fetchComplaintList, onNotify, open]);

  useEffect(() => {
    if (!open) {
      setStatusFilter('all');
      setKeyword('');
      setError('');
      setItems([]);
      if (listAbortRef.current) {
        listAbortRef.current.abort();
      }
      setDetailOpen(false);
      setDetailItem(null);
      setDetailError('');
      setFormStatus('processing');
      setFormReply('');
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    return items;
  }, [items]);

  const openDetail = async (complaintId) => {
    if (!complaintId) {
      return;
    }

    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setDetailItem(null);

    try {
      const response = await adminComplaintService.getComplaintDetail(complaintId);
      const item = response?.item ?? null;
      setDetailItem(item);
      setFormStatus(String(item?.status ?? 'processing').toLowerCase() === 'resolved' ? 'resolved' : 'processing');
      setFormReply(item?.adminReply || 'SmartRide cảm ơn bạn đã báo cáo!');
    } catch (loadError) {
      setDetailError(loadError?.message || 'Không thể tải chi tiết khiếu nại.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!detailItem?.id || saveLoading) {
      return;
    }

    if (normalizeText(formReply).length < 5) {
      setDetailError('Vui lòng nhập phản hồi tối thiểu 5 ký tự.');
      return;
    }

    setSaveLoading(true);
    setDetailError('');

    try {
      const response = await adminComplaintService.updateComplaint(detailItem.id, {
        status: formStatus,
        adminReply: normalizeText(formReply),
        handledByAccountId: normalizeText(accountId) || 'Q1_ADMIN',
      });
      const updated = response?.item ?? null;
      setDetailItem(updated);
      setItems((currentItems) => currentItems.map((item) => (item.id === updated?.id ? updated : item)));
      onNotify?.('Đã cập nhật trạng thái khiếu nại.', 'success', 2200);
      setDetailOpen(false);
    } catch (saveError) {
      setDetailError(saveError?.message || 'Không thể cập nhật khiếu nại.');
    } finally {
      setSaveLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="admin-complaint-modal" role="dialog" aria-modal="true" aria-label="Xử lí khiếu nại">
      <div className="admin-complaint-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="admin-complaint-modal__window" onClick={(event) => event.stopPropagation()}>
        <header className="admin-complaint-modal__header">
          <h2>Xử lí khiếu nại</h2>
          <button type="button" onClick={onClose} aria-label="Đóng">
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </header>

        <div className="admin-complaint-modal__toolbar">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>

          <label>
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm kiếm"
            />
          </label>
        </div>

        <div className="admin-complaint-modal__table-wrap">
          <table className="admin-complaint-modal__table">
            <thead>
              <tr>
                <th>Mã khiếu nại</th>
                <th>Mã chuyến</th>
                <th>Người gửi</th>
                <th>Nội dung khiếu nại</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="admin-complaint-modal__empty">Đang tải dữ liệu...</td>
                </tr>
              ) : null}

              {!loading && error ? (
                <tr>
                  <td colSpan={6} className="admin-complaint-modal__empty admin-complaint-modal__empty--error">{error}</td>
                </tr>
              ) : null}

              {!loading && !error && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-complaint-modal__empty">Chưa có khiếu nại phù hợp.</td>
                </tr>
              ) : null}

              {!loading && !error
                ? filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.bookingCode || '--'}</td>
                    <td>{formatReporter(item)}</td>
                    <td>{item.description || '--'}</td>
                    <td>
                      <span className={`admin-complaint-modal__status is-${item.status === 'resolved' ? 'resolved' : 'processing'}`}>
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>
                    <td>
                      <button type="button" onClick={() => openDetail(item.id)}>Xem</button>
                    </td>
                  </tr>
                ))
                : null}
            </tbody>
          </table>
        </div>

        {detailOpen ? (
          <div className="admin-complaint-detail" role="dialog" aria-modal="true" aria-label="Chi tiết khiếu nại">
            <div className="admin-complaint-detail__backdrop" onClick={() => setDetailOpen(false)} aria-hidden="true" />
            <div className="admin-complaint-detail__window" onClick={(event) => event.stopPropagation()}>
              <header className="admin-complaint-detail__header">
                <h3>Chi tiết khiếu nại</h3>
              </header>

              {detailLoading ? <p className="admin-complaint-detail__state">Đang tải chi tiết...</p> : null}

              {!detailLoading && detailItem ? (
                <>
                  <section className="admin-complaint-detail__meta-grid">
                    <article>
                      <span>Mã khiếu nại</span>
                      <strong>{detailItem.id}</strong>
                    </article>
                    <article>
                      <span>Mã chuyến</span>
                      <strong>{detailItem.bookingCode || '--'}</strong>
                    </article>
                    <article>
                      <span>Người gửi</span>
                      <strong>{detailItem.reporterRoleLabel || 'Người dùng'}</strong>
                    </article>
                  </section>

                  <h4>Thông tin liên quan</h4>

                  <section className="admin-complaint-detail__contact-grid">
                    <ContactCard title="Người dùng" name={detailItem.customerName} phone={detailItem.customerPhone} />
                    <ContactCard title="Tài xế" name={detailItem.driverName} phone={detailItem.driverPhone} />
                  </section>

                  <section className="admin-complaint-detail__content-grid">
                    <div>
                      <h4>Nội dung khiếu nại:</h4>
                      <div className="admin-complaint-detail__box">{detailItem.description || '--'}</div>
                    </div>

                    <div>
                      <h4>Phản hồi của Admin:</h4>
                      <textarea
                        rows={5}
                        value={formReply}
                        onChange={(event) => setFormReply(event.target.value)}
                        placeholder="Nhập nội dung phản hồi ..."
                        disabled={saveLoading}
                      />
                    </div>
                  </section>

                  <section className="admin-complaint-detail__status-row">
                    <label>
                      <input
                        type="radio"
                        name="complaint-status"
                        value="processing"
                        checked={formStatus === 'processing'}
                        onChange={(event) => setFormStatus(event.target.value)}
                        disabled={saveLoading}
                      />
                      Đang xử lí
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="complaint-status"
                        value="resolved"
                        checked={formStatus === 'resolved'}
                        onChange={(event) => setFormStatus(event.target.value)}
                        disabled={saveLoading}
                      />
                      Đã giải quyết
                    </label>
                  </section>

                  <section className="admin-complaint-detail__footer">
                    <small>Cập nhật gần nhất: {formatDateTime(detailItem.updatedAt || detailItem.createdAt)}</small>
                    <div>
                      <button type="button" onClick={() => setDetailOpen(false)} disabled={saveLoading}>Hủy</button>
                      <button type="button" onClick={handleSaveDetail} disabled={saveLoading}>
                        {saveLoading ? 'Đang cập nhật...' : 'Cập nhật'}
                      </button>
                    </div>
                  </section>
                </>
              ) : null}

              {!detailLoading && detailError ? <p className="admin-complaint-detail__state admin-complaint-detail__state--error">{detailError}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
