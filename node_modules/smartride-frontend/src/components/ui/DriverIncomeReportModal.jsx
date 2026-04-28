import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeIcon } from '../../assets/icons';
import { rideService } from '../../services/rideService';

const PLATFORM_FEE_PERCENT_DEFAULT = 30;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function formatCurrency(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '0đ';
  }

  return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Math.round(numericValue)))}đ`;
}

function parseTripDate(trip = {}) {
  const value = trip.completedAt || trip.bookedAt;
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function isSameDay(leftDate, rightDate) {
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function getWeekStart(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function getMonthStart(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date;
}

function getWeekEndFromWeekStart(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

function getMonthEnd(dateValue) {
  const date = new Date(dateValue);
  date.setHours(23, 59, 59, 999);
  date.setMonth(date.getMonth() + 1, 0);
  return date;
}

function isDateInRange(dateValue, startDate, endDate) {
  if (!dateValue || !startDate || !endDate) {
    return false;
  }

  return dateValue >= startDate && dateValue <= endDate;
}

function mapTripToIncomeItem(trip = {}, index = 0) {
  const tripDate = parseTripDate(trip);
  const dateLabel = tripDate
    ? tripDate.toLocaleDateString('vi-VN')
    : '--';
  const netIncome = Number(trip.driverNetIncome ?? 0);

  return {
    id: normalizeText(trip.bookingCode || trip.id || `trip-${index + 1}`),
    date: dateLabel,
    pickupLabel: normalizeText(trip.pickupLabel) || '--',
    destinationLabel: normalizeText(trip.destinationLabel) || '--',
    statusLabel: normalizeText(trip.statusLabel) || 'Không xác định',
    statusToken: normalizeText(trip.status).toLowerCase(),
    incomeAmount: Number.isFinite(netIncome) ? Math.max(0, Math.round(netIncome)) : 0,
    tripDate,
  };
}

export default function DriverIncomeReportModal({
  open = false,
  onClose,
  accountId = '',
  accountIdentifier = '',
  onNotify,
}) {
  const [filterValue, setFilterValue] = useState('all');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [incomeItems, setIncomeItems] = useState([]);
  const [platformFeePercent, setPlatformFeePercent] = useState(PLATFORM_FEE_PERCENT_DEFAULT);

  const normalizedAccountId = normalizeText(accountId);
  const normalizedIdentifier = normalizeText(accountIdentifier);

  useEffect(() => {
    if (!open) {
      setFilterValue('all');
      setErrorMessage('');
      return;
    }

    if (!normalizedAccountId && !normalizedIdentifier) {
      setIncomeItems([]);
      setErrorMessage('Thiếu thông tin tài khoản tài xế để tải thu nhập.');
      return;
    }

    let isActive = true;
    const abortController = new AbortController();

    const loadIncomeData = async () => {
      setLoading(true);
      setErrorMessage('');

      try {
        const response = await rideService.getTripHistory(
          {
            accountId: normalizedAccountId,
            identifier: normalizedIdentifier,
            roleCode: 'Q3',
            limit: 40,
          },
          { signal: abortController.signal },
        );

        if (!isActive) {
          return;
        }

        const responsePlatformFeePercent = Number(response?.platformFeePercent);
        const normalizedResponseFeePercent = Number.isFinite(responsePlatformFeePercent)
          ? Math.max(0, Math.min(100, responsePlatformFeePercent))
          : PLATFORM_FEE_PERCENT_DEFAULT;

        setPlatformFeePercent(normalizedResponseFeePercent);

        const items = Array.isArray(response?.items) ? response.items : [];
        const mappedItems = items.map((item, index) => mapTripToIncomeItem(item, index));
        setIncomeItems(mappedItems);
      } catch (error) {
        if (!isActive || error?.name === 'AbortError') {
          return;
        }

        const message = error?.message || 'Không thể tải dữ liệu thu nhập lúc này.';
        setIncomeItems([]);
        setErrorMessage(message);
        onNotify?.(message, 'error', 2800);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void loadIncomeData();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [normalizedAccountId, normalizedIdentifier, onNotify, open]);

  const filteredItems = useMemo(() => {
    if (filterValue === 'all') {
      return incomeItems;
    }

    const now = new Date();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEndFromWeekStart(weekStart);
    const monthStart = getMonthStart(now);
    const monthEnd = getMonthEnd(now);

    return incomeItems.filter((item) => {
      if (filterValue === 'today') {
        return item.tripDate ? isSameDay(item.tripDate, now) : false;
      }

      if (filterValue === 'week') {
        return isDateInRange(item.tripDate, weekStart, weekEnd);
      }

      if (filterValue === 'month') {
        return isDateInRange(item.tripDate, monthStart, monthEnd);
      }

      return true;
    });
  }, [filterValue, incomeItems]);

  const cards = useMemo(() => {
    const now = new Date();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEndFromWeekStart(weekStart);
    const monthStart = getMonthStart(now);
    const monthEnd = getMonthEnd(now);

    const todayIncome = incomeItems
      .filter((item) => (item.tripDate ? isSameDay(item.tripDate, now) : false))
      .reduce((sum, item) => sum + item.incomeAmount, 0);

    const weekIncome = incomeItems
      .filter((item) => isDateInRange(item.tripDate, weekStart, weekEnd))
      .reduce((sum, item) => sum + item.incomeAmount, 0);

    const monthIncome = incomeItems
      .filter((item) => isDateInRange(item.tripDate, monthStart, monthEnd))
      .reduce((sum, item) => sum + item.incomeAmount, 0);

    return [
      { label: 'Hôm nay', value: todayIncome, className: 'driver-income-modal__card--today' },
      { label: 'Tuần này', value: weekIncome, className: 'driver-income-modal__card--week' },
      { label: 'Tháng này', value: monthIncome, className: 'driver-income-modal__card--month' },
    ];
  }, [incomeItems]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="driver-income-modal" role="dialog" aria-modal="true" aria-label="Quản lý thu nhập">
      <div className="driver-income-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="driver-income-modal__window">
        <button className="driver-income-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng quản lý thu nhập">
          <img className="driver-income-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <h3 className="driver-income-modal__title">QUẢN LÝ THU NHẬP</h3>

        <section className="driver-income-modal__cards" aria-label="Tổng quan thu nhập">
          {cards.map((card) => (
            <article key={card.label} className={`driver-income-modal__card ${card.className}`}>
              <span>{card.label}</span>
              <strong>{formatCurrency(card.value)}</strong>
            </article>
          ))}
        </section>

        <div className="driver-income-modal__toolbar">
          <label>
            <span>Lọc theo:</span>
            <select value={filterValue} onChange={(event) => setFilterValue(event.target.value)}>
              <option value="all">Tất cả</option>
              <option value="today">Hôm nay</option>
              <option value="week">Tuần này</option>
              <option value="month">Tháng này</option>
            </select>
          </label>

          <p className="driver-income-modal__fee-note">
            Thu nhập tài xế đã trừ phí nền tảng: {Math.max(0, Math.min(100, Number(platformFeePercent) || PLATFORM_FEE_PERCENT_DEFAULT))}%
          </p>
        </div>

        <div className="driver-income-modal__table-wrap">
          <table className="driver-income-modal__table">
            <thead>
              <tr>
                <th>Mã chuyến</th>
                <th>Ngày</th>
                <th>Điểm đón</th>
                <th>Điểm đến</th>
                <th>Thu nhập</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="driver-income-modal__empty" colSpan={6}>Đang tải dữ liệu thu nhập...</td>
                </tr>
              ) : null}

              {!loading && errorMessage ? (
                <tr>
                  <td className="driver-income-modal__empty driver-income-modal__empty--error" colSpan={6}>{errorMessage}</td>
                </tr>
              ) : null}

              {!loading && !errorMessage && filteredItems.length === 0 ? (
                <tr>
                  <td className="driver-income-modal__empty" colSpan={6}>Không có dữ liệu thu nhập trong bộ lọc đã chọn.</td>
                </tr>
              ) : null}

              {!loading && !errorMessage
                ? filteredItems.map((trip) => (
                    <tr key={trip.id}>
                      <td title={`#${trip.id}`}>#{trip.id}</td>
                      <td>{trip.date}</td>
                      <td title={trip.pickupLabel}>{trip.pickupLabel}</td>
                      <td title={trip.destinationLabel}>{trip.destinationLabel}</td>
                      <td>{formatCurrency(trip.incomeAmount)}</td>
                      <td>
                        <span className={trip.statusToken === 'hoanthanh' || trip.statusToken === 'completed' ? 'driver-income-modal__status' : ''}>
                          {trip.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>,
    document.body,
  );
}
