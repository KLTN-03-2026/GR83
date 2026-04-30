import { closeIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import { rideService } from '../../services/rideService';

registerLocale('vi-VN', vi);

const PAYMENT_STATUS_META = {
  paid: { label: 'Đã thanh toán', tone: 'paid' },
  pending: { label: 'Chờ xác nhận', tone: 'pending' },
  failed: { label: 'Thất bại', tone: 'failed' },
};

const PAYMENT_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'failed', label: 'Thất bại' },
];

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function formatMoney(amount) {
  return `${new Intl.NumberFormat('en-US').format(Number(amount) || 0)} VNĐ`;
}

function formatPaymentDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDateKey(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

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

  return format(dateValue, 'yyyy-MM-dd');
}

function getPaymentStatusMeta(status) {
  return PAYMENT_STATUS_META[status] ?? PAYMENT_STATUS_META.pending;
}

function buildPaymentSummary(row) {
  if (row.paymentProviderLabel) {
    return `${row.paymentMethodLabel} - ${row.paymentProviderLabel}`;
  }

  return row.paymentMethodLabel;
}

function normalizePaymentStatus(item = {}) {
  const paymentStatus = normalizeToken(item.paymentStatus);
  const tripStatus = normalizeToken(item.tripStatus || item.status);

  if (paymentStatus === 'thatbai' || paymentStatus === 'failed' || tripStatus === 'dahuy') {
    return 'failed';
  }

  if (paymentStatus === 'dathanhtoan' || paymentStatus === 'paid' || tripStatus === 'hoanthanh' || item.status === 'completed') {
    return 'paid';
  }

  return 'pending';
}

function parsePaymentMethodSummary(item = {}) {
  const paymentLabel = String(item.paymentLabel ?? '').trim();

  if (!paymentLabel) {
    return {
      paymentMethodLabel: 'Không xác định',
      paymentProviderLabel: '',
    };
  }

  const separator = paymentLabel.includes(' - ') ? ' - ' : paymentLabel.includes('-') ? '-' : '';

  if (!separator) {
    return {
      paymentMethodLabel: paymentLabel,
      paymentProviderLabel: '',
    };
  }

  const [methodLabel, providerLabel] = paymentLabel.split(separator).map((part) => String(part ?? '').trim());

  return {
    paymentMethodLabel: methodLabel || paymentLabel,
    paymentProviderLabel: providerLabel || '',
  };
}

function mapPaymentRow(item = {}, index = 0) {
  const methodSummary = parsePaymentMethodSummary(item);
  const paymentCode = String(item.paymentCode ?? item.id ?? '').trim();
  const bookingCode = String(item.bookingCode ?? item.tripCode ?? '').trim();
  const transactionId = paymentCode || `TT-${bookingCode || index + 1}`;

  return {
    id: transactionId,
    paymentCode: transactionId,
    tripCode: bookingCode || paymentCode || `TR-${index + 1}`,
    customerName: String(item.customerName ?? '').trim() || 'Khách hàng SmartRide',
    driverName: String(item.driverDisplayName ?? item.driverName ?? '').trim() || 'Tài xế SmartRide',
    amount: Number(item.price ?? item.paymentAmount ?? 0),
    paidAt: item.completedAt || item.bookedAt || '',
    status: normalizePaymentStatus(item),
    paymentMethodLabel: methodSummary.paymentMethodLabel,
    paymentProviderLabel: methodSummary.paymentProviderLabel,
    rideTitle: String(item.rideTitle ?? '').trim() || 'Chuyến đi SmartRide',
    note: String(item.note ?? '').trim() || 'Dữ liệu thanh toán được đồng bộ trực tiếp từ hệ thống.',
  };
}

export default function AdminPaymentManagementModal({
  open = false,
  onClose,
  roleCode = 'Q1',
  accountId = '',
  accountIdentifier = '',
  onNotify,
}) {
  const [transactionKeyword, setTransactionKeyword] = useState('');
  const [tripKeyword, setTripKeyword] = useState('');
  const [customerKeyword, setCustomerKeyword] = useState('');
  const [driverKeyword, setDriverKeyword] = useState('');
  const [paymentDateFilter, setPaymentDateFilter] = useState('');
  const [paymentDatePickerOpen, setPaymentDatePickerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [paymentRows, setPaymentRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState('');

  const normalizedRoleCode = String(roleCode ?? '').trim().toUpperCase() === 'Q3' ? 'Q3' : 'Q1';
  const normalizedAccountId = String(accountId ?? '').trim();
  const normalizedIdentifier = String(accountIdentifier ?? '').trim();

  useEffect(() => {
    if (!open) {
      return;
    }

    let isActive = true;
    const abortController = new AbortController();

    const loadPayments = async () => {
      setLoading(true);
      setRequestError('');

      try {
        const response = await rideService.getTripHistory(
          {
            roleCode: normalizedRoleCode,
            accountId: normalizedRoleCode === 'Q3' ? normalizedAccountId : '',
            identifier: normalizedRoleCode === 'Q3' ? normalizedIdentifier : '',
            limit: 40,
          },
          { signal: abortController.signal },
        );

        if (!isActive) {
          return;
        }

        const rawItems = Array.isArray(response?.items) ? response.items : [];
        setPaymentRows(rawItems.map((item, index) => mapPaymentRow(item, index)));
      } catch (error) {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        const message = error?.message || 'Không thể tải dữ liệu thanh toán lúc này.';
        setPaymentRows([]);
        setRequestError(message);
        onNotify?.(message, 'error', 2800);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void loadPayments();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [normalizedAccountId, normalizedIdentifier, normalizedRoleCode, onNotify, open]);

  const filteredPayments = useMemo(() => {
    const normalizedTransactionKeyword = normalizeToken(transactionKeyword);
    const normalizedTripKeyword = normalizeToken(tripKeyword);
    const normalizedCustomerKeyword = normalizeToken(customerKeyword);
    const normalizedDriverKeyword = normalizeToken(driverKeyword);

    return paymentRows.filter((payment) => {
      if (statusFilter !== 'all' && payment.status !== statusFilter) {
        return false;
      }

      if (paymentDateFilter && formatDateKey(payment.paidAt) !== paymentDateFilter) {
        return false;
      }

      if (normalizedTransactionKeyword) {
        const searchableTransaction = normalizeToken(payment.id);

        if (!searchableTransaction.includes(normalizedTransactionKeyword)) {
          return false;
        }
      }

      if (normalizedTripKeyword && !normalizeToken(payment.tripCode).includes(normalizedTripKeyword)) {
        return false;
      }

      if (normalizedCustomerKeyword && !normalizeToken(payment.customerName).includes(normalizedCustomerKeyword)) {
        return false;
      }

      if (normalizedDriverKeyword && !normalizeToken(payment.driverName).includes(normalizedDriverKeyword)) {
        return false;
      }

      return true;
    });
  }, [customerKeyword, driverKeyword, paymentDateFilter, paymentRows, statusFilter, transactionKeyword, tripKeyword]);

  const paymentStats = useMemo(() => {
    return paymentRows.reduce(
      (accumulator, payment) => {
        accumulator.total += 1;
        accumulator.amount += Number(payment.amount) || 0;

        if (payment.status === 'paid') {
          accumulator.paid += 1;
        } else if (payment.status === 'failed') {
          accumulator.failed += 1;
        } else {
          accumulator.pending += 1;
        }

        return accumulator;
      },
      { total: 0, paid: 0, pending: 0, failed: 0, amount: 0 },
    );
  }, [paymentRows]);

  useEffect(() => {
    if (!open) {
      setSelectedPayment(null);
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (paymentDatePickerOpen) {
          setPaymentDatePickerOpen(false);
          return;
        }

        if (selectedPayment) {
          setSelectedPayment(null);
          return;
        }

        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open, paymentDatePickerOpen, selectedPayment]);

  useEffect(() => {
    if (!open) {
      setTransactionKeyword('');
      setTripKeyword('');
      setCustomerKeyword('');
      setDriverKeyword('');
      setPaymentDateFilter('');
      setPaymentDatePickerOpen(false);
      setStatusFilter('all');
      setSelectedPayment(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="admin-payment-modal" role="dialog" aria-modal="true" aria-label="Quản lý thanh toán">
      <div className="admin-payment-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="admin-payment-modal__window">
        <button className="admin-payment-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng quản lý thanh toán">
          <img className="admin-payment-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="admin-payment-modal__header">
          <div className="admin-payment-modal__header-copy">
            <p className="admin-payment-modal__eyebrow">{normalizedRoleCode === 'Q3' ? 'TÀI XẾ / THANH TOÁN' : 'ADMIN / THANH TOÁN'}</p>
            <h3>QUẢN LÝ THANH TOÁN</h3>
            <p>
              {normalizedRoleCode === 'Q3'
                ? 'Tra cứu giao dịch thanh toán của các chuyến bạn đã thực hiện, theo dõi trạng thái và đối soát số tiền ngay trong popup.'
                : 'Tra cứu giao dịch thanh toán, đối soát số tiền và theo dõi trạng thái của từng cuốc xe trong một popup duy nhất.'}
            </p>
          </div>

          <div className="admin-payment-modal__header-stats" aria-label="Thống kê thanh toán">
            <article className="admin-payment-modal__stat-card">
              <strong>{paymentStats.total}</strong>
              <span>Tổng giao dịch</span>
            </article>

            <article className="admin-payment-modal__stat-card">
              <strong>{paymentStats.paid}</strong>
              <span>Đã thanh toán</span>
            </article>

            <article className="admin-payment-modal__stat-card">
              <strong>{paymentStats.pending}</strong>
              <span>Chờ xác nhận</span>
            </article>

            <article className="admin-payment-modal__stat-card">
              <strong>{paymentStats.failed}</strong>
              <span>Thất bại</span>
            </article>
          </div>
        </header>

        <div
          className="admin-payment-modal__toolbar"
          role="search"
          aria-label="Bộ lọc thanh toán"
          onMouseDownCapture={(event) => {
            const targetElement = event.target;
            const isInsideDatePicker =
              targetElement instanceof Element &&
              (targetElement.closest('.admin-user-modal__date-calendar') || targetElement.closest('.admin-user-modal__date-input'));

            if (paymentDatePickerOpen && !isInsideDatePicker) {
              setPaymentDatePickerOpen(false);
            }
          }}
        >
          <label className="admin-payment-modal__field admin-payment-modal__field--search">
            <span className="admin-payment-modal__sr-only">Mã giao dịch</span>
            <input
              type="search"
              value={transactionKeyword}
              onChange={(event) => setTransactionKeyword(event.target.value)}
              placeholder="Mã giao dịch"
            />
          </label>

          <label className="admin-payment-modal__field admin-payment-modal__field--search">
            <span className="admin-payment-modal__sr-only">Mã chuyến đi</span>
            <input
              type="search"
              value={tripKeyword}
              onChange={(event) => setTripKeyword(event.target.value)}
              placeholder="Mã chuyến đi"
            />
          </label>

          <label className="admin-payment-modal__field admin-payment-modal__field--search">
            <span className="admin-payment-modal__sr-only">Khách hàng</span>
            <input
              type="search"
              value={customerKeyword}
              onChange={(event) => setCustomerKeyword(event.target.value)}
              placeholder="Khách hàng"
            />
          </label>

          <label className="admin-payment-modal__field admin-payment-modal__field--search">
            <span className="admin-payment-modal__sr-only">Tài xế</span>
            <input
              type="search"
              value={driverKeyword}
              onChange={(event) => setDriverKeyword(event.target.value)}
              placeholder="Tài xế"
            />
          </label>

          <label className="admin-payment-modal__field admin-payment-modal__field--date">
            <span className="admin-payment-modal__sr-only">Ngày giờ</span>
            <DatePicker
              selected={parseDateForPicker(paymentDateFilter)}
              onChange={(selectedDate) => {
                setPaymentDateFilter(formatDateForFilterValue(selectedDate));
                setPaymentDatePickerOpen(false);
              }}
              onCalendarOpen={() => setPaymentDatePickerOpen(true)}
              onCalendarClose={() => setPaymentDatePickerOpen(false)}
              onClickOutside={() => setPaymentDatePickerOpen(false)}
              onInputClick={() => setPaymentDatePickerOpen(true)}
              locale="vi-VN"
              dateFormat="dd/MM/yyyy"
              placeholderText="dd/mm/yyyy"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              className="admin-user-modal__date-input"
              calendarClassName="admin-user-modal__date-calendar"
              popperClassName="admin-user-modal__date-popper"
              open={paymentDatePickerOpen}
              autoComplete="off"
              showPopperArrow={false}
              ariaLabelledBy="Ngày giờ"
            />
          </label>

          <label className="admin-payment-modal__field">
            <span className="admin-payment-modal__sr-only">Tất cả trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-payment-modal__meta">
          <span>Hiển thị {filteredPayments.length}/{paymentRows.length} giao dịch</span>
          <span>Tổng giá trị đối soát: {formatMoney(paymentStats.amount)}</span>
        </div>

        <div className="admin-payment-modal__table-wrap">
          <table className="admin-payment-modal__table" aria-label="Danh sách thanh toán">
            <thead>
              <tr>
                <th>ID</th>
                <th>Mã chuyến</th>
                <th>Khách hàng</th>
                <th>Tài xế</th>
                <th>Số tiền</th>
                <th>Ngày giờ</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className="admin-payment-modal__empty-row" colSpan={8}>
                    Đang tải dữ liệu thanh toán...
                  </td>
                </tr>
              ) : null}

              {!loading && requestError ? (
                <tr>
                  <td className="admin-payment-modal__empty-row" colSpan={8}>
                    {requestError}
                  </td>
                </tr>
              ) : null}

              {!loading && !requestError && filteredPayments.length > 0 ? (
                filteredPayments.map((payment) => {
                  const statusMeta = getPaymentStatusMeta(payment.status);

                  return (
                    <tr key={payment.id}>
                      <td className="admin-payment-modal__id-cell">{payment.id}</td>
                      <td className="admin-payment-modal__trip-cell">{payment.tripCode}</td>
                      <td className="admin-payment-modal__party-cell">{payment.customerName}</td>
                      <td className="admin-payment-modal__party-cell">{payment.driverName}</td>
                      <td className="admin-payment-modal__amount-cell">{formatMoney(payment.amount)}</td>
                      <td className="admin-payment-modal__datetime-cell">{formatPaymentDate(payment.paidAt)}</td>
                      <td>
                        <span className={classNames('admin-payment-modal__status-badge', `admin-payment-modal__status-badge--${statusMeta.tone}`)}>
                          <span className={classNames('admin-payment-modal__status-dot', `admin-payment-modal__status-dot--${statusMeta.tone}`)} aria-hidden="true" />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="admin-payment-modal__row-actions">
                          <button
                            className="admin-payment-modal__action admin-payment-modal__action--view"
                            type="button"
                            onClick={() => setSelectedPayment(payment)}
                          >
                            Xem
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : null}

              {!loading && !requestError && filteredPayments.length === 0 ? (
                <tr>
                  <td className="admin-payment-modal__empty-row" colSpan={8}>
                    Không có giao dịch nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="admin-payment-modal__hint">
          {normalizedRoleCode === 'Q3'
            ? 'Màn hình này dùng để tài xế tra cứu lịch sử thanh toán chuyến đi của mình.'
            : 'Màn hình này dùng để tra cứu và đối soát các giao dịch thanh toán của khách hàng.'}
        </p>
      </section>

      {selectedPayment ? (
        createPortal(
          <div className="admin-payment-modal__detail-overlay" role="dialog" aria-modal="true" aria-label="Chi tiết thanh toán">
            <div className="admin-payment-modal__detail-backdrop" onClick={() => setSelectedPayment(null)} aria-hidden="true" />

            <section className="admin-payment-modal__detail-sheet">
              <div className="admin-payment-modal__detail-head">
                <div>
                  <p className="admin-payment-modal__eyebrow">CHI TIẾT THANH TOÁN</p>
                  <h4>{selectedPayment.paymentCode}</h4>
                  <p>{selectedPayment.tripCode} - {selectedPayment.customerName}</p>
                </div>

                <button className="admin-payment-modal__detail-close" type="button" onClick={() => setSelectedPayment(null)}>
                  Đóng
                </button>
              </div>

              <div className="admin-payment-modal__detail-summary">
                <article className="admin-payment-modal__detail-card">
                  <span>Tổng tiền</span>
                  <strong>{formatMoney(selectedPayment.amount)}</strong>
                </article>

                <article className="admin-payment-modal__detail-card">
                  <span>Trạng thái</span>
                  <strong>{getPaymentStatusMeta(selectedPayment.status).label}</strong>
                </article>

                <article className="admin-payment-modal__detail-card">
                  <span>Phương thức</span>
                  <strong>{buildPaymentSummary(selectedPayment)}</strong>
                </article>
              </div>

              <div className="admin-payment-modal__detail-grid">
                <div className="admin-payment-modal__detail-field">
                  <span>Mã chuyến</span>
                  <strong>{selectedPayment.tripCode}</strong>
                </div>

                <div className="admin-payment-modal__detail-field">
                  <span>Mã giao dịch</span>
                  <strong>{selectedPayment.paymentCode}</strong>
                </div>

                <div className="admin-payment-modal__detail-field">
                  <span>Khách hàng</span>
                  <strong>{selectedPayment.customerName}</strong>
                </div>

                <div className="admin-payment-modal__detail-field">
                  <span>Tài xế</span>
                  <strong>{selectedPayment.driverName}</strong>
                </div>

                <div className="admin-payment-modal__detail-field">
                  <span>Thời gian</span>
                  <strong>{formatPaymentDate(selectedPayment.paidAt)}</strong>
                </div>

                <div className="admin-payment-modal__detail-field">
                  <span>Chuyến đi</span>
                  <strong>{selectedPayment.rideTitle}</strong>
                </div>
              </div>

              <p className="admin-payment-modal__detail-note">{selectedPayment.note}</p>
            </section>
          </div>,
          document.body,
        )
      ) : null}
    </div>,
    document.body,
  );
}