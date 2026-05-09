import { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import { rideService } from '../../services/rideService';
import { adminUserService } from '../../services/adminUserService';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('vi-VN', vi);

const DATE_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
});

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const CURRENCY_FORMATTER = new Intl.NumberFormat('vi-VN');

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }

  const ddmmyyyy = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
    return null;
  }

  const yyyymmdd = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    const year = Number(yyyymmdd[1]);
    const month = Number(yyyymmdd[2]);
    const day = Number(yyyymmdd[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
    return null;
  }

  return null;
}

function parseDateForPicker(dateString) {
  const normalizedValue = String(dateString ?? '').trim();
  if (!normalizedValue) {
    return null;
  }

  const parsedIsoDate = parse(normalizedValue, 'yyyy-MM-dd', new Date());
  if (isValid(parsedIsoDate)) {
    return parsedIsoDate;
  }

  const parsedSlashDate = parse(normalizedValue, 'dd/MM/yyyy', new Date());
  if (isValid(parsedSlashDate)) {
    return parsedSlashDate;
  }

  return null;
}

function formatDateForFilterValue(dateValue) {
  if (!(dateValue instanceof Date) || !isValid(dateValue)) {
    return '';
  }

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTripStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return 'pending';
  }

  if (normalized.includes('dahuy') || normalized.includes('cancel')) {
    return 'cancelled';
  }

  if (normalized.includes('hoanthanh') || normalized.includes('completed')) {
    return 'completed';
  }

  if (normalized.includes('dang') || normalized.includes('in-progress') || normalized.includes('processing')) {
    return 'pending';
  }

  if (normalized.includes('danhanchuyen') || normalized.includes('chotx') || normalized.includes('chotaixe')) {
    return 'pending';
  }

  return 'pending';
}

function getTripDate(item) {
  const source = item?.bookedAt || item?.createdAt || item?.completedAt || item?.updatedAt || item?.date;
  const parsed = source ? new Date(source) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatRevenue(value) {
  return `${CURRENCY_FORMATTER.format(Math.round(value || 0))}đ`;
}

function formatCompactRevenue(value) {
  const millions = Number(value || 0) / 1000000;
  return `${millions.toFixed(millions >= 10 ? 0 : 1)} triệu`;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function buildLinePath(points, width, height, maxValue) {
  if (!points.length) {
    return '';
  }

  const horizontalPadding = 38;
  const verticalPadding = 18;
  const chartWidth = width - horizontalPadding * 2;
  const chartHeight = height - verticalPadding * 2;
  const safeMax = Math.max(maxValue, 1);

  return points
    .map((point, index) => {
      const x = horizontalPadding + (points.length === 1 ? chartWidth / 2 : (chartWidth * index) / (points.length - 1));
      const y = verticalPadding + chartHeight - (chartHeight * point.value) / safeMax;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = {
    x: cx + radius * Math.cos(startAngle),
    y: cy + radius * Math.sin(startAngle),
  };
  const end = {
    x: cx + radius * Math.cos(endAngle),
    y: cy + radius * Math.sin(endAngle),
  };
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function DashboardLineChart({ data = [], mode = 'day', onShowTooltip, onMoveTooltip, onHideTooltip }) {
  const horizontalPadding = 38;
  const verticalPadding = 18;
  const minWidth = 760;
  const minChartWidth = minWidth - horizontalPadding * 2;
  const pointSpacing = mode === 'day' ? 42 : mode === 'week' ? 48 : 56;
  const chartWidth = Math.max(minChartWidth, Math.max(0, data.length - 1) * pointSpacing);
  const width = chartWidth + horizontalPadding * 2;
  const height = 250;
  const maxRideCount = Math.max(1, ...data.map((item) => item.tripCount));
  const maxRevenueM = Math.max(1, ...data.map((item) => item.revenueMillion));
  const scaleMax = Math.max(maxRideCount, maxRevenueM);

  const ridePath = buildLinePath(
    data.map((item) => ({ value: item.tripCount })),
    width,
    height,
    scaleMax,
  );
  const revenuePath = buildLinePath(
    data.map((item) => ({ value: item.revenueMillion })),
    width,
    height,
    scaleMax,
  );

  const isWideChart = width > minWidth;
  const targetLabelCount = mode === 'day' ? 12 : 16;
  const labelStep = data.length > targetLabelCount ? Math.ceil(data.length / targetLabelCount) : 1;
  const chartHeight = height - verticalPadding * 2;

  return (
    <svg
      className="admin-dashboard__line-chart"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width}px` }}
      role="img"
      aria-label="Biểu đồ trạng thái chuyến và doanh thu"
    >
      <rect x="0" y="0" width={width} height={height} fill="transparent" />

      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = verticalPadding + chartHeight * ratio;
        return (
          <line
            key={String(ratio)}
            x1={horizontalPadding}
            y1={y}
            x2={width - horizontalPadding}
            y2={y}
            stroke="rgba(12, 54, 116, 0.18)"
            strokeDasharray="4 6"
          />
        );
      })}

      {ridePath ? <path d={ridePath} fill="none" stroke="#1f6feb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {revenuePath ? <path d={revenuePath} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}

      {data.map((item, index) => {
        const x = horizontalPadding + (data.length === 1 ? chartWidth / 2 : (chartWidth * index) / (data.length - 1));
        const tripY = verticalPadding + chartHeight - (chartHeight * item.tripCount) / Math.max(scaleMax, 1);
        const revenueY = verticalPadding + chartHeight - (chartHeight * item.revenueMillion) / Math.max(scaleMax, 1);
        const shouldRenderAxisLabel = index === 0 || index === data.length - 1 || index % labelStep === 0;

        return (
          <g key={item.label}>
            <circle
              cx={x} cy={tripY} r="11" fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseMove={(e) => { onMoveTooltip?.(e); onShowTooltip?.(e, [`📅 ${item.fullDateLabel}`, `🚗 Chuyến đi: ${item.tripCount}`]); }}
              onMouseLeave={() => onHideTooltip?.()}
            />
            <circle
              cx={x} cy={revenueY} r="11" fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseMove={(e) => { onMoveTooltip?.(e); onShowTooltip?.(e, [`📅 ${item.fullDateLabel}`, `💰 Doanh thu: ${formatRevenue(item.revenue)}`]); }}
              onMouseLeave={() => onHideTooltip?.()}
            />
            <circle cx={x} cy={tripY} r="4" fill="#1f6feb" style={{ pointerEvents: 'none' }} />
            <circle cx={x} cy={revenueY} r="4" fill="#f97316" style={{ pointerEvents: 'none' }} />
            <text
              x={x}
              y={height - 6}
              textAnchor="middle"
              className={`admin-dashboard__axis-label${isWideChart ? ' admin-dashboard__axis-label--compact' : ''}`}
            >
              {shouldRenderAxisLabel ? item.label : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DashboardPieChart({ segments = [], onShowTooltip, onMoveTooltip, onHideTooltip }) {
  const size = 250;
  const cx = 125;
  const cy = 125;
  const radius = 82;
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0));

  let angleCursor = -Math.PI / 2;

  return (
    <svg className="admin-dashboard__pie-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Biểu đồ tỷ lệ trạng thái chuyến đi">
      {segments.map((segment) => {
        const ratio = segment.value / total;
        const endAngle = angleCursor + ratio * Math.PI * 2;
        const pathD = describeArc(cx, cy, radius, angleCursor, endAngle);
        angleCursor = endAngle;

        return (
          <path
            key={segment.id}
            d={pathD}
            fill={segment.color}
            stroke="#fff"
            strokeWidth="2"
            style={{ cursor: 'pointer' }}
            onMouseMove={(e) => { onMoveTooltip?.(e); onShowTooltip?.(e, [`${segment.label}`, `Số chuyến: ${segment.value}`, `Tỷ lệ: ${segment.percent.toFixed(1)}%`]); }}
            onMouseLeave={() => onHideTooltip?.()}
          />
        );
      })}
      <circle cx={cx} cy={cy} r="44" fill="#fff" />
      <text x={cx} y={cy - 4} textAnchor="middle" className="admin-dashboard__pie-total-label">
        Tổng
      </text>
      <text x={cx} y={cy + 19} textAnchor="middle" className="admin-dashboard__pie-total-value">
        {total}
      </text>
    </svg>
  );
}

function DashboardBarChart({ data = [], onShowTooltip, onMoveTooltip, onHideTooltip }) {
  const width = 420;
  const height = 245;
  const barWidth = data.length ? Math.min(52, Math.floor((width - 80) / data.length) - 12) : 38;
  const chartBottom = height - 42;
  const chartTop = 24;
  const maxValue = Math.max(1, ...data.map((item) => item.value));

  return (
    <svg className="admin-dashboard__bar-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ top tài xế theo số chuyến">
      <line x1="34" y1={chartTop} x2="34" y2={chartBottom} stroke="rgba(12, 54, 116, 0.4)" strokeWidth="1" />
      <line x1="34" y1={chartBottom} x2={width - 18} y2={chartBottom} stroke="rgba(12, 54, 116, 0.4)" strokeWidth="1" />

      {data.map((item, index) => {
        const x = 48 + index * (barWidth + 16);
        const barHeight = ((chartBottom - chartTop) * item.value) / maxValue;
        const y = chartBottom - barHeight;

        return (
          <g key={item.id}>
            <rect
              x={x} y={y} width={barWidth} height={barHeight} rx="8" fill="#2563eb"
              style={{ cursor: 'pointer' }}
              onMouseMove={(e) => { onMoveTooltip?.(e); onShowTooltip?.(e, [`🧑‍✈️ ${item.fullLabel}`, `Số chuyến: ${item.value}`]); }}
              onMouseLeave={() => onHideTooltip?.()}
            />
            <text x={x + barWidth / 2} y={y - 7} textAnchor="middle" className="admin-dashboard__bar-value">
              {item.value}
            </text>
            <text x={x + barWidth / 2} y={chartBottom + 16} textAnchor="middle" className="admin-dashboard__axis-label">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AdminDashboardSection({ onNotify }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, lines: [] });
  const lineChartScrollerRef = useRef(null);

  const showTooltip = (e, lines) => setTooltip({ visible: true, x: e.clientX, y: e.clientY, lines });
  const moveTooltip = (e) => setTooltip((prev) => (prev.visible ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  const hideTooltip = () => setTooltip((prev) => ({ ...prev, visible: false }));

  const [viewMode, setViewMode] = useState('all');
  // Draft state: what user is currently typing/selecting in pickers
  const [draftFromDate, setDraftFromDate] = useState('');
  const [draftToDate, setDraftToDate] = useState('');
  // Applied state: what actually filters the data
  const [appliedFromDate, setAppliedFromDate] = useState('');
  const [appliedToDate, setAppliedToDate] = useState('');

  const applyDateFilter = () => {
    const notifyValidationError = (message) => {
      if (typeof onNotify === 'function') {
        onNotify(message, 'error', 2800);
        return;
      }

      setError(message);
    };

    const filterInputElements = document.querySelectorAll('.admin-dashboard__filters input');
    const fromInputValue = String(filterInputElements?.[0]?.value ?? '').trim();
    const toInputValue = String(filterInputElements?.[1]?.value ?? '').trim();

    const fromRaw = fromInputValue || String(draftFromDate ?? '').trim();
    const toRaw = toInputValue || String(draftToDate ?? '').trim();

    if (fromRaw && !parseDateInput(fromRaw)) {
      notifyValidationError('Ngày bắt đầu chưa hợp lệ. Vui lòng nhập đúng định dạng dd/MM/yyyy hoặc chọn trực tiếp từ lịch.');
      return;
    }

    if (toRaw && !parseDateInput(toRaw)) {
      notifyValidationError('Ngày kết thúc chưa hợp lệ. Vui lòng nhập đúng định dạng dd/MM/yyyy hoặc chọn trực tiếp từ lịch.');
      return;
    }

    const parsedFrom = parseDateInput(fromRaw);
    const parsedTo = parseDateInput(toRaw);

    if (parsedFrom && parsedTo && parsedFrom.getTime() >= parsedTo.getTime()) {
      notifyValidationError('Khoảng thời gian chưa hợp lệ: "Từ ngày" cần sớm hơn "Đến ngày".');
      return;
    }

    if (error) {
      setError('');
    }

    setAppliedFromDate(parsedFrom ? formatDateForFilterValue(parsedFrom) : '');
    setAppliedToDate(parsedTo ? formatDateForFilterValue(parsedTo) : '');
  };

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError('');

    Promise.all([
      rideService.getTripHistory({ roleCode: 'Q1', limit: 5000, view: 'dashboard' }, { signal: controller.signal }),
      adminUserService.listUsers({ signal: controller.signal }),
    ])
      .then(([tripResponse, userResponse]) => {
        const tripItems = Array.isArray(tripResponse?.items) ? tripResponse.items : [];
        const accountItems = Array.isArray(userResponse?.accounts) ? userResponse.accounts : [];

        setTrips(tripItems);
        setUsers(accountItems);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) {
          return;
        }

        setTrips([]);
        setUsers([]);
        setError(requestError?.message || 'Không thể tải dữ liệu dashboard. Vui lòng thử lại.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const filteredTrips = useMemo(() => {
    const from = parseDateInput(appliedFromDate);
    const to = parseDateInput(appliedToDate);

    return trips.filter((item) => {
      const tripDate = getTripDate(item);

      if (!tripDate) {
        return false;
      }

      if (from && tripDate < from) {
        return false;
      }

      if (to) {
        const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
        if (tripDate > toEnd) {
          return false;
        }
      }

      return true;
    });
  }, [appliedFromDate, appliedToDate, trips]);

  const metrics = useMemo(() => {
    const totalCustomers = users.filter((user) => String(user?.roleCode ?? '').trim().toUpperCase() === 'Q2').length;
    const totalDrivers = users.filter((user) => String(user?.roleCode ?? '').trim().toUpperCase() === 'Q3').length;
    const totalTrips = filteredTrips.length;
    const totalRevenue = filteredTrips.reduce((sum, trip) => sum + Number(trip?.price ?? 0), 0);

    return {
      totalCustomers,
      totalDrivers,
      totalTrips,
      totalRevenue,
    };
  }, [filteredTrips, users]);

  const dataSpanDays = useMemo(() => {
    if (!filteredTrips.length) {
      return 0;
    }

    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;

    filteredTrips.forEach((trip) => {
      const tripDate = getTripDate(trip);
      if (!tripDate) {
        return;
      }

      const time = tripDate.getTime();
      minTime = Math.min(minTime, time);
      maxTime = Math.max(maxTime, time);
    });

    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
      return 0;
    }

    return Math.max(1, Math.floor((maxTime - minTime) / (24 * 60 * 60 * 1000)) + 1);
  }, [filteredTrips]);

  const activeViewMode = useMemo(() => {
    if (viewMode !== 'all') {
      return viewMode;
    }

    if (dataSpanDays > 90) {
      return 'month';
    }

    if (dataSpanDays >= 30) {
      return 'week';
    }

    return 'day';
  }, [dataSpanDays, viewMode]);

  const modeLabel = viewMode === 'all'
    ? `tự động (${activeViewMode === 'day' ? 'theo ngày' : activeViewMode === 'week' ? 'theo tuần' : 'theo tháng'})`
    : activeViewMode === 'day'
      ? 'theo ngày'
      : activeViewMode === 'week'
        ? 'theo tuần'
        : 'theo tháng';

  const lineChartData = useMemo(() => {
    const map = new Map();

    filteredTrips.forEach((trip) => {
      const tripDate = getTripDate(trip);
      if (!tripDate) return;

      let key;
      let label;
      let fullDateLabel;
      let sortTime = tripDate.getTime();

      if (activeViewMode === 'month') {
        const y = tripDate.getFullYear();
        const m = String(tripDate.getMonth() + 1).padStart(2, '0');
        key = `${y}-${m}`;
        label = `${m}/${String(y).slice(2)}`;
        fullDateLabel = `Tháng ${tripDate.getMonth() + 1}/${y}`;
        sortTime = new Date(y, tripDate.getMonth(), 1).getTime();
      } else if (activeViewMode === 'week') {
        const { week, year } = getISOWeek(tripDate);
        const wStr = String(week).padStart(2, '0');
        key = `${year}-W${wStr}`;
        label = `T${week}`;
        fullDateLabel = `Tuần ${week}/${year}`;
        sortTime = new Date(tripDate.getFullYear(), tripDate.getMonth(), tripDate.getDate()).getTime();
      } else {
        const y = tripDate.getFullYear();
        const mStr = String(tripDate.getMonth() + 1).padStart(2, '0');
        const dStr = String(tripDate.getDate()).padStart(2, '0');
        key = `${y}-${mStr}-${dStr}`;
        label = DATE_FORMATTER.format(tripDate);
        fullDateLabel = FULL_DATE_FORMATTER.format(tripDate);
      }

      const existing = map.get(key) || { key, label, fullDateLabel, sortTime, tripCount: 0, revenue: 0 };
      existing.tripCount += 1;
      existing.revenue += Number(trip?.price ?? 0);
      existing.sortTime = Math.min(existing.sortTime, sortTime);
      map.set(key, existing);
    });

    return Array.from(map.values())
      .sort((a, b) => (a.sortTime - b.sortTime) || a.key.localeCompare(b.key))
      .map((entry) => ({
        label: entry.label,
        fullDateLabel: entry.fullDateLabel,
        tripCount: entry.tripCount,
        revenue: entry.revenue,
        revenueMillion: Number((entry.revenue / 1000000).toFixed(2)),
      }));
  }, [activeViewMode, filteredTrips]);

  useEffect(() => {
    if (lineChartScrollerRef.current) {
      lineChartScrollerRef.current.scrollLeft = 0;
    }
  }, [activeViewMode, appliedFromDate, appliedToDate, lineChartData.length]);

  const statusSegments = useMemo(() => {
    const counters = {
      completed: 0,
      pending: 0,
      cancelled: 0,
    };

    filteredTrips.forEach((trip) => {
      const key = normalizeTripStatus(trip?.tripStatus ?? trip?.status);
      counters[key] += 1;
    });

    const total = Math.max(1, counters.completed + counters.pending + counters.cancelled);

    return [
      {
        id: 'completed',
        label: 'Hoàn thành',
        value: counters.completed,
        percent: (counters.completed * 100) / total,
        color: '#2563eb',
      },
      {
        id: 'pending',
        label: 'Đang xử lý',
        value: counters.pending,
        percent: (counters.pending * 100) / total,
        color: '#f59e0b',
      },
      {
        id: 'cancelled',
        label: 'Đã hủy',
        value: counters.cancelled,
        percent: (counters.cancelled * 100) / total,
        color: '#ef4444',
      },
    ];
  }, [filteredTrips]);

  const topDrivers = useMemo(() => {
    const counts = new Map();

    filteredTrips.forEach((trip) => {
      const rawName = String(trip?.driverDisplayName ?? trip?.driverName ?? '').trim();
      if (!rawName) {
        return;
      }

      counts.set(rawName, (counts.get(rawName) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value], index) => ({
        id: `${name}-${index}`,
        label: name.length > 12 ? `${name.slice(0, 10)}…` : name,
        fullLabel: name,
        value,
      }));
  }, [filteredTrips]);

  return (
    <>
      {tooltip.visible && (
        <div
          className="admin-dashboard__tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 8 }}
          aria-hidden="true"
        >
          {tooltip.lines.map((line, i) => (
            <span key={i} className={i === 0 ? 'admin-dashboard__tooltip-title' : 'admin-dashboard__tooltip-row'}>
              {line}
            </span>
          ))}
        </div>
      )}
      <section className="admin-dashboard" aria-label="Admin dashboard">
      <div className="container admin-dashboard__container">
        <header className="admin-dashboard__header">
          <h2>Admin dashboard</h2>

          <div className="admin-dashboard__filters">
            <label className="admin-dashboard__mode-select-wrap">
              <span>Kiểu hiển thị:</span>
              <select
                className="admin-dashboard__mode-select"
                value={viewMode}
                onChange={(event) => {
                  const nextMode = event.target.value;
                  setViewMode(nextMode);

                  if (nextMode === 'all') {
                    setDraftFromDate('');
                    setDraftToDate('');
                    setAppliedFromDate('');
                    setAppliedToDate('');
                  }
                }}
              >
                <option value="all">Tự động</option>
                <option value="day">Theo ngày</option>
                <option value="week">Theo tuần</option>
                <option value="month">Theo tháng</option>
              </select>
            </label>

            <label>
              <span>Từ ngày:</span>
              <DatePicker
                selected={parseDateForPicker(draftFromDate)}
                onChange={(selectedDate) => setDraftFromDate(formatDateForFilterValue(selectedDate))}
                onChangeRaw={(event) => setDraftFromDate(event.target.value)}
                locale="vi-VN"
                dateFormat="dd/MM/yyyy"
                placeholderText="Tất cả"
                isClearable
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                shouldCloseOnSelect
                className="admin-user-modal__date-input admin-dashboard__date-input"
                calendarClassName="admin-user-modal__date-calendar"
                popperClassName="admin-user-modal__date-popper"
                popperPlacement="bottom-start"
                autoComplete="off"
                showPopperArrow={false}
              />
            </label>

            <label>
              <span>Đến ngày:</span>
              <DatePicker
                selected={parseDateForPicker(draftToDate)}
                onChange={(selectedDate) => setDraftToDate(formatDateForFilterValue(selectedDate))}
                onChangeRaw={(event) => setDraftToDate(event.target.value)}
                locale="vi-VN"
                dateFormat="dd/MM/yyyy"
                placeholderText="dd/mm/yyyy"
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                shouldCloseOnSelect
                className="admin-user-modal__date-input admin-dashboard__date-input"
                calendarClassName="admin-user-modal__date-calendar"
                popperClassName="admin-user-modal__date-popper"
                popperPlacement="bottom-start"
                autoComplete="off"
                showPopperArrow={false}
              />
            </label>

            <button
              className="admin-dashboard__filter-button"
              onClick={applyDateFilter}
            >
              Lọc
            </button>

          </div>
        </header>

        {loading ? <p className="admin-dashboard__state">Đang tải dữ liệu dashboard...</p> : null}
        {!loading && error ? <p className="admin-dashboard__state admin-dashboard__state--error">{error}</p> : null}

        {!loading && !error ? (
          <>
            <section className="admin-dashboard__stats" aria-label="Tổng quan nhanh">
              <article className="admin-dashboard__card">
                <span>Tổng khách hàng</span>
                <strong>{metrics.totalCustomers}</strong>
              </article>

              <article className="admin-dashboard__card">
                <span>Tổng tài xế</span>
                <strong>{metrics.totalDrivers}</strong>
              </article>

              <article className="admin-dashboard__card">
                <span>Tổng số chuyến đi</span>
                <strong>{metrics.totalTrips}</strong>
              </article>

              <article className="admin-dashboard__card">
                <span>Doanh thu</span>
                <strong>{formatRevenue(metrics.totalRevenue)}</strong>
              </article>
            </section>

            <section className="admin-dashboard__chart-block" aria-label="Biểu đồ trạng thái chuyến và doanh thu">
              <header className="admin-dashboard__chart-header">
                <h3>Biểu đồ trạng thái chuyến & doanh thu <small>({modeLabel})</small></h3>
                <div className="admin-dashboard__legend">
                  <span className="admin-dashboard__legend-item">
                    <i style={{ backgroundColor: '#1f6feb' }} aria-hidden="true" /> Chuyến đi
                  </span>
                  <span className="admin-dashboard__legend-item">
                    <i style={{ backgroundColor: '#f97316' }} aria-hidden="true" /> Doanh thu triệu
                  </span>
                </div>
              </header>

              <div className="admin-dashboard__line-chart-scroller" ref={lineChartScrollerRef}>
                <DashboardLineChart
                  data={lineChartData}
                  mode={activeViewMode}
                  onShowTooltip={showTooltip}
                  onMoveTooltip={moveTooltip}
                  onHideTooltip={hideTooltip}
                />
              </div>
            </section>

            <section className="admin-dashboard__split" aria-label="Biểu đồ trạng thái và top tài xế">
              <article className="admin-dashboard__chart-card">
                <h3>Biểu đồ tỷ lệ trạng thái chuyến</h3>
                <div className="admin-dashboard__pie-layout">
                  <DashboardPieChart segments={statusSegments} onShowTooltip={showTooltip} onMoveTooltip={moveTooltip} onHideTooltip={hideTooltip} />

                  <div className="admin-dashboard__status-list">
                    {statusSegments.map((segment) => (
                      <p key={segment.id}>
                        <span className="admin-dashboard__dot" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                        {segment.label}: <strong>{segment.percent.toFixed(1)}%</strong>
                      </p>
                    ))}
                  </div>
                </div>
              </article>

              <article className="admin-dashboard__chart-card">
                <h3>Top tài xế</h3>
                {topDrivers.length ? (
                  <>
                    <DashboardBarChart data={topDrivers} onShowTooltip={showTooltip} onMoveTooltip={moveTooltip} onHideTooltip={hideTooltip} />
                    <ul className="admin-dashboard__driver-list" aria-label="Danh sách top tài xế">
                      {topDrivers.map((driver) => (
                        <li key={driver.id}>
                          <span>{driver.fullLabel}</span>
                          <strong>{driver.value} chuyến</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="admin-dashboard__state">Chưa có dữ liệu tài xế trong khoảng thời gian đã chọn.</p>
                )}
              </article>
            </section>
          </>
        ) : null}
      </div>
    </section>
    </>
  );
}
