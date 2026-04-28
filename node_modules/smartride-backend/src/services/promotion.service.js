import sql from 'mssql';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';

const allowedStatuses = new Set(['active', 'expired', 'scheduled']);
const allowedDiscountTypes = new Set(['percent', 'fixed']);
const allowedVisibilityValues = new Set(['public', 'hidden']);
let promotionSchemaPromise = null;

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

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function getTodayKey(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const day = String(referenceDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseIntegerField(value, fieldLabel, { required = true, min = null, max = null } = {}) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    if (required) {
      throw createHttpError(400, `${fieldLabel} không được để trống.`);
    }

    return null;
  }

  if (!/^-?\d+$/.test(normalizedValue)) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ.`);
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);

  if (!Number.isInteger(parsedValue)) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ.`);
  }

  if (min !== null && parsedValue < min) {
    throw createHttpError(400, `${fieldLabel} phải lớn hơn hoặc bằng ${min}.`);
  }

  if (max !== null && parsedValue > max) {
    throw createHttpError(400, `${fieldLabel} phải nhỏ hơn hoặc bằng ${max}.`);
  }

  return parsedValue;
}

function parseDateKey(value, fieldLabel) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    throw createHttpError(400, `${fieldLabel} không được để trống.`);
  }

  const dateKey = normalizedValue.slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ.`);
  }

  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ.`);
  }

  return dateKey;
}

function parseStatusValue(value, fallback = 'scheduled') {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue) {
    return fallback;
  }

  if (!allowedStatuses.has(normalizedValue)) {
    throw createHttpError(400, 'Trạng thái ưu đãi không hợp lệ.');
  }

  return normalizedValue;
}

function parseDiscountTypeValue(value, fallback = 'percent') {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue) {
    return fallback;
  }

  if (!allowedDiscountTypes.has(normalizedValue)) {
    throw createHttpError(400, 'Loại ưu đãi không hợp lệ.');
  }

  return normalizedValue;
}

function parseVisibilityValue(value, fallback = 'public') {
  const normalizedValue = normalizeToken(value);

  if (!normalizedValue) {
    return fallback;
  }

  if (!allowedVisibilityValues.has(normalizedValue)) {
    throw createHttpError(400, 'Kiểu hiển thị ưu đãi không hợp lệ.');
  }

  return normalizedValue;
}

function resolvePromotionStatus(status, startsAt, expiresAt) {
  const normalizedStatus = parseStatusValue(status, 'active');
  const todayKey = getTodayKey();

  if (startsAt && startsAt > todayKey) {
    return 'scheduled';
  }

  if (expiresAt && expiresAt < todayKey) {
    return 'expired';
  }

  if (normalizedStatus === 'expired') {
    return 'expired';
  }

  return normalizedStatus;
}

function parsePromotionPayload(payload = {}) {
  const code = normalizeCode(payload.code ?? payload.promotionCode ?? payload.maUuDai ?? payload.MaUuDai);
  const title = normalizeText(payload.title ?? payload.name ?? payload.tenUuDai ?? payload.TenUuDai);
  const description = normalizeText(payload.description ?? payload.moTa ?? payload.MoTa);
  const VALID_AUDIENCE = new Set(['all', 'customer', 'driver', 'admin']);
  const rawAudience = normalizeToken(payload.audience ?? payload.doiTuong ?? payload.DoiTuong ?? payload.scope ?? payload.phamViApDung ?? payload.PhamViApDung ?? 'all');
  const audience = VALID_AUDIENCE.has(rawAudience) ? rawAudience : 'all';
  const discountType = parseDiscountTypeValue(payload.discountType ?? payload.loaiUuDai ?? payload.LoaiUuDai ?? 'percent');
  const visibility = parseVisibilityValue(payload.visibility ?? payload.hienThi ?? payload.HienThi ?? 'public');
  const status = parseStatusValue(payload.status ?? payload.trangThai ?? payload.TrangThai ?? 'active');
  const discountPercent = parseIntegerField(
    payload.discountPercent ?? payload.phanTramGiam ?? payload.PhanTramGiam,
    'Phần trăm giảm',
    { required: false, min: 1, max: 100 },
  );
  const discountAmount = parseIntegerField(
    payload.discountAmount ?? payload.soTienGiam ?? payload.SoTienGiam,
    'Số tiền giảm',
    { required: false, min: 1 },
  );
  const maxAmount = parseIntegerField(
    payload.maxAmount ?? payload.giaTriToiDa ?? payload.GiaTriToiDa,
    'Giảm tối đa',
    { required: false, min: 0 },
  );
  const minOrderAmount = parseIntegerField(
    payload.minOrderAmount ?? payload.donToiThieu ?? payload.DonToiThieu,
    'Đơn tối thiểu',
    { required: false, min: 0 },
  );
  const usageCount = parseIntegerField(
    payload.usageCount ?? payload.soLuotDaDung ?? payload.SoLuotDaDung,
    'Số lượt đã dùng',
    { required: false, min: 0 },
  );
  const usageLimit = parseIntegerField(
    payload.usageLimit ?? payload.gioiHanLuotDung ?? payload.GioiHanLuotDung,
    'Giới hạn lượt dùng',
    { required: false, min: 0 },
  );
  const startsAt = parseDateKey(
    payload.startsAt ?? payload.ngayBatDau ?? payload.NgayBatDau,
    'Ngày bắt đầu',
  );
  const expiresAt = parseDateKey(
    payload.expiresAt ?? payload.ngayHetHan ?? payload.NgayHetHan,
    'Ngày hết hạn',
  );

  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw createHttpError(
      400,
      'Mã ưu đãi chỉ được chứa chữ cái, số, dấu gạch ngang hoặc gạch dưới và dài từ 3 đến 40 ký tự.',
    );
  }

  if (!title) {
    throw createHttpError(400, 'Tên ưu đãi không được để trống.');
  }

  if (title.length > 120) {
    throw createHttpError(400, 'Tên ưu đãi không được vượt quá 120 ký tự.');
  }

  if (!description) {
    throw createHttpError(400, 'Mô tả ưu đãi không được để trống.');
  }

  if (description.length > 1000) {
    throw createHttpError(400, 'Mô tả ưu đãi không được vượt quá 1000 ký tự.');
  }

  if (startsAt > expiresAt) {
    throw createHttpError(400, 'Ngày bắt đầu không được lớn hơn ngày kết thúc.');
  }

  if (discountType === 'percent') {
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      throw createHttpError(400, 'Phần trăm giảm phải là số nguyên từ 1 đến 100.');
    }

    if (!Number.isInteger(maxAmount) || maxAmount < 0) {
      throw createHttpError(400, 'Giảm tối đa phải là số nguyên không âm khi chọn giảm theo % .');
    }
  }

  if (discountType === 'fixed') {
    if (!Number.isInteger(discountAmount) || discountAmount <= 0) {
      throw createHttpError(400, 'Số tiền giảm phải là số nguyên dương khi chọn giảm tiền cố định.');
    }
  }

  return {
    code,
    title,
    description,
    discountType,
    discountPercent: discountType === 'percent' ? discountPercent : null,
    discountAmount: discountType === 'fixed' ? discountAmount : null,
    maxAmount: discountType === 'percent' ? maxAmount : null,
    minOrderAmount: minOrderAmount ?? 0,
    audience,
    visibility,
    status: resolvePromotionStatus(status, startsAt, expiresAt),
    startsAt,
    expiresAt,
    usageCount: usageCount ?? 0,
    usageLimit,
  };
}

function parsePromotionStatusFilter(value) {
  const normalizedValue = normalizeToken(value || 'all');

  if (normalizedValue === 'all') {
    return 'all';
  }

  if (!allowedStatuses.has(normalizedValue)) {
    throw createHttpError(400, 'Trạng thái ưu đãi không hợp lệ.');
  }

  return normalizedValue;
}

function parsePromotionVisibilityFilter(value) {
  const normalizedValue = normalizeToken(value || 'all');

  if (normalizedValue === 'all') {
    return 'all';
  }

  if (!allowedVisibilityValues.has(normalizedValue)) {
    throw createHttpError(400, 'Kiểu hiển thị ưu đãi không hợp lệ.');
  }

  return normalizedValue;
}

function mapPromotionRow(row = {}) {
  const expiresAt = normalizeText(row.NgayHetHan ?? row.expiresAt);
  const startsAt = normalizeText(row.NgayBatDau ?? row.startsAt);
  const storedStatus = parseStatusValue(row.TrangThai ?? row.status ?? 'active');
  const todayKey = getTodayKey();
  let status = storedStatus;

  if (startsAt && startsAt > todayKey) {
    status = 'scheduled';
  } else if (expiresAt && expiresAt < todayKey) {
    status = 'expired';
  } else if (status !== 'expired') {
    status = 'active';
  }

  const discountType = parseDiscountTypeValue(row.LoaiUuDai ?? row.discountType ?? 'percent');
  const visibility = parseVisibilityValue(row.HienThi ?? row.visibility ?? 'public');

  return {
    id: Number(row.MaUD ?? row.id ?? 0) || 0,
    code: normalizeText(row.MaUuDai ?? row.code),
    title: normalizeText(row.TenUuDai ?? row.title),
    description: normalizeText(row.MoTa ?? row.description),
    discountType,
    discountPercent: discountType === 'percent' ? Number(row.PhanTramGiam ?? row.discountPercent ?? 0) || 0 : 0,
    discountAmount: discountType === 'fixed' ? Number(row.SoTienGiam ?? row.discountAmount ?? 0) || 0 : 0,
    maxAmount: Number(row.GiaTriToiDa ?? row.maxAmount ?? 0) || 0,
    minOrderAmount: Number(row.DonToiThieu ?? row.minOrderAmount ?? 0) || 0,
    audience: normalizeToken(row.DoiTuong ?? row.audience ?? 'all'),
    visibility,
    status,
    usageCount: Number(row.SoLuotDaDung ?? row.usageCount ?? 0) || 0,
    usageLimit: row.GioiHanLuotDung === null || row.GioiHanLuotDung === undefined || row.GioiHanLuotDung === ''
      ? null
      : Number(row.GioiHanLuotDung) || 0,
    startsAt,
    expiresAt,
    createdAt: normalizeText(row.NgayTao ?? row.createdAt),
    updatedAt: normalizeText(row.NgayCapNhat ?? row.updatedAt),
  };
}

function buildPromotionSelectClause() {
  return `
    SELECT
      ud.MaUD,
      ud.MaUuDai,
      ud.TenUuDai,
      ud.MoTa,
      ud.LoaiUuDai,
      ud.PhanTramGiam,
      ud.SoTienGiam,
      ud.GiaTriToiDa,
      ud.DonToiThieu,
      ud.DoiTuong,
      ud.HienThi,
      ud.TrangThai,
      ud.SoLuotDaDung,
      ud.GioiHanLuotDung,
      CONVERT(VARCHAR(10), ud.NgayBatDau, 23) AS NgayBatDau,
      CONVERT(VARCHAR(10), ud.NgayHetHan, 23) AS NgayHetHan,
      CONVERT(VARCHAR(19), ud.NgayTao, 126) AS NgayTao,
      CONVERT(VARCHAR(19), ud.NgayCapNhat, 126) AS NgayCapNhat
    FROM dbo.UuDai ud
  `;
}

function buildPromotionListRequest(pool, filters = {}) {
  const request = pool.request();
  const conditions = [];
  const statusFilter = parsePromotionStatusFilter(filters.status);
  const visibilityFilter = parsePromotionVisibilityFilter(filters.visibility);
  const keyword = normalizeText(filters.keyword);
  const VALID_AUDIENCE = new Set(['all', 'customer', 'driver', 'admin']);
  const rawAudience = normalizeToken(filters.audience ?? '');
  const audienceFilter = VALID_AUDIENCE.has(rawAudience) && rawAudience !== 'all' ? rawAudience : null;

  if (statusFilter !== 'all') {
    conditions.push(`(CASE
      WHEN ud.NgayHetHan < CONVERT(date, GETDATE()) THEN 'expired'
      WHEN ud.NgayBatDau > CONVERT(date, GETDATE()) THEN 'scheduled'
      ELSE 'active'
    END = @status)`);
    request.input('status', sql.VarChar(20), statusFilter);
  }

  if (visibilityFilter !== 'all') {
    conditions.push('ud.HienThi = @visibility');
    request.input('visibility', sql.VarChar(20), visibilityFilter);
  }

  if (audienceFilter) {
    conditions.push(`(ud.DoiTuong = 'all' OR ud.DoiTuong = @audience)`);
    request.input('audience', sql.VarChar(20), audienceFilter);
  }

  if (keyword) {
    conditions.push(`(
      ud.MaUuDai COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.TenUuDai COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.MoTa COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.DoiTuong COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.HienThi COLLATE Latin1_General_100_CI_AI LIKE @keyword
    )`);
    request.input('keyword', sql.NVarChar(240), `%${keyword}%`);
  }

  return {
    request,
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

async function seedDefaultPromotions(pool) {
  const seedRows = [
    {
      code: 'SALE10',
      title: 'Giảm giá chuyến ngắn',
      description: 'Ưu đãi giảm trực tiếp cho chuyến xe ngắn.',
      discountType: 'percent',
      discountPercent: 10,
      discountAmount: null,
      maxAmount: 50000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'active',
      usageCount: 186,
      usageLimit: 500,
      startsAt: '2026-04-01',
      expiresAt: '2026-05-30',
      createdAt: '2026-04-18T08:00:00',
      updatedAt: '2026-04-18T08:00:00',
    },
    {
      code: 'NEWUSER',
      title: 'Ưu đãi khách hàng mới',
      description: 'Mã ưu đãi dành cho người dùng lần đầu đặt xe.',
      discountType: 'percent',
      discountPercent: 20,
      discountAmount: null,
      maxAmount: 100000,
      minOrderAmount: 20000,
      audience: 'customer',
      visibility: 'public',
      status: 'active',
      usageCount: 92,
      usageLimit: 300,
      startsAt: '2026-04-15',
      expiresAt: '2026-06-10',
      createdAt: '2026-04-21T09:00:00',
      updatedAt: '2026-04-21T09:00:00',
    },
    {
      code: 'SALE15',
      title: 'Khuyến mãi cuối tuần',
      description: 'Khuyến mãi cuối tuần cho toàn bộ chuyến xe.',
      discountType: 'percent',
      discountPercent: 15,
      discountAmount: null,
      maxAmount: 50000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'active',
      usageCount: 120,
      usageLimit: 450,
      startsAt: '2026-04-01',
      expiresAt: '2026-05-15',
      createdAt: '2026-04-18T11:00:00',
      updatedAt: '2026-04-18T11:00:00',
    },
    {
      code: 'BIKE20',
      title: 'Ưu đãi xe máy',
      description: 'Ưu đãi riêng cho các chuyến xe máy.',
      discountType: 'percent',
      discountPercent: 20,
      discountAmount: null,
      maxAmount: 80000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'active',
      usageCount: 68,
      usageLimit: 250,
      startsAt: '2026-04-10',
      expiresAt: '2026-06-12',
      createdAt: '2026-04-16T08:30:00',
      updatedAt: '2026-04-16T08:30:00',
    },
    {
      code: 'SPRING25',
      title: 'Ưu đãi mùa mới',
      description: 'Ưu đãi mùa mới dành cho người dùng quay lại.',
      discountType: 'percent',
      discountPercent: 25,
      discountAmount: null,
      maxAmount: 75000,
      minOrderAmount: 30000,
      audience: 'customer',
      visibility: 'public',
      status: 'active',
      usageCount: 44,
      usageLimit: 200,
      startsAt: '2026-04-20',
      expiresAt: '2026-05-22',
      createdAt: '2026-04-22T07:00:00',
      updatedAt: '2026-04-22T07:00:00',
    },
    {
      code: 'WEEKEND10',
      title: 'Cuối tuần tiết kiệm',
      description: 'Khuyến mãi dùng cho khung giờ cuối tuần.',
      discountType: 'fixed',
      discountPercent: 10,
      discountAmount: 30000,
      maxAmount: null,
      minOrderAmount: 100000,
      audience: 'all',
      visibility: 'hidden',
      status: 'active',
      usageCount: 77,
      usageLimit: 400,
      startsAt: '2026-04-20',
      expiresAt: '2026-04-27',
      createdAt: '2026-04-20T08:00:00',
      updatedAt: '2026-04-20T08:00:00',
    },
    {
      code: 'OLD5',
      title: 'Ưu đãi cũ',
      description: 'Mã cũ đã hết hiệu lực và được giữ để đối soát.',
      discountType: 'percent',
      discountPercent: 5,
      discountAmount: null,
      maxAmount: 20000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'expired',
      usageCount: 210,
      usageLimit: 600,
      startsAt: '2026-01-01',
      expiresAt: '2026-03-02',
      createdAt: '2026-03-01T08:00:00',
      updatedAt: '2026-03-01T08:00:00',
    },
    {
      code: 'TET2025',
      title: 'Ưu đãi theo mùa vụ',
      description: 'Ưu đãi theo mùa vụ đã ngừng áp dụng.',
      discountType: 'percent',
      discountPercent: 30,
      discountAmount: null,
      maxAmount: 60000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'expired',
      usageCount: 305,
      usageLimit: 700,
      startsAt: '2025-12-01',
      expiresAt: '2026-02-10',
      createdAt: '2026-02-12T08:00:00',
      updatedAt: '2026-02-12T08:00:00',
    },
    {
      code: 'VIP30',
      title: 'Ưu đãi khách VIP',
      description: 'Mã ưu đãi dành cho tập khách hàng VIP.',
      discountType: 'percent',
      discountPercent: 30,
      discountAmount: null,
      maxAmount: 90000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'expired',
      usageCount: 41,
      usageLimit: 120,
      startsAt: '2025-12-01',
      expiresAt: '2026-01-15',
      createdAt: '2026-01-15T08:00:00',
      updatedAt: '2026-01-15T08:00:00',
    },
    {
      code: 'WELCOME5',
      title: 'Mã chào mừng',
      description: 'Ưu đãi chào mừng sẽ mở trong đợt tiếp theo.',
      discountType: 'percent',
      discountPercent: 5,
      discountAmount: null,
      maxAmount: 40000,
      minOrderAmount: 0,
      audience: 'customer',
      visibility: 'public',
      status: 'scheduled',
      usageCount: 0,
      usageLimit: 250,
      startsAt: '2026-05-20',
      expiresAt: '2026-06-30',
      createdAt: '2026-04-19T08:00:00',
      updatedAt: '2026-04-19T08:00:00',
    },
  ];

  const request = pool.request();
  const valueRows = seedRows.map((row, index) => {
    request.input(`code${index}`, sql.VarChar(40), row.code);
    request.input(`title${index}`, sql.NVarChar(120), row.title);
    request.input(`description${index}`, sql.NVarChar(1000), row.description);
    request.input(`discountType${index}`, sql.VarChar(20), row.discountType);
    request.input(`discountPercent${index}`, sql.Int, row.discountPercent);
    request.input(`discountAmount${index}`, sql.Int, row.discountAmount);
    request.input(`maxAmount${index}`, sql.Int, row.maxAmount);
    request.input(`minOrderAmount${index}`, sql.Int, row.minOrderAmount);
    request.input(`audience${index}`, sql.VarChar(20), row.audience ?? 'all');
    request.input(`visibility${index}`, sql.VarChar(20), row.visibility);
    request.input(`status${index}`, sql.VarChar(20), row.status);
    request.input(`usageCount${index}`, sql.Int, row.usageCount);
    request.input(`usageLimit${index}`, sql.Int, row.usageLimit);
    request.input(`startsAt${index}`, sql.VarChar(10), row.startsAt);
    request.input(`expiresAt${index}`, sql.VarChar(10), row.expiresAt);
    request.input(`createdAt${index}`, sql.DateTime2(0), new Date(row.createdAt));
    request.input(`updatedAt${index}`, sql.DateTime2(0), new Date(row.updatedAt));

    return `(
      @code${index},
      @title${index},
      @description${index},
      @discountType${index},
      @discountPercent${index},
      @discountAmount${index},
      @maxAmount${index},
      @minOrderAmount${index},
      @audience${index},
      @visibility${index},
      @status${index},
      @usageCount${index},
      @usageLimit${index},
      CONVERT(date, @startsAt${index}),
      CONVERT(date, @expiresAt${index}),
      @createdAt${index},
      @updatedAt${index}
    )`;
  }).join(',\n');

  await request.query(`
    INSERT INTO dbo.UuDai
    (
      MaUuDai,
      TenUuDai,
      MoTa,
      LoaiUuDai,
      PhanTramGiam,
      SoTienGiam,
      GiaTriToiDa,
      DonToiThieu,
      DoiTuong,
      HienThi,
      TrangThai,
      SoLuotDaDung,
      GioiHanLuotDung,
      NgayBatDau,
      NgayHetHan,
      NgayTao,
      NgayCapNhat
    )
    VALUES
    ${valueRows};
  `);
}

async function ensureCodeAvailable(pool, promotionCode, promotionId = null) {
  const request = pool.request().input('promotionCode', sql.VarChar(40), promotionCode);
  let query = 'SELECT TOP (1) MaUD FROM dbo.UuDai WHERE MaUuDai = @promotionCode';

  if (promotionId !== null && promotionId !== undefined) {
    request.input('promotionId', sql.Int, promotionId);
    query += ' AND MaUD <> @promotionId';
  }

  const result = await request.query(query);

  if ((result.recordset ?? []).length > 0) {
    throw createHttpError(409, 'Mã ưu đãi đã tồn tại.');
  }
}

async function fetchPromotionById(pool, promotionId) {
  const queryResult = await pool.request()
    .input('promotionId', sql.Int, promotionId)
    .query(`
      ${buildPromotionSelectClause()}
      WHERE ud.MaUD = @promotionId;
    `);

  return mapPromotionRow(queryResult.recordset?.[0] ?? null);
}

export async function ensurePromotionSchema() {
  if (!isSqlServerConfigured()) {
    throw createHttpError(
      500,
      'Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.',
    );
  }

  if (!promotionSchemaPromise) {
    promotionSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.UuDai', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.UuDai
          (
            MaUD             INT            IDENTITY(1,1) NOT NULL,
            MaUuDai          VARCHAR(40)    NOT NULL,
            TenUuDai         NVARCHAR(120)  NOT NULL,
            MoTa             NVARCHAR(1000) NOT NULL,
            LoaiUuDai        VARCHAR(20)    NOT NULL CONSTRAINT DF_UuDai_LoaiUuDai DEFAULT 'percent',
            PhanTramGiam     INT            NULL,
            SoTienGiam       INT            NULL,
            GiaTriToiDa      INT            NULL,
            DonToiThieu      INT            NOT NULL CONSTRAINT DF_UuDai_DonToiThieu DEFAULT 0,
            DoiTuong         VARCHAR(20)    NOT NULL CONSTRAINT DF_UuDai_DoiTuong DEFAULT 'all',
            HienThi          VARCHAR(20)    NOT NULL CONSTRAINT DF_UuDai_HienThi DEFAULT 'public',
            TrangThai        VARCHAR(20)    NOT NULL CONSTRAINT DF_UuDai_TrangThai DEFAULT 'scheduled',
            SoLuotDaDung     INT            NOT NULL CONSTRAINT DF_UuDai_SoLuotDaDung DEFAULT 0,
            GioiHanLuotDung  INT            NULL,
            NgayBatDau       DATE           NOT NULL,
            NgayHetHan       DATE           NOT NULL,
            NgayTao          DATETIME2(0)   NOT NULL CONSTRAINT DF_UuDai_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat      DATETIME2(0)   NOT NULL CONSTRAINT DF_UuDai_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_UuDai PRIMARY KEY (MaUD),
            CONSTRAINT UQ_UuDai_MaUuDai UNIQUE (MaUuDai),
            CONSTRAINT CK_UuDai_MaUuDai CHECK (LEN(LTRIM(RTRIM(MaUuDai))) > 0),
            CONSTRAINT CK_UuDai_TenUuDai CHECK (LEN(LTRIM(RTRIM(TenUuDai))) > 0),
            CONSTRAINT CK_UuDai_MoTa CHECK (LEN(LTRIM(RTRIM(MoTa))) > 0),
            CONSTRAINT CK_UuDai_LoaiUuDai CHECK (LoaiUuDai IN ('percent', 'fixed')),
            CONSTRAINT CK_UuDai_PhanTramGiam CHECK (PhanTramGiam IS NULL OR PhanTramGiam BETWEEN 1 AND 100),
            CONSTRAINT CK_UuDai_SoTienGiam CHECK (SoTienGiam IS NULL OR SoTienGiam > 0),
            CONSTRAINT CK_UuDai_GiaTriToiDa CHECK (GiaTriToiDa IS NULL OR GiaTriToiDa >= 0),
            CONSTRAINT CK_UuDai_DonToiThieu CHECK (DonToiThieu >= 0),
            CONSTRAINT CK_UuDai_DoiTuong CHECK (DoiTuong IN ('all', 'customer', 'driver', 'admin')),
            CONSTRAINT CK_UuDai_HienThi CHECK (HienThi IN ('public', 'hidden')),
            CONSTRAINT CK_UuDai_TrangThai CHECK (TrangThai IN ('active', 'expired', 'scheduled')),
            CONSTRAINT CK_UuDai_SoLuotDaDung CHECK (SoLuotDaDung >= 0),
            CONSTRAINT CK_UuDai_GioiHanLuotDung CHECK (GioiHanLuotDung IS NULL OR GioiHanLuotDung >= 0),
            CONSTRAINT CK_UuDai_NgayBatDau_NgayHetHan CHECK (NgayBatDau <= NgayHetHan)
          );
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.UuDai', N'LoaiUuDai') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD LoaiUuDai VARCHAR(20) NULL;
          UPDATE dbo.UuDai SET LoaiUuDai = 'percent' WHERE LoaiUuDai IS NULL;
          ALTER TABLE dbo.UuDai ALTER COLUMN LoaiUuDai VARCHAR(20) NOT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'SoTienGiam') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD SoTienGiam INT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'DonToiThieu') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD DonToiThieu INT NULL;
          UPDATE dbo.UuDai SET DonToiThieu = 0 WHERE DonToiThieu IS NULL;
          ALTER TABLE dbo.UuDai ALTER COLUMN DonToiThieu INT NOT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'HienThi') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD HienThi VARCHAR(20) NULL;
          UPDATE dbo.UuDai SET HienThi = 'public' WHERE HienThi IS NULL;
          ALTER TABLE dbo.UuDai ALTER COLUMN HienThi VARCHAR(20) NOT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'NgayBatDau') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD NgayBatDau DATE NULL;
          UPDATE dbo.UuDai
          SET NgayBatDau = COALESCE(CONVERT(date, NgayTao), NgayHetHan)
          WHERE NgayBatDau IS NULL;
          ALTER TABLE dbo.UuDai ALTER COLUMN NgayBatDau DATE NOT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'DoiTuong') IS NULL
        BEGIN
          ALTER TABLE dbo.UuDai ADD DoiTuong VARCHAR(20) NULL;
          UPDATE dbo.UuDai SET DoiTuong = 'customer' WHERE DoiTuong IS NULL;
          ALTER TABLE dbo.UuDai ALTER COLUMN DoiTuong VARCHAR(20) NOT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'PhanTramGiam') IS NOT NULL
        BEGIN
          ALTER TABLE dbo.UuDai ALTER COLUMN PhanTramGiam INT NULL;
        END

        IF COL_LENGTH(N'dbo.UuDai', N'GiaTriToiDa') IS NOT NULL
        BEGIN
          ALTER TABLE dbo.UuDai ALTER COLUMN GiaTriToiDa INT NULL;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.default_constraints
          WHERE name = N'DF_UuDai_LoaiUuDai'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT DF_UuDai_LoaiUuDai;
        END

        ALTER TABLE dbo.UuDai ADD CONSTRAINT DF_UuDai_LoaiUuDai DEFAULT 'percent' FOR LoaiUuDai;

        IF EXISTS (
          SELECT 1
          FROM sys.default_constraints
          WHERE name = N'DF_UuDai_DonToiThieu'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT DF_UuDai_DonToiThieu;
        END

        ALTER TABLE dbo.UuDai ADD CONSTRAINT DF_UuDai_DonToiThieu DEFAULT 0 FOR DonToiThieu;

        IF EXISTS (
          SELECT 1
          FROM sys.default_constraints
          WHERE name = N'DF_UuDai_HienThi'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT DF_UuDai_HienThi;
        END

        ALTER TABLE dbo.UuDai ADD CONSTRAINT DF_UuDai_HienThi DEFAULT 'public' FOR HienThi;

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_PhanTramGiam'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_PhanTramGiam;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_GiaTriToiDa'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_GiaTriToiDa;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_LoaiUuDai'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_LoaiUuDai;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_SoTienGiam'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_SoTienGiam;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_DonToiThieu'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_DonToiThieu;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_HienThi'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_HienThi;
        END

        IF EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_NgayBatDau_NgayHetHan'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai DROP CONSTRAINT CK_UuDai_NgayBatDau_NgayHetHan;
        END

        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_LoaiUuDai CHECK (LoaiUuDai IN ('percent', 'fixed'));
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_PhanTramGiam CHECK (PhanTramGiam IS NULL OR PhanTramGiam BETWEEN 1 AND 100);
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_SoTienGiam CHECK (SoTienGiam IS NULL OR SoTienGiam > 0);
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_GiaTriToiDa CHECK (GiaTriToiDa IS NULL OR GiaTriToiDa >= 0);
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_DonToiThieu CHECK (DonToiThieu >= 0);
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_HienThi CHECK (HienThi IN ('public', 'hidden'));
        ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_NgayBatDau_NgayHetHan CHECK (NgayBatDau <= NgayHetHan);

        IF NOT EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_UuDai_DoiTuong'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai ADD CONSTRAINT CK_UuDai_DoiTuong CHECK (DoiTuong IN ('all', 'customer', 'driver', 'admin'));
        END

        IF NOT EXISTS (
          SELECT 1
          FROM sys.default_constraints
          WHERE name = N'DF_UuDai_DoiTuong'
            AND parent_object_id = OBJECT_ID(N'dbo.UuDai')
        )
        BEGIN
          ALTER TABLE dbo.UuDai ADD CONSTRAINT DF_UuDai_DoiTuong DEFAULT 'customer' FOR DoiTuong;
        END
      `);

      const countResult = await pool.request().query('SELECT COUNT(1) AS totalCount FROM dbo.UuDai;');
      const totalCount = Number(countResult.recordset?.[0]?.totalCount ?? 0);

      if (totalCount === 0) {
        await seedDefaultPromotions(pool);
      }
    })().catch((error) => {
      promotionSchemaPromise = null;
      throw error;
    });
  }

  return promotionSchemaPromise;
}

export async function listPromotions(filters = {}) {
  await ensurePromotionSchema();

  const pool = await getSqlServerPool();
  const { request, whereClause } = buildPromotionListRequest(pool, filters);
  const queryResult = await request.query(`
    ${buildPromotionSelectClause()}
    ${whereClause}
    ORDER BY NgayTao DESC, MaUD DESC;
  `);

  return {
    success: true,
    message: 'Lấy danh sách ưu đãi thành công.',
    promotions: (queryResult.recordset ?? []).map(mapPromotionRow),
  };
}

export async function getPromotion(promotionId) {
  const normalizedPromotionId = Number(promotionId);

  if (!Number.isInteger(normalizedPromotionId) || normalizedPromotionId <= 0) {
    throw createHttpError(400, 'Mã ưu đãi không hợp lệ.');
  }

  await ensurePromotionSchema();

  const pool = await getSqlServerPool();
  const promotion = await fetchPromotionById(pool, normalizedPromotionId);

  if (!promotion) {
    throw createHttpError(404, 'Không tìm thấy ưu đãi cần xem.');
  }

  return {
    success: true,
    message: 'Lấy chi tiết ưu đãi thành công.',
    promotion,
  };
}

export async function createPromotion(payload = {}) {
  await ensurePromotionSchema();

  const parsedPayload = parsePromotionPayload(payload);
  const pool = await getSqlServerPool();
  await ensureCodeAvailable(pool, parsedPayload.code);

  const now = new Date();
  const insertResult = await pool.request()
    .input('code', sql.VarChar(40), parsedPayload.code)
    .input('title', sql.NVarChar(120), parsedPayload.title)
    .input('description', sql.NVarChar(1000), parsedPayload.description)
    .input('discountType', sql.VarChar(20), parsedPayload.discountType)
    .input('discountPercent', sql.Int, parsedPayload.discountPercent)
    .input('discountAmount', sql.Int, parsedPayload.discountAmount)
    .input('maxAmount', sql.Int, parsedPayload.maxAmount)
    .input('minOrderAmount', sql.Int, parsedPayload.minOrderAmount)
    .input('audience', sql.VarChar(20), parsedPayload.audience ?? 'all')
    .input('visibility', sql.VarChar(20), parsedPayload.visibility)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('usageCount', sql.Int, parsedPayload.usageCount ?? 0)
    .input('usageLimit', sql.Int, parsedPayload.usageLimit)
    .input('startsAt', sql.VarChar(10), parsedPayload.startsAt)
    .input('expiresAt', sql.VarChar(10), parsedPayload.expiresAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      INSERT INTO dbo.UuDai
      (
        MaUuDai,
        TenUuDai,
        MoTa,
        LoaiUuDai,
        PhanTramGiam,
        SoTienGiam,
        GiaTriToiDa,
        DonToiThieu,
        DoiTuong,
        HienThi,
        TrangThai,
        SoLuotDaDung,
        GioiHanLuotDung,
        NgayBatDau,
        NgayHetHan,
        NgayTao,
        NgayCapNhat
      )
      VALUES
      (
        @code,
        @title,
        @description,
        @discountType,
        @discountPercent,
        @discountAmount,
        @maxAmount,
        @minOrderAmount,
        @audience,
        @visibility,
        @status,
        @usageCount,
        @usageLimit,
        CONVERT(date, @startsAt),
        CONVERT(date, @expiresAt),
        @now,
        @now
      );

      SELECT CAST(SCOPE_IDENTITY() AS INT) AS MaUD;
    `);

  const createdPromotionId = Number(insertResult.recordset?.[0]?.MaUD ?? 0);
  const createdPromotion = await fetchPromotionById(pool, createdPromotionId);

  if (!createdPromotion) {
    throw createHttpError(500, 'Không thể lấy lại thông tin ưu đãi sau khi tạo.');
  }

  return {
    success: true,
    message: 'Đã tạo ưu đãi thành công.',
    promotion: createdPromotion,
  };
}

export async function updatePromotion(promotionId, payload = {}) {
  const normalizedPromotionId = Number(promotionId);

  if (!Number.isInteger(normalizedPromotionId) || normalizedPromotionId <= 0) {
    throw createHttpError(400, 'Mã ưu đãi không hợp lệ.');
  }

  await ensurePromotionSchema();

  const parsedPayload = parsePromotionPayload(payload);
  const pool = await getSqlServerPool();
  const existingPromotion = await fetchPromotionById(pool, normalizedPromotionId);

  if (!existingPromotion) {
    throw createHttpError(404, 'Không tìm thấy ưu đãi cần cập nhật.');
  }

  if (parsedPayload.code !== existingPromotion.code) {
    await ensureCodeAvailable(pool, parsedPayload.code, normalizedPromotionId);
  }

  const now = new Date();
  await pool.request()
    .input('promotionId', sql.Int, normalizedPromotionId)
    .input('code', sql.VarChar(40), parsedPayload.code)
    .input('title', sql.NVarChar(120), parsedPayload.title)
    .input('description', sql.NVarChar(1000), parsedPayload.description)
    .input('discountType', sql.VarChar(20), parsedPayload.discountType)
    .input('discountPercent', sql.Int, parsedPayload.discountPercent)
    .input('discountAmount', sql.Int, parsedPayload.discountAmount)
    .input('maxAmount', sql.Int, parsedPayload.maxAmount)
    .input('minOrderAmount', sql.Int, parsedPayload.minOrderAmount)
    .input('audience', sql.VarChar(20), parsedPayload.audience ?? 'all')
    .input('visibility', sql.VarChar(20), parsedPayload.visibility)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('usageCount', sql.Int, parsedPayload.usageCount)
    .input('usageLimit', sql.Int, parsedPayload.usageLimit)
    .input('startsAt', sql.VarChar(10), parsedPayload.startsAt)
    .input('expiresAt', sql.VarChar(10), parsedPayload.expiresAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      UPDATE dbo.UuDai
      SET
        MaUuDai = @code,
        TenUuDai = @title,
        MoTa = @description,
        LoaiUuDai = @discountType,
        PhanTramGiam = @discountPercent,
        SoTienGiam = @discountAmount,
        GiaTriToiDa = @maxAmount,
        DonToiThieu = @minOrderAmount,
        DoiTuong = @audience,
        HienThi = @visibility,
        TrangThai = @status,
        SoLuotDaDung = COALESCE(@usageCount, SoLuotDaDung),
        GioiHanLuotDung = @usageLimit,
        NgayBatDau = CONVERT(date, @startsAt),
        NgayHetHan = CONVERT(date, @expiresAt),
        NgayCapNhat = @now
      WHERE MaUD = @promotionId;
    `);

  const updatedPromotion = await fetchPromotionById(pool, normalizedPromotionId);

  if (!updatedPromotion) {
    throw createHttpError(500, 'Không thể lấy lại thông tin ưu đãi sau khi cập nhật.');
  }

  return {
    success: true,
    message: 'Cập nhật ưu đãi thành công.',
    promotion: updatedPromotion,
  };
}

export async function deletePromotion(promotionId) {
  const normalizedPromotionId = Number(promotionId);

  if (!Number.isInteger(normalizedPromotionId) || normalizedPromotionId <= 0) {
    throw createHttpError(400, 'Mã ưu đãi không hợp lệ.');
  }

  await ensurePromotionSchema();

  const pool = await getSqlServerPool();
  const existingPromotion = await fetchPromotionById(pool, normalizedPromotionId);

  if (!existingPromotion) {
    throw createHttpError(404, 'Không tìm thấy ưu đãi cần xóa.');
  }

  await pool.request()
    .input('promotionId', sql.Int, normalizedPromotionId)
    .query('DELETE FROM dbo.UuDai WHERE MaUD = @promotionId;');

  return {
    success: true,
    message: 'Đã xóa ưu đãi thành công.',
    promotion: existingPromotion,
  };
}