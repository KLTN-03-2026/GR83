import sql from 'mssql';
import { getSqlServerPool } from './database.service.js';
import { broadcastAdminEvent } from './ride.realtime.service.js';
import { createNotification } from './notification.service.js';

const VIOLATION_TYPES = {
  'cancel-trip': { label: 'Hủy chuyến', tone: 'warning' },
  'driver-attitude': { label: 'Thái độ', tone: 'danger' },
  'unsafe-driving': { label: 'Vi phạm tốc độ', tone: 'danger' },
  'fraud-risk': { label: 'Gian lận', tone: 'danger' },
  other: { label: 'Khác', tone: 'neutral' },
};

const VIOLATION_STATUS_LABELS = {
  pending: 'Chưa xử lí',
  resolved: 'Đã xử lí',
};

const SEVERITY_LABELS = {
  low: 'Nhẹ',
  medium: 'Trung bình',
  high: 'Nặng',
};

const RESOLUTION_ACTION_LABELS = {
  warning: 'Cảnh cáo',
  'suspend-3-days': 'Tạm ngưng 3 ngày',
  'permanent-lock': 'Khóa vĩnh viễn',
};

let driverViolationSchemaPromise = null;
let inMemoryViolationIdSeed = 1;
const inMemoryViolations = new Map();

function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details && typeof details === 'object') {
    error.details = details;
  }

  return error;
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function hasSpeedingKeywords(text) {
  const normalized = normalizeText(text).toLowerCase();

  return normalized.includes('tốc độ')
    || normalized.includes('vượt quá tốc độ')
    || normalized.includes('chạy nhanh')
    || normalized.includes('phóng nhanh');
}

function parseLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 100);
}

function parseViolationId(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(400, 'Mã vi phạm không hợp lệ.');
  }

  return parsed;
}

function normalizeAccountId(value, label = 'tài khoản') {
  const normalized = normalizeText(value);

  if (!normalized || normalized.length > 20) {
    throw createHttpError(400, `Mã ${label} không hợp lệ.`);
  }

  return normalized;
}

function normalizeViolationType(value, { allowAll = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return allowAll ? 'all' : 'other';
  }

  if (allowAll && normalized === 'all') {
    return 'all';
  }

  if (Object.prototype.hasOwnProperty.call(VIOLATION_TYPES, normalized)) {
    return normalized;
  }

  throw createHttpError(400, 'Loại vi phạm không hợp lệ.');
}

function normalizeViolationStatus(value, { allowAll = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return allowAll ? 'all' : 'pending';
  }

  if (allowAll && normalized === 'all') {
    return 'all';
  }

  if (normalized === 'pending' || normalized === 'resolved') {
    return normalized;
  }

  throw createHttpError(400, 'Trạng thái xử lí vi phạm không hợp lệ.');
}

function normalizeSeverity(value) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return 'medium';
  }

  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }

  throw createHttpError(400, 'Mức độ vi phạm không hợp lệ.');
}

function normalizeResolutionAction(value) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return '';
  }

  if (
    normalized === 'warning'
    || normalized === 'suspend-3-days'
    || normalized === 'permanent-lock'
  ) {
    return normalized;
  }

  throw createHttpError(400, 'Hình thức xử lí không hợp lệ.');
}

function normalizeAdminNote(value, { allowEmpty = true } = {}) {
  const normalized = normalizeText(value);

  if (!normalized && allowEmpty) {
    return '';
  }

  if (!normalized) {
    throw createHttpError(400, 'Vui lòng nhập ghi chú xử lí.');
  }

  if (normalized.length > 1200) {
    throw createHttpError(400, 'Ghi chú xử lí không được vượt quá 1200 ký tự.');
  }

  return normalized;
}

function normalizeCancellationMeta(cancelMeta = {}) {
  return {
    cancelledByAccountId: normalizeText(cancelMeta.cancelledByAccountId ?? cancelMeta.cancelledById ?? ''),
    cancelledByRoleCode: normalizeText(cancelMeta.cancelledByRoleCode ?? cancelMeta.cancelledByRole ?? cancelMeta.roleCode ?? ''),
    cancelReason: normalizeText(
      cancelMeta.cancelReason
      ?? cancelMeta.cancelReasonText
      ?? cancelMeta.reasonText
      ?? cancelMeta.reasonLabel
      ?? cancelMeta.cancelReasonCustomReason
      ?? '',
    ),
  };
}

function parseCancellationMeta(rawValue = '') {
  const normalizedValue = normalizeText(rawValue);

  if (!normalizedValue) {
    return normalizeCancellationMeta();
  }

  if (normalizedValue.startsWith('{')) {
    try {
      return normalizeCancellationMeta(JSON.parse(normalizedValue));
    } catch {
      // Fall through.
    }
  }

  const parts = normalizedValue.split('|||');

  if (parts.length >= 3) {
    return normalizeCancellationMeta({
      cancelledByRoleCode: parts[0],
      cancelledByAccountId: parts[1],
      cancelReason: parts.slice(2).join('|||'),
    });
  }

  return normalizeCancellationMeta({ cancelReason: normalizedValue });
}

function mapIssueTypeToViolationType(issueType, description = '') {
  const normalizedIssueType = normalizeText(issueType).toLowerCase();
  const normalizedDescription = normalizeText(description).toLowerCase();

  if (normalizedIssueType === 'driver-attitude') {
    return 'driver-attitude';
  }

  if (normalizedIssueType === 'unsafe-driving' || normalizedIssueType === 'safety-threat') {
    return 'unsafe-driving';
  }

  if (normalizedDescription.includes('thái độ') || normalizedDescription.includes('khó chịu') || normalizedDescription.includes('thô lỗ')) {
    return 'driver-attitude';
  }

  if (normalizedDescription.includes('nguy hiểm') || normalizedDescription.includes('ẩu') || hasSpeedingKeywords(normalizedDescription)) {
    return 'unsafe-driving';
  }

  return 'other';
}

function mapViolationRow(row = {}) {
  const violationType = normalizeText(row.LoaiViPham ?? row.violationType).toLowerCase() || 'other';
  const status = normalizeText(row.TrangThai ?? row.status).toLowerCase() || 'pending';
  const severity = normalizeText(row.MucDo ?? row.severity).toLowerCase() || 'medium';
  const resolutionAction = normalizeText(row.HinhThucXuLy ?? row.resolutionAction).toLowerCase();
  const detectedAt = row.NgayPhatHien ? new Date(row.NgayPhatHien) : null;
  const handledAt = row.NgayXuLy ? new Date(row.NgayXuLy) : null;
  const createdAt = row.NgayTao ? new Date(row.NgayTao) : null;
  const updatedAt = row.NgayCapNhat ? new Date(row.NgayCapNhat) : null;

  return {
    id: Number(row.MaVP ?? row.id ?? 0) || 0,
    bookingCode: normalizeText(row.MaChuyen ?? row.bookingCode),
    complaintId: Number(row.MaKN ?? row.complaintId ?? 0) || null,
    fingerprint: normalizeText(row.Fingerprint ?? row.fingerprint),
    sourceType: normalizeText(row.NguonPhatHien ?? row.sourceType).toLowerCase() || 'system',
    sourceLabel: normalizeText(row.sourceLabel) || 'Hệ thống',
    violationType,
    violationLabel: normalizeText(row.TenLoaiViPham ?? row.violationLabel) || VIOLATION_TYPES[violationType]?.label || VIOLATION_TYPES.other.label,
    violationTone: VIOLATION_TYPES[violationType]?.tone || 'neutral',
    description: normalizeText(row.MoTa ?? row.description),
    severity,
    severityLabel: SEVERITY_LABELS[severity] ?? SEVERITY_LABELS.medium,
    status,
    statusLabel: VIOLATION_STATUS_LABELS[status] ?? VIOLATION_STATUS_LABELS.pending,
    resolutionAction,
    resolutionActionLabel: RESOLUTION_ACTION_LABELS[resolutionAction] ?? '',
    adminNote: normalizeText(row.GhiChuAdmin ?? row.adminNote),
    handledByAccountId: normalizeText(row.MaTKXuLy ?? row.handledByAccountId),
    handledByName: normalizeText(row.handledByName),
    driverAccountId: normalizeText(row.MaTX ?? row.driverAccountId),
    driverSystemAccountId: normalizeText(row.MaTKTaiXe ?? row.driverSystemAccountId),
    driverName: normalizeText(row.TenTaiXe ?? row.driverName),
    driverPhone: normalizeText(row.driverPhone),
    customerName: normalizeText(row.TenKhachHang ?? row.customerName),
    detectedAt: detectedAt && !Number.isNaN(detectedAt.getTime()) ? detectedAt.toISOString() : '',
    handledAt: handledAt && !Number.isNaN(handledAt.getTime()) ? handledAt.toISOString() : '',
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : '',
    updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : '',
    detectionPayload: normalizeText(row.DuLieuPhatHien ?? row.detectionPayload),
  };
}

function buildSummaryRow(row = {}) {
  return {
    totalCount: Number(row.totalCount ?? 0) || 0,
    pendingCount: Number(row.pendingCount ?? 0) || 0,
    resolvedCount: Number(row.resolvedCount ?? 0) || 0,
    highSeverityCount: Number(row.highSeverityCount ?? 0) || 0,
  };
}

function mapCandidateToMemoryViolation(candidate = {}) {
  const violationType = normalizeText(candidate.violationType).toLowerCase() || 'other';
  const severity = normalizeText(candidate.severity).toLowerCase() || 'medium';
  const detectedAt = toIsoDate(candidate.detectedAt);

  return {
    id: 0,
    bookingCode: normalizeText(candidate.bookingCode),
    complaintId: Number(candidate.complaintId ?? 0) || null,
    fingerprint: normalizeText(candidate.fingerprint),
    sourceType: normalizeText(candidate.sourceType).toLowerCase() || 'system',
    sourceLabel: candidate.sourceType === 'complaint'
      ? 'Phản ánh khách hàng'
      : candidate.sourceType === 'rating'
        ? 'Đánh giá chuyến đi'
        : 'Hệ thống tự phát hiện',
    violationType,
    violationLabel: normalizeText(candidate.violationLabel) || VIOLATION_TYPES[violationType]?.label || VIOLATION_TYPES.other.label,
    violationTone: VIOLATION_TYPES[violationType]?.tone || 'neutral',
    description: normalizeText(candidate.description),
    severity,
    severityLabel: SEVERITY_LABELS[severity] ?? SEVERITY_LABELS.medium,
    status: 'pending',
    statusLabel: VIOLATION_STATUS_LABELS.pending,
    resolutionAction: '',
    resolutionActionLabel: '',
    adminNote: '',
    handledByAccountId: '',
    handledByName: '',
    driverAccountId: normalizeText(candidate.driverAccountId),
    driverSystemAccountId: normalizeText(candidate.driverSystemAccountId),
    driverName: normalizeText(candidate.driverName),
    driverPhone: normalizeText(candidate.driverPhone),
    customerName: normalizeText(candidate.customerName),
    detectedAt,
    handledAt: '',
    createdAt: detectedAt,
    updatedAt: detectedAt,
    detectionPayload: normalizeText(candidate.detectionPayload),
  };
}

function buildInMemorySummary(items = []) {
  return items.reduce((summary, item) => {
    summary.totalCount += 1;

    if (item.status === 'pending') {
      summary.pendingCount += 1;
    }

    if (item.status === 'resolved') {
      summary.resolvedCount += 1;
    }

    if (item.severity === 'high') {
      summary.highSeverityCount += 1;
    }

    return summary;
  }, {
    totalCount: 0,
    pendingCount: 0,
    resolvedCount: 0,
    highSeverityCount: 0,
  });
}

function filterViolationItems(items = [], { status = 'all', violationType = 'all', keyword = '' } = {}) {
  const normalizedKeyword = normalizeText(keyword).toLowerCase();

  return items.filter((item) => {
    if (status !== 'all' && item.status !== status) {
      return false;
    }

    if (violationType !== 'all' && item.violationType !== violationType) {
      return false;
    }

    if (!normalizedKeyword) {
      return true;
    }

    return [
      item.bookingCode,
      item.driverName,
      item.description,
      item.violationLabel,
    ].some((value) => normalizeText(value).toLowerCase().includes(normalizedKeyword));
  });
}

function toIsoDate(value) {
  const parsed = value ? new Date(value) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function buildCandidateFingerprint(prefix, value) {
  return `${prefix}:${normalizeText(value).toLowerCase()}`.slice(0, 150);
}

async function loadCancellationCandidates(pool) {
  const result = await pool.request().query(`
    SELECT TOP (240)
      dx.MaChuyen AS bookingCode,
      dx.MaTX AS driverAccountId,
      tx.MaTK AS driverSystemAccountId,
      driverTk.Ten AS driverName,
      driverTk.SDT AS driverPhone,
      dx.TenKhachHang AS customerName,
      dx.LyDoHuy AS cancelReasonRaw,
      dx.NgayCapNhat AS updatedAt,
      dx.NgayTao AS bookedAt
    FROM dbo.DatXe dx
    LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
    LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
    WHERE
      dx.TrangThaiChuyen = N'DaHuy'
      AND NULLIF(dx.MaTX, '') IS NOT NULL
      AND dx.NgayCapNhat >= DATEADD(DAY, -90, SYSDATETIME())
    ORDER BY dx.NgayCapNhat DESC, dx.MaChuyen DESC;
  `);

  return result.recordset ?? [];
}

async function loadLowRatingCandidates(pool) {
  const result = await pool.request().query(`
    SELECT TOP (240)
      dx.MaChuyen AS bookingCode,
      dx.MaTX AS driverAccountId,
      tx.MaTK AS driverSystemAccountId,
      driverTk.Ten AS driverName,
      driverTk.SDT AS driverPhone,
      dx.TenKhachHang AS customerName,
      dg.SoSaoDanhGia AS ratingScore,
      dg.NhanXetDanhGia AS ratingComment,
      dg.ThoiDiemDanhGia AS detectedAt
    FROM dbo.DanhGiaChuyenXe dg
    INNER JOIN dbo.DatXe dx ON dx.MaChuyen = dg.MaChuyen
    LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
    LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
    WHERE
      NULLIF(dx.MaTX, '') IS NOT NULL
      AND dg.SoSaoDanhGia <= 2
      AND dg.ThoiDiemDanhGia >= DATEADD(DAY, -90, SYSDATETIME())
    ORDER BY dg.ThoiDiemDanhGia DESC, dx.MaChuyen DESC;
  `);

  return result.recordset ?? [];
}

async function loadComplaintCandidates(pool) {
  const result = await pool.request().query(`
    SELECT TOP (240)
      kn.MaKN AS complaintId,
      kn.LoaiSuCo AS issueType,
      kn.MoTa AS description,
      kn.NgayTao AS detectedAt,
      dx.MaChuyen AS bookingCode,
      dx.MaTX AS driverAccountId,
      tx.MaTK AS driverSystemAccountId,
      driverTk.Ten AS driverName,
      driverTk.SDT AS driverPhone,
      customerTk.Ten AS customerName
    FROM dbo.KhieuNaiHoTro kn
    INNER JOIN dbo.DatXe dx ON dx.MaChuyen = kn.MaChuyen
    LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
    LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
    LEFT JOIN dbo.TaiKhoan customerTk ON customerTk.MaTK = dx.MaTK
    WHERE
      kn.VaiTroNguoiGui = 'Q2'
      AND NULLIF(dx.MaTX, '') IS NOT NULL
      AND kn.NgayTao >= DATEADD(DAY, -90, SYSDATETIME())
    ORDER BY kn.NgayTao DESC, kn.MaKN DESC;
  `);

  return result.recordset ?? [];
}

function buildSystemViolationCandidates({ cancellationRows = [], ratingRows = [], complaintRows = [] }) {
  const candidates = [];
  const recentCancellationBuckets = new Map();
  const now = new Date();
  const recentWindowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const row of cancellationRows) {
    const cancelMeta = parseCancellationMeta(row.cancelReasonRaw);
    const cancelledByRoleCode = normalizeText(cancelMeta.cancelledByRoleCode).toLowerCase();

    if (cancelledByRoleCode !== 'q3' && cancelledByRoleCode !== 'driver') {
      continue;
    }

    const bookingCode = normalizeText(row.bookingCode);
    const detectedAt = toIsoDate(row.updatedAt || row.bookedAt);
    const description = `Tài xế hủy chuyến ${bookingCode || ''}${cancelMeta.cancelReason ? `, lý do: ${cancelMeta.cancelReason}` : ''}`.trim();
    const driverBucketKey = normalizeText(row.driverSystemAccountId || row.driverAccountId).toLowerCase();

    candidates.push({
      fingerprint: buildCandidateFingerprint('cancel-trip', bookingCode),
      sourceType: 'system',
      violationType: 'cancel-trip',
      violationLabel: VIOLATION_TYPES['cancel-trip'].label,
      severity: 'medium',
      bookingCode,
      driverAccountId: normalizeText(row.driverAccountId),
      driverSystemAccountId: normalizeText(row.driverSystemAccountId),
      driverName: normalizeText(row.driverName),
      driverPhone: normalizeText(row.driverPhone),
      customerName: normalizeText(row.customerName),
      complaintId: null,
      description,
      detectedAt,
      detectionPayload: JSON.stringify({
        source: 'trip-cancellation',
        cancelReason: normalizeText(cancelMeta.cancelReason),
        cancelledByRoleCode: normalizeText(cancelMeta.cancelledByRoleCode),
      }),
    });

    const detectedDate = new Date(detectedAt);
    if (driverBucketKey && !Number.isNaN(detectedDate.getTime()) && detectedDate >= recentWindowStart) {
      const bucket = recentCancellationBuckets.get(driverBucketKey) ?? [];
      bucket.push({ ...row, detectedAt });
      recentCancellationBuckets.set(driverBucketKey, bucket);
    }
  }

  for (const [driverKey, rows] of recentCancellationBuckets.entries()) {
    if (rows.length < 3) {
      continue;
    }

    const latestRow = rows[0] ?? {};
    candidates.push({
      fingerprint: buildCandidateFingerprint('fraud-risk', `${driverKey}:${now.toISOString().slice(0, 10)}`),
      sourceType: 'system',
      violationType: 'fraud-risk',
      violationLabel: VIOLATION_TYPES['fraud-risk'].label,
      severity: 'high',
      bookingCode: normalizeText(latestRow.bookingCode),
      driverAccountId: normalizeText(latestRow.driverAccountId),
      driverSystemAccountId: normalizeText(latestRow.driverSystemAccountId),
      driverName: normalizeText(latestRow.driverName),
      driverPhone: normalizeText(latestRow.driverPhone),
      customerName: normalizeText(latestRow.customerName),
      complaintId: null,
      description: `Tài xế có ${rows.length} chuyến bị hủy do chính tài xế thực hiện trong 7 ngày gần nhất.`,
      detectedAt: toIsoDate(latestRow.updatedAt || latestRow.bookedAt || now),
      detectionPayload: JSON.stringify({
        source: 'fraud-risk',
        recentCancelledTrips: rows.slice(0, 5).map((item) => normalizeText(item.bookingCode)).filter(Boolean),
        count: rows.length,
      }),
    });
  }

  for (const row of ratingRows) {
    const bookingCode = normalizeText(row.bookingCode);
    const ratingScore = Number(row.ratingScore ?? 0) || 0;
    const ratingComment = normalizeText(row.ratingComment);
    const normalizedComment = ratingComment.toLowerCase();
    const violationType = hasSpeedingKeywords(normalizedComment) || normalizedComment.includes('ẩu') || normalizedComment.includes('nguy hiểm')
      ? 'unsafe-driving'
      : 'driver-attitude';
    const violationLabel = hasSpeedingKeywords(normalizedComment)
      ? 'Vi phạm tốc độ'
      : VIOLATION_TYPES[violationType].label;

    candidates.push({
      fingerprint: buildCandidateFingerprint('rating', bookingCode),
      sourceType: 'rating',
      violationType,
      violationLabel,
      severity: ratingScore <= 1 ? 'high' : 'medium',
      bookingCode,
      driverAccountId: normalizeText(row.driverAccountId),
      driverSystemAccountId: normalizeText(row.driverSystemAccountId),
      driverName: normalizeText(row.driverName),
      driverPhone: normalizeText(row.driverPhone),
      customerName: normalizeText(row.customerName),
      complaintId: null,
      description: `Khách hàng đánh giá ${ratingScore} sao${ratingComment ? ` với nhận xét: ${ratingComment}` : '.'}`,
      detectedAt: toIsoDate(row.detectedAt),
      detectionPayload: JSON.stringify({
        source: 'rating',
        ratingScore,
        ratingComment,
      }),
    });
  }

  for (const row of complaintRows) {
    const violationType = mapIssueTypeToViolationType(row.issueType, row.description);

    if (!violationType) {
      continue;
    }

    candidates.push({
      fingerprint: buildCandidateFingerprint('complaint', row.complaintId),
      sourceType: 'complaint',
      violationType,
      violationLabel: VIOLATION_TYPES[violationType]?.label || VIOLATION_TYPES.other.label,
      severity: violationType === 'unsafe-driving' ? 'high' : 'medium',
      bookingCode: normalizeText(row.bookingCode),
      driverAccountId: normalizeText(row.driverAccountId),
      driverSystemAccountId: normalizeText(row.driverSystemAccountId),
      driverName: normalizeText(row.driverName),
      driverPhone: normalizeText(row.driverPhone),
      customerName: normalizeText(row.customerName),
      complaintId: Number(row.complaintId ?? 0) || null,
      description: normalizeText(row.description) || 'Khách hàng đã gửi phản ánh về chuyến đi.',
      detectedAt: toIsoDate(row.detectedAt),
      detectionPayload: JSON.stringify({
        source: 'complaint',
        complaintId: Number(row.complaintId ?? 0) || 0,
        issueType: normalizeText(row.issueType).toLowerCase(),
      }),
    });
  }

  return Array.from(new Map(candidates.map((candidate) => [candidate.fingerprint, candidate])).values());
}

async function insertViolationIfMissing(pool, candidate) {
  const result = await pool.request()
    .input('fingerprint', sql.VarChar(150), candidate.fingerprint)
    .input('sourceType', sql.VarChar(20), candidate.sourceType)
    .input('violationType', sql.VarChar(40), candidate.violationType)
    .input('violationLabel', sql.NVarChar(120), candidate.violationLabel)
    .input('description', sql.NVarChar(1200), candidate.description)
    .input('severity', sql.VarChar(20), candidate.severity)
    .input('bookingCode', sql.VarChar(30), candidate.bookingCode || null)
    .input('complaintId', sql.Int, candidate.complaintId ?? null)
    .input('driverAccountId', sql.VarChar(20), candidate.driverAccountId || null)
    .input('driverSystemAccountId', sql.VarChar(20), candidate.driverSystemAccountId || null)
    .input('driverName', sql.NVarChar(120), candidate.driverName || null)
    .input('driverPhone', sql.VarChar(20), candidate.driverPhone || null)
    .input('customerName', sql.NVarChar(120), candidate.customerName || null)
    .input('detectedAt', sql.DateTime2, new Date(candidate.detectedAt))
    .input('detectionPayload', sql.NVarChar(2000), candidate.detectionPayload || null)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.ViPhamTaiXe WHERE Fingerprint = @fingerprint)
      BEGIN
        INSERT INTO dbo.ViPhamTaiXe (
          Fingerprint,
          NguonPhatHien,
          LoaiViPham,
          TenLoaiViPham,
          MoTa,
          MucDo,
          TrangThai,
          MaChuyen,
          MaKN,
          MaTX,
          MaTKTaiXe,
          TenTaiXe,
          driverPhone,
          TenKhachHang,
          NgayPhatHien,
          DuLieuPhatHien,
          NgayTao,
          NgayCapNhat
        )
        VALUES (
          @fingerprint,
          @sourceType,
          @violationType,
          @violationLabel,
          @description,
          @severity,
          'pending',
          NULLIF(@bookingCode, ''),
          @complaintId,
          NULLIF(@driverAccountId, ''),
          NULLIF(@driverSystemAccountId, ''),
          NULLIF(@driverName, ''),
          NULLIF(@driverPhone, ''),
          NULLIF(@customerName, ''),
          @detectedAt,
          NULLIF(@detectionPayload, ''),
          SYSDATETIME(),
          SYSDATETIME()
        );

        SELECT CAST(1 AS INT) AS inserted;
      END
      ELSE
      BEGIN
        SELECT CAST(0 AS INT) AS inserted;
      END;
    `);

  return result.recordset?.[0]?.inserted > 0;
}

async function syncSystemDetectedViolations() {
  const pool = await getSqlServerPool();

  const [cancellationRows, ratingRows, complaintRows] = await Promise.all([
    loadCancellationCandidates(pool),
    loadLowRatingCandidates(pool),
    loadComplaintCandidates(pool),
  ]);

  const candidates = buildSystemViolationCandidates({
    cancellationRows,
    ratingRows,
    complaintRows,
  });

  await ensureDriverViolationSchema();

  let createdCount = 0;

  for (const candidate of candidates) {
    const inserted = await insertViolationIfMissing(pool, candidate);

    if (inserted) {
      createdCount += 1;
    }
  }

  if (createdCount > 0) {
    broadcastAdminEvent('admin.driver-violation.changed', {
      action: 'created',
      createdCount,
    });
  }

  return {
    success: true,
    createdCount,
  };
}

async function getTransientDetectedViolations(filters = {}) {
  const pool = await getSqlServerPool();
  const [cancellationRows, ratingRows, complaintRows] = await Promise.all([
    loadCancellationCandidates(pool),
    loadLowRatingCandidates(pool),
    loadComplaintCandidates(pool),
  ]);

  const candidates = buildSystemViolationCandidates({
    cancellationRows,
    ratingRows,
    complaintRows,
  });

  for (const candidate of candidates) {
    const fingerprint = normalizeText(candidate.fingerprint);

    if (!fingerprint) {
      continue;
    }

    if (!inMemoryViolations.has(fingerprint)) {
      const nextItem = mapCandidateToMemoryViolation(candidate);
      nextItem.id = inMemoryViolationIdSeed;
      inMemoryViolationIdSeed += 1;
      inMemoryViolations.set(fingerprint, nextItem);
    }
  }

  const filteredItems = filterViolationItems(Array.from(inMemoryViolations.values()), filters);
  filteredItems.sort((a, b) => {
    const timeA = new Date(a.detectedAt || a.createdAt || 0).getTime() || 0;
    const timeB = new Date(b.detectedAt || b.createdAt || 0).getTime() || 0;
    return timeB - timeA;
  });

  const limit = parseLimit(filters.limit, 80);

  return {
    items: filteredItems.slice(0, limit),
    summary: buildInMemorySummary(filteredItems),
  };
}

async function ensureDriverTemporaryLockColumns(pool) {
  await pool.request().query(`
    IF COL_LENGTH(N'dbo.TaiXe', N'KhoaTamDen') IS NULL
    BEGIN
      ALTER TABLE dbo.TaiXe
      ADD KhoaTamDen DATETIME2(0) NULL;
    END
  `);

  await pool.request().query(`
    IF COL_LENGTH(N'dbo.TaiXe', N'LyDoKhoaTam') IS NULL
    BEGIN
      ALTER TABLE dbo.TaiXe
      ADD LyDoKhoaTam NVARCHAR(500) NULL;
    END
  `);
}

async function applyDriverResolutionAction(pool, updatedItem, resolutionAction, adminNote = '') {
  const driverSystemAccountId = normalizeText(updatedItem?.driverSystemAccountId);
  const driverAccountId = normalizeText(updatedItem?.driverAccountId);
  const effectiveReason = normalizeText(adminNote) || 'Xử lí vi phạm tài xế';

  if (!driverSystemAccountId && !driverAccountId) {
    return;
  }

  await ensureDriverTemporaryLockColumns(pool);

  if (resolutionAction === 'suspend-3-days') {
    await pool.request()
      .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId || null)
      .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
      .input('reason', sql.NVarChar(500), effectiveReason)
      .query(`
        UPDATE dbo.TaiXe
        SET
          KhoaTamDen = DATEADD(DAY, 3, SYSDATETIME()),
          LyDoKhoaTam = @reason
        WHERE
          (NULLIF(@driverSystemAccountId, '') IS NOT NULL AND MaTK = @driverSystemAccountId)
          OR (NULLIF(@driverAccountId, '') IS NOT NULL AND CCCD = @driverAccountId);
      `);

    return;
  }

  if (resolutionAction === 'permanent-lock') {
    await pool.request()
      .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId || null)
      .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
      .query(`
        UPDATE dbo.TaiKhoan
        SET TrangThai = N'Khoa'
        WHERE NULLIF(@driverSystemAccountId, '') IS NOT NULL AND MaTK = @driverSystemAccountId;

        UPDATE dbo.TaiXe
        SET TrangThai = N'Khoa'
        WHERE
          (NULLIF(@driverSystemAccountId, '') IS NOT NULL AND MaTK = @driverSystemAccountId)
          OR (NULLIF(@driverAccountId, '') IS NOT NULL AND CCCD = @driverAccountId);
      `);
  }
}

async function notifyDriverViolationResolution(item, { resolutionAction = '', adminNote = '' } = {}) {
  const driverSystemAccountId = normalizeText(item?.driverSystemAccountId);

  if (!driverSystemAccountId) {
    return;
  }

  const actionLabel = RESOLUTION_ACTION_LABELS[resolutionAction] || 'Đã cập nhật biên bản vi phạm';
  const noteLabel = normalizeText(adminNote) || 'Vui lòng tuân thủ quy định để tiếp tục hoạt động ổn định.';

  await createNotification({
    accountId: driverSystemAccountId,
    title: 'Cập nhật xử lí vi phạm tài xế',
    content: `${actionLabel}. ${noteLabel}`,
    recipient: 'driver',
    status: 'sent',
    sendAt: new Date().toISOString(),
  });
}

async function notifyAdminViolationDetected(candidate = {}) {
  await createNotification({
    accountId: null,
    title: 'Hệ thống phát hiện vi phạm tài xế mới',
    content: `${normalizeText(candidate.violationLabel) || 'Vi phạm'} - ${normalizeText(candidate.driverName) || 'Tài xế chưa định danh'} (${normalizeText(candidate.bookingCode) || '--'})`,
    recipient: 'all',
    status: 'sent',
    sendAt: new Date().toISOString(),
  });
}

function buildListWhereClause() {
  return `
    WHERE
      (@status = 'all' OR v.TrangThai = @status)
      AND (@violationType = 'all' OR v.LoaiViPham = @violationType)
      AND (
        @keyword = N''
        OR v.MaChuyen LIKE '%' + @keyword + '%'
        OR v.TenTaiXe LIKE '%' + @keyword + '%'
        OR v.MoTa LIKE '%' + @keyword + '%'
      )
  `;
}

export async function ensureDriverViolationSchema() {
  if (!driverViolationSchemaPromise) {
    driverViolationSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.ViPhamTaiXe', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.ViPhamTaiXe
          (
            MaVP INT IDENTITY(1,1) NOT NULL,
            Fingerprint VARCHAR(150) NOT NULL,
            NguonPhatHien VARCHAR(20) NOT NULL CONSTRAINT DF_ViPhamTaiXe_NguonPhatHien DEFAULT 'system',
            LoaiViPham VARCHAR(40) NOT NULL,
            TenLoaiViPham NVARCHAR(120) NOT NULL,
            MoTa NVARCHAR(1200) NOT NULL,
            MucDo VARCHAR(20) NOT NULL CONSTRAINT DF_ViPhamTaiXe_MucDo DEFAULT 'medium',
            TrangThai VARCHAR(20) NOT NULL CONSTRAINT DF_ViPhamTaiXe_TrangThai DEFAULT 'pending',
            HinhThucXuLy VARCHAR(30) NULL,
            GhiChuAdmin NVARCHAR(1200) NULL,
            MaTKXuLy VARCHAR(20) NULL,
            MaChuyen VARCHAR(30) NULL,
            MaKN INT NULL,
            MaTX VARCHAR(20) NULL,
            MaTKTaiXe VARCHAR(20) NULL,
            TenTaiXe NVARCHAR(120) NULL,
            driverPhone VARCHAR(20) NULL,
            TenKhachHang NVARCHAR(120) NULL,
            DuLieuPhatHien NVARCHAR(2000) NULL,
            NgayPhatHien DATETIME2(0) NOT NULL CONSTRAINT DF_ViPhamTaiXe_NgayPhatHien DEFAULT SYSDATETIME(),
            NgayXuLy DATETIME2(0) NULL,
            NgayTao DATETIME2(0) NOT NULL CONSTRAINT DF_ViPhamTaiXe_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat DATETIME2(0) NOT NULL CONSTRAINT DF_ViPhamTaiXe_NgayCapNhat DEFAULT SYSDATETIME(),
            CONSTRAINT PK_ViPhamTaiXe PRIMARY KEY (MaVP),
            CONSTRAINT UQ_ViPhamTaiXe_Fingerprint UNIQUE (Fingerprint),
            CONSTRAINT CK_ViPhamTaiXe_LoaiViPham CHECK (LoaiViPham IN ('cancel-trip', 'driver-attitude', 'unsafe-driving', 'fraud-risk', 'other')),
            CONSTRAINT CK_ViPhamTaiXe_MucDo CHECK (MucDo IN ('low', 'medium', 'high')),
            CONSTRAINT CK_ViPhamTaiXe_TrangThai CHECK (TrangThai IN ('pending', 'resolved')),
            CONSTRAINT CK_ViPhamTaiXe_HinhThucXuLy CHECK (HinhThucXuLy IS NULL OR HinhThucXuLy IN ('warning', 'suspend-3-days', 'permanent-lock'))
          );

          CREATE INDEX IX_ViPhamTaiXe_TrangThai_NgayPhatHien ON dbo.ViPhamTaiXe (TrangThai, NgayPhatHien DESC);
          CREATE INDEX IX_ViPhamTaiXe_LoaiViPham_NgayPhatHien ON dbo.ViPhamTaiXe (LoaiViPham, NgayPhatHien DESC);
        END;
      `);

      await ensureDriverTemporaryLockColumns(pool);
    })().catch((error) => {
      driverViolationSchemaPromise = null;
      throw error;
    });
  }

  return driverViolationSchemaPromise;
}

export async function listAdminDriverViolations(query = {}) {
  const limit = parseLimit(query.limit, 80);
  const status = normalizeViolationStatus(query.status, { allowAll: true });
  const violationType = normalizeViolationType(query.violationType ?? query.type, { allowAll: true });
  const keyword = normalizeText(query.keyword);

  await ensureDriverViolationSchema();

  try {
    await syncSystemDetectedViolations();

    const pool = await getSqlServerPool();
    const listResult = await pool.request()
      .input('limit', sql.Int, limit)
      .input('status', sql.VarChar(20), status)
      .input('violationType', sql.VarChar(40), violationType)
      .input('keyword', sql.NVarChar(200), keyword)
      .query(`
        SELECT TOP (@limit)
          v.*, 
          CASE v.NguonPhatHien
            WHEN 'complaint' THEN N'Phản ánh khách hàng'
            WHEN 'rating' THEN N'Đánh giá chuyến đi'
            ELSE N'Hệ thống tự phát hiện'
          END AS sourceLabel,
          handler.Ten AS handledByName
        FROM dbo.ViPhamTaiXe v
        LEFT JOIN dbo.TaiKhoan handler ON handler.MaTK = v.MaTKXuLy
        ${buildListWhereClause()}
        ORDER BY
          CASE v.TrangThai WHEN 'pending' THEN 0 ELSE 1 END,
          CASE v.MucDo WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          v.NgayPhatHien DESC,
          v.MaVP DESC;
      `);

    const summaryResult = await pool.request()
      .input('status', sql.VarChar(20), status)
      .input('violationType', sql.VarChar(40), violationType)
      .input('keyword', sql.NVarChar(200), keyword)
      .query(`
        SELECT
          COUNT(*) AS totalCount,
          SUM(CASE WHEN v.TrangThai = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
          SUM(CASE WHEN v.TrangThai = 'resolved' THEN 1 ELSE 0 END) AS resolvedCount,
          SUM(CASE WHEN v.MucDo = 'high' THEN 1 ELSE 0 END) AS highSeverityCount
        FROM dbo.ViPhamTaiXe v
        ${buildListWhereClause()};
      `);

    return {
      success: true,
      items: (listResult.recordset ?? []).map(mapViolationRow),
      summary: buildSummaryRow(summaryResult.recordset?.[0] ?? {}),
    };
  } catch {
    const transient = await getTransientDetectedViolations({
      limit,
      status,
      violationType,
      keyword,
    });

    return {
      success: true,
      items: transient.items,
      summary: transient.summary,
      fallback: true,
      message: 'Hệ thống đang dùng dữ liệu vi phạm tạm thời do chưa khởi tạo được bảng lưu.',
    };
  }
}

export async function getAdminDriverViolationDetail(violationId) {
  await ensureDriverViolationSchema();
  const normalizedViolationId = parseViolationId(violationId);
  const pool = await getSqlServerPool();

  const result = await pool.request()
    .input('violationId', sql.Int, normalizedViolationId)
    .query(`
      SELECT TOP (1)
        v.*, 
        CASE v.NguonPhatHien
          WHEN 'complaint' THEN N'Phản ánh khách hàng'
          WHEN 'rating' THEN N'Đánh giá chuyến đi'
          ELSE N'Hệ thống tự phát hiện'
        END AS sourceLabel,
        handler.Ten AS handledByName
      FROM dbo.ViPhamTaiXe v
      LEFT JOIN dbo.TaiKhoan handler ON handler.MaTK = v.MaTKXuLy
      WHERE v.MaVP = @violationId;
    `);

  const row = result.recordset?.[0] ?? null;

  if (!row) {
    throw createHttpError(404, 'Không tìm thấy vi phạm tài xế.');
  }

  return {
    success: true,
    item: mapViolationRow(row),
  };
}

export async function updateAdminDriverViolation(violationId, payload = {}) {
  await ensureDriverViolationSchema();
  const normalizedViolationId = parseViolationId(violationId);
  const severity = normalizeSeverity(payload.severity);
  const status = 'resolved';
  const resolutionAction = normalizeResolutionAction(payload.resolutionAction);
  const adminNote = normalizeAdminNote(payload.adminNote ?? payload.note);
  const handledByAccountId = normalizeAccountId(payload.handledByAccountId ?? payload.adminAccountId, 'admin xử lí');
  const pool = await getSqlServerPool();

  const updateResult = await pool.request()
    .input('violationId', sql.Int, normalizedViolationId)
    .input('severity', sql.VarChar(20), severity)
    .input('status', sql.VarChar(20), status)
    .input('resolutionAction', sql.VarChar(30), resolutionAction || null)
    .input('adminNote', sql.NVarChar(1200), adminNote || null)
    .input('handledByAccountId', sql.VarChar(20), handledByAccountId)
    .query(`
      UPDATE dbo.ViPhamTaiXe
      SET
        MucDo = @severity,
        TrangThai = @status,
        HinhThucXuLy = @resolutionAction,
        GhiChuAdmin = @adminNote,
        MaTKXuLy = @handledByAccountId,
        NgayXuLy = CASE WHEN @status = 'resolved' THEN SYSDATETIME() ELSE NgayXuLy END,
        NgayCapNhat = SYSDATETIME()
      WHERE MaVP = @violationId;

      SELECT @@ROWCOUNT AS affectedRows;
    `);

  if (!(updateResult.recordset?.[0]?.affectedRows > 0)) {
    throw createHttpError(404, 'Không tìm thấy vi phạm để cập nhật.');
  }

  const updated = await getAdminDriverViolationDetail(normalizedViolationId);

  await applyDriverResolutionAction(pool, updated?.item, resolutionAction, adminNote);

  try {
    await notifyDriverViolationResolution(updated?.item, { resolutionAction, adminNote });
  } catch {
    // Notification failure should not block update response.
  }

  broadcastAdminEvent('admin.driver-violation.changed', {
    action: 'updated',
    violationId: updated?.item?.id ?? normalizedViolationId,
    bookingCode: updated?.item?.bookingCode,
    driverSystemAccountId: updated?.item?.driverSystemAccountId,
    driverAccountId: updated?.item?.driverAccountId,
    status: updated?.item?.status,
    severity: updated?.item?.severity,
    resolutionAction: updated?.item?.resolutionAction,
  });

  return updated;
}

export async function enforceDriverAutoLockForContinuousCancellation(payload = {}) {
  const driverAccountId = normalizeText(payload.driverAccountId);
  const driverSystemAccountId = normalizeText(payload.driverSystemAccountId);
  const bookingCode = normalizeText(payload.bookingCode);

  if (!driverAccountId && !driverSystemAccountId) {
    return { success: true, locked: false, reason: 'missing-driver' };
  }

  const pool = await getSqlServerPool();
  await ensureDriverTemporaryLockColumns(pool);

  const recentRowsResult = await pool.request()
    .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId || null)
    .query(`
      SELECT TOP (5)
        dx.MaChuyen AS bookingCode,
        dx.TrangThaiChuyen AS tripStatus,
        dx.LyDoHuy AS cancelReasonRaw,
        dx.NgayCapNhat AS updatedAt
      FROM dbo.DatXe dx
      LEFT JOIN dbo.TaiXe tx ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
      WHERE
        (NULLIF(@driverAccountId, '') IS NOT NULL AND LOWER(ISNULL(dx.MaTX, '')) = LOWER(@driverAccountId))
        OR (NULLIF(@driverSystemAccountId, '') IS NOT NULL AND LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverSystemAccountId))
      ORDER BY dx.NgayCapNhat DESC, dx.MaChuyen DESC;
    `);

  const recentRows = recentRowsResult.recordset ?? [];

  if (recentRows.length < 5) {
    return { success: true, locked: false, reason: 'not-enough-history' };
  }

  const isContinuousFiveDriverCancelled = recentRows.every((row) => {
    const status = normalizeText(row.tripStatus).toLowerCase();
    const cancelMeta = parseCancellationMeta(row.cancelReasonRaw);
    const cancelledByRoleCode = normalizeText(cancelMeta.cancelledByRoleCode).toLowerCase();

    return status === 'dahuy' && (cancelledByRoleCode === 'q3' || cancelledByRoleCode === 'driver');
  });

  if (!isContinuousFiveDriverCancelled) {
    return { success: true, locked: false, reason: 'not-continuous-five' };
  }

  await ensureDriverViolationSchema();

  const lockResult = await pool.request()
    .input('driverAccountId', sql.VarChar(20), driverAccountId || null)
    .input('driverSystemAccountId', sql.VarChar(20), driverSystemAccountId || null)
    .query(`
      SELECT TOP (1)
        tx.MaTK AS driverSystemAccountId,
        tx.CCCD AS driverAccountId,
        tx.KhoaTamDen AS temporaryLockUntil,
        tk.Ten AS driverName,
        tk.SDT AS driverPhone
      FROM dbo.TaiXe tx
      LEFT JOIN dbo.TaiKhoan tk ON tk.MaTK = tx.MaTK
      WHERE
        (NULLIF(@driverAccountId, '') IS NOT NULL AND LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverAccountId))
        OR (NULLIF(@driverSystemAccountId, '') IS NOT NULL AND LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverSystemAccountId));
    `);

  const driverRow = lockResult.recordset?.[0] ?? null;

  if (!driverRow) {
    return { success: true, locked: false, reason: 'driver-not-found' };
  }

  const temporaryLockUntil = driverRow.temporaryLockUntil ? new Date(driverRow.temporaryLockUntil) : null;
  const lockStillActive = temporaryLockUntil && !Number.isNaN(temporaryLockUntil.getTime()) && temporaryLockUntil.getTime() > Date.now();

  if (lockStillActive) {
    return {
      success: true,
      locked: true,
      reason: 'already-locked',
      lockUntil: temporaryLockUntil.toISOString(),
    };
  }

  await pool.request()
    .input('driverAccountId', sql.VarChar(20), normalizeText(driverRow.driverAccountId) || null)
    .input('driverSystemAccountId', sql.VarChar(20), normalizeText(driverRow.driverSystemAccountId) || null)
    .query(`
      UPDATE dbo.TaiXe
      SET
        KhoaTamDen = DATEADD(HOUR, 1, SYSDATETIME()),
        LyDoKhoaTam = N'Hủy 5 chuyến liên tiếp trong thời gian gần đây',
        NgayCapNhat = SYSDATETIME()
      WHERE
        (NULLIF(@driverSystemAccountId, '') IS NOT NULL AND MaTK = @driverSystemAccountId)
        OR (NULLIF(@driverAccountId, '') IS NOT NULL AND CCCD = @driverAccountId);
    `);

  const candidate = {
    fingerprint: buildCandidateFingerprint('fraud-risk-auto-lock', `${normalizeText(driverRow.driverSystemAccountId || driverRow.driverAccountId)}:${bookingCode}`),
    sourceType: 'system',
    violationType: 'fraud-risk',
    violationLabel: 'Gian lận',
    description: 'Tài xế hủy 5 chuyến liên tục, hệ thống tự động khóa nhận chuyến 1 giờ.',
    severity: 'high',
    bookingCode,
    complaintId: null,
    driverAccountId: normalizeText(driverRow.driverAccountId),
    driverSystemAccountId: normalizeText(driverRow.driverSystemAccountId),
    driverName: normalizeText(driverRow.driverName),
    driverPhone: normalizeText(driverRow.driverPhone),
    customerName: '',
    detectedAt: new Date().toISOString(),
    detectionPayload: JSON.stringify({
      source: 'continuous-cancel-auto-lock',
      recentCancelledTrips: recentRows.map((row) => normalizeText(row.bookingCode)).filter(Boolean),
      count: 5,
      lockMinutes: 60,
    }),
  };

  await insertViolationIfMissing(pool, candidate);

  try {
    await createNotification({
      accountId: normalizeText(driverRow.driverSystemAccountId) || null,
      title: 'Tạm khóa nhận chuyến 1 giờ',
      content: 'Bạn đã hủy 5 chuyến liên tiếp, hệ thống tạm khóa chức năng nhận chuyến trong 1 giờ.',
      recipient: 'driver',
      status: 'sent',
      sendAt: new Date().toISOString(),
    });
  } catch {
    // Notification failure should not block policy enforcement.
  }

  try {
    await notifyAdminViolationDetected(candidate);
  } catch {
    // Notification failure should not block policy enforcement.
  }

  broadcastAdminEvent('admin.driver-violation.changed', {
    action: 'created',
    createdCount: 1,
    source: 'continuous-cancel-auto-lock',
    bookingCode,
    driverSystemAccountId: normalizeText(driverRow.driverSystemAccountId),
    driverAccountId: normalizeText(driverRow.driverAccountId),
  });

  return {
    success: true,
    locked: true,
    reason: 'continuous-five-cancelled',
  };
}