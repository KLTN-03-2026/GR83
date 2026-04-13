import sql from 'mssql';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';

const allowedRecipients = new Set(['all', 'customer', 'driver']);
const allowedStatuses = new Set(['scheduled', 'sent']);
let notificationSchemaPromise = null;

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

function normalizeRecipientValue(value, fallback = 'customer') {
  const normalizedValue = normalizeToken(value);
  return allowedRecipients.has(normalizedValue) ? normalizedValue : fallback;
}

function normalizeStatusValue(value, fallback = 'scheduled') {
  const normalizedValue = normalizeToken(value);
  return allowedStatuses.has(normalizedValue) ? normalizedValue : fallback;
}

function parseRecipientFilter(value) {
  const normalizedValue = normalizeToken(value || 'all');

  if (normalizedValue === 'all') {
    return 'all';
  }

  if (!allowedRecipients.has(normalizedValue)) {
    throw createHttpError(400, 'Người nhận thông báo không hợp lệ.');
  }

  return normalizedValue;
}

function parseStatusFilter(value) {
  const normalizedValue = normalizeToken(value || 'all');

  if (normalizedValue === 'all') {
    return 'all';
  }

  if (!allowedStatuses.has(normalizedValue)) {
    throw createHttpError(400, 'Trạng thái thông báo không hợp lệ.');
  }

  return normalizedValue;
}

function parseSendAt(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    throw createHttpError(400, 'Vui lòng chọn thời gian gửi dự kiến.');
  }

  const sendAt = new Date(normalizedValue);

  if (Number.isNaN(sendAt.getTime())) {
    throw createHttpError(400, 'Thời gian gửi dự kiến không hợp lệ.');
  }

  return sendAt;
}

function normalizeDateTime(value, fallbackMessage) {
  const parsedDate = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, fallbackMessage);
  }

  return parsedDate;
}

function resolveNotificationStatus(sendAt, fallbackStatus = 'scheduled') {
  const parsedDate = sendAt instanceof Date ? sendAt : new Date(sendAt);
  const normalizedFallback = normalizeStatusValue(fallbackStatus);

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedFallback;
  }

  return parsedDate.getTime() <= Date.now() ? 'sent' : 'scheduled';
}

function parseNotificationPayload(payload = {}) {
  const title = normalizeText(payload.title);
  const content = normalizeText(payload.content);

  if (!title) {
    throw createHttpError(400, 'Tiêu đề thông báo không được để trống.');
  }

  if (title.length > 200) {
    throw createHttpError(400, 'Tiêu đề thông báo không được vượt quá 200 ký tự.');
  }

  if (!content) {
    throw createHttpError(400, 'Nội dung thông báo không được để trống.');
  }

  const recipient = parseRecipientFilter(payload.recipient ?? 'customer');
  const sendAt = parseSendAt(payload.sendAt);
  const status = resolveNotificationStatus(sendAt, payload.status);

  return {
    title,
    content,
    recipient,
    status,
    sendAt,
  };
}

function mapNotificationRow(row = {}) {
  const id = Number(row.MaTB ?? row.id ?? 0) || 0;
  const createdAt = row.NgayTao ? new Date(row.NgayTao) : null;
  const updatedAt = row.NgayCapNhat ? new Date(row.NgayCapNhat) : null;
  const sendAt = row.ThoiGianGuiDuKien ? new Date(row.ThoiGianGuiDuKien) : null;

  return {
    id,
    title: normalizeText(row.TieuDe ?? row.title),
    content: normalizeText(row.NoiDung ?? row.content),
    recipient: normalizeRecipientValue(row.NguoiNhan ?? row.recipient),
    status: normalizeStatusValue(row.TrangThai ?? row.status),
    sendAt: sendAt?.toISOString() ?? '',
    createdAt: createdAt?.toISOString() ?? '',
    updatedAt: updatedAt?.toISOString() ?? '',
  };
}

function buildNotificationSelectClause() {
  return `
    SELECT
      MaTB,
      TieuDe,
      NoiDung,
      NguoiNhan,
      TrangThai,
      ThoiGianGuiDuKien,
      NgayTao,
      NgayCapNhat
    FROM dbo.ThongBao
  `;
}

async function seedDefaultNotifications(pool) {
  const seedRows = [
    {
      title: 'Giảm giá 20%',
      recipient: 'customer',
      status: 'sent',
      createdAt: '2026-04-01T08:00:00',
      sendAt: '2026-04-02T09:00:00',
      content: 'Áp dụng giảm giá 20% cho khách hàng sử dụng RiBike trong khung giờ cao điểm.',
    },
    {
      title: 'Sự kiện lễ hội',
      recipient: 'customer',
      status: 'scheduled',
      createdAt: '2026-04-02T10:00:00',
      sendAt: '2026-04-12T18:00:00',
      content: 'Thông báo sự kiện lễ hội và các ưu đãi dành cho khách hàng trong tuần.',
    },
    {
      title: 'Chúc mừng sinh nhật',
      recipient: 'customer',
      status: 'sent',
      createdAt: '2026-04-03T09:00:00',
      sendAt: '2026-04-03T09:30:00',
      content: 'Tặng lời chúc và mã ưu đãi sinh nhật riêng cho khách hàng thân thiết.',
    },
    {
      title: 'Khuyến mãi 50%',
      recipient: 'customer',
      status: 'sent',
      createdAt: '2026-04-04T11:00:00',
      sendAt: '2026-04-06T12:00:00',
      content: 'Chương trình khuyến mãi 50% cho các chuyến xe chọn lọc trong cuối tuần.',
    },
    {
      title: 'Thông báo bảo trì',
      recipient: 'driver',
      status: 'sent',
      createdAt: '2026-04-05T07:00:00',
      sendAt: '2026-04-05T22:00:00',
      content: 'Lịch bảo trì hệ thống và hướng dẫn cập nhật ứng dụng dành cho tài xế.',
    },
    {
      title: 'Flash Sale',
      recipient: 'customer',
      status: 'scheduled',
      createdAt: '2026-04-06T09:00:00',
      sendAt: '2026-04-13T20:00:00',
      content: 'Thông báo flash sale theo khung giờ cho khách hàng hoạt động trong khu vực trung tâm.',
    },
    {
      title: 'Tăng voucher',
      recipient: 'customer',
      status: 'scheduled',
      createdAt: '2026-04-07T08:00:00',
      sendAt: '2026-04-14T09:00:00',
      content: 'Cộng thêm voucher cho khách hàng hoàn tất đủ số chuyến trong tháng.',
    },
    {
      title: 'Event cuối tuần',
      recipient: 'all',
      status: 'scheduled',
      createdAt: '2026-04-08T09:00:00',
      sendAt: '2026-04-15T18:00:00',
      content: 'Tổng hợp sự kiện cuối tuần dành cho khách hàng và tài xế đang hoạt động.',
    },
  ];

  const request = pool.request();
  const valueRows = seedRows.map((row, index) => {
    request.input(`title${index}`, sql.NVarChar(200), row.title);
    request.input(`content${index}`, sql.NVarChar(sql.MAX), row.content);
    request.input(`recipient${index}`, sql.VarChar(20), row.recipient);
    request.input(`status${index}`, sql.VarChar(20), row.status);
    request.input(`sendAt${index}`, sql.DateTime2(0), new Date(row.sendAt));
    request.input(`createdAt${index}`, sql.DateTime2(0), new Date(row.createdAt));

    return `(
      @title${index},
      @content${index},
      @recipient${index},
      @status${index},
      @sendAt${index},
      @createdAt${index},
      @createdAt${index}
    )`;
  }).join(',\n');

  await request.query(`
    INSERT INTO dbo.ThongBao
    (
      TieuDe,
      NoiDung,
      NguoiNhan,
      TrangThai,
      ThoiGianGuiDuKien,
      NgayTao,
      NgayCapNhat
    )
    VALUES
    ${valueRows};
  `);
}

async function ensureNotificationSchema() {
  if (!isSqlServerConfigured()) {
    throw createHttpError(
      500,
      'Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.',
    );
  }

  if (!notificationSchemaPromise) {
    notificationSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.ThongBao', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.ThongBao
          (
            MaTB                  INT            IDENTITY(1,1) NOT NULL,
            TieuDe                NVARCHAR(200)  NOT NULL,
            NoiDung               NVARCHAR(MAX)  NOT NULL,
            NguoiNhan             VARCHAR(20)    NOT NULL CONSTRAINT DF_ThongBao_NguoiNhan DEFAULT 'customer',
            TrangThai             VARCHAR(20)    NOT NULL CONSTRAINT DF_ThongBao_TrangThai DEFAULT 'scheduled',
            ThoiGianGuiDuKien     DATETIME2(0)   NOT NULL,
            NgayTao               DATETIME2(0)   NOT NULL CONSTRAINT DF_ThongBao_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat           DATETIME2(0)   NOT NULL CONSTRAINT DF_ThongBao_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_ThongBao PRIMARY KEY (MaTB),
            CONSTRAINT CK_ThongBao_NguoiNhan CHECK (NguoiNhan IN ('all', 'customer', 'driver')),
            CONSTRAINT CK_ThongBao_TrangThai CHECK (TrangThai IN ('scheduled', 'sent'))
          );
        END
      `);

      await pool.request().query(`
        IF COL_LENGTH(N'dbo.ThongBao', N'KenhGui') IS NOT NULL
        BEGIN
          DECLARE @defaultConstraintName sysname;

          SELECT @defaultConstraintName = dc.name
          FROM sys.default_constraints dc
          INNER JOIN sys.columns c ON c.default_object_id = dc.object_id
          WHERE dc.parent_object_id = OBJECT_ID(N'dbo.ThongBao')
            AND c.name = N'KenhGui';

          IF @defaultConstraintName IS NOT NULL
          BEGIN
            DECLARE @dropConstraintSql NVARCHAR(4000) = N'ALTER TABLE dbo.ThongBao DROP CONSTRAINT [' + REPLACE(@defaultConstraintName, N']', N']]') + N']';
            EXEC sys.sp_executesql @dropConstraintSql;
          END

          IF EXISTS (
            SELECT 1
            FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID(N'dbo.ThongBao')
              AND name = N'CK_ThongBao_KenhGui'
          )
          BEGIN
            ALTER TABLE dbo.ThongBao DROP CONSTRAINT CK_ThongBao_KenhGui;
          END

          ALTER TABLE dbo.ThongBao DROP COLUMN KenhGui;
        END
      `);

      const countResult = await pool.request().query('SELECT COUNT(1) AS totalCount FROM dbo.ThongBao;');
      const totalCount = Number(countResult.recordset?.[0]?.totalCount ?? 0);

      if (totalCount === 0) {
        await seedDefaultNotifications(pool);
      }
    })().catch((error) => {
      notificationSchemaPromise = null;
      throw error;
    });
  }

  return notificationSchemaPromise;
}

function buildNotificationListRequest(pool, filters = {}) {
  const request = pool.request();
  const conditions = [];
  const recipientFilter = parseRecipientFilter(filters.recipient);
  const statusFilter = parseStatusFilter(filters.status);
  const keyword = normalizeText(filters.keyword);

  if (recipientFilter !== 'all') {
    conditions.push('NguoiNhan = @recipient');
    request.input('recipient', sql.VarChar(20), recipientFilter);
  }

  if (statusFilter !== 'all') {
    conditions.push('TrangThai = @status');
    request.input('status', sql.VarChar(20), statusFilter);
  }

  if (keyword) {
    conditions.push('(TieuDe COLLATE Latin1_General_100_CI_AI LIKE @keyword OR NoiDung COLLATE Latin1_General_100_CI_AI LIKE @keyword)');
    request.input('keyword', sql.NVarChar(220), `%${keyword}%`);
  }

  return {
    request,
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

export async function syncDueNotifications(referenceTime = new Date()) {
  await ensureNotificationSchema();

  const now = normalizeDateTime(referenceTime, 'Thời điểm đồng bộ thông báo không hợp lệ.');
  const pool = await getSqlServerPool();
  const queryResult = await pool.request()
    .input('now', sql.DateTime2(0), now)
    .query(`
      UPDATE dbo.ThongBao
      SET
        TrangThai = 'sent',
        NgayCapNhat = @now
      OUTPUT INSERTED.MaTB, INSERTED.TieuDe, INSERTED.NoiDung, INSERTED.NguoiNhan, INSERTED.TrangThai, INSERTED.ThoiGianGuiDuKien, INSERTED.NgayTao, INSERTED.NgayCapNhat
      WHERE TrangThai = 'scheduled'
        AND ThoiGianGuiDuKien <= @now;
    `);

  const notifications = (queryResult.recordset ?? []).map(mapNotificationRow);

  return {
    success: true,
    message: notifications.length > 0
      ? 'Đã chuyển các thông báo đến hạn sang trạng thái đã gửi.'
      : 'Không có thông báo nào đến hạn cần cập nhật.',
    updatedCount: notifications.length,
    notifications,
  };
}

export async function listNotifications(filters = {}) {
  await ensureNotificationSchema();

  const pool = await getSqlServerPool();
  const { request, whereClause } = buildNotificationListRequest(pool, filters);
  const queryResult = await request.query(`
    ${buildNotificationSelectClause()}
    ${whereClause}
    ORDER BY NgayTao DESC, MaTB DESC;
  `);

  return {
    success: true,
    message: 'Lấy danh sách thông báo thành công.',
    notifications: (queryResult.recordset ?? []).map(mapNotificationRow),
  };
}

export async function getNotification(notificationId) {
  const normalizedNotificationId = Number(notificationId);

  if (!Number.isInteger(normalizedNotificationId) || normalizedNotificationId <= 0) {
    throw createHttpError(400, 'Mã thông báo không hợp lệ.');
  }

  await ensureNotificationSchema();

  const pool = await getSqlServerPool();
  const queryResult = await pool.request()
    .input('notificationId', sql.Int, normalizedNotificationId)
    .query(`
      ${buildNotificationSelectClause()}
      WHERE MaTB = @notificationId;
    `);

  const notificationRow = queryResult.recordset?.[0];

  if (!notificationRow) {
    throw createHttpError(404, 'Không tìm thấy thông báo cần xem.');
  }

  return {
    success: true,
    message: 'Lấy chi tiết thông báo thành công.',
    notification: mapNotificationRow(notificationRow),
  };
}

export async function createNotification(payload = {}) {
  await ensureNotificationSchema();

  const parsedPayload = parseNotificationPayload(payload);
  const now = new Date();
  const pool = await getSqlServerPool();
  const queryResult = await pool.request()
    .input('title', sql.NVarChar(200), parsedPayload.title)
    .input('content', sql.NVarChar(sql.MAX), parsedPayload.content)
    .input('recipient', sql.VarChar(20), parsedPayload.recipient)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('sendAt', sql.DateTime2(0), parsedPayload.sendAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      INSERT INTO dbo.ThongBao
      (
        TieuDe,
        NoiDung,
        NguoiNhan,
        TrangThai,
        ThoiGianGuiDuKien,
        NgayTao,
        NgayCapNhat
      )
      OUTPUT INSERTED.MaTB, INSERTED.TieuDe, INSERTED.NoiDung, INSERTED.NguoiNhan, INSERTED.TrangThai, INSERTED.ThoiGianGuiDuKien, INSERTED.NgayTao, INSERTED.NgayCapNhat
      VALUES
      (
        @title,
        @content,
        @recipient,
        @status,
        @sendAt,
        @now,
        @now
      );
    `);

  const notificationRow = queryResult.recordset?.[0];

  return {
    success: true,
    message: 'Đã tạo thông báo thành công.',
    notification: mapNotificationRow(notificationRow),
  };
}

export async function updateNotification(notificationId, payload = {}) {
  const normalizedNotificationId = Number(notificationId);

  if (!Number.isInteger(normalizedNotificationId) || normalizedNotificationId <= 0) {
    throw createHttpError(400, 'Mã thông báo không hợp lệ.');
  }

  await ensureNotificationSchema();

  const parsedPayload = parseNotificationPayload(payload);
  const now = new Date();
  const pool = await getSqlServerPool();
  const queryResult = await pool.request()
    .input('notificationId', sql.Int, normalizedNotificationId)
    .input('title', sql.NVarChar(200), parsedPayload.title)
    .input('content', sql.NVarChar(sql.MAX), parsedPayload.content)
    .input('recipient', sql.VarChar(20), parsedPayload.recipient)
    .input('status', sql.VarChar(20), parsedPayload.status)
    .input('sendAt', sql.DateTime2(0), parsedPayload.sendAt)
    .input('now', sql.DateTime2(0), now)
    .query(`
      UPDATE dbo.ThongBao
      SET
        TieuDe = @title,
        NoiDung = @content,
        NguoiNhan = @recipient,
        TrangThai = @status,
        ThoiGianGuiDuKien = @sendAt,
        NgayCapNhat = @now
      OUTPUT INSERTED.MaTB, INSERTED.TieuDe, INSERTED.NoiDung, INSERTED.NguoiNhan, INSERTED.TrangThai, INSERTED.ThoiGianGuiDuKien, INSERTED.NgayTao, INSERTED.NgayCapNhat
      WHERE MaTB = @notificationId;
    `);

  const notificationRow = queryResult.recordset?.[0];

  if (!notificationRow) {
    throw createHttpError(404, 'Không tìm thấy thông báo cần cập nhật.');
  }

  return {
    success: true,
    message: 'Cập nhật thông báo thành công.',
    notification: mapNotificationRow(notificationRow),
  };
}

export async function deleteNotification(notificationId) {
  const normalizedNotificationId = Number(notificationId);

  if (!Number.isInteger(normalizedNotificationId) || normalizedNotificationId <= 0) {
    throw createHttpError(400, 'Mã thông báo không hợp lệ.');
  }

  await ensureNotificationSchema();

  const pool = await getSqlServerPool();
  const queryResult = await pool.request()
    .input('notificationId', sql.Int, normalizedNotificationId)
    .query(`
      DELETE FROM dbo.ThongBao
      OUTPUT DELETED.MaTB, DELETED.TieuDe, DELETED.NoiDung, DELETED.NguoiNhan, DELETED.TrangThai, DELETED.ThoiGianGuiDuKien, DELETED.NgayTao, DELETED.NgayCapNhat
      WHERE MaTB = @notificationId;
    `);

  const notificationRow = queryResult.recordset?.[0];

  if (!notificationRow) {
    throw createHttpError(404, 'Không tìm thấy thông báo cần xóa.');
  }

  return {
    success: true,
    message: 'Đã xóa thông báo thành công.',
    notification: mapNotificationRow(notificationRow),
  };
}
