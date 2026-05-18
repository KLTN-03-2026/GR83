// Chuyển tiền giữa các ví người dùng (theo số điện thoại)
export async function transferWalletBalance({ senderId, phone, amount, note }) {
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Lấy thông tin người nhận theo số điện thoại
    const receiverRes = await new sql.Request(transaction)
      .input('phone', sql.VarChar(20), String(phone).trim())
      .query(`SELECT MaTK FROM dbo.TaiKhoan WHERE SDT = @phone AND TrangThai = N'HoatDong'`);
    const receiverId = receiverRes.recordset?.[0]?.MaTK;
    if (!receiverId) {
      throw new Error('Không tìm thấy tài khoản nhận hoặc tài khoản bị khóa.');
    }
    if (receiverId === senderId) {
      throw new Error('Không thể chuyển tiền cho chính mình.');
    }
    const transferAmount = Number(amount);
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      throw new Error('Số tiền chuyển không hợp lệ.');
    }
    // Kiểm tra số dư ví người gửi
    const senderWalletRes = await new sql.Request(transaction)
      .input('senderId', sql.VarChar(20), senderId)
      .query(`SELECT SoDu FROM dbo.Vi WHERE MaTK = @senderId`);
    const senderBalance = senderWalletRes.recordset?.[0]?.SoDu ?? 0;
    if (senderBalance < transferAmount) {
      throw new Error('Số dư ví không đủ để chuyển tiền.');
    }
    // Nội dung chuyển tiền
    const safeNote = (typeof note === 'string' && note.trim()) ? note.trim() : 'Chuyển tiền từ Website SmartRide';
    // Trừ tiền người gửi
    await new sql.Request(transaction)
      .input('senderId', sql.VarChar(20), senderId)
      .input('amount', sql.Int, transferAmount)
      .query(`UPDATE dbo.Vi SET SoDu = SoDu - @amount WHERE MaTK = @senderId`);
    // Cộng tiền người nhận
    await new sql.Request(transaction)
      .input('receiverId', sql.VarChar(20), receiverId)
      .input('amount', sql.Int, transferAmount)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @receiverId)
                INSERT INTO dbo.Vi (MaTK, SoDu) VALUES (@receiverId, 0);
              UPDATE dbo.Vi SET SoDu = SoDu + @amount WHERE MaTK = @receiverId`);
    // Ghi lịch sử giao dịch cho cả hai bên
    // Lấy số dư sau khi chuyển
    const senderAfter = senderBalance - transferAmount;
    const receiverWalletRes = await new sql.Request(transaction)
      .input('receiverId', sql.VarChar(20), receiverId)
      .query(`SELECT SoDu FROM dbo.Vi WHERE MaTK = @receiverId`);
    const receiverAfter = receiverWalletRes.recordset?.[0]?.SoDu ?? 0;
    // Giao dịch người gửi
    await new sql.Request(transaction)
      .input('MaTK', sql.VarChar(20), senderId)
      .input('LoaiGiaoDich', sql.VarChar(20), 'transfer_out')
      .input('SoTien', sql.Int, transferAmount)
      .input('SoDuTruoc', sql.Int, senderBalance)
      .input('SoDuSau', sql.Int, senderAfter)
      .input('MoTa', sql.NVarChar(255), `Chuyển tiền cho ${phone}: ${safeNote}`)
      .input('MaThamChieu', sql.VarChar(40), receiverId)
      .input('TrangThai', sql.VarChar(20), 'completed')
      .query(`INSERT INTO dbo.GiaoDichVi (MaTK, LoaiGiaoDich, SoTien, SoDuTruoc, SoDuSau, MoTa, MaThamChieu, TrangThai)
              VALUES (@MaTK, @LoaiGiaoDich, @SoTien, @SoDuTruoc, @SoDuSau, @MoTa, @MaThamChieu, @TrangThai)`);
    // Giao dịch người nhận
    await new sql.Request(transaction)
      .input('MaTK', sql.VarChar(20), receiverId)
      .input('LoaiGiaoDich', sql.VarChar(20), 'transfer_in')
      .input('SoTien', sql.Int, transferAmount)
      .input('SoDuTruoc', sql.Int, receiverAfter - transferAmount)
      .input('SoDuSau', sql.Int, receiverAfter)
      .input('MoTa', sql.NVarChar(255), `Nhận tiền từ ${senderId}: ${safeNote}`)
      .input('MaThamChieu', sql.VarChar(40), senderId)
      .input('TrangThai', sql.VarChar(20), 'completed')
      .query(`INSERT INTO dbo.GiaoDichVi (MaTK, LoaiGiaoDich, SoTien, SoDuTruoc, SoDuSau, MoTa, MaThamChieu, TrangThai)
              VALUES (@MaTK, @LoaiGiaoDich, @SoTien, @SoDuTruoc, @SoDuSau, @MoTa, @MaThamChieu, @TrangThai)`);
    await transaction.commit();
    return { success: true, message: 'Chuyển tiền thành công', balance: senderAfter };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
import { createHmac } from 'node:crypto';
import sql from 'mssql';
import { env } from '../config/env.js';
import { getSqlServerPool } from './database.service.js';
import { topupCustomerWallet } from './customer.wallet.service.js';
import { topupDriverWallet } from './driver.service.js';

const MOMO_SUCCESS_RESULT_CODE = 0;
const MOMO_TIMEOUT_MS = 12000;
const ZALOPAY_TIMEOUT_MS = 12000;
const topupRequests = new Map();

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isMoMoConfigured() {
  return Boolean(normalizeText(env.momoPartnerCode) && normalizeText(env.momoAccessKey) && normalizeText(env.momoSecretKey));
}

function isZaloPayConfigured() {
  return Boolean(normalizeText(env.zaloPayAppId) && normalizeText(env.zaloPayKey1) && normalizeText(env.zaloPayKey2));
}

function computeHmacSha256(data, secret) {
  return createHmac('sha256', String(secret ?? '')).update(String(data ?? '')).digest('hex');
}

async function queryZaloPayOrderStatus(appTransId) {
  const normalizedAppTransId = normalizeText(appTransId);

  if (!normalizedAppTransId) {
    throw createValidationError('Thiếu app_trans_id để truy vấn trạng thái ZaloPay.');
  }

  if (!isZaloPayConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình ZaloPay (APP_ID/KEY1/KEY2).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để truy vấn ZaloPay.');
  }

  const appId = normalizeText(env.zaloPayAppId);
  const key1 = normalizeText(env.zaloPayKey1);
  const macData = `${appId}|${normalizedAppTransId}|${key1}`;
  const mac = computeHmacSha256(macData, key1);

  const response = await fetch(normalizeText(env.zaloPayQueryOrderUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      app_id: appId,
      app_trans_id: normalizedAppTransId,
      mac,
    }),
  });

  if (!response.ok) {
    throw createValidationError(`Không thể truy vấn trạng thái ZaloPay (HTTP ${response.status}).`);
  }

  return response.json();
}

async function queryMoMoOrderStatus(orderId) {
  const normalizedOrderId = normalizeText(orderId);

  if (!normalizedOrderId) {
    throw createValidationError('Thiếu orderId để truy vấn trạng thái MoMo.');
  }

  if (!isMoMoConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình MoMo (PARTNER_CODE/ACCESS_KEY/SECRET_KEY).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để truy vấn MoMo.');
  }

  const partnerCode = normalizeText(env.momoPartnerCode);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const requestId = `${normalizedOrderId}_${Date.now()}`;
  const rawSignature = [
    `accessKey=${accessKey}`,
    `orderId=${normalizedOrderId}`,
    `partnerCode=${partnerCode}`,
    `requestId=${requestId}`,
  ].join('&');
  const signature = computeHmacSha256(rawSignature, secretKey);

  const response = await fetch(normalizeText(env.momoQueryOrderUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      partnerCode,
      requestId,
      orderId: normalizedOrderId,
      lang: 'vi',
      signature,
    }),
  });

  if (!response.ok) {
    throw createValidationError(`Không thể truy vấn trạng thái MoMo (HTTP ${response.status}).`);
  }

  return response.json();
}

function encodeMoMoExtraData(payload = {}) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeMoMoExtraData(value = '') {
  try {
    const decoded = Buffer.from(String(value ?? ''), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function generateTopupRef() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0'),
  ].join('');
  return `TOPUP-${stamp}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function generateZaloPayAppTransId(referenceCode) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${yy}${mm}${dd}`;
  const token = normalizeText(referenceCode).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-14) || 'TOPUP';
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `${datePrefix}_${token}${randomSuffix}`;
}

function generateMoMoOrderId(referenceCode) {
  const token = normalizeText(referenceCode).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 22) || 'TOPUP';
  return `SR_${token}_${Date.now()}`;
}

function normalizeRole(role) {
  const normalizedRole = normalizeText(role).toLowerCase();
  if (normalizedRole === 'driver' || normalizedRole === 'q3') {
    return 'driver';
  }
  return 'customer';
}

function buildPendingTopupDescription({ methodLabel, provider, gatewayReferenceId, role }) {
  const safeMethodLabel = normalizeText(methodLabel) || 'Unknown';
  const safeProvider = normalizeText(provider).toLowerCase() || 'unknown';
  const safeGatewayReferenceId = normalizeText(gatewayReferenceId) || '';
  const safeRole = normalizeRole(role);

  return [
    `Nạp tiền ví qua ${safeMethodLabel} (chờ xác nhận)` ,
    `meta:p=${safeProvider};g=${safeGatewayReferenceId};r=${safeRole}`,
  ].join(' | ');
}

function parsePendingTopupDescription(description = '') {
  const normalizedDescription = normalizeText(description);
  const marker = 'meta:';
  const markerIndex = normalizedDescription.indexOf(marker);

  if (markerIndex < 0) {
    return { provider: '', gatewayReferenceId: '', role: '' };
  }

  const metaSegment = normalizedDescription.slice(markerIndex + marker.length).trim();
  const segments = metaSegment.split(';').map((segment) => segment.trim()).filter(Boolean);
  const metadata = {};

  for (const segment of segments) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const key = segment.slice(0, separatorIndex).trim().toLowerCase();
    const value = segment.slice(separatorIndex + 1).trim();
    metadata[key] = value;
  }

  return {
    provider: normalizeText(metadata.p).toLowerCase(),
    gatewayReferenceId: normalizeText(metadata.g),
    role: normalizeRole(metadata.r),
  };
}

async function persistPendingTopupRecord(requestInfo) {
  const normalizedUserId = normalizeText(requestInfo?.userId);
  const normalizedReferenceCode = normalizeText(requestInfo?.referenceCode);
  const normalizedAmount = normalizeAmount(requestInfo?.amount);

  if (!normalizedUserId || !normalizedReferenceCode || normalizedAmount <= 0) {
    throw createValidationError('Không đủ dữ liệu để lưu yêu cầu nạp ví pending.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const description = buildPendingTopupDescription({
      methodLabel: requestInfo?.methodLabel,
      provider: requestInfo?.provider || requestInfo?.method,
      gatewayReferenceId: requestInfo?.gatewayReferenceId,
      role: requestInfo?.role,
    });

    await new sql.Request(transaction)
      .input('userId', sql.VarChar(20), normalizedUserId)
      .input('referenceCode', sql.VarChar(40), normalizedReferenceCode)
      .input('amount', sql.Int, normalizedAmount)
      .input('description', sql.NVarChar(255), description)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @userId)
        BEGIN
          INSERT INTO dbo.Vi (MaTK, SoDu)
          VALUES (@userId, 0);
        END

        DECLARE @walletBalance INT;
        DECLARE @existingStatus VARCHAR(20);

        SELECT @walletBalance = SoDu
        FROM dbo.Vi
        WHERE MaTK = @userId;

        SELECT TOP 1 @existingStatus = TrangThai
        FROM dbo.GiaoDichVi
        WHERE MaTK = @userId
          AND LoaiGiaoDich = 'topup'
          AND MaThamChieu = @referenceCode
        ORDER BY MaGD DESC;

        IF @existingStatus IS NULL
        BEGIN
          INSERT INTO dbo.GiaoDichVi
          (
            MaTK,
            LoaiGiaoDich,
            SoTien,
            SoDuTruoc,
            SoDuSau,
            MoTa,
            MaThamChieu,
            TrangThai
          )
          VALUES
          (
            @userId,
            'topup',
            @amount,
            @walletBalance,
            @walletBalance,
            @description,
            @referenceCode,
            'pending'
          );
        END
        ELSE IF @existingStatus <> 'completed'
        BEGIN
          ;WITH latest AS
          (
            SELECT TOP 1 *
            FROM dbo.GiaoDichVi
            WHERE MaTK = @userId
              AND LoaiGiaoDich = 'topup'
              AND MaThamChieu = @referenceCode
            ORDER BY MaGD DESC
          )
          UPDATE latest
          SET SoTien = @amount,
              SoDuTruoc = @walletBalance,
              SoDuSau = @walletBalance,
              MoTa = @description,
              TrangThai = 'pending';
        END
      `);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function finalizePendingTopupRecord(requestInfo) {
  const normalizedUserId = normalizeText(requestInfo?.userId);
  const normalizedReferenceCode = normalizeText(requestInfo?.referenceCode);
  const normalizedAmount = normalizeAmount(requestInfo?.amount);
  const normalizedMethod = normalizeText(requestInfo?.method).toLowerCase();
  const normalizedMethodLabel = normalizeText(requestInfo?.methodLabel) || (normalizedMethod === 'momo' ? 'MoMo' : 'ZaloPay');

  if (!normalizedUserId || !normalizedReferenceCode || normalizedAmount <= 0) {
    throw createValidationError('Không đủ dữ liệu để hoàn tất giao dịch nạp ví.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const finalizeResult = await new sql.Request(transaction)
      .input('userId', sql.VarChar(20), normalizedUserId)
      .input('referenceCode', sql.VarChar(40), normalizedReferenceCode)
      .input('amount', sql.Int, normalizedAmount)
      .input('description', sql.NVarChar(255), `Nạp tiền ví qua ${normalizedMethodLabel}`)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @userId)
        BEGIN
          INSERT INTO dbo.Vi (MaTK, SoDu)
          VALUES (@userId, 0);
        END

        DECLARE @transactionId INT;
        DECLARE @transactionStatus VARCHAR(20);
        DECLARE @walletBefore INT;
        DECLARE @walletAfter INT;

        SELECT TOP 1
          @transactionId = MaGD,
          @transactionStatus = TrangThai
        FROM dbo.GiaoDichVi WITH (UPDLOCK, ROWLOCK)
        WHERE MaTK = @userId
          AND LoaiGiaoDich = 'topup'
          AND MaThamChieu = @referenceCode
        ORDER BY MaGD DESC;

        IF @transactionId IS NULL
        BEGIN
          SELECT
            CAST(0 AS INT) AS actionCode,
            CAST('not_found' AS VARCHAR(20)) AS actionStatus,
            CAST(NULL AS INT) AS balance;
          RETURN;
        END

        IF @transactionStatus = 'completed'
        BEGIN
          SELECT
            CAST(1 AS INT) AS actionCode,
            CAST('already_completed' AS VARCHAR(20)) AS actionStatus,
            (SELECT TOP 1 SoDu FROM dbo.Vi WHERE MaTK = @userId) AS balance;
          RETURN;
        END

        SELECT @walletBefore = SoDu
        FROM dbo.Vi
        WHERE MaTK = @userId;

        UPDATE dbo.Vi
        SET SoDu = SoDu + @amount,
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @userId;

        SELECT @walletAfter = SoDu
        FROM dbo.Vi
        WHERE MaTK = @userId;

        UPDATE dbo.GiaoDichVi
        SET SoTien = @amount,
            SoDuTruoc = @walletBefore,
            SoDuSau = @walletAfter,
            MoTa = @description,
            TrangThai = 'completed'
        WHERE MaGD = @transactionId;

        SELECT
          CAST(2 AS INT) AS actionCode,
          CAST('completed' AS VARCHAR(20)) AS actionStatus,
          @walletAfter AS balance;
      `);

    await transaction.commit();

    const row = finalizeResult.recordset?.[0] ?? null;
    return {
      applied: Number(row?.actionCode) === 2,
      alreadyCompleted: Number(row?.actionCode) === 1,
      notFound: Number(row?.actionCode) === 0,
      balance: Number.isFinite(Number(row?.balance)) ? Number(row.balance) : null,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function markPendingTopupAsFailed(referenceCode, errorMessage = '') {
  const normalizedReferenceCode = normalizeText(referenceCode);

  if (!normalizedReferenceCode) {
    return;
  }

  const safeMessage = normalizeText(errorMessage).slice(0, 120);
  const description = safeMessage
    ? `Nạp tiền ví thất bại: ${safeMessage}`
    : 'Nạp tiền ví thất bại.';

  await (await getSqlServerPool())
    .request()
    .input('referenceCode', sql.VarChar(40), normalizedReferenceCode)
    .input('description', sql.NVarChar(255), description)
    .query(`
      UPDATE dbo.GiaoDichVi
      SET TrangThai = 'failed',
          MoTa = @description
      WHERE LoaiGiaoDich = 'topup'
        AND MaThamChieu = @referenceCode
        AND TrangThai <> 'completed';
    `);
}

async function listPendingTopupsByUser(userId) {
  const normalizedUserId = normalizeText(userId);

  if (!normalizedUserId) {
    return [];
  }

  const queryResult = await (await getSqlServerPool())
    .request()
    .input('userId', sql.VarChar(20), normalizedUserId)
    .query(`
      SELECT TOP 30
        MaTK,
        SoTien,
        MoTa,
        MaThamChieu,
        TrangThai,
        NgayTao
      FROM dbo.GiaoDichVi
      WHERE MaTK = @userId
        AND LoaiGiaoDich = 'topup'
        AND TrangThai = 'pending'
      ORDER BY NgayTao DESC, MaGD DESC;
    `);

  return (queryResult.recordset ?? []).map((row) => {
    const metadata = parsePendingTopupDescription(row?.MoTa);
    return {
      userId: normalizeText(row?.MaTK),
      amount: normalizeAmount(row?.SoTien),
      referenceCode: normalizeText(row?.MaThamChieu),
      provider: metadata.provider,
      gatewayReferenceId: metadata.gatewayReferenceId,
      role: metadata.role,
      method: metadata.provider,
      methodLabel: metadata.provider === 'momo' ? 'MoMo' : 'ZaloPay',
      status: normalizeText(row?.TrangThai).toLowerCase() || 'pending',
      createdAt: row?.NgayTao ?? null,
    };
  });
}

async function updatePendingTopupGatewayMetadata(requestInfo = {}, gatewayResult = {}) {
  const normalizedReferenceCode = normalizeText(requestInfo?.referenceCode);

  if (!normalizedReferenceCode) {
    return;
  }

  const description = buildPendingTopupDescription({
    methodLabel: requestInfo?.methodLabel,
    provider: gatewayResult?.provider || requestInfo?.method,
    gatewayReferenceId: gatewayResult?.gatewayReferenceId,
    role: requestInfo?.role,
  });

  await (await getSqlServerPool())
    .request()
    .input('referenceCode', sql.VarChar(40), normalizedReferenceCode)
    .input('description', sql.NVarChar(255), description)
    .query(`
      UPDATE dbo.GiaoDichVi
      SET MoTa = @description,
          TrangThai = 'pending'
      WHERE LoaiGiaoDich = 'topup'
        AND MaThamChieu = @referenceCode
        AND TrangThai <> 'completed';
    `);
}

function getRedirectUrl() {
  return normalizeText(env.zaloPayRedirectUrl) || normalizeText(env.momoRedirectUrl) || 'http://localhost:5173/';
}

function getCallbackUrl(provider) {
  if (provider === 'momo') {
    return normalizeText(env.momoCallbackUrl);
  }
  return normalizeText(env.zaloPayCallbackUrl);
}

async function createMoMoOrder(requestInfo) {
  if (!isMoMoConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình MoMo (PARTNER_CODE/ACCESS_KEY/SECRET_KEY).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để gọi cổng thanh toán MoMo.');
  }

  const partnerCode = normalizeText(env.momoPartnerCode);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const orderId = generateMoMoOrderId(requestInfo.referenceCode);
  const requestId = `${orderId}_${Math.floor(100 + Math.random() * 900)}`;
  const amount = normalizeAmount(requestInfo.amount);

  if (amount <= 0) {
    throw createValidationError('Số tiền thanh toán MoMo không hợp lệ.');
  }

  const redirectUrl = getRedirectUrl();
  const ipnUrl = getCallbackUrl('momo');

  if (!ipnUrl) {
    throw createValidationError('Thiếu MOMO_CALLBACK_URL để nhận xác nhận thanh toán MoMo.');
  }

  const orderInfo = `Nap tien vi SmartRide - ${requestInfo.referenceCode}`;
  const requestType = normalizeText(env.momoRequestType) || 'captureWallet';
  const extraData = encodeMoMoExtraData({
    referenceCode: requestInfo.referenceCode,
    userId: requestInfo.userId,
    role: requestInfo.role,
    paymentProvider: 'momo',
    redirectUrl,
  });
  const rawSignature = [
    `accessKey=${accessKey}`,
    `amount=${amount}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=${requestType}`,
  ].join('&');
  const signature = computeHmacSha256(rawSignature, secretKey);

  const body = {
    partnerCode,
    partnerName: 'SmartRide',
    storeId: 'SmartRide',
    requestId,
    amount: String(amount),
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    lang: 'vi',
    requestType,
    autoCapture: true,
    extraData,
    signature,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOMO_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.momoCreateOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể tạo đơn MoMo (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    const resultCode = Number(payload?.resultCode ?? payload?.result_code ?? NaN);

    if (!Number.isFinite(resultCode) || resultCode !== MOMO_SUCCESS_RESULT_CODE) {
      const errorMessage = normalizeText(payload?.message ?? payload?.localMessage) || 'MoMo từ chối tạo đơn.';
      throw createValidationError(`${errorMessage} (resultCode: ${Number.isFinite(resultCode) ? resultCode : 'unknown'})`);
    }

    return {
      provider: 'momo',
      referenceCode: requestInfo.referenceCode,
      gatewayReferenceId: orderId,
      amount,
      orderUrl: normalizeText(payload?.payUrl),
      payUrl: normalizeText(payload?.payUrl),
      deepLink: normalizeText(payload?.deeplink ?? payload?.deeplinkMiniApp),
      qrCodeUrl: normalizeText(payload?.qrCodeUrl),
      gatewayTransToken: normalizeText(payload?.transId),
      raw: payload,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Kết nối MoMo bị quá thời gian phản hồi. Vui lòng thử lại.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createZaloPayOrder(requestInfo) {
  if (!isZaloPayConfigured()) {
    throw createValidationError('Hệ thống chưa cấu hình ZaloPay (APP_ID/KEY1/KEY2).');
  }

  if (typeof fetch !== 'function') {
    throw createValidationError('Máy chủ hiện tại chưa hỗ trợ fetch để gọi cổng thanh toán ZaloPay.');
  }

  const appId = normalizeText(env.zaloPayAppId);
  const key1 = normalizeText(env.zaloPayKey1);
  const amount = normalizeAmount(requestInfo.amount);

  if (amount <= 0) {
    throw createValidationError('Số tiền thanh toán ZaloPay không hợp lệ.');
  }

  const appUser = normalizeText(requestInfo.userId || 'guest');
  const appTransId = generateZaloPayAppTransId(requestInfo.referenceCode);
  const appTime = Date.now();
  const embedData = JSON.stringify({
    referenceCode: requestInfo.referenceCode,
    userId: requestInfo.userId,
    role: requestInfo.role,
    paymentProvider: 'zalopay',
    redirectUrl: getRedirectUrl(),
  });
  const items = JSON.stringify([]);
  const description = `Nạp tiền ví SmartRide - ${requestInfo.referenceCode}`;
  const callbackUrl = getCallbackUrl('zalopay');
  const macData = `${appId}|${appTransId}|${appUser}|${amount}|${appTime}|${embedData}|${items}`;
  const mac = computeHmacSha256(macData, key1);

  const body = new URLSearchParams({
    app_id: appId,
    app_user: appUser,
    app_time: String(appTime),
    amount: String(amount),
    app_trans_id: appTransId,
    embed_data: embedData,
    item: items,
    description,
    bank_code: '',
    mac,
  });

  if (callbackUrl) {
    body.set('callback_url', callbackUrl);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZALOPAY_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeText(env.zaloPayCreateOrderUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createValidationError(`Không thể tạo đơn ZaloPay (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    const returnCode = Number(payload?.return_code ?? payload?.returncode ?? 0);

    if (returnCode !== 1) {
      const errorMessage = normalizeText(payload?.return_message ?? payload?.returnmessage) || 'ZaloPay từ chối tạo đơn.';
      const subReturnCode = Number(payload?.sub_return_code ?? payload?.subreturncode ?? NaN);
      const subReturnMessage = normalizeText(payload?.sub_return_message ?? payload?.subreturnmessage);
      let detailedMessage = errorMessage;
      if (subReturnMessage) {
        detailedMessage = `${detailedMessage} - ${subReturnMessage}`;
      }
      if (Number.isFinite(subReturnCode)) {
        detailedMessage = `${detailedMessage} (sub_return_code: ${subReturnCode})`;
      }
      throw createValidationError(detailedMessage);
    }

    return {
      provider: 'zalopay',
      referenceCode: requestInfo.referenceCode,
      gatewayReferenceId: appTransId,
      amount,
      orderUrl: normalizeText(payload?.order_url ?? payload?.orderurl),
      deepLink: normalizeText(payload?.deeplink ?? payload?.deep_link ?? payload?.order_url ?? payload?.orderurl),
      qrCodeUrl: normalizeText(payload?.qr_code ?? payload?.qrCode),
      gatewayTransToken: normalizeText(payload?.zp_trans_token ?? payload?.zptranstoken),
      raw: payload,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createValidationError('Kết nối ZaloPay bị quá thời gian phản hồi. Vui lòng thử lại.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function finalizeTopup(requestInfo) {
  const finalizeResult = await finalizePendingTopupRecord(requestInfo);

  if (!finalizeResult.notFound) {
    return finalizeResult;
  }

  const normalizedRole = normalizeRole(requestInfo.role);
  if (normalizedRole === 'driver') {
    return topupDriverWallet(requestInfo.userId, {
      amount: requestInfo.amount,
      method: requestInfo.method,
      description: `Nạp tiền ví qua ${requestInfo.methodLabel}`,
      referenceCode: requestInfo.referenceCode,
    });
  }

  return topupCustomerWallet(requestInfo.userId, {
    amount: requestInfo.amount,
    method: requestInfo.method,
    description: `Nạp tiền ví qua ${requestInfo.methodLabel}`,
    referenceCode: requestInfo.referenceCode,
  });
}

async function syncTopupRequest(requestInfo = {}) {
  const provider = normalizeText(requestInfo.provider).toLowerCase();

  if (!requestInfo || requestInfo.completed) {
    return { synced: false, reason: 'already_completed' };
  }

  if (provider === 'zalopay') {
    const gatewayReferenceId = normalizeText(requestInfo.gatewayReferenceId);

    if (!gatewayReferenceId) {
      return { synced: false, reason: 'missing_gateway_reference_id' };
    }

    const gatewayResult = await queryZaloPayOrderStatus(gatewayReferenceId);
    const status = Number(gatewayResult?.status ?? NaN);
    const returnCode = Number(gatewayResult?.return_code ?? gatewayResult?.returncode ?? NaN);
    const isPaidByGateway = status === 1 || returnCode === 1;

    if (!isPaidByGateway) {
      return {
        synced: false,
        provider,
        status: Number.isFinite(status) ? status : null,
        returnCode: Number.isFinite(returnCode) ? returnCode : null,
      };
    }

    await finalizeTopup(requestInfo);
    const completedPayload = {
      ...requestInfo,
      completed: true,
      completedAt: new Date().toISOString(),
      status: 'success',
    };
    topupRequests.set(normalizeText(requestInfo.referenceCode), completedPayload);
    topupRequests.set(gatewayReferenceId, completedPayload);

    return {
      synced: true,
      provider,
      status: Number.isFinite(status) ? status : null,
      returnCode: Number.isFinite(returnCode) ? returnCode : null,
    };
  }

  if (provider === 'momo') {
    const gatewayReferenceId = normalizeText(requestInfo.gatewayReferenceId);

    if (!gatewayReferenceId) {
      return { synced: false, reason: 'missing_gateway_reference_id' };
    }

    const gatewayResult = await queryMoMoOrderStatus(gatewayReferenceId);
    const resultCode = Number(gatewayResult?.resultCode ?? gatewayResult?.errorCode ?? NaN);

    if (!Number.isFinite(resultCode) || resultCode !== MOMO_SUCCESS_RESULT_CODE) {
      return { synced: false, provider, resultCode };
    }

    await finalizeTopup(requestInfo);
    const completedPayload = {
      ...requestInfo,
      completed: true,
      completedAt: new Date().toISOString(),
      status: 'success',
    };
    topupRequests.set(normalizeText(requestInfo.referenceCode), completedPayload);
    topupRequests.set(gatewayReferenceId, completedPayload);

    return { synced: true, provider, resultCode };
  }

  return { synced: false, reason: 'unsupported_provider' };
}

export async function syncPendingTopups({ userId, role } = {}) {
  const normalizedUserId = normalizeText(userId);
  const normalizedRole = normalizeRole(role);

  if (!normalizedUserId) {
    throw createValidationError('Thiếu mã tài khoản để đồng bộ nạp tiền.');
  }

  const pendingRequests = await listPendingTopupsByUser(normalizedUserId);

  const results = [];

  for (const requestInfo of pendingRequests) {
    try {
      const cachedRequest = topupRequests.get(normalizeText(requestInfo.referenceCode)) ?? {};
      const mergedRequest = {
        ...cachedRequest,
        ...requestInfo,
        userId: normalizedUserId,
        role: normalizeRole(requestInfo.role || normalizedRole),
        provider: normalizeText(requestInfo.provider || cachedRequest.provider || requestInfo.method).toLowerCase(),
        gatewayReferenceId: normalizeText(requestInfo.gatewayReferenceId || cachedRequest.gatewayReferenceId),
      };

      results.push(await syncTopupRequest(mergedRequest));
    } catch (error) {
      results.push({ synced: false, reason: error?.message || 'sync_failed', referenceCode: requestInfo.referenceCode });
    }
  }

  return {
    success: true,
    synchronized: results,
  };
}

export async function createTopupRequest({ userId, amount, method, role }) {
  const normalizedUserId = normalizeText(userId);
  const normalizedMethod = normalizeText(method).toLowerCase();
  const normalizedRole = normalizeRole(role);
  const normalizedAmount = normalizeAmount(amount);

  if (!normalizedUserId) {
    throw createValidationError('Thiếu mã tài khoản để nạp tiền.');
  }

  if (normalizedAmount <= 0) {
    throw createValidationError('Số tiền nạp không hợp lệ.');
  }

  if (normalizedMethod !== 'momo' && normalizedMethod !== 'zalopay') {
    throw createValidationError('Phương thức thanh toán không được hỗ trợ.');
  }

  const referenceCode = generateTopupRef();
  const requestInfo = {
    userId: normalizedUserId,
    amount: normalizedAmount,
    method: normalizedMethod,
    methodLabel: normalizedMethod === 'momo' ? 'MoMo' : 'ZaloPay',
    role: normalizedRole,
    referenceCode,
  };

  topupRequests.set(referenceCode, {
    ...requestInfo,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  await persistPendingTopupRecord(requestInfo);

  let gatewayResult;
  try {
    gatewayResult = normalizedMethod === 'momo'
      ? await createMoMoOrder(requestInfo)
      : await createZaloPayOrder(requestInfo);
  } catch (error) {
    await markPendingTopupAsFailed(referenceCode, error?.message || 'gateway_create_failed');
    throw error;
  }

  const storedRequest = topupRequests.get(referenceCode) ?? {};
  topupRequests.set(referenceCode, {
    ...storedRequest,
    ...gatewayResult,
    status: 'pending',
  });

  if (gatewayResult?.gatewayReferenceId) {
    topupRequests.set(gatewayResult.gatewayReferenceId, {
      ...storedRequest,
      ...gatewayResult,
      status: 'pending',
    });
  }

  await updatePendingTopupGatewayMetadata(requestInfo, gatewayResult);

  return {
    success: true,
    message: 'Đã tạo yêu cầu nạp tiền. Vui lòng hoàn tất thanh toán ở ứng dụng thanh toán.',
    transactionId: referenceCode,
    provider: gatewayResult.provider,
    gatewayReferenceId: gatewayResult.gatewayReferenceId,
    paymentUrl: gatewayResult.orderUrl || gatewayResult.payUrl || gatewayResult.deepLink || gatewayResult.qrCodeUrl,
    orderUrl: gatewayResult.orderUrl,
    deepLink: gatewayResult.deepLink,
    qrCodeUrl: gatewayResult.qrCodeUrl,
    gatewayTransToken: gatewayResult.gatewayTransToken,
  };
}

export async function handleMomoCallback(payload = {}) {
  const orderId = normalizeText(payload?.orderId);
  const requestId = normalizeText(payload?.requestId);
  const amount = normalizeAmount(payload?.amount);
  const resultCode = Number(payload?.resultCode ?? payload?.errorCode ?? NaN);
  const message = normalizeText(payload?.message ?? payload?.localMessage);
  const partnerCode = normalizeText(payload?.partnerCode);
  const accessKey = normalizeText(env.momoAccessKey);
  const secretKey = normalizeText(env.momoSecretKey);
  const expectedPartnerCode = normalizeText(env.momoPartnerCode);

  if (!orderId || !requestId || !partnerCode) {
    return { resultCode: 0, message: 'received' };
  }

  const rawSignatures = [
    [
      `accessKey=${accessKey}`,
      `amount=${Number.isFinite(amount) ? amount : normalizeText(payload?.amount)}`,
      `extraData=${normalizeText(payload?.extraData)}`,
      `message=${message}`,
      `orderId=${orderId}`,
      `orderInfo=${normalizeText(payload?.orderInfo)}`,
      `orderType=${normalizeText(payload?.orderType)}`,
      `partnerCode=${partnerCode}`,
      `payType=${normalizeText(payload?.payType)}`,
      `requestId=${requestId}`,
      `responseTime=${normalizeText(payload?.responseTime)}`,
      `resultCode=${Number.isFinite(resultCode) ? resultCode : normalizeText(payload?.resultCode)}`,
      `transId=${normalizeText(payload?.transId)}`,
    ].join('&'),
    [
      `accessKey=${accessKey}`,
      `amount=${Number.isFinite(amount) ? amount : normalizeText(payload?.amount)}`,
      `extraData=${normalizeText(payload?.extraData)}`,
      `message=${message}`,
      `orderId=${orderId}`,
      `orderInfo=${normalizeText(payload?.orderInfo)}`,
      `partnerCode=${partnerCode}`,
      `requestId=${requestId}`,
      `responseTime=${normalizeText(payload?.responseTime)}`,
      `resultCode=${Number.isFinite(resultCode) ? resultCode : normalizeText(payload?.resultCode)}`,
      `transId=${normalizeText(payload?.transId)}`,
    ].join('&'),
  ];

  const expectedSignature = rawSignatures
    .map((rawData) => computeHmacSha256(rawData, secretKey).toLowerCase())
    .find((signature) => signature === normalizeText(payload?.signature).toLowerCase());

  if (!expectedSignature || !partnerCode || !expectedPartnerCode || partnerCode !== expectedPartnerCode) {
    return { resultCode: 0, message: 'received' };
  }

  const requestInfo = topupRequests.get(orderId) ?? decodeMoMoExtraData(payload?.extraData);
  const referenceCode = normalizeText(requestInfo?.referenceCode || orderId);

  if (!referenceCode) {
    return { resultCode: 0, message: 'received' };
  }

  if (Number.isFinite(resultCode) && resultCode === MOMO_SUCCESS_RESULT_CODE) {
    const storedRequest = topupRequests.get(orderId) ?? topupRequests.get(referenceCode) ?? {};
    if (!storedRequest.completed) {
      await finalizeTopup({
        ...storedRequest,
        ...requestInfo,
        userId: requestInfo?.userId,
        amount: requestInfo?.amount || amount,
        method: 'momo',
        methodLabel: 'MoMo',
        referenceCode,
      });
      const completedPayload = {
        ...storedRequest,
        completed: true,
        completedAt: new Date().toISOString(),
        status: 'success',
      };
      topupRequests.set(referenceCode, completedPayload);
      topupRequests.set(orderId, completedPayload);
    }
  }

  return { resultCode: 0, message: 'received' };
}

export async function handleZaloPayCallback(payload = {}) {
  const callbackData = normalizeText(payload?.data);
  const callbackMac = normalizeText(payload?.mac).toLowerCase();

  if (!callbackData || !callbackMac) {
    return {
      return_code: 0,
      return_message: 'invalid_payload',
    };
  }

  const expectedMac = computeHmacSha256(callbackData, normalizeText(env.zaloPayKey2)).toLowerCase();
  if (expectedMac !== callbackMac) {
    return {
      return_code: -1,
      return_message: 'invalid_mac',
    };
  }

  let parsedCallback = null;
  try {
    parsedCallback = JSON.parse(callbackData);
  } catch {
    return {
      return_code: 0,
      return_message: 'invalid_data_json',
    };
  }

  let embedData = {};
  try {
    embedData = parsedCallback?.embed_data ? JSON.parse(parsedCallback.embed_data) : {};
  } catch {
    embedData = {};
  }

  const referenceCode = normalizeText(embedData?.referenceCode || parsedCallback?.app_trans_id);
  const appId = normalizeText(parsedCallback?.app_id);
  const amount = normalizeAmount(parsedCallback?.amount);
  const status = Number(parsedCallback?.status ?? NaN);
  const returnCode = Number(parsedCallback?.return_code ?? parsedCallback?.returncode ?? NaN);
  const isPaidByGateway = status === 1 || returnCode === 1;

  if (!referenceCode || appId !== normalizeText(env.zaloPayAppId)) {
    return {
      return_code: 0,
      return_message: 'invalid_request',
    };
  }

  const requestInfo = topupRequests.get(referenceCode) ?? topupRequests.get(parsedCallback?.app_trans_id) ?? embedData;
  if (isPaidByGateway) {
    const storedRequest = topupRequests.get(referenceCode) ?? topupRequests.get(parsedCallback?.app_trans_id) ?? {};
    if (!storedRequest.completed) {
      await finalizeTopup({
        ...storedRequest,
        ...requestInfo,
        userId: requestInfo?.userId,
        amount: requestInfo?.amount || amount,
        method: 'zalopay',
        methodLabel: 'ZaloPay',
        referenceCode,
      });
      const completedPayload = {
        ...storedRequest,
        completed: true,
        completedAt: new Date().toISOString(),
        status: 'success',
      };
      topupRequests.set(referenceCode, completedPayload);
      topupRequests.set(parsedCallback?.app_trans_id, completedPayload);
    }
    return {
      return_code: 1,
      return_message: 'success',
    };
  }

  topupRequests.set(referenceCode, {
    ...(topupRequests.get(referenceCode) ?? {}),
    status: 'failed',
    completedAt: new Date().toISOString(),
  });

  await markPendingTopupAsFailed(referenceCode, 'zalopay_not_success_status');

  return {
    return_code: 0,
    return_message: 'not_success_status',
  };
}
