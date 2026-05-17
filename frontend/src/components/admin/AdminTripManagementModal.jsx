import { closeIcon } from '../../assets/icons';
import ConfirmDialog from '../ui/ConfirmDialog';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rideService } from '../../services/rideService';
import { connectRideEventStream } from '../../services/rideRealtimeService';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';

registerLocale('vi-VN', vi);

const TRIP_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'ChoTaiXe', label: 'Chờ tài xế' },
  { value: 'DaNhanChuyen', label: 'Đã nhận chuyến' },
  { value: 'DangDen', label: 'Đang đến' },
  { value: 'DaDon', label: 'Đã đón' },
  { value: 'DangThucHien', label: 'Đang thực hiện' },
  { value: 'HoanThanh', label: 'Hoàn thành' },
  { value: 'DaHuy', label: 'Đã hủy' },
];

const TONE_COLOR = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  neutral: '#6b7280',
  pending: '#a78bfa',
};

function getToneColor(tone) {
  return TONE_COLOR[tone] || TONE_COLOR.neutral;
}

function formatPrice(value) {
  const num = Number(value);
  if (!num && num !== 0) return '—';
  return num.toLocaleString('vi-VN') + 'đ';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  return format(dateValue, 'yyyy-MM-dd');
}

function getTripSortTimestamp(item = {}) {
  const candidates = [item.updatedAt, item.createdAt, item.bookedAt, item.completedAt];

  for (const candidate of candidates) {
    const time = new Date(candidate).getTime();

    if (Number.isFinite(time)) {
      return time;
    }
  }

  return 0;
}

function DetailRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="atm-detail__row">
      <span className="atm-detail__label">{label}</span>
      <span className="atm-detail__value">{value}</span>
    </div>
  );
}

function TripDetailPanel({ trip, onClose }) {
  if (!trip) return null;
  return createPortal(
    <div className="atm-detail-layer" role="dialog" aria-modal="true" aria-label="Chi tiết chuyến đi" onClick={(event) => event.stopPropagation()}>
      <div className="atm-detail-overlay" onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }} />
      <div className="atm-detail-panel" onClick={(event) => event.stopPropagation()}>
        <div className="atm-detail-panel__header">
          <h3>Chi tiết chuyến đi</h3>
          <button className="atm-detail-panel__close" onClick={onClose} aria-label="Đóng">
            <img src={closeIcon} alt="Đóng" width={18} height={18} />
          </button>
        </div>
        <div className="atm-detail-panel__body">
          <DetailRow label="Mã chuyến" value={trip.bookingCode} />
          <DetailRow label="Khách hàng" value={trip.customerName || trip.accountDisplayName} />
          <DetailRow label="Tài xế" value={trip.driverDisplayName || '—'} />
          <DetailRow label="SĐT tài xế" value={trip.driverPhone || '—'} />
          <DetailRow label="Điểm đón" value={trip.pickupLabel} />
          <DetailRow label="Điểm đến" value={trip.destinationLabel} />
          <DetailRow label="Phương tiện" value={trip.vehicleLabel} />
          <DetailRow label="Khoảng cách" value={trip.routeDistanceKm ? `${trip.routeDistanceKm} km` : null} />
          <DetailRow label="Giá" value={trip.priceFormatted || formatPrice(trip.price)} />
          <DetailRow label="Phí nền tảng" value={trip.platformFeeAmount ? formatPrice(trip.platformFeeAmount) : null} />
          <DetailRow label="Thu nhập tài xế" value={trip.driverNetIncome ? formatPrice(trip.driverNetIncome) : null} />
          <DetailRow label="Thanh toán" value={trip.paymentLabel} />
          <DetailRow label="Trạng thái TT" value={trip.paymentStatusLabel} />
          <DetailRow label="Mã ưu đãi" value={trip.promotionCode || null} />
          <DetailRow label="Trạng thái" value={trip.tripStatusLabel || trip.statusLabel} />
          <DetailRow label="Lý do hủy" value={trip.cancelReason || null} />
          <DetailRow label="Đánh giá" value={trip.ratingScore ? `${trip.ratingScore}/5` : null} />
          <DetailRow label="Nhận xét" value={trip.ratingComment || null} />
          <DetailRow label="Đặt lúc" value={formatDate(trip.bookedAt)} />
          <DetailRow label="Hoàn thành lúc" value={formatDate(trip.completedAt)} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

const ACTIVE_STATUSES = new Set(['ChoTaiXe', 'DaNhanChuyen', 'DangDen', 'DaDon', 'DangThucHien']);

export default function AdminTripManagementModal({ open = false, onClose, accountId = '' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [detailTrip, setDetailTrip] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const abortRef = useRef(null);
  const statusDropRef = useRef(null);
  const timeDropRef = useRef(null);
  const disconnectSocketRef = useRef(null);
  const lastRideEventIdRef = useRef('');
  const reloadTimerRef = useRef(null);

  const fetchData = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    rideService
      .getTripHistory({ roleCode: 'Q1', limit: 200 }, { signal: controller.signal })
      .then((res) => {
        if (res?.success) {
          setItems(Array.isArray(res.items) ? res.items : []);
        } else {
          setError(res?.message || 'Không thể tải dữ liệu chuyến đi.');
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError('Không thể tải dữ liệu chuyến đi.');
      })
      .finally(() => setLoading(false));
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      fetchData();
    }, 220);
  }, [fetchData]);

  useEffect(() => {
    if (open) {
      fetchData();
      setSearch('');
      setStatusFilter('all');
      setDateFrom('');
      setDateTo('');
      setPage(1);

      // Connect real-time socket for status updates
      const normalizedAccountId = String(accountId ?? '').trim();
      if (normalizedAccountId) {
        disconnectSocketRef.current = connectRideEventStream({
          accountId: normalizedAccountId,
          roleCode: 'Q1',
          onEvent: (eventPayload) => {
            const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();
            const eventId = String(eventPayload?.id ?? '').trim();

            if (eventId && lastRideEventIdRef.current === eventId) {
              return;
            }

            if (eventId) {
              lastRideEventIdRef.current = eventId;
            }

            if (
              eventType !== 'ride.trip.status.updated'
              && eventType !== 'ride.payment.updated'
              && eventType !== 'ride.booking.created'
            ) {
              return;
            }

            const code = String(eventPayload?.bookingCode ?? '').trim();

            if (!code) {
              scheduleReload();
              return;
            }

            if (eventType === 'ride.payment.updated') {
              const newPaymentStatus = String(eventPayload?.paymentStatus ?? '').trim();
              const newPaymentStatusLabel = String(eventPayload?.paymentStatusLabel ?? '').trim();

              if (!newPaymentStatus) {
                scheduleReload();
                return;
              }

              setItems((prev) => prev.map((it) => {
                if (it.bookingCode !== code) {
                  return it;
                }

                const nextPaymentStatus = newPaymentStatus || it.paymentStatus;
                const nextPaymentStatusLabel = newPaymentStatusLabel || it.paymentStatusLabel;

                if (it.paymentStatus === nextPaymentStatus && it.paymentStatusLabel === nextPaymentStatusLabel) {
                  return it;
                }

                return {
                  ...it,
                  paymentStatus: nextPaymentStatus,
                  paymentStatusLabel: nextPaymentStatusLabel,
                };
              }));

              setDetailTrip((prev) => {
                if (!prev || prev.bookingCode !== code) {
                  return prev;
                }

                const nextPaymentStatus = newPaymentStatus || prev.paymentStatus;
                const nextPaymentStatusLabel = newPaymentStatusLabel || prev.paymentStatusLabel;

                if (prev.paymentStatus === nextPaymentStatus && prev.paymentStatusLabel === nextPaymentStatusLabel) {
                  return prev;
                }

                return {
                  ...prev,
                  paymentStatus: nextPaymentStatus,
                  paymentStatusLabel: nextPaymentStatusLabel,
                };
              });

              return;
            }

            const newStatus = String(eventPayload?.tripStatus ?? '').trim();
            const newLabel = String(eventPayload?.tripStatusLabel ?? '').trim();
            const newTone = String(eventPayload?.tripStatusTone ?? '').trim();

            if (!newStatus) {
              scheduleReload();
              return;
            }

            setItems((prev) => prev.map((it) => {
              if (it.bookingCode !== code) {
                return it;
              }

              const nextStatus = newStatus || it.tripStatus;
              const nextLabel = newLabel || it.tripStatusLabel || it.statusLabel;
              const nextTone = newTone || it.tripStatusTone || it.statusTone;

              if (
                it.tripStatus === nextStatus
                && it.status === nextStatus
                && it.tripStatusLabel === nextLabel
                && it.statusLabel === nextLabel
                && it.tripStatusTone === nextTone
                && it.statusTone === nextTone
              ) {
                return it;
              }

              return {
                ...it,
                tripStatus: nextStatus,
                tripStatusLabel: nextLabel,
                tripStatusTone: nextTone,
                status: nextStatus,
                statusLabel: nextLabel,
                statusTone: nextTone,
              };
            }));

            setDetailTrip((prev) => {
              if (!prev || prev.bookingCode !== code) {
                return prev;
              }

              const nextStatus = newStatus || prev.tripStatus;
              const nextLabel = newLabel || prev.tripStatusLabel;
              const nextTone = newTone || prev.tripStatusTone;

              if (
                prev.tripStatus === nextStatus
                && prev.tripStatusLabel === nextLabel
                && prev.tripStatusTone === nextTone
              ) {
                return prev;
              }

              return {
                ...prev,
                tripStatus: nextStatus,
                tripStatusLabel: nextLabel,
                tripStatusTone: nextTone,
              };
            });
          },
        });
      }
    } else {
      if (abortRef.current) abortRef.current.abort();
      if (disconnectSocketRef.current) {
        disconnectSocketRef.current();
        disconnectSocketRef.current = null;
      }
      setItems([]);
      setError('');
      setDetailTrip(null);
      setCancelTarget(null);
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    }

    return () => {
      if (disconnectSocketRef.current) {
        disconnectSocketRef.current();
        disconnectSocketRef.current = null;
      }

      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [open, fetchData, accountId, scheduleReload]);

  useEffect(() => {
    if (!open) return;

    const handler = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (detailTrip) {
        setDetailTrip(null);
        return;
      }

      if (cancelTarget) {
        setCancelTarget(null);
        return;
      }

      onClose?.();
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [cancelTarget, detailTrip, onClose, open]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (statusDropRef.current && !statusDropRef.current.contains(e.target)) setStatusOpen(false);
      if (timeDropRef.current && !timeDropRef.current.contains(e.target)) {
        setTimeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    return items
      .filter((item) => {
        if (q) {
          const customer = String(item.customerName ?? item.accountDisplayName ?? '').toLowerCase();
          const driver = String(item.driverDisplayName ?? '').toLowerCase();
          const code = String(item.bookingCode ?? '').toLowerCase();
          if (!customer.includes(q) && !driver.includes(q) && !code.includes(q)) return false;
        }

        if (statusFilter !== 'all') {
          const ts = String(item.tripStatus ?? item.status ?? '');
          if (ts !== statusFilter) return false;
        }

        if (dateFrom) {
          const itemDate = new Date(item.bookedAt);
          const from = new Date(dateFrom);
          from.setHours(0, 0, 0, 0);
          if (itemDate < from) return false;
        }

        if (dateTo) {
          const itemDate = new Date(item.bookedAt);
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          if (itemDate > to) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeDiff = getTripSortTimestamp(b) - getTripSortTimestamp(a);

        if (timeDiff !== 0) {
          return timeDiff;
        }

        return String(b.bookingCode ?? '').localeCompare(String(a.bookingCode ?? ''));
      });
  }, [dateFrom, dateTo, items, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleStatusSelect = (value) => {
    setStatusFilter(value);
    setStatusOpen(false);
    setPage(1);
  };

  const toggleTimeFilter = () => {
    setTimeOpen((current) => {
      const nextOpen = !current;

      return nextOpen;
    });
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      const res = await rideService.updateTripStatus(cancelTarget.bookingCode, 'DaHuy', {
        cancelledByRoleCode: 'Q1',
        cancelReasonLabel: 'Admin hủy chuyến',
      });
      if (res?.success) {
        setItems((prev) =>
          prev.map((it) =>
            it.bookingCode === cancelTarget.bookingCode
              ? { ...it, tripStatus: 'DaHuy', tripStatusLabel: 'Đã hủy', tripStatusTone: 'error', status: 'DaHuy', statusLabel: 'Đã hủy', statusTone: 'error' }
              : it,
          ),
        );
      }
    } catch {
      // silent
    } finally {
      setCancelLoading(false);
      setCancelTarget(null);
    }
  };

  const canCancel = (item) => {
    const ts = String(item.tripStatus ?? item.status ?? '');
    return ACTIVE_STATUSES.has(ts);
  };

  const selectedStatusLabel = TRIP_STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? 'Trạng thái';

  const tripStats = useMemo(() => {
    const stats = {
      total: items.length,
      completed: 0,
      inProgress: 0,
      cancelled: 0,
    };

    items.forEach((item) => {
      const status = String(item.tripStatus ?? item.status ?? '').trim();
      if (status === 'HoanThanh') {
        stats.completed++;
      } else if (['ChoTaiXe', 'DaNhanChuyen', 'DangDen', 'DaDon', 'DangThucHien'].includes(status)) {
        stats.inProgress++;
      } else if (status === 'DaHuy') {
        stats.cancelled++;
      }
    });

    return stats;
  }, [items]);

  if (!open) return null;

  return createPortal(
    <div className="atm-overlay" onClick={onClose}>
      <div className="atm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="atm-modal__header">
          <button className="atm-modal__close" onClick={onClose} aria-label="Đóng">
            <img src={closeIcon} alt="Đóng" width={20} height={20} />
          </button>

          <div className="atm-modal__header-copy">
            <p className="atm-modal__eyebrow">ADMIN / CHUYẾN ĐI</p>
            <h2 className="atm-modal__title">QUẢN LÝ CHUYẾN ĐI</h2>
            <p className="atm-modal__description">
              Tra cứu giao dịch chuyến đi, theo dõi trạng thái và quản lý các chuyến xe trong một giao diện duy nhất.
            </p>
          </div>

          <div className="atm-modal__header-stats" aria-label="Thống kê chuyến đi">
            <article className="atm-modal__stat-card">
              <strong>{tripStats.total}</strong>
              <span>Tổng chuyến đi</span>
            </article>

            <article className="atm-modal__stat-card">
              <strong>{tripStats.completed}</strong>
              <span>Hoàn thành</span>
            </article>

            <article className="atm-modal__stat-card">
              <strong>{tripStats.inProgress}</strong>
              <span>Đang thực hiện</span>
            </article>

            <article className="atm-modal__stat-card">
              <strong>{tripStats.cancelled}</strong>
              <span>Đã hủy</span>
            </article>
          </div>
        </header>

        {/* Toolbar */}
        <div className="atm-toolbar">
          <div className="atm-toolbar__search">
            <span className="atm-toolbar__search-icon">🔍</span>
            <input
              className="atm-toolbar__search-input"
              type="text"
              placeholder="Nhập tên người dùng / tài xế..."
              value={search}
              onChange={handleSearchChange}
            />
          </div>

          {/* Time filter */}
          <div className="atm-toolbar__dropdown" ref={timeDropRef}>
            <button className="atm-toolbar__dropdown-btn" onClick={toggleTimeFilter}>
              <span>📅</span>
              <span>Thời gian</span>
              <span className="atm-toolbar__dropdown-caret">▾</span>
            </button>
            {timeOpen && (
              <div className="atm-toolbar__dropdown-panel atm-toolbar__dropdown-panel--time">
                <label className="atm-toolbar__time-label">
                  Từ ngày
                  <DatePicker
                    selected={parseDateForPicker(dateFrom)}
                    onChange={(selectedDate) => {
                      setDateFrom(formatDateForFilterValue(selectedDate));
                      setPage(1);
                    }}
                    locale="vi-VN"
                    dateFormat="dd/MM/yyyy"
                    placeholderText="dd/mm/yyyy"
                    showMonthDropdown
                    showYearDropdown
                    dropdownMode="select"
                    shouldCloseOnSelect
                    className="admin-user-modal__date-input"
                    calendarClassName="admin-user-modal__date-calendar"
                    popperClassName="admin-user-modal__date-popper"
                    popperPlacement="bottom-start"
                    autoComplete="off"
                    showPopperArrow={false}
                  />
                </label>
                <label className="atm-toolbar__time-label">
                  Đến ngày
                  <DatePicker
                    selected={parseDateForPicker(dateTo)}
                    onChange={(selectedDate) => {
                      setDateTo(formatDateForFilterValue(selectedDate));
                      setPage(1);
                    }}
                    locale="vi-VN"
                    dateFormat="dd/MM/yyyy"
                    placeholderText="dd/mm/yyyy"
                    showMonthDropdown
                    showYearDropdown
                    dropdownMode="select"
                    shouldCloseOnSelect
                    className="admin-user-modal__date-input"
                    calendarClassName="admin-user-modal__date-calendar"
                    popperClassName="admin-user-modal__date-popper"
                    popperPlacement="bottom-start"
                    autoComplete="off"
                    showPopperArrow={false}
                  />
                </label>
                {(dateFrom || dateTo) && (
                  <button
                    className="atm-toolbar__clear-btn"
                    onClick={() => {
                      setDateFrom('');
                      setDateTo('');
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Status filter */}
          <div className="atm-toolbar__dropdown" ref={statusDropRef}>
            <button className="atm-toolbar__dropdown-btn" onClick={() => setStatusOpen((v) => !v)}>
              <span>📊</span>
              <span>{selectedStatusLabel}</span>
              <span className="atm-toolbar__dropdown-caret">▾</span>
            </button>
            {statusOpen && (
              <div className="atm-toolbar__dropdown-panel">
                {TRIP_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`atm-toolbar__dropdown-item${statusFilter === opt.value ? ' is-active' : ''}`}
                    onClick={() => handleStatusSelect(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="atm-toolbar__refresh" onClick={fetchData} title="Tải lại" disabled={loading}>
            {loading ? '⟳' : '↺'}
          </button>
        </div>

        {/* Table */}
        <div className="atm-table-wrap">
          {loading && (
            <div className="atm-state atm-state--loading">
              <span className="atm-spinner" />
              Đang tải dữ liệu...
            </div>
          )}
          {!loading && error && (
            <div className="atm-state atm-state--error">{error}</div>
          )}
          {!loading && !error && filteredItems.length === 0 && (
            <div className="atm-state atm-state--empty">Không có chuyến đi nào.</div>
          )}
          {!loading && !error && filteredItems.length > 0 && (
            <table className="atm-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Khách hàng</th>
                  <th>Tài xế</th>
                  <th>Điểm đón → Điểm đến</th>
                  <th>Giá</th>
                  <th>Trạng thái</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => {
                  const tone = item.tripStatusTone || item.statusTone || 'neutral';
                  const label = item.tripStatusLabel || item.statusLabel || item.tripStatus || '—';
                  const color = getToneColor(tone);
                  return (
                    <tr key={item.bookingCode}>
                      <td className="atm-table__code">{item.bookingCode}</td>
                      <td>{item.customerName || item.accountDisplayName || '—'}</td>
                      <td>{item.driverDisplayName || '—'}</td>
                      <td className="atm-table__route">
                        <div className="atm-route__pickup" title={item.pickupLabel}>{item.pickupLabel || '—'}</div>
                        <div className="atm-route__sep">↓</div>
                        <div className="atm-route__dest" title={item.destinationLabel}>{item.destinationLabel || '—'}</div>
                      </td>
                      <td className="atm-table__price">{item.priceFormatted || formatPrice(item.price)}</td>
                      <td>
                        <span className="atm-badge" style={{ '--badge-color': color }}>
                          <span className="atm-badge__dot" />
                          {label}
                        </span>
                      </td>
                      <td className="atm-table__actions">
                        <button
                          className="atm-btn atm-btn--view"
                          onClick={() => setDetailTrip(item)}
                        >
                          Xem
                        </button>
                        {canCancel(item) && (
                          <button
                            className="atm-btn atm-btn--cancel"
                            onClick={() => setCancelTarget(item)}
                          >
                            Hủy
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="atm-pagination">
            <button
              className="atm-pagination__btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span className="atm-pagination__info">
              Trang {page} / {totalPages}
            </span>
            <button
              className="atm-pagination__btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </button>
          </div>
        )}

        {/* Total count */}
        <div className="atm-footer-info">
          Hiển thị {filteredItems.length} / {items.length} chuyến
        </div>
      </div>

      {/* Trip detail panel */}
      {detailTrip && <TripDetailPanel trip={detailTrip} onClose={() => setDetailTrip(null)} />}

      {/* Cancel confirm */}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Thông báo"
        description={`Bạn có chắc muốn hủy chuyến ${cancelTarget?.bookingCode ?? ''}? Hành động này không thể hoàn tác.`}
        confirmLabel="Xác nhận hủy"
        cancelLabel="Quay lại"
        busy={cancelLoading}
        busyLabel="Đang hủy..."
        confirmTone="danger"
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />
    </div>,
    document.body,
  );
}
