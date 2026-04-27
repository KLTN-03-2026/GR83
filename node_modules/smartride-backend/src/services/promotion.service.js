import sql from 'mssql';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';

const allowedStatuses = new Set(['active', 'expired', 'scheduled']);
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

function resolvePromotionStatus(status, expiresAt) {
  const normalizedStatus = parseStatusValue(status, 'scheduled');

  if (expiresAt && expiresAt < getTodayKey()) {
    return 'expired';
  }

  return normalizedStatus;
}

function parsePromotionPayload(payload = {}) {
  const code = normalizeCode(payload.code ?? payload.promotionCode ?? payload.maUuDai ?? payload.MaUuDai);
  const title = normalizeText(payload.title ?? payload.name ?? payload.tenUuDai ?? payload.TenUuDai);
  const description = normalizeText(payload.description ?? payload.moTa ?? payload.MoTa);
  const scope = normalizeText(payload.scope ?? payload.phamViApDung ?? payload.PhamViApDung);
  const status = parseStatusValue(payload.status ?? payload.trangThai ?? payload.TrangThai ?? 'scheduled');
  const discountPercent = parseIntegerField(
    payload.discountPercent ?? payload.phanTramGiam ?? payload.PhanTramGiam,
    'Mức giảm',
    { required: true, min: 1, max: 100 },
  );
  const maxAmount = parseIntegerField(
    payload.maxAmount ?? payload.giaTriToiDa ?? payload.GiaTriToiDa,
    'Giảm tối đa',
    { required: true, min: 0 },
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

  if (!scope) {
    throw createHttpError(400, 'Phạm vi áp dụng không được để trống.');
  }

  if (scope.length > 120) {
    throw createHttpError(400, 'Phạm vi áp dụng không được vượt quá 120 ký tự.');
  }

  return {
    code,
    title,
    description,
    discountPercent,
    maxAmount,
    scope,
    status: resolvePromotionStatus(status, expiresAt),
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

function mapPromotionRow(row = {}) {
  const expiresAt = normalizeText(row.NgayHetHan ?? row.expiresAt);
  const storedStatus = parseStatusValue(row.TrangThai ?? row.status ?? 'scheduled');
  const todayKey = getTodayKey();
  const status = expiresAt && expiresAt < todayKey && storedStatus !== 'expired' ? 'expired' : storedStatus;

  return {
    id: Number(row.MaUD ?? row.id ?? 0) || 0,
    code: normalizeText(row.MaUuDai ?? row.code),
    title: normalizeText(row.TenUuDai ?? row.title),
    description: normalizeText(row.MoTa ?? row.description),
    discountPercent: Number(row.PhanTramGiam ?? row.discountPercent ?? 0) || 0,
    maxAmount: Number(row.GiaTriToiDa ?? row.maxAmount ?? 0) || 0,
    scope: normalizeText(row.PhamViApDung ?? row.scope),
    status,
    usageCount: Number(row.SoLuotDaDung ?? row.usageCount ?? 0) || 0,
    usageLimit: row.GioiHanLuotDung === null || row.GioiHanLuotDung === undefined || row.GioiHanLuotDung === ''
      ? null
      : Number(row.GioiHanLuotDung) || 0,
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
      ud.PhanTramGiam,
      ud.GiaTriToiDa,
      ud.PhamViApDung,
      ud.TrangThai,
      ud.SoLuotDaDung,
      ud.GioiHanLuotDung,
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
  const keyword = normalizeText(filters.keyword);

  if (statusFilter !== 'all') {
    conditions.push(`(
      CASE
        WHEN ud.TrangThai <> 'expired' AND ud.NgayHetHan < CONVERT(date, GETDATE()) THEN 'expired'
        ELSE ud.TrangThai
      END = @status
    )`);
    request.input('status', sql.VarChar(20), statusFilter);
  }

  if (keyword) {
    conditions.push(`(
      ud.MaUuDai COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.TenUuDai COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.MoTa COLLATE Latin1_General_100_CI_AI LIKE @keyword OR
      ud.PhamViApDung COLLATE Latin1_General_100_CI_AI LIKE @keyword
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
      discountPercent: 10,
      maxAmount: 50000,
      scope: 'Tất cả khách hàng',
      status: 'active',
      usageCount: 186,
      usageLimit: 500,
      expiresAt: '2026-05-30',
      createdAt: '2026-04-18T08:00:00',
      updatedAt: '2026-04-18T08:00:00',
    },
    {
      code: 'NEWUSER',
      title: 'Ưu đãi khách hàng mới',
      description: 'Mã ưu đãi dành cho người dùng lần đầu đặt xe.',
      discountPercent: 20,
      maxAmount: 100000,
      scope: 'Khách hàng mới',
      status: 'active',
      usageCount: 92,
      usageLimit: 300,
      expiresAt: '2026-06-10',
      createdAt: '2026-04-21T09:00:00',
      updatedAt: '2026-04-21T09:00:00',
    },
    {
      code: 'SALE15',
      title: 'Khuyến mãi cuối tuần',
      description: 'Khuyến mãi cuối tuần cho toàn bộ chuyến xe.',
      discountPercent: 15,
      maxAmount: 50000,
      scope: 'Tất cả khách hàng',
      status: 'active',
      usageCount: 120,
      usageLimit: 450,
      expiresAt: '2026-05-15',
      createdAt: '2026-04-18T11:00:00',
      updatedAt: '2026-04-18T11:00:00',
    },
    {
      code: 'BIKE20',
      title: 'Ưu đãi xe máy',
      description: 'Ưu đãi riêng cho các chuyến xe máy.',
      discountPercent: 20,
      maxAmount: 80000,
      scope: 'RiBike',
      status: 'active',
      usageCount: 68,
      usageLimit: 250,
      expiresAt: '2026-06-12',
      createdAt: '2026-04-16T08:30:00',
      updatedAt: '2026-04-16T08:30:00',
    },
    {
      code: 'SPRING25',
      title: 'Ưu đãi mùa mới',
      description: 'Ưu đãi mùa mới dành cho người dùng quay lại.',
      discountPercent: 25,
      maxAmount: 75000,
      scope: 'Khách hàng thân thiết',
      status: 'active',
      usageCount: 44,
      usageLimit: 200,
      expiresAt: '2026-05-22',
      createdAt: '2026-04-22T07:00:00',
      updatedAt: '2026-04-22T07:00:00',
    },
    {
      code: 'WEEKEND10',
      title: 'Cuối tuần tiết kiệm',
      description: 'Khuyến mãi dùng cho khung giờ cuối tuần.',
      discountPercent: 10,
      maxAmount: 30000,
      scope: 'Tất cả khách hàng',
      status: 'active',
      usageCount: 77,
      usageLimit: 400,
      expiresAt: '2026-04-27',
      createdAt: '2026-04-20T08:00:00',
      updatedAt: '2026-04-20T08:00:00',
    },
    {
      code: 'OLD5',
      title: 'Ưu đãi cũ',
      description: 'Mã cũ đã hết hiệu lực và được giữ để đối soát.',
      discountPercent: 5,
      maxAmount: 20000,
      scope: 'Tất cả khách hàng',
      status: 'expired',
      usageCount: 210,
      usageLimit: 600,
      expiresAt: '2026-03-02',
      createdAt: '2026-03-01T08:00:00',
      updatedAt: '2026-03-01T08:00:00',
    },
    {
      code: 'TET2025',
      title: 'Ưu đãi theo mùa vụ',
      description: 'Ưu đãi theo mùa vụ đã ngừng áp dụng.',
      discountPercent: 30,
      maxAmount: 60000,
      scope: 'Khách hàng thân thiết',
      status: 'expired',
      usageCount: 305,
      usageLimit: 700,
      expiresAt: '2026-02-10',
      createdAt: '2026-02-12T08:00:00',
      updatedAt: '2026-02-12T08:00:00',
    },
    {
      code: 'VIP30',
      title: 'Ưu đãi khách VIP',
      description: 'Mã ưu đãi dành cho tập khách hàng VIP.',
      discountPercent: 30,
      maxAmount: 90000,
      scope: 'Khách VIP',
      status: 'expired',
      usageCount: 41,
      usageLimit: 120,
      expiresAt: '2026-01-15',
      createdAt: '2026-01-15T08:00:00',
      updatedAt: '2026-01-15T08:00:00',
    },
    {
      code: 'WELCOME5',
      title: 'Mã chào mừng',
      description: 'Ưu đãi chào mừng sẽ mở trong đợt tiếp theo.',
      discountPercent: 5,
      maxAmount: 40000,
      scope: 'Khách hàng mới',
      status: 'scheduled',
      usageCount: 0,
      usageLimit: 250,
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
    request.input(`discountPercent${index}`, sql.Int, row.discountPercent);
    request.input(`maxAmount${index}`, sql.Int, row.maxAmount);
    request.input(`scope${index}`, sql.NVarChar(120), row.scope);
    request.input(`status${index}`, sql.VarChar(20), row.status);
    request.input(`usageCount${index}`, sql.Int, row.usageCount);
    request.input(`usageLimit${index}`, sql.Int, row.usageLimit);
    request.input(`expiresAt${index}`, sql.VarChar(10), row.expiresAt);
    request.input(`createdAt${index}`, sql.DateTime2(0), new Date(row.createdAt));
    request.input(`updatedAt${index}`, sql.DateTime2(0), new Date(row.updatedAt));

    return `(
      @code${index},
      @title${index},
      @description${index},
      @discountPercent${index},
      @maxAmount${index},
      @scope${index},
      @status${index},
      @usageCount${index},
      @usageLimit${index},
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
      PhanTramGiam,
      GiaTriToiDa,
      PhamViApDung,
      TrangThai,
      SoLuotDaDung,
      GioiHanLuotDung,
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
            PhanTramGiam     INT            NOT NULL,
            GiaTriToiDa      INT            NOT NULL,
            PhamViApDung     NVARCHAR(120)  NOT NULL,
            TrangThai        VARCHAR(20)    NOT NULL CONSTRAINT DF_UuDai_TrangThai DEFAULT 'scheduled',
            SoLuotDaDung     INT            NOT NULL CONSTRAINT DF_UuDai_SoLuotDaDung DEFAULT 0,
            GioiHanLuotDung  INT            NULL,
            NgayHetHan       DATE           NOT NULL,
            NgayTao          DATETIME2(0)   NOT NULL CONSTRAINT DF_UuDai_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat      DATETIME2(0)   NOT NULL CONSTRAINT DF_UuDai_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_UuDai PRIMARY KEY (MaUD),
            CONSTRAINT UQ_UuDai_MaUuDai UNIQUE (MaUuDai),
            CONSTRAINT CK_UuDai_MaUuDai CHECK (LEN(LTRIM(RTRIM(MaUuDai))) > 0),
            CONSTRAINT CK_UuDai_TenUuDai CHECK (LEN(LTRIM(RTRIM(TenUuDai))) > 0),
            CONSTRAINT CK_UuDai_MoTa CHECK (LEN(LTRIM(RTRIM(MoTa))) > 0),
            CONSTRAINT CK_UuDai_PhanTramGiam CHECK (PhanTramGiam BETWEEN 1 AND 100),
            CONSTRAINT CK_UuDai_GiaTriToiDa CHECK (GiaTriToiDa >= 0),
            CONSTRAINT CK_UuDai_PhamViApDung CHECK (LEN(LTRIM(RTRIM(PhamViApDung))) > 0),
            CONSTRAINT CK_UuDai_TrangThai CHECK (TrangThai IN ('active', 'expired', 'scheduled')),
            CONSTRAINT CK_UuDai_SoLuotDaDung CHECK (SoLuotDaDung >= 0),
            CONSTRAINT CK_UuDai_GioiHanLuotDung CHECK (GioiHanLuotDung IS NULL OR GioiHanLuotDung >= 0)
          );
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
    .input('discountPercent', sql.Int, parsedPayload.discountPercent)
    .input('maxAmount', sql.Int, parsedPayload.maxAmount)
    .input('scope', sql.NVarChar(120), parsedPayload.scope)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('usageCount', sql.Int, parsedPayload.usageCount ?? 0)
    .input('usageLimit', sql.Int, parsedPayload.usageLimit)
    .input('expiresAt', sql.VarChar(10), parsedPayload.expiresAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      INSERT INTO dbo.UuDai
      (
        MaUuDai,
        TenUuDai,
        MoTa,
        PhanTramGiam,
        GiaTriToiDa,
        PhamViApDung,
        TrangThai,
        SoLuotDaDung,
        GioiHanLuotDung,
        NgayHetHan,
        NgayTao,
        NgayCapNhat
      )
      VALUES
      (
        @code,
        @title,
        @description,
        @discountPercent,
        @maxAmount,
        @scope,
        @status,
        @usageCount,
        @usageLimit,
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
    .input('discountPercent', sql.Int, parsedPayload.discountPercent)
    .input('maxAmount', sql.Int, parsedPayload.maxAmount)
    .input('scope', sql.NVarChar(120), parsedPayload.scope)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('usageCount', sql.Int, parsedPayload.usageCount)
    .input('usageLimit', sql.Int, parsedPayload.usageLimit)
    .input('expiresAt', sql.VarChar(10), parsedPayload.expiresAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      UPDATE dbo.UuDai
      SET
        MaUuDai = @code,
        TenUuDai = @title,
        MoTa = @description,
        PhanTramGiam = @discountPercent,
        GiaTriToiDa = @maxAmount,
        PhamViApDung = @scope,
        TrangThai = @status,
        SoLuotDaDung = COALESCE(@usageCount, SoLuotDaDung),
        GioiHanLuotDung = @usageLimit,
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