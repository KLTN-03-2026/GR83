import sql from 'mssql';
import { getSqlServerPool } from './database.service.js';

const customerWalletTransactionTypes = new Set(['topup', 'transfer', 'receive', 'adjustment']);
const phoneNumberPattern = /^\d{8,15}$/;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNullableText(value) {
  const normalizedValue = normalizeText(value);
  return normalizedValue || null;
}

function normalizeCurrencyAmount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue);
}

function normalizeWalletTransactionType(value, fallbackValue = 'adjustment') {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (customerWalletTransactionTypes.has(normalizedValue)) {
    return normalizedValue;
  }
  return fallbackValue;
}

function mapWalletTransactionRow(row = {}) {
  const amount = normalizeCurrencyAmount(row.SoTien);
  return {
    id: Number(row.MaGD ?? 0) || 0,
    customerId: normalizeText(row.MaTK),
    type: normalizeWalletTransactionType(row.LoaiGiaoDich),
    amount,
    amountFormatted: `${amount >= 0 ? '+' : '-'}${new Intl.NumberFormat('vi-VN').format(Math.abs(amount))} đ`,
    balanceBefore: normalizeCurrencyAmount(row.SoDuTruoc),
    balanceAfter: normalizeCurrencyAmount(row.SoDuSau),
    description: normalizeText(row.MoTa),
    recipientPhone: normalizeText(row.SoDTNguoiNhan),
    senderPhone: normalizeText(row.SoDTNguoiGui),
    referenceCode: normalizeText(row.MaThamChieu),
    status: normalizeText(row.TrangThai).toLowerCase() || 'completed',
    createdAt: row.NgayTao ?? null,
  };
}

async function getCustomerRowOrThrow(customerId) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  const queryResult = await (await getSqlServerPool())
    .request()
    .input('customerId', sql.VarChar(20), normalizedCustomerId)
    .query(`
      SELECT TOP 1 MaTK, Ten, SDT, Email, MaQuyen
      FROM dbo.TaiKhoan
      WHERE MaTK = @customerId AND MaQuyen = 'Q2';
    `);

  const customerRow = queryResult.recordset?.[0] ?? null;

  if (!customerRow) {
    throw createHttpError(404, 'Không tìm thấy tài khoản khách hàng.');
  }

  return customerRow;
}

async function ensureCustomerWalletRow(customerId, transaction = null) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  const request = transaction
    ? new sql.Request(transaction)
    : (await getSqlServerPool()).request();

  const queryResult = await request
    .input('customerId', sql.VarChar(20), normalizedCustomerId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @customerId)
      BEGIN
        INSERT INTO dbo.Vi (MaTK, SoDu)
        VALUES (@customerId, 0);
      END

      SELECT TOP 1 MaVi, MaTK, SoDu, NgayTao, NgayCapNhat
      FROM dbo.Vi
      WHERE MaTK = @customerId;
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function appendCustomerWalletTransaction(transaction, payload = {}) {
  const normalizedCustomerId = normalizeText(payload.customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Thiếu mã khách hàng để ghi nhận giao dịch ví.');
  }

  const normalizedAmount = normalizeCurrencyAmount(payload.amount);

  if (!normalizedAmount) {
    throw createHttpError(400, 'Số tiền giao dịch phải khác 0.');
  }

  const transactionType = normalizeWalletTransactionType(payload.type);

  const insertedResult = await new sql.Request(transaction)
    .input('customerId', sql.VarChar(20), normalizedCustomerId)
    .input('type', sql.VarChar(20), transactionType)
    .input('amount', sql.Int, normalizedAmount)
    .input('description', sql.NVarChar(255), normalizeNullableText(payload.description))
    .input('recipientPhone', sql.VarChar(20), normalizeNullableText(payload.recipientPhone))
    .input('senderPhone', sql.VarChar(20), normalizeNullableText(payload.senderPhone))
    .input('referenceCode', sql.VarChar(40), normalizeNullableText(payload.referenceCode))
    .input('status', sql.VarChar(20), normalizeText(payload.status).toLowerCase() || 'completed')
    .query(`
      DECLARE @walletBefore INT;
      DECLARE @walletAfter INT;

      SELECT @walletBefore = SoDu
      FROM dbo.Vi
      WHERE MaTK = @customerId;

      UPDATE dbo.Vi
      SET SoDu = SoDu + @amount,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @customerId;

      SELECT @walletAfter = SoDu
      FROM dbo.Vi
      WHERE MaTK = @customerId;

      INSERT INTO dbo.GiaoDichVi
      (
        MaTK,
        LoaiGiaoDich,
        SoTien,
        SoDuTruoc,
        SoDuSau,
        MoTa,
        SoDTNguoiNhan,
        SoDTNguoiGui,
        MaThamChieu,
        TrangThai
      )
      OUTPUT INSERTED.*
      VALUES
      (
        @customerId,
        @type,
        @amount,
        @walletBefore,
        @walletAfter,
        @description,
        @recipientPhone,
        @senderPhone,
        @referenceCode,
        @status
      );
    `);

  return insertedResult.recordset?.[0] ?? null;
}

function parseWalletTopupPayload(payload = {}) {
  const amount = normalizeCurrencyAmount(payload.amount ?? payload.soTien);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(400, 'Số tiền nạp phải lớn hơn 0.');
  }

  const method = normalizeText(payload.method ?? payload.phuongThuc).toLowerCase() || 'momo';
  const referenceCode = normalizeText(payload.referenceCode ?? payload.maThamChieu);

  return {
    amount,
    method,
    referenceCode,
    description: normalizeText(payload.description ?? payload.noiDung) || `Nạp tiền vào ví qua ${method.toUpperCase()}`,
  };
}

function parseWalletTransferPayload(payload = {}) {
  const recipientPhone = normalizeText(payload.recipientPhone ?? payload.soDienThoaiNguoiNhan ?? payload.phone);
  const amount = normalizeCurrencyAmount(payload.amount ?? payload.soTien);
  const description = normalizeText(payload.description ?? payload.noiDung) || 'Chuyển tiền ví khách hàng';

  if (!recipientPhone || !phoneNumberPattern.test(recipientPhone)) {
    throw createHttpError(400, 'Số điện thoại người nhận không hợp lệ (8-15 chữ số).');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(400, 'Số tiền chuyển phải lớn hơn 0.');
  }

  return {
    recipientPhone,
    amount,
    description,
  };
}

export async function ensureCustomerWalletSchema() {
  const pool = await getSqlServerPool();

  await pool.request().query(`
    IF OBJECT_ID(N'dbo.Vi', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Vi
      (
        MaVi         INT           IDENTITY(1,1) NOT NULL,
        MaTK         VARCHAR(20)   NOT NULL,
        SoDu         INT           NOT NULL CONSTRAINT DF_Vi_SoDu DEFAULT 0,
        NgayTao      DATETIME2(0)  NOT NULL CONSTRAINT DF_Vi_NgayTao DEFAULT SYSDATETIME(),
        NgayCapNhat  DATETIME2(0)  NOT NULL CONSTRAINT DF_Vi_NgayCapNhat DEFAULT SYSDATETIME(),
        CONSTRAINT PK_Vi PRIMARY KEY (MaVi),
        CONSTRAINT UQ_Vi_MaTK UNIQUE (MaTK),
        CONSTRAINT FK_Vi_TaiKhoan FOREIGN KEY (MaTK)
          REFERENCES dbo.TaiKhoan(MaTK)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT CK_Vi_SoDu CHECK (SoDu >= 0)
      );
    END;

    IF OBJECT_ID(N'dbo.GiaoDichVi', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.GiaoDichVi
      (
        MaGD            INT            IDENTITY(1,1) NOT NULL,
        MaTK            VARCHAR(20)    NOT NULL,
        LoaiGiaoDich    VARCHAR(20)    NOT NULL,
        SoTien          INT            NOT NULL,
        SoDuTruoc       INT            NOT NULL,
        SoDuSau         INT            NOT NULL,
        MoTa            NVARCHAR(255)  NULL,
        SoDTNguoiNhan   VARCHAR(20)    NULL,
        SoDTNguoiGui    VARCHAR(20)    NULL,
        MaThamChieu     VARCHAR(40)    NULL,
        TrangThai       VARCHAR(20)    NOT NULL CONSTRAINT DF_GiaoDichVi_TrangThai DEFAULT 'completed',
        NgayTao         DATETIME2(0)   NOT NULL CONSTRAINT DF_GiaoDichVi_NgayTao DEFAULT SYSDATETIME(),
        CONSTRAINT PK_GiaoDichVi PRIMARY KEY (MaGD),
        CONSTRAINT FK_GiaoDichVi_TaiKhoan FOREIGN KEY (MaTK)
          REFERENCES dbo.TaiKhoan(MaTK)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT CK_GiaoDichVi_Loai CHECK (LoaiGiaoDich IN ('topup', 'transfer', 'receive', 'adjustment')),
        CONSTRAINT CK_GiaoDichVi_TrangThai CHECK (TrangThai IN ('completed', 'pending', 'failed')),
        CONSTRAINT CK_GiaoDichVi_SoTien CHECK (SoTien <> 0),
        CONSTRAINT CK_GiaoDichVi_SoDuTruoc CHECK (SoDuTruoc >= 0),
        CONSTRAINT CK_GiaoDichVi_SoDuSau CHECK (SoDuSau >= 0)
      );
    END;

    INSERT INTO dbo.Vi (MaTK, SoDu)
    SELECT tk.MaTK, 0
    FROM dbo.TaiKhoan AS tk
    WHERE tk.MaQuyen = 'Q2'
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.Vi AS kv
        WHERE kv.MaTK = tk.MaTK
      );

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = N'IX_GiaoDichVi_MaTK_NgayTao'
        AND object_id = OBJECT_ID(N'dbo.GiaoDichVi')
    )
    BEGIN
      CREATE INDEX IX_GiaoDichVi_MaTK_NgayTao
      ON dbo.GiaoDichVi (MaTK, NgayTao DESC, MaGD DESC);
    END;

    IF OBJECT_ID(N'dbo.TR_Vi_SetNgayCapNhat', N'TR') IS NULL
    BEGIN
      EXEC('CREATE TRIGGER dbo.TR_Vi_SetNgayCapNhat
      ON dbo.Vi
      AFTER UPDATE
      AS
      BEGIN
        SET NOCOUNT ON;
        UPDATE target
        SET target.NgayCapNhat = SYSDATETIME()
        FROM dbo.Vi AS target
        INNER JOIN inserted AS i ON i.MaVi = target.MaVi;
      END');
    END;
  `);
}

export async function getCustomerWallet(customerId) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  const customerRow = await getCustomerRowOrThrow(normalizedCustomerId);
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const walletRow = await ensureCustomerWalletRow(normalizedCustomerId, transaction);

    const transactionsResult = await new sql.Request(transaction)
      .input('customerId', sql.VarChar(20), normalizedCustomerId)
      .query(`
        SELECT TOP 30 *
        FROM dbo.GiaoDichVi
        WHERE MaTK = @customerId
        ORDER BY NgayTao DESC, MaGD DESC;
      `);

    await transaction.commit();

    return {
      success: true,
      message: 'Lấy thông tin ví khách hàng thành công.',
      wallet: {
        id: Number(walletRow?.MaVi ?? 0) || 0,
        customerId: normalizedCustomerId,
        balance: normalizeCurrencyAmount(walletRow?.SoDu),
        balanceFormatted: `${new Intl.NumberFormat('vi-VN').format(normalizeCurrencyAmount(walletRow?.SoDu))} đ`,
        updatedAt: walletRow?.NgayCapNhat ?? null,
      },
      customer: {
        id: normalizeText(customerRow.MaTK),
        name: normalizeText(customerRow.Ten),
        phone: normalizeText(customerRow.SDT),
        email: normalizeText(customerRow.Email),
      },
      transactions: (transactionsResult.recordset ?? []).map(mapWalletTransactionRow),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listCustomerWalletTransactions(customerId, filters = {}) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  await getCustomerRowOrThrow(normalizedCustomerId);

  const request = (await getSqlServerPool())
    .request()
    .input('customerId', sql.VarChar(20), normalizedCustomerId);

  const whereConditions = ['MaTK = @customerId'];

  const typeFilter = normalizeText(filters.type).toLowerCase();
  if (customerWalletTransactionTypes.has(typeFilter)) {
    whereConditions.push('LoaiGiaoDich = @typeFilter');
    request.input('typeFilter', sql.VarChar(20), typeFilter);
  }

  const queryResult = await request.query(`
    SELECT TOP 100 *
    FROM dbo.GiaoDichVi
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY NgayTao DESC, MaGD DESC;
  `);

  return {
    success: true,
    message: 'Lấy lịch sử giao dịch ví thành công.',
    transactions: (queryResult.recordset ?? []).map(mapWalletTransactionRow),
  };
}

export async function topupCustomerWallet(customerId, payload = {}) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  const parsedPayload = parseWalletTopupPayload(payload);
  await getCustomerRowOrThrow(normalizedCustomerId);

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await ensureCustomerWalletRow(normalizedCustomerId, transaction);

    await appendCustomerWalletTransaction(transaction, {
      customerId: normalizedCustomerId,
      type: 'topup',
      amount: parsedPayload.amount,
      description: parsedPayload.description,
      referenceCode: parsedPayload.referenceCode || `${parsedPayload.method.toUpperCase()}-${Date.now()}`,
    });

    const walletRow = await ensureCustomerWalletRow(normalizedCustomerId, transaction);

    await transaction.commit();

    return {
      success: true,
      message: 'Nạp tiền vào ví thành công.',
      wallet: {
        id: Number(walletRow?.MaVi ?? 0) || 0,
        customerId: normalizedCustomerId,
        balance: normalizeCurrencyAmount(walletRow?.SoDu),
        balanceFormatted: `${new Intl.NumberFormat('vi-VN').format(normalizeCurrencyAmount(walletRow?.SoDu))} đ`,
        updatedAt: walletRow?.NgayCapNhat ?? null,
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function transferCustomerWallet(customerId, payload = {}) {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  const parsedPayload = parseWalletTransferPayload(payload);
  const senderCustomer = await getCustomerRowOrThrow(normalizedCustomerId);

  const recipientResult = await (await getSqlServerPool())
    .request()
    .input('recipientPhone', sql.VarChar(15), parsedPayload.recipientPhone)
    .query(`
      SELECT TOP 1 MaTK, SDT, Ten
      FROM dbo.TaiKhoan
      WHERE SDT = @recipientPhone;
    `);

  const recipientRow = recipientResult.recordset?.[0] ?? null;

  if (!recipientRow?.MaTK) {
    throw createHttpError(404, 'Không tìm thấy tài khoản người nhận theo số điện thoại đã nhập.');
  }

  if (normalizeText(recipientRow.MaTK) === normalizedCustomerId) {
    throw createHttpError(400, 'Không thể chuyển tiền cho chính tài khoản của bạn.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const senderWalletRow = await ensureCustomerWalletRow(normalizedCustomerId, transaction);
    await ensureCustomerWalletRow(recipientRow.MaTK, transaction);

    const currentBalance = normalizeCurrencyAmount(senderWalletRow?.SoDu);

    if (parsedPayload.amount > currentBalance) {
      throw createHttpError(400, 'Số dư không đủ để thực hiện giao dịch chuyển tiền.');
    }

    const transferReferenceCode = `TRF-${Date.now()}`;

    const debitTransaction = await appendCustomerWalletTransaction(transaction, {
      customerId: normalizedCustomerId,
      type: 'transfer',
      amount: -Math.abs(parsedPayload.amount),
      description: parsedPayload.description,
      recipientPhone: parsedPayload.recipientPhone,
      senderPhone: normalizeText(senderCustomer.SDT),
      referenceCode: transferReferenceCode,
    });

    await appendCustomerWalletTransaction(transaction, {
      customerId: recipientRow.MaTK,
      type: 'receive',
      amount: Math.abs(parsedPayload.amount),
      description: `Nhận tiền từ ${normalizeText(senderCustomer.Ten) || normalizeText(senderCustomer.SDT) || normalizedCustomerId}`,
      recipientPhone: parsedPayload.recipientPhone,
      senderPhone: normalizeText(senderCustomer.SDT),
      referenceCode: transferReferenceCode,
    });

    const latestWalletRow = await ensureCustomerWalletRow(normalizedCustomerId, transaction);

    await transaction.commit();

    return {
      success: true,
      message: 'Chuyển tiền thành công.',
      wallet: {
        id: Number(latestWalletRow?.MaVi ?? 0) || 0,
        customerId: normalizedCustomerId,
        balance: normalizeCurrencyAmount(latestWalletRow?.SoDu),
        balanceFormatted: `${new Intl.NumberFormat('vi-VN').format(normalizeCurrencyAmount(latestWalletRow?.SoDu))} đ`,
        updatedAt: latestWalletRow?.NgayCapNhat ?? null,
      },
      transaction: mapWalletTransactionRow(debitTransaction),
      recipient: {
        accountId: normalizeText(recipientRow.MaTK),
        phone: normalizeText(recipientRow.SDT),
        name: normalizeText(recipientRow.Ten),
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Deduct customer wallet for a ride payment (called at booking time).
 * Throws if insufficient balance. Must be called within an existing SQL transaction.
 */
export async function deductCustomerWalletForRide(customerId, amount, bookingCode, transaction = null) {
  const normalizedCustomerId = normalizeText(customerId);
  const normalizedAmount = normalizeCurrencyAmount(amount);
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedCustomerId) {
    throw createHttpError(400, 'Mã khách hàng không hợp lệ.');
  }

  if (!normalizedAmount || normalizedAmount <= 0) {
    throw createHttpError(400, 'Số tiền thanh toán phải lớn hơn 0.');
  }

  const pool = await getSqlServerPool();
  let ownTransaction = null;

  if (!transaction) {
    ownTransaction = new sql.Transaction(pool);
    await ownTransaction.begin();
  }

  const activeTransaction = transaction ?? ownTransaction;

  try {
    const walletRow = await ensureCustomerWalletRow(normalizedCustomerId, activeTransaction);
    const currentBalance = normalizeCurrencyAmount(walletRow?.SoDu);

    if (normalizedAmount > currentBalance) {
      throw createHttpError(400, `Số dư ví không đủ. Số dư hiện tại: ${new Intl.NumberFormat('vi-VN').format(currentBalance)} đ, cần thanh toán: ${new Intl.NumberFormat('vi-VN').format(normalizedAmount)} đ.`);
    }

    await appendCustomerWalletTransaction(activeTransaction, {
      customerId: normalizedCustomerId,
      type: 'adjustment',
      amount: -normalizedAmount,
      description: `Thanh toán chuyến đi${normalizedBookingCode ? ` #${normalizedBookingCode}` : ''}`,
      referenceCode: normalizedBookingCode || null,
    });

    if (ownTransaction) {
      await ownTransaction.commit();
    }
  } catch (error) {
    if (ownTransaction) {
      await ownTransaction.rollback();
    }
    throw error;
  }
}

/**
 * Refund customer wallet when an admin cancels a wallet-paid booking.
 * Can be called within an existing SQL transaction or standalone.
 */
export async function refundCustomerWalletForRide(customerId, amount, bookingCode, transaction = null) {
  const normalizedCustomerId = normalizeText(customerId);
  const normalizedAmount = normalizeCurrencyAmount(amount);
  const normalizedBookingCode = normalizeText(bookingCode);

  if (!normalizedCustomerId || !normalizedAmount || normalizedAmount <= 0) {
    return;
  }

  const pool = await getSqlServerPool();
  let ownTransaction = null;

  if (!transaction) {
    ownTransaction = new sql.Transaction(pool);
    await ownTransaction.begin();
  }

  const activeTransaction = transaction ?? ownTransaction;

  try {
    await ensureCustomerWalletRow(normalizedCustomerId, activeTransaction);

    await appendCustomerWalletTransaction(activeTransaction, {
      customerId: normalizedCustomerId,
      type: 'adjustment',
      amount: normalizedAmount,
      description: `Hoàn tiền chuyến đi bị hủy${normalizedBookingCode ? ` #${normalizedBookingCode}` : ''}`,
      referenceCode: normalizedBookingCode || null,
    });

    if (ownTransaction) {
      await ownTransaction.commit();
    }
  } catch (error) {
    if (ownTransaction) {
      await ownTransaction.rollback();
    }
    throw error;
  }
}
