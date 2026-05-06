import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import { rideService } from '../../services/rideService';
import { connectRideEventStream } from '../../services/rideRealtimeService';

registerLocale('vi-VN', vi);

const PLATFORM_FEE_PERCENT = 30;

const VEHICLE_OPTIONS = [
  { value: 'all', label: 'Tất cả loại xe' },
  { value: 'motorbike', label: 'Xe máy' },
  { value: 'car', label: 'Ô tô' },
  { value: 'intercity', label: 'Xe liên tỉnh' },
];

const PAYMENT_OPTIONS = [
  { value: 'all', label: 'Tất cả PT thanh toán' },
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'wallet', label: 'Ví điện tử' },
  { value: 'qr', label: 'QR code' },
];

const NUM_FMT = new Intl.NumberFormat('vi-VN');

function fmt(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? NUM_FMT.format(Math.round(n)) : '0';
}

function fmtDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function toInputDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultDates() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: toInputDate(from),
    to: toInputDate(now),
  };
}

function parseDateForPicker(dateString) {
  const normalizedValue = String(dateString ?? '').trim();
  if (!normalizedValue) return null;

  const parsedDate = parse(normalizedValue, 'yyyy-MM-dd', new Date());
  if (isValid(parsedDate)) return parsedDate;

  const fallbackDate = new Date(normalizedValue);
  return isValid(fallbackDate) ? fallbackDate : null;
}

function formatDateForFilterValue(dateValue) {
  if (!(dateValue instanceof Date) || !isValid(dateValue)) return '';
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getVehicleLabel(vehicle) {
  const v = String(vehicle ?? '').toLowerCase();
  if (v === 'motorbike') return 'Xe máy';
  if (v === 'car') return 'Ô tô';
  if (v === 'intercity') return 'Xe liên tỉnh';
  return vehicle || 'Khác';
}

function getPaymentLabel(paymentMethod, paymentProvider) {
  const m = String(paymentMethod ?? '').toLowerCase();
  if (m === 'cash') return 'Tiền mặt';
  if (m === 'wallet') {
    const p = String(paymentProvider ?? '').toLowerCase();
    if (p === 'momo') return 'Ví Momo';
    if (p === 'zalopay') return 'Ví ZaloPay';
    if (p === 'vnpay') return 'Ví VNPay';
    return 'Ví điện tử';
  }
  if (m === 'qr') {
    const p = String(paymentProvider ?? '').toLowerCase();
    if (p === 'momo') return 'QR Momo';
    if (p === 'zalopay') return 'QR ZaloPay';
    if (p === 'vnpay') return 'QR VNPay';
    return 'QR code';
  }
  return 'Tiền mặt';
}

function mapRow(item) {
  const originalPrice = Number(item.originalPrice ?? item.basePrice ?? item.paymentOriginalAmount ?? 0);
  const discountAmount = Number(item.discountAmount ?? item.paymentDiscountAmount ?? 0);
  const customerPays = Number(item.paymentAmount ?? item.price ?? 0);
  const surcharge = Math.max(0, customerPays - Math.max(0, originalPrice - discountAmount));
  const platformFee = Math.round(customerPays * PLATFORM_FEE_PERCENT / 100);
  const driverNet = Math.max(0, customerPays - platformFee);
  const vehicle = String(item.vehicle ?? '').toLowerCase();
  const paymentMethod = String(item.paymentMethod ?? item.paymentMethodFromPayment ?? '').toLowerCase();

  return {
    date: fmtDate(item.bookedAt ?? item.createdAt),
    rawDate: item.bookedAt ?? item.createdAt ?? '',
    bookingCode: item.bookingCode ?? '',
    vehicle,
    vehicleLabel: getVehicleLabel(vehicle),
    distanceKm: Number(item.routeDistanceKm ?? 0),
    originalPrice,
    discountAmount,
    surcharge,
    customerPays,
    driverNet,
    platformFee,
    paymentMethod,
    paymentLabel: getPaymentLabel(paymentMethod, item.paymentProvider ?? item.paymentProviderFromPayment ?? ''),
    tripStatus: String(item.tripStatus ?? '').toLowerCase(),
  };
}

function downloadBlob(filename, content, mimeType, addBom = false) {
  const blob = new Blob([addBom ? `\uFEFF${content}` : content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function exportToExcel(rows, filename) {
  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.bookingCode)}</td>
      <td>${escapeHtml(row.vehicleLabel)}</td>
      <td class="num">${escapeHtml(row.distanceKm.toFixed(1))}</td>
      <td class="num">${escapeHtml(row.originalPrice)}</td>
      <td class="num">${escapeHtml(row.discountAmount)}</td>
      <td class="num">${escapeHtml(row.surcharge)}</td>
      <td class="num">${escapeHtml(row.customerPays)}</td>
      <td class="num">${escapeHtml(row.driverNet)}</td>
      <td class="num">${escapeHtml(row.platformFee)}</td>
      <td>${escapeHtml(row.paymentLabel)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40"
      lang="vi">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8" />
  <style>
    table {
      border-collapse: collapse;
      width: 100%;
      font-family: 'Times New Roman', serif;
      font-size: 13pt;
    }
    th, td {
      border: 1px solid #000;
      padding: 6px 8px;
    }
    th {
      text-align: center;
      font-weight: 700;
      background: #f3f4f6;
    }
    td.num {
      text-align: right;
    }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th>Ngày</th>
        <th>Mã chuyến</th>
        <th>Loại xe</th>
        <th>Quảng đường (km)</th>
        <th>Giá gốc (đ)</th>
        <th>Giảm giá (đ)</th>
        <th>Phụ phí (đ)</th>
        <th>Khách trả (đ)</th>
        <th>Tài xế nhận (đ)</th>
        <th>Hoa hồng (đ)</th>
        <th>Thanh toán</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;

  downloadBlob(filename, html, 'application/vnd.ms-excel;charset=utf-8');
}

function exportToPDF(rows, summary, dateFrom, dateTo) {
  const tableRows = rows.map((r) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.bookingCode}</td>
      <td>${r.vehicleLabel}</td>
      <td>${r.distanceKm.toFixed(1)} km</td>
      <td class="num">${fmt(r.originalPrice)}</td>
      <td class="num">${fmt(r.discountAmount)}</td>
      <td class="num">${fmt(r.surcharge)}</td>
      <td class="num">${fmt(r.customerPays)}</td>
      <td class="num">${fmt(r.driverNet)}</td>
      <td class="num">${fmt(r.platformFee)}</td>
      <td>${r.paymentLabel}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Báo cáo doanh thu</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
  h2{text-align:center;font-size:16px;margin-bottom:4px}
  .subtitle{text-align:center;font-size:11px;color:#555;margin-bottom:12px}
  .summary{display:flex;gap:12px;margin-bottom:12px}
  .card{flex:1;border:1px solid #ddd;border-radius:6px;padding:8px 12px;text-align:center}
  .card .label{font-size:10px;color:#666;margin-bottom:4px}
  .card .value{font-size:14px;font-weight:bold}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#4f46e5;color:#fff;padding:5px 6px;text-align:left}
  td{padding:4px 6px;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#f9f9f9}
  .num{text-align:right}
  @media print{button{display:none}}
</style>
</head>
<body>
<h2>BÁO CÁO DOANH THU HỆ THỐNG</h2>
<div class="subtitle">Từ ngày ${dateFrom || '—'} đến ${dateTo || '—'}</div>
<div class="summary">
  <div class="card"><div class="label">Tổng chuyến</div><div class="value">${summary.totalTrips}</div></div>
  <div class="card"><div class="label">Tổng thu</div><div class="value">${fmt(summary.totalRevenue)} đ</div></div>
  <div class="card"><div class="label">Tiền tài xế nhận</div><div class="value">${fmt(summary.driverTotal)} đ</div></div>
  <div class="card"><div class="label">Doanh thu hệ thống</div><div class="value">${fmt(summary.systemTotal)} đ</div></div>
</div>
<table>
<thead>
<tr>
  <th>Ngày</th><th>Mã chuyến</th><th>Loại xe</th><th>Quảng đường</th>
  <th>Giá gốc</th><th>Giảm giá</th><th>Phụ phí</th>
  <th>Khách trả</th><th>Tài xế nhận</th><th>Hoa hồng</th><th>Thanh toán</th>
</tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
<script>window.onload=function(){window.print();}<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

export default function AdminRevenueReportModal({ open, onClose, accountId = '' }) {
  const defaults = useMemo(() => getDefaultDates(), []);
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [appliedDateFrom, setAppliedDateFrom] = useState(defaults.from);
  const [appliedDateTo, setAppliedDateTo] = useState(defaults.to);
  const [appliedVehicle, setAppliedVehicle] = useState('all');
  const [appliedPayment, setAppliedPayment] = useState('all');
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const lastRealtimeEventIdRef = useRef('');
  const realtimeReloadTimerRef = useRef(null);

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
          setAllItems(Array.isArray(res.items) ? res.items : []);
        } else {
          setError(res?.message || 'Không thể tải dữ liệu.');
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError('Không thể tải dữ liệu doanh thu.');
      })
      .finally(() => setLoading(false));
  }, []);

  const scheduleRealtimeReload = useCallback(() => {
    if (realtimeReloadTimerRef.current) {
      window.clearTimeout(realtimeReloadTimerRef.current);
    }

    realtimeReloadTimerRef.current = window.setTimeout(() => {
      realtimeReloadTimerRef.current = null;
      fetchData();
    }, 220);
  }, [fetchData]);

  useEffect(() => {
    if (open) {
      const d = getDefaultDates();
      setDateFrom(d.from);
      setDateTo(d.to);
      setVehicleFilter('all');
      setPaymentFilter('all');
      setAppliedDateFrom(d.from);
      setAppliedDateTo(d.to);
      setAppliedVehicle('all');
      setAppliedPayment('all');
      fetchData();
    } else {
      if (abortRef.current) abortRef.current.abort();
      setAllItems([]);
      setError('');
    }
  }, [open, fetchData]);

  useEffect(() => {
    const normalizedAccountId = String(accountId ?? '').trim();

    if (!open || !normalizedAccountId) {
      return undefined;
    }

    const disconnectRideEventStream = connectRideEventStream({
      accountId: normalizedAccountId,
      roleCode: 'Q1',
      onEvent: (eventPayload = {}) => {
        const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();

        if (
          eventType !== 'ride.booking.created'
          && eventType !== 'ride.trip.status.updated'
          && eventType !== 'ride.payment.updated'
        ) {
          return;
        }

        const eventId = String(eventPayload?.id ?? '').trim();

        if (eventId && lastRealtimeEventIdRef.current === eventId) {
          return;
        }

        if (eventId) {
          lastRealtimeEventIdRef.current = eventId;
        }

        scheduleRealtimeReload();
      },
    });

    return () => {
      disconnectRideEventStream();

      if (realtimeReloadTimerRef.current) {
        window.clearTimeout(realtimeReloadTimerRef.current);
        realtimeReloadTimerRef.current = null;
      }
    };
  }, [accountId, open, scheduleRealtimeReload]);

  const handleFilter = useCallback(() => {
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setAppliedVehicle(vehicleFilter);
    setAppliedPayment(paymentFilter);
  }, [dateFrom, dateTo, vehicleFilter, paymentFilter]);

  const filteredRows = useMemo(() => {
    const rows = allItems
      .filter((item) => {
        const status = String(item.tripStatus ?? '').toLowerCase();
        return status === 'hoanthanh' || status === 'completed';
      })
      .map(mapRow);

    return rows.filter((row) => {
      if (appliedVehicle !== 'all' && row.vehicle !== appliedVehicle) return false;
      if (appliedPayment !== 'all' && row.paymentMethod !== appliedPayment) return false;

      if (appliedDateFrom) {
        const rowDate = new Date(row.rawDate ?? '');
        const from = new Date(appliedDateFrom + 'T00:00:00');
        if (!Number.isNaN(rowDate.getTime()) && !Number.isNaN(from.getTime()) && rowDate < from) return false;
      }

      if (appliedDateTo) {
        const rowDate = new Date(row.rawDate ?? '');
        const to = new Date(appliedDateTo + 'T23:59:59');
        if (!Number.isNaN(rowDate.getTime()) && !Number.isNaN(to.getTime()) && rowDate > to) return false;
      }

      return true;
    });
  }, [allItems, appliedDateFrom, appliedDateTo, appliedVehicle, appliedPayment]);

  const summary = useMemo(() => {
    return filteredRows.reduce((acc, row) => {
      acc.totalTrips += 1;
      acc.totalRevenue += row.customerPays;
      acc.driverTotal += row.driverNet;
      acc.systemTotal += row.platformFee;
      return acc;
    }, { totalTrips: 0, totalRevenue: 0, driverTotal: 0, systemTotal: 0 });
  }, [filteredRows]);

  const handleExcelExport = useCallback(() => {
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    exportToExcel(filteredRows, `bao-cao-doanh-thu-${stamp}.xls`);
  }, [filteredRows]);

  const handlePDFExport = useCallback(() => {
    const fmtInputDate = (val) => {
      if (!val) return '';
      const [y, m, d] = val.split('-');
      return `${d}/${m}/${y}`;
    };
    exportToPDF(filteredRows, summary, fmtInputDate(appliedDateFrom), fmtInputDate(appliedDateTo));
  }, [filteredRows, summary, appliedDateFrom, appliedDateTo]);

  if (!open) return null;

  return createPortal(
    <div className="revenue-modal">
      <div className="revenue-modal__backdrop" onClick={onClose} />
      <div className="revenue-modal__window">
        {/* Header */}
        <header className="revenue-modal__header">
          <div className="revenue-modal__header-copy">
            <p className="revenue-modal__eyebrow">ADMIN / BÁO CÁO</p>
            <h2 className="revenue-modal__title">XUẤT BÁO CÁO DOANH THU</h2>
            <p>Lập báo cáo doanh thu chi tiết theo ngày, loại xe, phương thức thanh toán.</p>
          </div>

          <div className="revenue-modal__header-stats" aria-label="Thống kê báo cáo">
            <article className="revenue-modal__stat-card">
              <strong>{summary.totalTrips}</strong>
              <span>Chuyến đi</span>
            </article>

            <article className="revenue-modal__stat-card">
              <strong>{fmt(summary.totalRevenue)}</strong>
              <span>Doanh thu</span>
            </article>

            <article className="revenue-modal__stat-card">
              <strong>{fmt(summary.driverTotal)}</strong>
              <span>Cho tài xế</span>
            </article>

            <article className="revenue-modal__stat-card">
              <strong>{fmt(summary.systemTotal)}</strong>
              <span>Hệ thống</span>
            </article>
          </div>

          <button className="revenue-modal__close" onClick={onClose} aria-label="Đóng báo cáo doanh thu">✕</button>
        </header>

        {/* Filters */}
        <div className="revenue-modal__filters">
          <div className="revenue-modal__filter-group">
            <label className="revenue-modal__filter-label">Từ ngày:</label>
            <div className="revenue-modal__date-wrap">
              <DatePicker
                selected={parseDateForPicker(dateFrom)}
                onChange={(selectedDate) => setDateFrom(formatDateForFilterValue(selectedDate))}
                locale="vi-VN"
                dateFormat="dd/MM/yyyy"
                placeholderText="dd/mm/yyyy"
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                shouldCloseOnSelect
                className="revenue-modal__date-input"
                calendarClassName="admin-user-modal__date-calendar"
                popperClassName="admin-user-modal__date-popper"
                popperPlacement="bottom-start"
                popperModifiers={[
                  {
                    name: 'offset',
                    options: {
                      offset: [0, 8],
                    },
                  },
                  {
                    name: 'flip',
                    options: {
                      fallbackPlacements: ['top-start', 'bottom-start'],
                    },
                  },
                  {
                    name: 'preventOverflow',
                    options: {
                      rootBoundary: 'viewport',
                      altAxis: true,
                    },
                  },
                ]}
                autoComplete="off"
                showPopperArrow={false}
              />
            </div>
          </div>
          <div className="revenue-modal__filter-group">
            <label className="revenue-modal__filter-label">Đến ngày:</label>
            <div className="revenue-modal__date-wrap">
              <DatePicker
                selected={parseDateForPicker(dateTo)}
                onChange={(selectedDate) => setDateTo(formatDateForFilterValue(selectedDate))}
                locale="vi-VN"
                dateFormat="dd/MM/yyyy"
                placeholderText="dd/mm/yyyy"
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                shouldCloseOnSelect
                className="revenue-modal__date-input"
                calendarClassName="admin-user-modal__date-calendar"
                popperClassName="admin-user-modal__date-popper"
                popperPlacement="bottom-start"
                popperModifiers={[
                  {
                    name: 'offset',
                    options: {
                      offset: [0, 8],
                    },
                  },
                  {
                    name: 'flip',
                    options: {
                      fallbackPlacements: ['top-start', 'bottom-start'],
                    },
                  },
                  {
                    name: 'preventOverflow',
                    options: {
                      rootBoundary: 'viewport',
                      altAxis: true,
                    },
                  },
                ]}
                autoComplete="off"
                showPopperArrow={false}
              />
            </div>
          </div>
          <select
            className="revenue-modal__select"
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
          >
            {VEHICLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            className="revenue-modal__select"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
          >
            {PAYMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button className="revenue-modal__filter-btn" onClick={handleFilter}>Lọc</button>
          <button
            className="revenue-modal__reload-btn atm-toolbar__refresh"
            onClick={fetchData}
            disabled={loading}
            aria-label="Tải lại dữ liệu doanh thu"
            title="Tải lại dữ liệu doanh thu"
          >
            {loading ? '⟳' : '↺'}
          </button>
        </div>

        {/* Export buttons */}
        <div className="revenue-modal__export-row">
          <button className="revenue-modal__export-btn revenue-modal__export-btn--excel" onClick={handleExcelExport}>
            Xuất excel 📊
          </button>
          <button className="revenue-modal__export-btn revenue-modal__export-btn--pdf" onClick={handlePDFExport}>
            Xuất PDF 🖨
          </button>
        </div>

        {/* Table */}
        <div className="revenue-modal__table-wrap">
          {loading && (
            <div className="revenue-modal__loading">Đang tải dữ liệu...</div>
          )}
          {!loading && error && (
            <div className="revenue-modal__error">{error}</div>
          )}
          {!loading && !error && (
            <table className="revenue-modal__table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Mã chuyến</th>
                  <th>Loại xe</th>
                  <th>Quảng đường</th>
                  <th>Giá gốc</th>
                  <th>Giảm giá</th>
                  <th>Phụ phí</th>
                  <th>Khách trả</th>
                  <th>Tài xế nhận</th>
                  <th>Hoa hồng</th>
                  <th>Thanh toán</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
                      Không có dữ liệu trong khoảng thời gian đã chọn
                    </td>
                  </tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.bookingCode}>
                    <td>{row.date}</td>
                    <td className="revenue-modal__code">{row.bookingCode}</td>
                    <td>{row.vehicleLabel}</td>
                    <td>{row.distanceKm.toFixed(1)} km</td>
                    <td className="revenue-modal__num">{fmt(row.originalPrice)}</td>
                    <td className="revenue-modal__num revenue-modal__num--discount">{row.discountAmount > 0 ? fmt(row.discountAmount) : '0'}</td>
                    <td className="revenue-modal__num">{fmt(row.surcharge)}</td>
                    <td className="revenue-modal__num revenue-modal__num--bold">{fmt(row.customerPays)}</td>
                    <td className="revenue-modal__num">{fmt(row.driverNet)}</td>
                    <td className="revenue-modal__num revenue-modal__num--fee">{fmt(row.platformFee)}</td>
                    <td className="revenue-modal__payment">{row.paymentLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!loading && !error && (
          <div className="revenue-modal__footer">
            Hiển thị {filteredRows.length} chuyến hoàn thành
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
