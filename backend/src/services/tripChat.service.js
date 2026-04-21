import sql from 'mssql';
import { ensureRideSchema } from './ride.service.js';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';
import { publishRideEvent } from './ride.realtime.service.js';

const CHAT_MESSAGE_TEXT_MAX_LENGTH = 1000;
const CHAT_MESSAGES_DEFAULT_LIMIT = 100;

let tripChatSchemaPromise = null;

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeTripStatusToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function normalizeTripParticipantRole(value) {
  const token = normalizeText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (!token) {
    return '';
  }

  if (token === 'q2' || token === 'customer' || token === 'khach' || token === 'khachhang' || token === 'passenger') {
    return 'customer';
  }

  if (token === 'q3' || token === 'driver' || token === 'taixe') {
    return 'driver';
  }

  return '';
}

function normalizeRoleCode(value) {
  const role = normalizeTripParticipantRole(value);

  if (role === 'customer') {
    return 'Q2';
  }

  if (role === 'driver') {
    return 'Q3';
  }

  return '';
}

function normalizeLimit(value, defaultLimit = CHAT_MESSAGES_DEFAULT_LIMIT) {
  const parsedLimit = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return defaultLimit;
  }

  return Math.min(parsedLimit, 200);
}

function normalizeMessageText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createValidationError(message) {
  return createHttpError(400, message);
}

function createNotFoundError(message) {
  return createHttpError(404, message);
}

function createForbiddenError(message) {
  return createHttpError(403, message);
}

function createConflictError(message) {
  return createHttpError(409, message);
}

async function getTripChatColumnNames(pool) {
  const result = await pool.request().query(`
    SELECT COLUMN_NAME AS columnName
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo'
      AND TABLE_NAME = N'TinNhan';
  `);

  return new Set((result.recordset ?? []).map((row) => String(row.columnName ?? '')));
}

function formatIsoDate(value) {
  const parsedDate = value instanceof Date ? value : new Date(value);

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString();
  }

  return parsedDate.toISOString();
}

function buildTripChatBookingSnapshot(context) {
  if (!context) {
    return null;
  }

  return {
    bookingCode: normalizeText(context.bookingCode),
    customerAccountId: normalizeText(context.customerAccountId),
    customerName: normalizeText(context.customerName),
    customerPhone: normalizeText(context.customerPhone),
    driverAccountId: normalizeText(context.driverAccountId),
    driverName: normalizeText(context.driverName),
    driverPhone: normalizeText(context.driverPhone),
    driverVehicleName: normalizeText(context.driverVehicleName),
    driverVehicleLicensePlate: normalizeText(context.driverVehicleLicensePlate),
    tripStatus: normalizeText(context.tripStatus),
  };
}

function buildTripChatMessageResponse(row) {
  if (!row) {
    return null;
  }

  return {
    messageId: String(row.messageId ?? row.MaTinNhan ?? '').trim(),
    bookingCode: normalizeText(row.bookingCode ?? row.MaChuyen),
    senderAccountId: normalizeText(row.senderAccountId ?? row.MaTK),
    senderRoleCode: normalizeTripParticipantRole(row.senderRoleCode ?? row.VaiTro),
    senderName: normalizeText(row.senderName ?? row.Ten),
    senderPhone: normalizeText(row.senderPhone ?? row.SDT),
    messageText: normalizeText(row.messageText ?? row.NoiDung),
    createdAt: formatIsoDate(row.createdAt ?? row.NgayTao),
    updatedAt: formatIsoDate(row.updatedAt ?? row.NgayCapNhat ?? row.createdAt ?? row.NgayTao),
  };
}

function buildTripChatMessageEvent(context, message) {
  const bookingSnapshot = buildTripChatBookingSnapshot(context);

  return {
    type: 'ride.trip.message.created',
    routingKey: 'ride.trip.message.created',
    bookingCode: normalizeText(message?.bookingCode ?? bookingSnapshot?.bookingCode),
    customerAccountId: normalizeText(context?.customerAccountId),
    driverAccountId: normalizeText(context?.driverAccountId),
    audience: ['customer', 'driver'],
    booking: bookingSnapshot,
    message,
    source: 'chat',
    createdAt: message?.createdAt ?? new Date().toISOString(),
  };
}

function assertTripChatAccess(context, accountId, roleCode) {
  const normalizedAccountId = normalizeText(accountId);
  const normalizedRoleCode = normalizeRoleCode(roleCode);

  if (!normalizedAccountId) {
    throw createValidationError('Vui lòng cung cấp tài khoản để sử dụng hội thoại chuyến xe.');
  }

  if (!normalizedRoleCode) {
    throw createValidationError('Vai trò tài khoản không hợp lệ.');
  }

  if (!context) {
    throw createNotFoundError('Không tìm thấy chuyến xe cần trao đổi.');
  }

  if (normalizedRoleCode === 'Q2') {
    if (!context.customerAccountId || normalizeText(context.customerAccountId).toLowerCase() !== normalizedAccountId.toLowerCase()) {
      throw createForbiddenError('Bạn không có quyền truy cập hội thoại của chuyến này.');
    }

    return 'customer';
  }

  if (normalizedRoleCode === 'Q3') {
    if (!context.driverAccountId) {
      throw createConflictError('Chuyến này chưa có tài xế nhận nên chưa thể nhắn tin.');
    }

    if (normalizeText(context.driverAccountId).toLowerCase() !== normalizedAccountId.toLowerCase()) {
      throw createForbiddenError('Bạn không có quyền truy cập hội thoại của chuyến này.');
    }

    return 'driver';
  }

  throw createValidationError('Vai trò tài khoản không hợp lệ.');
}

function canSendTripMessage(context) {
  const normalizedTripStatus = normalizeTripStatusToken(context?.tripStatus);

  if (!context?.driverAccountId) {
    return false;
  }

  return !['chotaixe', 'hoanthanh', 'dahuy', 'cancelled'].includes(normalizedTripStatus);
}

async function readTripChatContext(connection, bookingCode) {
  const queryResult = await new sql.Request(connection)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.MaTK AS customerAccountId,
        COALESCE(
          NULLIF(LTRIM(RTRIM(customerTk.Ten)), ''),
          NULLIF(LTRIM(RTRIM(dx.TenKhachHang)), ''),
          NULLIF(LTRIM(RTRIM(customerTk.TaiKhoan)), ''),
          dx.MaTK
        ) AS customerName,
        COALESCE(
          NULLIF(LTRIM(RTRIM(customerTk.SDT)), ''),
          NULLIF(LTRIM(RTRIM(dx.SDT)), ''),
          ''
        ) AS customerPhone,
        tx.MaTK AS driverAccountId,
        COALESCE(
          NULLIF(LTRIM(RTRIM(driverTk.Ten)), ''),
          NULLIF(LTRIM(RTRIM(driverTk.TaiKhoan)), ''),
          tx.MaTK
        ) AS driverName,
        COALESCE(NULLIF(LTRIM(RTRIM(driverTk.SDT)), ''), '') AS driverPhone,
        dx.TrangThaiChuyen AS tripStatus,
        JSON_VALUE(tx.ThongTinXe, '$.name') AS driverVehicleName,
        JSON_VALUE(tx.ThongTinXe, '$.licensePlate') AS driverVehicleLicensePlate
      FROM dbo.DatXe dx
      LEFT JOIN dbo.TaiKhoan customerTk ON customerTk.MaTK = dx.MaTK
      LEFT JOIN dbo.TaiXe tx ON LOWER(ISNULL(tx.CCCD, '')) = LOWER(ISNULL(dx.MaTX, ''))
      LEFT JOIN dbo.TaiKhoan driverTk ON driverTk.MaTK = tx.MaTK
      WHERE dx.MaChuyen = @bookingCode;
    `);

  const row = queryResult.recordset?.[0] ?? null;

  if (!row) {
    return null;
  }

  return {
    bookingCode: normalizeText(row.bookingCode),
    customerAccountId: normalizeText(row.customerAccountId),
    customerName: normalizeText(row.customerName),
    customerPhone: normalizeText(row.customerPhone),
    driverAccountId: normalizeText(row.driverAccountId),
    driverName: normalizeText(row.driverName),
    driverPhone: normalizeText(row.driverPhone),
    tripStatus: normalizeText(row.tripStatus),
    driverVehicleName: normalizeText(row.driverVehicleName),
    driverVehicleLicensePlate: normalizeText(row.driverVehicleLicensePlate),
  };
}

async function readTripChatMessages(connection, bookingCode, limit = CHAT_MESSAGES_DEFAULT_LIMIT) {
  const queryResult = await new sql.Request(connection)
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .input('limit', sql.Int, normalizeLimit(limit))
    .query(`
      SELECT TOP (@limit)
        mt.MaTinNhan AS messageId,
        mt.MaChuyen AS bookingCode,
        mt.MaTK AS senderAccountId,
        mt.VaiTro AS senderRoleCode,
        mt.Ten AS senderName,
        mt.SDT AS senderPhone,
        mt.NoiDung AS messageText,
        mt.NgayTao AS createdAt,
        mt.NgayCapNhat AS updatedAt
      FROM dbo.TinNhan mt
      WHERE mt.MaChuyen = @bookingCode
      ORDER BY mt.NgayTao DESC, mt.MaTinNhan DESC;
    `);

  return (queryResult.recordset ?? [])
    .map((row) => buildTripChatMessageResponse(row))
    .filter(Boolean)
    .reverse();
}

function getSenderSnapshot(context, senderRole) {
  if (senderRole === 'customer') {
    return {
      senderAccountId: normalizeText(context.customerAccountId),
      senderName: normalizeText(context.customerName) || normalizeText(context.customerAccountId),
      senderPhone: normalizeText(context.customerPhone),
    };
  }

  return {
    senderAccountId: normalizeText(context.driverAccountId),
    senderName: normalizeText(context.driverName) || normalizeText(context.driverAccountId),
    senderPhone: normalizeText(context.driverPhone),
  };
}

async function persistTripChatMessage(transaction, context, senderRole, messageText) {
  const senderSnapshot = getSenderSnapshot(context, senderRole);

  const insertResult = await new sql.Request(transaction)
    .input('bookingCode', sql.VarChar(30), context.bookingCode)
    .input('senderAccountId', sql.VarChar(20), senderSnapshot.senderAccountId || null)
    .input('senderRoleCode', sql.VarChar(20), senderRole)
    .input('senderName', sql.NVarChar(200), senderSnapshot.senderName)
    .input('senderPhone', sql.VarChar(30), senderSnapshot.senderPhone || null)
    .input('messageText', sql.NVarChar(1000), messageText)
    .query(`
      INSERT INTO dbo.TinNhan
      (
        MaChuyen,
        MaTK,
        VaiTro,
        Ten,
        SDT,
        NoiDung
      )
      OUTPUT
        INSERTED.MaTinNhan AS messageId,
        INSERTED.MaChuyen AS bookingCode,
        INSERTED.MaTK AS senderAccountId,
        INSERTED.VaiTro AS senderRoleCode,
        INSERTED.Ten AS senderName,
        INSERTED.SDT AS senderPhone,
        INSERTED.NoiDung AS messageText,
        INSERTED.NgayTao AS createdAt,
        INSERTED.NgayCapNhat AS updatedAt
      VALUES
      (
        @bookingCode,
        @senderAccountId,
        @senderRoleCode,
        @senderName,
        @senderPhone,
        @messageText
      );
    `);

  const message = buildTripChatMessageResponse(insertResult.recordset?.[0] ?? null);

  if (!message) {
    throw createValidationError('Không thể lưu tin nhắn vào hệ thống.');
  }

  return message;
}

async function ensureTripChatSchema() {
  if (!isSqlServerConfigured()) {
    throw createValidationError('Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.');
  }

  if (!tripChatSchemaPromise) {
    tripChatSchemaPromise = (async () => {
      await ensureRideSchema();

      const pool = await getSqlServerPool();
      const columnNames = await getTripChatColumnNames(pool);

      if (columnNames.size === 0) {
        await pool.request().query(`
          CREATE TABLE dbo.TinNhan
          (
            MaTinNhan                BIGINT         IDENTITY(1,1) NOT NULL,
            MaChuyen                 VARCHAR(30)    NOT NULL,
            MaTK                     VARCHAR(20)    NULL,
            VaiTro                   VARCHAR(20)    NOT NULL,
            Ten                      NVARCHAR(200)  NOT NULL,
            SDT                      VARCHAR(30)    NULL,
            NoiDung                  NVARCHAR(1000) NOT NULL,
            NgayTao                  DATETIME2(0)   NOT NULL CONSTRAINT DF_TinNhan_NgayTao DEFAULT SYSDATETIME(),
            NgayCapNhat              DATETIME2(0)   NOT NULL CONSTRAINT DF_TinNhan_NgayCapNhat DEFAULT SYSDATETIME(),

            CONSTRAINT PK_TinNhan PRIMARY KEY (MaTinNhan),
            CONSTRAINT FK_TinNhan_DatXe FOREIGN KEY (MaChuyen)
              REFERENCES dbo.DatXe(MaChuyen)
              ON UPDATE CASCADE
              ON DELETE CASCADE,
            CONSTRAINT FK_TinNhan_TaiKhoan FOREIGN KEY (MaTK)
              REFERENCES dbo.TaiKhoan(MaTK)
              ON UPDATE NO ACTION
              ON DELETE NO ACTION,
            CONSTRAINT CK_TinNhan_VaiTro CHECK (VaiTro IN ('customer', 'driver'))
          );
        `);

        await pool.request().query(`
          CREATE INDEX IX_TinNhan_MaChuyen_NgayTao
            ON dbo.TinNhan (MaChuyen, NgayTao DESC, MaTinNhan DESC);
        `);

        return;
      }

      const hasLegacyColumns = columnNames.has('MaTN') || columnNames.has('MaTKNguoiGui');
      const missingRequiredColumns = ['MaTinNhan', 'MaTK', 'VaiTro', 'Ten', 'SDT', 'NgayCapNhat']
        .some((columnName) => !columnNames.has(columnName));

      if (hasLegacyColumns || missingRequiredColumns) {
        await pool.request().query(`
          IF EXISTS (
            SELECT 1
            FROM sys.foreign_keys
            WHERE name = N'FK_TinNhan_TaiKhoan'
              AND parent_object_id = OBJECT_ID(N'dbo.TinNhan')
          )
          BEGIN
            ALTER TABLE dbo.TinNhan DROP CONSTRAINT FK_TinNhan_TaiKhoan;
          END
        `);

        await pool.request().query(`
          IF EXISTS (
            SELECT 1
            FROM sys.foreign_keys
            WHERE name = N'FK_TinNhan_DatXe'
              AND parent_object_id = OBJECT_ID(N'dbo.TinNhan')
          )
          BEGIN
            ALTER TABLE dbo.TinNhan DROP CONSTRAINT FK_TinNhan_DatXe;
          END
        `);

        if (columnNames.has('MaTN') && !columnNames.has('MaTinNhan')) {
          await pool.request().query(`
            EXEC sys.sp_rename N'dbo.TinNhan.MaTN', N'MaTinNhan', N'COLUMN';
          `);
          columnNames.delete('MaTN');
          columnNames.add('MaTinNhan');
        }

        if (columnNames.has('MaTKNguoiGui') && !columnNames.has('MaTK')) {
          await pool.request().query(`
            EXEC sys.sp_rename N'dbo.TinNhan.MaTKNguoiGui', N'MaTK', N'COLUMN';
          `);
          columnNames.delete('MaTKNguoiGui');
          columnNames.add('MaTK');
        }

        if (!columnNames.has('VaiTro')) {
          await pool.request().query(`
            ALTER TABLE dbo.TinNhan
            ADD VaiTro VARCHAR(20) NOT NULL CONSTRAINT DF_TinNhan_VaiTro DEFAULT 'customer';
          `);
          columnNames.add('VaiTro');
        }

        if (!columnNames.has('Ten')) {
          await pool.request().query(`
            ALTER TABLE dbo.TinNhan
            ADD Ten NVARCHAR(200) NOT NULL CONSTRAINT DF_TinNhan_Ten DEFAULT N'Người dùng';
          `);
          columnNames.add('Ten');
        }

        if (!columnNames.has('SDT')) {
          await pool.request().query(`
            ALTER TABLE dbo.TinNhan
            ADD SDT VARCHAR(30) NULL;
          `);
          columnNames.add('SDT');
        }

        if (!columnNames.has('NgayCapNhat')) {
          await pool.request().query(`
            ALTER TABLE dbo.TinNhan
            ADD NgayCapNhat DATETIME2(0) NOT NULL CONSTRAINT DF_TinNhan_NgayCapNhat DEFAULT SYSDATETIME();
          `);
          columnNames.add('NgayCapNhat');
        }

        if (columnNames.has('MaTK')) {
          await pool.request().query(`
            ALTER TABLE dbo.TinNhan
            ALTER COLUMN MaTK VARCHAR(20) NULL;
          `);
        }

        await pool.request().query(`
          UPDATE mt
          SET
            mt.VaiTro = CASE
              WHEN LOWER(ISNULL(tk.MaQuyen, '')) = 'q3' THEN 'driver'
              ELSE 'customer'
            END,
            mt.Ten = COALESCE(
              NULLIF(LTRIM(RTRIM(tk.Ten)), ''),
              NULLIF(LTRIM(RTRIM(tk.TaiKhoan)), ''),
              NULLIF(LTRIM(RTRIM(mt.Ten)), ''),
              N'Người dùng'
            ),
            mt.SDT = COALESCE(
              NULLIF(LTRIM(RTRIM(tk.SDT)), ''),
              NULLIF(LTRIM(RTRIM(mt.SDT)), '')
            ),
            mt.NgayCapNhat = COALESCE(mt.NgayCapNhat, mt.NgayTao, SYSDATETIME())
          FROM dbo.TinNhan mt
          LEFT JOIN dbo.TaiKhoan tk ON tk.MaTK = mt.MaTK
          WHERE
            NULLIF(LTRIM(RTRIM(mt.Ten)), '') IS NULL
            OR NULLIF(LTRIM(RTRIM(mt.SDT)), '') IS NULL
            OR mt.NgayCapNhat IS NULL
            OR NULLIF(LTRIM(RTRIM(mt.VaiTro)), '') IS NULL;
        `);
      }

      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.foreign_keys
          WHERE name = N'FK_TinNhan_DatXe'
            AND parent_object_id = OBJECT_ID(N'dbo.TinNhan')
        )
        BEGIN
          ALTER TABLE dbo.TinNhan
          ADD CONSTRAINT FK_TinNhan_DatXe FOREIGN KEY (MaChuyen)
            REFERENCES dbo.DatXe(MaChuyen)
            ON UPDATE CASCADE
            ON DELETE CASCADE;
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.foreign_keys
          WHERE name = N'FK_TinNhan_TaiKhoan'
            AND parent_object_id = OBJECT_ID(N'dbo.TinNhan')
        )
        BEGIN
          ALTER TABLE dbo.TinNhan
          ADD CONSTRAINT FK_TinNhan_TaiKhoan FOREIGN KEY (MaTK)
            REFERENCES dbo.TaiKhoan(MaTK)
            ON UPDATE NO ACTION
            ON DELETE NO ACTION;
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.check_constraints
          WHERE name = N'CK_TinNhan_VaiTro'
            AND parent_object_id = OBJECT_ID(N'dbo.TinNhan')
        )
        BEGIN
          ALTER TABLE dbo.TinNhan
          ADD CONSTRAINT CK_TinNhan_VaiTro CHECK (VaiTro IN ('customer', 'driver'));
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE name = N'IX_TinNhan_MaChuyen_NgayTao'
            AND object_id = OBJECT_ID(N'dbo.TinNhan')
        )
        BEGIN
          CREATE INDEX IX_TinNhan_MaChuyen_NgayTao
            ON dbo.TinNhan (MaChuyen, NgayTao DESC, MaTinNhan DESC);
        END
      `);
    })().catch((error) => {
      tripChatSchemaPromise = null;
      throw error;
    });
  }

  return tripChatSchemaPromise;
}

async function loadTripChatContextForAccess(transactionOrPool, bookingCode, accountId, roleCode) {
  const context = await readTripChatContext(transactionOrPool, bookingCode);

  if (!context) {
    throw createNotFoundError('Không tìm thấy chuyến xe cần trao đổi.');
  }

  const senderRole = assertTripChatAccess(context, accountId, roleCode);

  if (!canSendTripMessage(context)) {
    throw createValidationError('Chuyến này chưa sẵn sàng để nhắn tin.');
  }

  return {
    context,
    senderRole,
  };
}

export async function getTripMessages(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode ?? payload?.tripCode ?? payload?.id);
  const accountId = normalizeText(payload?.accountId ?? payload?.senderAccountId);
  const roleCode = normalizeRoleCode(payload?.roleCode ?? payload?.role ?? payload?.userRole);
  const limit = normalizeLimit(payload?.limit);

  if (!bookingCode) {
    throw createValidationError('Vui lòng cung cấp mã chuyến để tải hội thoại.');
  }

  await ensureTripChatSchema();

  const pool = await getSqlServerPool();
  const context = await readTripChatContext(pool, bookingCode);

  if (!context) {
    throw createNotFoundError('Không tìm thấy chuyến xe cần trao đổi.');
  }

  assertTripChatAccess(context, accountId, roleCode);

  const messages = await readTripChatMessages(pool, bookingCode, limit);

  return {
    success: true,
    bookingCode,
    messages,
    booking: buildTripChatBookingSnapshot(context),
  };
}

export async function sendTripMessage(payload = {}) {
  const bookingCode = normalizeText(payload?.bookingCode ?? payload?.tripCode ?? payload?.id);
  const accountId = normalizeText(payload?.accountId ?? payload?.senderAccountId);
  const roleCode = normalizeRoleCode(payload?.roleCode ?? payload?.role ?? payload?.userRole);
  const messageText = normalizeMessageText(payload?.message ?? payload?.messageText ?? payload?.content);

  if (!bookingCode) {
    throw createValidationError('Vui lòng cung cấp mã chuyến để gửi tin nhắn.');
  }

  if (!messageText) {
    throw createValidationError('Vui lòng nhập nội dung tin nhắn.');
  }

  if (messageText.length > CHAT_MESSAGE_TEXT_MAX_LENGTH) {
    throw createValidationError('Nội dung tin nhắn quá dài.');
  }

  await ensureTripChatSchema();

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const { context, senderRole } = await loadTripChatContextForAccess(transaction, bookingCode, accountId, roleCode);
    const message = await persistTripChatMessage(transaction, context, senderRole, messageText);

    await transaction.commit();

    const bookingSnapshot = buildTripChatBookingSnapshot(context);

    void publishRideEvent({
      ...buildTripChatMessageEvent(context, message),
      booking: bookingSnapshot,
    }).catch((error) => {
      console.warn('[realtime] Không thể đồng bộ sự kiện chat chuyến xe:', error);
    });

    return {
      success: true,
      bookingCode,
      message,
      booking: bookingSnapshot,
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Ignore rollback failures.
    }

    throw error;
  }
}
