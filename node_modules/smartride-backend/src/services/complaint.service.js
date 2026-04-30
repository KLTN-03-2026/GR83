import sql from 'mssql';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';
import { createNotification } from './notification.service.js';
import { broadcastAdminEvent, publishRideEvent } from './ride.realtime.service.js';

const SUPPORT_CONTACT = {
  hotline: '19001234',
  email: 'support@smartride.vn',
  chatLabel: 'Chat với CSKH',
};

const ROLE_AUDIENCE = {
  Q2: 'customer',
  Q3: 'driver',
};

const ISSUE_TYPE_SEEDS = [
  { id: 'fare-issue', label: 'Giá cước / thanh toán', audience: 'customer', order: 1 },
  { id: 'driver-attitude', label: 'Thái độ tài xế', audience: 'customer', order: 2 },
  { id: 'unsafe-driving', label: 'Tài xế lái xe không an toàn', audience: 'customer', order: 3 },
  { id: 'lost-item', label: 'Thất lạc đồ dùng', audience: 'customer', order: 4 },
  { id: 'app-error', label: 'Lỗi ứng dụng', audience: 'all', order: 5 },
  { id: 'other', label: 'Lý do khác', audience: 'all', order: 6 },
  { id: 'accident', label: 'Tai nạn khẩn cấp', audience: 'driver', order: 7 },
  { id: 'vehicle-issue', label: 'Xe gặp sự cố', audience: 'driver', order: 8 },
  { id: 'customer-conflict', label: 'Mâu thuẫn với khách', audience: 'driver', order: 9 },
  { id: 'safety-threat', label: 'Nguy cơ an toàn', audience: 'driver', order: 10 },
];

let complaintSchemaPromise = null;

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

function normalizeRoleCode(value) {
  const normalized = normalizeText(value).toUpperCase();

  if (normalized === 'Q2' || normalized === 'Q3') {
    return normalized;
  }

  throw createHttpError(400, 'Vai trò gửi khiếu nại không hợp lệ.');
}

function normalizeAccountId(accountId, label = 'tài khoản') {
  const normalized = normalizeText(accountId);

  if (!normalized || normalized.length > 20) {
    throw createHttpError(400, `Mã ${label} không hợp lệ.`);
  }

  return normalized;
}

function normalizeBookingCode(bookingCode, { allowEmpty = false } = {}) {
  const normalized = normalizeText(bookingCode);

  if (!normalized && allowEmpty) {
    return '';
  }

  if (!normalized || normalized.length > 30) {
    throw createHttpError(400, 'Mã chuyến không hợp lệ.');
  }

  return normalized;
}

function normalizeIssueType(issueType, audience) {
  const normalized = normalizeText(issueType).toLowerCase();
  const matched = ISSUE_TYPE_SEEDS.find((item) => item.id === normalized && (item.audience === audience || item.audience === 'all'));

  if (!matched) {
    throw createHttpError(400, 'Loại báo lỗi không hợp lệ.');
  }

  return normalized;
}

function normalizeDescription(value, maxLength = 1200) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw createHttpError(400, 'Vui lòng nhập mô tả chi tiết.');
  }

  if (normalized.length < 10) {
    throw createHttpError(400, 'Mô tả chi tiết cần tối thiểu 10 ký tự.');
  }

  if (normalized.length > maxLength) {
    throw createHttpError(400, `Mô tả chi tiết không được vượt quá ${maxLength} ký tự.`);
  }

  return normalized;
}

function normalizeIncidentAt(value, fallbackValue = null) {
  const rawValue = normalizeText(value);

  if (!rawValue) {
    if (!fallbackValue) {
      return null;
    }

    const fallbackDate = new Date(fallbackValue);

    if (Number.isNaN(fallbackDate.getTime())) {
      return null;
    }

    return fallbackDate;
  }

  const incidentDate = new Date(rawValue);

  if (Number.isNaN(incidentDate.getTime())) {
    throw createHttpError(400, 'Thời gian xảy ra sự việc không hợp lệ.');
  }

  return incidentDate;
}

function normalizeAttachmentUrl(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length > 500) {
    throw createHttpError(400, 'Đường dẫn tệp đính kèm không hợp lệ.');
  }

  return normalized;
}

function parseLimit(value, fallback = 8) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 30);
}

function parseComplaintId(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(400, 'Mã khiếu nại không hợp lệ.');
  }

  return parsed;
}

function normalizeComplaintStatus(value, { allowAll = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return allowAll ? 'all' : 'processing';
  }

  if (allowAll && normalized === 'all') {
    return 'all';
  }

  if (normalized === 'processing' || normalized === 'resolved') {
    return normalized;
  }

  if (normalized === 'new') {
    return 'processing';
  }

  throw createHttpError(400, 'Trạng thái khiếu nại không hợp lệ.');
}

function normalizeAdminReply(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw createHttpError(400, 'Vui lòng nhập phản hồi của admin.');
  }

  if (normalized.length > 1200) {
    throw createHttpError(400, 'Phản hồi của admin không được vượt quá 1200 ký tự.');
  }

  return normalized;
}

function formatReporterRoleLabel(roleCode) {
  return String(roleCode ?? '').trim().toUpperCase() === 'Q3' ? 'Tài xế' : 'Người dùng';
}

function parseRouteGeometry(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeCancellationPayload({ roleCode = '', accountId = '', reason = '' } = {}) {
  const normalizedRoleCode = normalizeText(roleCode).toUpperCase();
  const normalizedAccountId = normalizeText(accountId);
  const normalizedReason = normalizeText(reason);

  if (!normalizedRoleCode && !normalizedAccountId && !normalizedReason) {
    return '';
  }

  return [normalizedRoleCode, normalizedAccountId, normalizedReason].join('|||');
}

function mapComplaintRow(row = {}) {
  const createdAt = row.NgayTao ? new Date(row.NgayTao) : null;
  const updatedAt = row.NgayCapNhat ? new Date(row.NgayCapNhat) : null;
  const incidentAt = row.ThoiDiemSuViec ? new Date(row.ThoiDiemSuViec) : null;

  return {
    id: Number(row.MaKN ?? row.id ?? 0) || 0,
    accountId: normalizeText(row.MaTK ?? row.accountId),
    reporterRoleCode: normalizeText(row.VaiTroNguoiGui ?? row.reporterRoleCode).toUpperCase(),
    bookingCode: normalizeText(row.MaChuyen ?? row.bookingCode),
    issueType: normalizeText(row.LoaiSuCo ?? row.issueType).toLowerCase(),
    issueLabel: normalizeText(row.issueLabel ?? ''),
    description: normalizeText(row.MoTa ?? row.description),
    status: normalizeText(row.TrangThai ?? row.status).toLowerCase() || 'new',
    incidentAt: incidentAt?.toISOString() ?? '',
    attachmentUrl: normalizeText(row.TepDinhKemUrl ?? row.attachmentUrl),
    createdAt: createdAt?.toISOString() ?? '',
    updatedAt: updatedAt?.toISOString() ?? '',
  };
}

function mapAdminComplaintRow(row = {}) {
  const mapped = mapComplaintRow(row);

  return {
    ...mapped,
    reporterName: normalizeText(row.reporterName),
    reporterPhone: normalizeText(row.reporterPhone),
    reporterRoleLabel: normalizeText(row.reporterRoleLabel) || formatReporterRoleLabel(mapped.reporterRoleCode),
    customerName: normalizeText(row.customerName),
    customerPhone: normalizeText(row.customerPhone),
    driverName: normalizeText(row.driverName),
    driverPhone: normalizeText(row.driverPhone),
    adminReply: normalizeText(row.PhanHoiAdmin ?? row.adminReply),
    handledByAccountId: normalizeText(row.MaTKXuLy ?? row.handledByAccountId),
    handledByName: normalizeText(row.handledByName),
    statusLabel: mapped.status === 'resolved' ? 'Đã giải quyết' : 'Đang xử lí',
  };
}

async function ensureIssueTypeLookup(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.LoaiKhieuNaiHoTro', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.LoaiKhieuNaiHoTro
      (
        MaLoaiSuCo   VARCHAR(40)   NOT NULL,
        TenLoaiSuCo  NVARCHAR(120) NOT NULL,
        DoiTuong     VARCHAR(20)   NOT NULL,
        ThuTuHienThi INT           NOT NULL CONSTRAINT DF_LoaiKhieuNaiHoTro_ThuTu DEFAULT 0,
        CONSTRAINT PK_LoaiKhieuNaiHoTro PRIMARY KEY (MaLoaiSuCo)
      );
    END
  `);

  const request = pool.request();
  const valuesClause = ISSUE_TYPE_SEEDS.map((row, index) => {
    request.input(`issueId${index}`, sql.VarChar(40), row.id);
    request.input(`issueLabel${index}`, sql.NVarChar(120), row.label);
    request.input(`issueAudience${index}`, sql.VarChar(20), row.audience);
    request.input(`issueOrder${index}`, sql.Int, row.order);

    return `(@issueId${index}, @issueLabel${index}, @issueAudience${index}, @issueOrder${index})`;
  }).join(',\n');

  await request.query(`
    MERGE dbo.LoaiKhieuNaiHoTro AS target
    USING (VALUES
      ${valuesClause}
    ) AS source (MaLoaiSuCo, TenLoaiSuCo, DoiTuong, ThuTuHienThi)
    ON target.MaLoaiSuCo = source.MaLoaiSuCo
    WHEN MATCHED THEN
      UPDATE SET
        target.TenLoaiSuCo = source.TenLoaiSuCo,
        target.DoiTuong = source.DoiTuong,
        target.ThuTuHienThi = source.ThuTuHienThi
    WHEN NOT MATCHED THEN
      INSERT (MaLoaiSuCo, TenLoaiSuCo, DoiTuong, ThuTuHienThi)
      VALUES (source.MaLoaiSuCo, source.TenLoaiSuCo, source.DoiTuong, source.ThuTuHienThi);
  `);
}

async function ensureComplaintForeignKeys(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.KhieuNaiHoTro', N'U') IS NULL
      RETURN;

    -- MaTK -> TaiKhoan.MaTK
    IF OBJECT_ID(N'dbo.TaiKhoan', N'U') IS NOT NULL
      AND NOT EXISTS
      (
        SELECT 1
        FROM sys.foreign_key_columns fkc
        INNER JOIN sys.columns pc
          ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        INNER JOIN sys.columns rc
          ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.KhieuNaiHoTro')
          AND fkc.referenced_object_id = OBJECT_ID(N'dbo.TaiKhoan')
          AND pc.name = 'MaTK'
          AND rc.name = 'MaTK'
      )
    BEGIN
      ALTER TABLE dbo.KhieuNaiHoTro WITH CHECK
      ADD CONSTRAINT FK_KhieuNaiHoTro_TaiKhoan
      FOREIGN KEY (MaTK) REFERENCES dbo.TaiKhoan(MaTK)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION;
    END;

    -- MaChuyen -> DatXe.MaChuyen
    IF OBJECT_ID(N'dbo.DatXe', N'U') IS NOT NULL
      AND NOT EXISTS
      (
        SELECT 1
        FROM sys.foreign_key_columns fkc
        INNER JOIN sys.columns pc
          ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        INNER JOIN sys.columns rc
          ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.KhieuNaiHoTro')
          AND fkc.referenced_object_id = OBJECT_ID(N'dbo.DatXe')
          AND pc.name = 'MaChuyen'
          AND rc.name = 'MaChuyen'
      )
    BEGIN
      ALTER TABLE dbo.KhieuNaiHoTro WITH CHECK
      ADD CONSTRAINT FK_KhieuNaiHoTro_DatXe
      FOREIGN KEY (MaChuyen) REFERENCES dbo.DatXe(MaChuyen)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION;
    END;

    -- LoaiSuCo -> LoaiKhieuNaiHoTro.MaLoaiSuCo
    IF OBJECT_ID(N'dbo.LoaiKhieuNaiHoTro', N'U') IS NOT NULL
      AND NOT EXISTS
      (
        SELECT 1
        FROM sys.foreign_key_columns fkc
        INNER JOIN sys.columns pc
          ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        INNER JOIN sys.columns rc
          ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.KhieuNaiHoTro')
          AND fkc.referenced_object_id = OBJECT_ID(N'dbo.LoaiKhieuNaiHoTro')
          AND pc.name = 'LoaiSuCo'
          AND rc.name = 'MaLoaiSuCo'
      )
    BEGIN
      ALTER TABLE dbo.KhieuNaiHoTro WITH CHECK
      ADD CONSTRAINT FK_KhieuNaiHoTro_Loai
      FOREIGN KEY (LoaiSuCo) REFERENCES dbo.LoaiKhieuNaiHoTro(MaLoaiSuCo)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION;
    END;

    -- MaTKXuLy -> TaiKhoan.MaTK
    IF COL_LENGTH(N'dbo.KhieuNaiHoTro', N'MaTKXuLy') IS NOT NULL
      AND OBJECT_ID(N'dbo.TaiKhoan', N'U') IS NOT NULL
      AND NOT EXISTS
      (
        SELECT 1
        FROM sys.foreign_key_columns fkc
        INNER JOIN sys.columns pc
          ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        INNER JOIN sys.columns rc
          ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.KhieuNaiHoTro')
          AND fkc.referenced_object_id = OBJECT_ID(N'dbo.TaiKhoan')
          AND pc.name = 'MaTKXuLy'
          AND rc.name = 'MaTK'
      )
    BEGIN
      ALTER TABLE dbo.KhieuNaiHoTro WITH CHECK
      ADD CONSTRAINT FK_KhieuNaiHoTro_NguoiXuLy
      FOREIGN KEY (MaTKXuLy) REFERENCES dbo.TaiKhoan(MaTK)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION;
    END;
  `);
}

async function readTripOwnership(pool, bookingCode) {
  const result = await pool.request()
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP (1)
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS accountId,
        dx.MaTX AS driverAccountId,
        dx.NgayTao AS bookedAt,
        dx.LoaiXe AS vehicle,
        dx.QuangDuongKm AS routeDistanceKm,
        dx.DiemDon AS pickupLabel,
        dx.DiemDen AS destinationLabel,
        dx.ThoiGianDuKienPhut AS etaMinutes,
        dx.TuyenDuongJson AS routeGeometryJson,
        dx.TenHangXe AS rideTitle,
        driverTk.Ten AS driverName,
        JSON_VALUE(tx.ThongTinXe, '$.licensePlate') AS driverVehicleLicensePlate,
        dg.SoSaoDanhGia AS ratingScore
      FROM dbo.DatXe dx
      LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
      LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
      LEFT JOIN dbo.DanhGiaChuyenXe dg ON dg.MaChuyen = dx.MaChuyen
      WHERE dx.MaChuyen = @bookingCode;
    `);

  const row = result.recordset?.[0] ?? null;
  if (!row) {
    throw createHttpError(404, 'Không tìm thấy chuyến đi cần báo lỗi.');
  }

  return {
    bookingCode: normalizeText(row.bookingCode),
    accountId: normalizeText(row.accountId),
    driverAccountId: normalizeText(row.driverAccountId),
    bookedAt: row.bookedAt ? new Date(row.bookedAt).toISOString() : '',
    vehicle: normalizeText(row.vehicle).toLowerCase(),
    rideTitle: normalizeText(row.rideTitle),
    routeDistanceKm: Number(row.routeDistanceKm ?? 0) || 0,
    pickupLabel: normalizeText(row.pickupLabel),
    destinationLabel: normalizeText(row.destinationLabel),
    etaMinutes: Number(row.etaMinutes ?? 0) || 0,
    routeGeometry: parseRouteGeometry(row.routeGeometryJson),
    driverName: normalizeText(row.driverName),
    driverVehicleLicensePlate: normalizeText(row.driverVehicleLicensePlate),
    ratingScore: Number(row.ratingScore ?? 0) || 0,
  };
}

async function readDriverActiveTrip(pool, driverId) {
  const result = await pool.request()
    .input('driverId', sql.VarChar(20), driverId)
    .query(`
      SELECT TOP (1)
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS customerAccountId,
        dx.TrangThaiChuyen AS tripStatus,
        dx.NgayCapNhat AS updatedAt,
        dx.NgayTao AS createdAt,
        tx.MaTK AS driverAccountId,
        tx.CCCD AS driverCccd
      FROM dbo.DatXe dx
      INNER JOIN dbo.TaiXe tx
        ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
      WHERE
        (
          LOWER(ISNULL(tx.MaTK, '')) = LOWER(@driverId)
          OR LOWER(ISNULL(tx.CCCD, '')) = LOWER(@driverId)
        )
        AND dx.TrangThaiChuyen IN (N'DaNhanChuyen', N'DangDen', N'DaDon', N'DangThucHien')
      ORDER BY dx.NgayCapNhat DESC, dx.NgayTao DESC;
    `);

  const row = result.recordset?.[0] ?? null;

  if (!row) {
    return null;
  }

  return {
    bookingCode: normalizeText(row.bookingCode),
    customerAccountId: normalizeText(row.customerAccountId),
    tripStatus: normalizeText(row.tripStatus),
    driverAccountId: normalizeText(row.driverAccountId),
    driverCccd: normalizeText(row.driverCccd),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
  };
}

export async function ensureComplaintSchema() {
  if (!isSqlServerConfigured()) {
    throw createHttpError(500, 'Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.');
  }

  if (!complaintSchemaPromise) {
    complaintSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.KhieuNaiHoTro', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.KhieuNaiHoTro
          (
            MaKN           INT            IDENTITY(1,1) NOT NULL,
            MaTK           VARCHAR(20)    NOT NULL,
            VaiTroNguoiGui VARCHAR(10)    NOT NULL,
            MaChuyen       VARCHAR(30)    NULL,
            LoaiSuCo       VARCHAR(40)    NOT NULL,
            MoTa           NVARCHAR(1200) NOT NULL,
            TrangThai      VARCHAR(20)    NOT NULL CONSTRAINT DF_KhieuNaiHoTro_TrangThai DEFAULT 'new',
            ThoiDiemSuViec DATETIME2(0)   NULL,
            TepDinhKemUrl  NVARCHAR(500)  NULL,
            NgayTao        DATETIME2(0)   NOT NULL CONSTRAINT DF_KhieuNaiHoTro_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat    DATETIME2(0)   NOT NULL CONSTRAINT DF_KhieuNaiHoTro_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_KhieuNaiHoTro PRIMARY KEY (MaKN),
            CONSTRAINT CK_KhieuNaiHoTro_MaTK CHECK (LEN(LTRIM(RTRIM(MaTK))) > 0),
            CONSTRAINT CK_KhieuNaiHoTro_VaiTroNguoiGui CHECK (VaiTroNguoiGui IN ('Q2','Q3')),
            CONSTRAINT CK_KhieuNaiHoTro_TrangThai CHECK (TrangThai IN ('new','processing','resolved','rejected')),
            CONSTRAINT CK_KhieuNaiHoTro_MoTa CHECK (LEN(LTRIM(RTRIM(MoTa))) BETWEEN 10 AND 1200)
          );
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH('dbo.KhieuNaiHoTro', 'PhanHoiAdmin') IS NULL
        BEGIN
          ALTER TABLE dbo.KhieuNaiHoTro ADD PhanHoiAdmin NVARCHAR(1200) NULL;
        END

        IF COL_LENGTH('dbo.KhieuNaiHoTro', 'MaTKXuLy') IS NULL
        BEGIN
          ALTER TABLE dbo.KhieuNaiHoTro ADD MaTKXuLy VARCHAR(20) NULL;
        END
      `);

      await ensureIssueTypeLookup(pool);
      await ensureComplaintForeignKeys(pool);
    })().catch((error) => {
      complaintSchemaPromise = null;
      throw error;
    });
  }

  return complaintSchemaPromise;
}

export async function listComplaintIssueTypes(audience) {
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();

  const result = await pool.request()
    .input('audience', sql.VarChar(20), audience)
    .query(`
      SELECT MaLoaiSuCo, TenLoaiSuCo, DoiTuong
      FROM dbo.LoaiKhieuNaiHoTro
      WHERE DoiTuong = @audience OR DoiTuong = 'all'
      ORDER BY ThuTuHienThi ASC, MaLoaiSuCo ASC;
    `);

  return (result.recordset ?? []).map((row) => ({
    id: normalizeText(row.MaLoaiSuCo).toLowerCase(),
    label: normalizeText(row.TenLoaiSuCo),
    audience: normalizeText(row.DoiTuong).toLowerCase(),
  }));
}

export async function getDriverSupportOverview(driverId) {
  const normalizedDriverId = normalizeAccountId(driverId, 'tài xế');
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const issueTypes = await listComplaintIssueTypes('driver');
  const activeTrip = await readDriverActiveTrip(pool, normalizedDriverId);

  const recentResult = await pool.request()
    .input('driverId', sql.VarChar(20), normalizedDriverId)
    .query(`
      SELECT TOP (6)
        kn.MaKN,
        kn.MaTK,
        kn.VaiTroNguoiGui,
        kn.MaChuyen,
        kn.LoaiSuCo,
        kn.MoTa,
        kn.TrangThai,
        kn.ThoiDiemSuViec,
        kn.TepDinhKemUrl,
        kn.NgayTao,
        kn.NgayCapNhat,
        ls.TenLoaiSuCo AS issueLabel
      FROM dbo.KhieuNaiHoTro kn
      LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
      WHERE kn.MaTK = @driverId AND kn.VaiTroNguoiGui = 'Q3'
      ORDER BY kn.NgayTao DESC, kn.MaKN DESC;
    `);

  return {
    success: true,
    contact: SUPPORT_CONTACT,
    issueTypes,
    activeTrip,
    canSubmit: Boolean(activeTrip?.bookingCode),
    recentRequests: (recentResult.recordset ?? []).map(mapComplaintRow),
  };
}

export async function listDriverSupportRequests(driverId, query = {}) {
  const normalizedDriverId = normalizeAccountId(driverId, 'tài xế');
  const limit = parseLimit(query.limit, 8);

  await ensureComplaintSchema();
  const pool = await getSqlServerPool();

  const result = await pool.request()
    .input('driverId', sql.VarChar(20), normalizedDriverId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        kn.MaKN,
        kn.MaTK,
        kn.VaiTroNguoiGui,
        kn.MaChuyen,
        kn.LoaiSuCo,
        kn.MoTa,
        kn.TrangThai,
        kn.ThoiDiemSuViec,
        kn.TepDinhKemUrl,
        kn.NgayTao,
        kn.NgayCapNhat,
        ls.TenLoaiSuCo AS issueLabel
      FROM dbo.KhieuNaiHoTro kn
      LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
      WHERE kn.MaTK = @driverId AND kn.VaiTroNguoiGui = 'Q3'
      ORDER BY kn.NgayTao DESC, kn.MaKN DESC;
    `);

  return {
    success: true,
    items: (result.recordset ?? []).map(mapComplaintRow),
  };
}

export async function createDriverSupportRequest(driverId, payload = {}) {
  const normalizedDriverId = normalizeAccountId(driverId, 'tài xế');
  const audience = ROLE_AUDIENCE.Q3;
  const issueType = normalizeIssueType(payload.issueType, audience);
  const description = normalizeDescription(payload.description);
  const emergencyCancelReason = 'Tài xế gửi báo cáo hỗ trợ và an toàn trong khi đang thực hiện chuyến đi.';

  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const activeTrip = await readDriverActiveTrip(pool, normalizedDriverId);

    if (!activeTrip?.bookingCode) {
      throw createHttpError(409, 'Chỉ có thể gửi báo cáo khi tài xế đang thực hiện chuyến đi.');
    }

    const incidentAt = normalizeIncidentAt(payload.incidentAt, activeTrip.updatedAt || activeTrip.createdAt || new Date());
    const cancellationPayload = serializeCancellationPayload({
      roleCode: 'Q3',
      accountId: normalizedDriverId,
      reason: emergencyCancelReason,
    });

    const insertResult = await new sql.Request(transaction)
      .input('accountId', sql.VarChar(20), normalizedDriverId)
      .input('reporterRoleCode', sql.VarChar(10), 'Q3')
      .input('bookingCode', sql.VarChar(30), activeTrip.bookingCode)
      .input('issueType', sql.VarChar(40), issueType)
      .input('description', sql.NVarChar(1200), description)
      .input('incidentAt', sql.DateTime2(0), incidentAt)
      .query(`
        INSERT INTO dbo.KhieuNaiHoTro (MaTK, VaiTroNguoiGui, MaChuyen, LoaiSuCo, MoTa, TrangThai, ThoiDiemSuViec)
        VALUES (@accountId, @reporterRoleCode, @bookingCode, @issueType, @description, 'new', @incidentAt);

        SELECT TOP (1)
          kn.MaKN,
          kn.MaTK,
          kn.VaiTroNguoiGui,
          kn.MaChuyen,
          kn.LoaiSuCo,
          kn.MoTa,
          kn.TrangThai,
          kn.ThoiDiemSuViec,
          kn.TepDinhKemUrl,
          kn.NgayTao,
          kn.NgayCapNhat,
          ls.TenLoaiSuCo AS issueLabel
        FROM dbo.KhieuNaiHoTro kn
        LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
        WHERE kn.MaKN = SCOPE_IDENTITY();
      `);

    await new sql.Request(transaction)
      .input('bookingCode', sql.VarChar(30), activeTrip.bookingCode)
      .input('cancelPayload', sql.NVarChar(500), cancellationPayload || null)
      .query(`
        UPDATE dbo.DatXe
        SET
          TrangThaiChuyen = N'DaHuy',
          LyDoHuy = NULLIF(@cancelPayload, '')
        WHERE MaChuyen = @bookingCode
          AND TrangThaiChuyen IN (N'DaNhanChuyen', N'DangDen', N'DaDon', N'DangThucHien');

        IF @@ROWCOUNT = 0
        BEGIN
          THROW 50001, N'Không thể tự động hủy chuyến đang thực hiện.', 1;
        END
      `);

    await transaction.commit();

    const createdRequest = mapComplaintRow(insertResult.recordset?.[0] ?? {});
    broadcastAdminEvent('admin.complaint.changed', {
      action: 'created',
      complaintId: createdRequest.id,
      reporterRoleCode: createdRequest.reporterRoleCode,
      reporterAccountId: createdRequest.accountId,
      bookingCode: createdRequest.bookingCode,
      status: createdRequest.status,
    });

    try {
      await publishRideEvent({
        type: 'ride.trip.status.updated',
        routingKey: 'ride.trip.status.updated',
        bookingCode: activeTrip.bookingCode,
        customerAccountId: activeTrip.customerAccountId,
        driverAccountId: activeTrip.driverAccountId,
        cancelledByAccountId: normalizedDriverId,
        cancelledByRoleCode: 'Q3',
        cancelReason: emergencyCancelReason,
        tripStatus: 'DaHuy',
        tripStatusLabel: 'Đã hủy',
        tripStatusTone: 'error',
        audience: ['customer', 'driver'],
        booking: {
          bookingCode: activeTrip.bookingCode,
          tripStatus: 'DaHuy',
          cancelledByAccountId: normalizedDriverId,
          cancelledByRoleCode: 'Q3',
          cancelReason: emergencyCancelReason,
        },
        source: 'driver-support',
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Keep complaint creation successful even if realtime push is unavailable.
    }

    return {
      success: true,
      message: 'Đã gửi báo cáo sự cố thành công và hủy chuyến đang thực hiện.',
      request: createdRequest,
      cancelledBookingCode: activeTrip.bookingCode,
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback errors.
    }

    if (Number(error?.number) === 50001) {
      throw createHttpError(500, 'Không thể tự động hủy chuyến đang thực hiện. Vui lòng thử lại.');
    }

    throw error;
  }
}

export async function getTripIssueReportMeta(bookingCode, query = {}) {
  const normalizedBookingCode = normalizeBookingCode(bookingCode);
  const normalizedAccountId = normalizeAccountId(query.accountId, 'khách hàng');
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const trip = await readTripOwnership(pool, normalizedBookingCode);

  if (trip.accountId !== normalizedAccountId) {
    throw createHttpError(403, 'Bạn không có quyền báo lỗi cho chuyến đi này.');
  }

  const existingResult = await pool.request()
    .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .query(`
      SELECT TOP (1)
        kn.MaKN,
        kn.TrangThai,
        kn.NgayTao
      FROM dbo.KhieuNaiHoTro kn
      WHERE kn.MaChuyen = @bookingCode
        AND kn.MaTK = @accountId
        AND kn.VaiTroNguoiGui = 'Q2'
      ORDER BY kn.NgayTao DESC, kn.MaKN DESC;
    `);

  const existingComplaint = existingResult.recordset?.[0] ?? null;

  return {
    success: true,
    contact: SUPPORT_CONTACT,
    issueTypes: await listComplaintIssueTypes('customer'),
    trip,
    alreadyReported: Boolean(existingComplaint),
    existingComplaintId: Number(existingComplaint?.MaKN ?? 0) || null,
  };
}

export async function createTripIssueReport(bookingCode, payload = {}) {
  const normalizedBookingCode = normalizeBookingCode(bookingCode);
  const normalizedAccountId = normalizeAccountId(payload.accountId, 'khách hàng');
  const reporterRoleCode = normalizeRoleCode(payload.reporterRoleCode ?? 'Q2');
  const audience = ROLE_AUDIENCE[reporterRoleCode];
  const issueType = normalizeIssueType(payload.issueType, audience);
  const description = normalizeDescription(payload.description, 500);
  const attachmentUrl = normalizeAttachmentUrl(payload.attachmentUrl);

  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const trip = await readTripOwnership(pool, normalizedBookingCode);

  if (trip.accountId !== normalizedAccountId) {
    throw createHttpError(403, 'Bạn không có quyền báo lỗi cho chuyến đi này.');
  }

  const duplicateResult = await pool.request()
    .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .query(`
      SELECT TOP (1)
        MaKN
      FROM dbo.KhieuNaiHoTro
      WHERE MaChuyen = @bookingCode
        AND MaTK = @accountId
        AND VaiTroNguoiGui = 'Q2'
      ORDER BY NgayTao DESC, MaKN DESC;
    `);

  if (duplicateResult.recordset?.[0]?.MaKN) {
    throw createHttpError(409, 'Bạn đã khiếu nại cho chuyến đi này.');
  }

  const incidentAt = normalizeIncidentAt(payload.incidentAt, trip.bookedAt);

  const insertResult = await pool.request()
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .input('reporterRoleCode', sql.VarChar(10), reporterRoleCode)
    .input('bookingCode', sql.VarChar(30), normalizedBookingCode)
    .input('issueType', sql.VarChar(40), issueType)
    .input('description', sql.NVarChar(1200), description)
    .input('incidentAt', sql.DateTime2(0), incidentAt)
    .input('attachmentUrl', sql.NVarChar(500), attachmentUrl)
    .query(`
      INSERT INTO dbo.KhieuNaiHoTro (MaTK, VaiTroNguoiGui, MaChuyen, LoaiSuCo, MoTa, TrangThai, ThoiDiemSuViec, TepDinhKemUrl)
      VALUES (@accountId, @reporterRoleCode, @bookingCode, @issueType, @description, 'new', @incidentAt, @attachmentUrl);

      SELECT TOP (1)
        kn.MaKN,
        kn.MaTK,
        kn.VaiTroNguoiGui,
        kn.MaChuyen,
        kn.LoaiSuCo,
        kn.MoTa,
        kn.TrangThai,
        kn.ThoiDiemSuViec,
        kn.TepDinhKemUrl,
        kn.NgayTao,
        kn.NgayCapNhat,
        ls.TenLoaiSuCo AS issueLabel
      FROM dbo.KhieuNaiHoTro kn
      LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
      WHERE kn.MaKN = SCOPE_IDENTITY();
    `);

  const createdRequest = mapComplaintRow(insertResult.recordset?.[0] ?? {});
  broadcastAdminEvent('admin.complaint.changed', {
    action: 'created',
    complaintId: createdRequest.id,
    reporterRoleCode: createdRequest.reporterRoleCode,
    reporterAccountId: createdRequest.accountId,
    bookingCode: createdRequest.bookingCode,
    status: createdRequest.status,
  });

  return {
    success: true,
    message: 'Đã gửi báo lỗi thành công. Chúng tôi sẽ xử lý trong thời gian sớm nhất.',
    request: createdRequest,
  };
}

export async function listAdminComplaintRequests(query = {}) {
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const limit = parseLimit(query.limit, 30);
  const status = normalizeComplaintStatus(query.status, { allowAll: true });
  const keyword = normalizeText(query.keyword);

  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .input('status', sql.VarChar(20), status)
    .input('keyword', sql.NVarChar(200), keyword)
    .query(`
      SELECT TOP (@limit)
        kn.MaKN,
        kn.MaTK,
        kn.VaiTroNguoiGui,
        CASE WHEN kn.VaiTroNguoiGui = 'Q3' THEN N'Tài xế' ELSE N'Người dùng' END AS reporterRoleLabel,
        kn.MaChuyen,
        kn.LoaiSuCo,
        kn.MoTa,
        CASE WHEN kn.TrangThai = 'resolved' THEN 'resolved' ELSE 'processing' END AS TrangThai,
        kn.ThoiDiemSuViec,
        kn.TepDinhKemUrl,
        kn.PhanHoiAdmin,
        kn.MaTKXuLy,
        kn.NgayTao,
        kn.NgayCapNhat,
        ls.TenLoaiSuCo AS issueLabel,
        reporter.Ten AS reporterName,
        reporter.SDT AS reporterPhone,
        customerTk.Ten AS customerName,
        customerTk.SDT AS customerPhone,
        driverTk.Ten AS driverName,
        driverTk.SDT AS driverPhone,
        handlerTk.Ten AS handledByName
      FROM dbo.KhieuNaiHoTro kn
      LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
      LEFT JOIN dbo.TaiKhoan reporter ON reporter.MaTK = kn.MaTK
      LEFT JOIN dbo.DatXe dx ON dx.MaChuyen = kn.MaChuyen
      LEFT JOIN dbo.TaiKhoan customerTk ON customerTk.MaTK = dx.MaTK
      LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
      LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
      LEFT JOIN dbo.TaiKhoan handlerTk ON handlerTk.MaTK = kn.MaTKXuLy
      WHERE
        (@status = 'all' OR CASE WHEN kn.TrangThai = 'resolved' THEN 'resolved' ELSE 'processing' END = @status)
        AND (
          @keyword = N''
          OR kn.MaChuyen LIKE '%' + @keyword + '%'
          OR reporter.Ten LIKE '%' + @keyword + '%'
          OR customerTk.Ten LIKE '%' + @keyword + '%'
          OR driverTk.Ten LIKE '%' + @keyword + '%'
          OR kn.MoTa LIKE '%' + @keyword + '%'
        )
      ORDER BY kn.NgayTao DESC, kn.MaKN DESC;
    `);

  return {
    success: true,
    items: (result.recordset ?? []).map(mapAdminComplaintRow),
  };
}

export async function getAdminComplaintDetail(complaintId) {
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const normalizedComplaintId = parseComplaintId(complaintId);

  const result = await pool.request()
    .input('complaintId', sql.Int, normalizedComplaintId)
    .query(`
      SELECT TOP (1)
        kn.MaKN,
        kn.MaTK,
        kn.VaiTroNguoiGui,
        CASE WHEN kn.VaiTroNguoiGui = 'Q3' THEN N'Tài xế' ELSE N'Người dùng' END AS reporterRoleLabel,
        kn.MaChuyen,
        kn.LoaiSuCo,
        kn.MoTa,
        CASE WHEN kn.TrangThai = 'resolved' THEN 'resolved' ELSE 'processing' END AS TrangThai,
        kn.ThoiDiemSuViec,
        kn.TepDinhKemUrl,
        kn.PhanHoiAdmin,
        kn.MaTKXuLy,
        kn.NgayTao,
        kn.NgayCapNhat,
        ls.TenLoaiSuCo AS issueLabel,
        reporter.Ten AS reporterName,
        reporter.SDT AS reporterPhone,
        customerTk.Ten AS customerName,
        customerTk.SDT AS customerPhone,
        driverTk.Ten AS driverName,
        driverTk.SDT AS driverPhone,
        handlerTk.Ten AS handledByName
      FROM dbo.KhieuNaiHoTro kn
      LEFT JOIN dbo.LoaiKhieuNaiHoTro ls ON ls.MaLoaiSuCo = kn.LoaiSuCo
      LEFT JOIN dbo.TaiKhoan reporter ON reporter.MaTK = kn.MaTK
      LEFT JOIN dbo.DatXe dx ON dx.MaChuyen = kn.MaChuyen
      LEFT JOIN dbo.TaiKhoan customerTk ON customerTk.MaTK = dx.MaTK
      LEFT JOIN dbo.TaiXe tx ON tx.CCCD = dx.MaTX
      LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
      LEFT JOIN dbo.TaiKhoan handlerTk ON handlerTk.MaTK = kn.MaTKXuLy
      WHERE kn.MaKN = @complaintId;
    `);

  const row = result.recordset?.[0] ?? null;

  if (!row) {
    throw createHttpError(404, 'Không tìm thấy khiếu nại.');
  }

  return {
    success: true,
    item: mapAdminComplaintRow(row),
  };
}

export async function updateAdminComplaintDetail(complaintId, payload = {}) {
  await ensureComplaintSchema();
  const pool = await getSqlServerPool();
  const normalizedComplaintId = parseComplaintId(complaintId);
  const status = normalizeComplaintStatus(payload.status);
  const adminReply = normalizeAdminReply(payload.adminReply);
  const handledByAccountId = normalizeAccountId(payload.handledByAccountId, 'admin xử lí');

  const updateResult = await pool.request()
    .input('complaintId', sql.Int, normalizedComplaintId)
    .input('status', sql.VarChar(20), status)
    .input('adminReply', sql.NVarChar(1200), adminReply)
    .input('handledByAccountId', sql.VarChar(20), handledByAccountId)
    .query(`
      UPDATE dbo.KhieuNaiHoTro
      SET
        TrangThai = @status,
        PhanHoiAdmin = @adminReply,
        MaTKXuLy = @handledByAccountId,
        NgayCapNhat = SYSDATETIME()
      WHERE MaKN = @complaintId;

      SELECT @@ROWCOUNT AS affectedRows;
    `);

  if (!(updateResult.recordset?.[0]?.affectedRows > 0)) {
    throw createHttpError(404, 'Không tìm thấy khiếu nại để cập nhật.');
  }

  const updated = await getAdminComplaintDetail(normalizedComplaintId);

  // Send notification to the reporter
  try {
    const item = updated?.item;
    if (item?.accountId) {
      const recipientRole = item.reporterRoleCode === 'Q3' ? 'driver' : 'customer';
      const replyText = adminReply || 'SmartRide cảm ơn bạn đã báo cáo!';
      await createNotification({
        accountId: item.accountId,
        title: 'Khiếu nại của bạn đã được xử lí',
        content: replyText,
        recipient: recipientRole,
        sendAt: new Date().toISOString(),
        status: 'sent',
      });
    }
  } catch {
    // Non-critical: notification failure should not block the update response
  }

  broadcastAdminEvent('admin.complaint.changed', {
    action: 'updated',
    complaintId: updated?.item?.id ?? normalizedComplaintId,
    reporterRoleCode: updated?.item?.reporterRoleCode,
    reporterAccountId: updated?.item?.accountId,
    bookingCode: updated?.item?.bookingCode,
    status: updated?.item?.status,
  });

  return updated;
}
