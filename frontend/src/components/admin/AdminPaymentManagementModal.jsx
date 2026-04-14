import { closeIcon } from '../../assets/icons';
import { classNames } from '../../utils/classNames';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';

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

const PAYMENT_ROWS = [
  {
    id: 101,
    paymentCode: 'TT-TR01',
    tripCode: 'TR01',
    customerName: 'Nguyễn Văn A',
    driverName: 'Anh Tài',
    amount: 50000,
    paidAt: '2026-03-25T10:30:00',
    status: 'paid',
    paymentMethodLabel: 'Tiền mặt',
    paymentProviderLabel: '',
    rideTitle: 'RiBike tiết kiệm',
    note: 'Cuốc xe đã được đối soát thành công.',
  },
  {
    id: 102,
    paymentCode: 'TT-TR02',
    tripCode: 'TR02',
    customerName: 'Trần Thị B',
    driverName: 'Minh Hoàng',
    amount: 150000,
    paidAt: '2026-03-25T11:00:00',
    status: 'failed',
    paymentMethodLabel: 'Ví điện tử',
    paymentProviderLabel: 'Momo',
    rideTitle: 'RiCar tiết kiệm',
    note: 'Giao dịch thất bại do ví điện tử không phản hồi.',
  },
  {
    id: 103,
    paymentCode: 'TT-TR03',
    tripCode: 'TR03',
    customerName: 'Lê Văn C',
    driverName: 'Quang Huy',
    amount: 70000,
    paidAt: '2026-03-26T09:15:00',
    status: 'paid',
    paymentMethodLabel: 'QR code',
    paymentProviderLabel: 'ZaloPay',
    rideTitle: 'RiBike phổ thông',
    note: 'Đã quét QR và xác nhận thanh toán.',
  },
  {
    id: 104,
    paymentCode: 'TT-TR04',
    tripCode: 'TR04',
    customerName: 'Phạm Thị D',
    driverName: 'Anh Tài',
    amount: 80000,
    paidAt: '2026-03-26T14:20:00',
    status: 'paid',
    paymentMethodLabel: 'Tiền mặt',
    paymentProviderLabel: '',
    rideTitle: 'RiBike Plus',
    note: 'Tiền mặt đã được thu sau khi kết thúc chuyến.',
  },
  {
    id: 105,
    paymentCode: 'TT-TR05',
    tripCode: 'TR05',
    customerName: 'Hoàng Văn E',
    driverName: 'Minh Hoàng',
    amount: 120000,
    paidAt: '2026-03-27T08:45:00',
    status: 'paid',
    paymentMethodLabel: 'Ví điện tử',
    paymentProviderLabel: 'ShopeePay',
    rideTitle: 'RiCar Plus',
    note: 'Giao dịch hoàn tất trước khi xe khởi hành.',
  },
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

export default function AdminPaymentManagementModal({ open = false, onClose }) {
  const [transactionKeyword, setTransactionKeyword] = useState('');
  const [tripKeyword, setTripKeyword] = useState('');
  const [customerKeyword, setCustomerKeyword] = useState('');
  const [driverKeyword, setDriverKeyword] = useState('');
  const [paymentDateFilter, setPaymentDateFilter] = useState('');
  const [paymentDatePickerOpen, setPaymentDatePickerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedPayment, setSelectedPayment] = useState(null);

  const filteredPayments = useMemo(() => {
    const normalizedTransactionKeyword = normalizeToken(transactionKeyword);
    const normalizedTripKeyword = normalizeToken(tripKeyword);
    const normalizedCustomerKeyword = normalizeToken(customerKeyword);
    const normalizedDriverKeyword = normalizeToken(driverKeyword);

    return PAYMENT_ROWS.filter((payment) => {
      if (statusFilter !== 'all' && payment.status !== statusFilter) {
        return false;
      }

      if (paymentDateFilter && formatDateKey(payment.paidAt) !== paymentDateFilter) {
        return false;
      }

      if (normalizedTransactionKeyword) {
        const searchableTransaction = normalizeToken(`${payment.paymentCode} ${payment.id}`);

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
  }, [customerKeyword, driverKeyword, paymentDateFilter, statusFilter, transactionKeyword, tripKeyword]);

  const paymentStats = useMemo(() => {
    return PAYMENT_ROWS.reduce(
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
  }, []);

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
            <p className="admin-payment-modal__eyebrow">ADMIN / THANH TOÁN</p>
            <h3>QUẢN LÝ THANH TOÁN</h3>
            <p>
              Tra cứu giao dịch thanh toán, đối soát số tiền và theo dõi trạng thái của từng cuốc xe trong một popup duy nhất.
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
          <span>Hiển thị {filteredPayments.length}/{PAYMENT_ROWS.length} giao dịch</span>
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
              {filteredPayments.length > 0 ? (
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
              ) : (
                <tr>
                  <td className="admin-payment-modal__empty-row" colSpan={8}>
                    Không có giao dịch nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="admin-payment-modal__hint">
          Màn hình này dùng để tra cứu và đối soát các giao dịch thanh toán của khách hàng.
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