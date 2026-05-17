import { createHmac } from 'node:crypto';
import sql from 'mssql';
import { env } from '../src/config/env.js';

const BACKEND_BASE_URL = `http://localhost:${env.port || 4000}`;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function computeZaloCallbackMac(data, key2) {
  return createHmac('sha256', String(key2 ?? '')).update(String(data ?? ''), 'utf8').digest('hex');
}

function getSqlConfig() {
  return {
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
    server: env.dbHost,
    port: Number(env.dbPort ?? 1433),
    options: {
      encrypt: Boolean(env.dbEncrypt),
      trustServerCertificate: Boolean(env.dbTrustServerCertificate),
      ...(normalizeText(env.dbInstanceName) ? { instanceName: normalizeText(env.dbInstanceName) } : {}),
    },
    pool: {
      max: Number(env.dbPoolMax ?? 10),
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: Number(env.dbRequestTimeoutMs ?? 60000),
    connectionTimeout: Number(env.dbConnectionTimeoutMs ?? 60000),
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function resolveCustomerAccountId(pool) {
  const result = await pool.request().query(`
    SELECT TOP 1 tk.MaTK AS accountId
    FROM dbo.TaiKhoan tk
    LEFT JOIN dbo.Quyen q ON q.MaQuyen = tk.MaQuyen
    WHERE (
      UPPER(ISNULL(q.MaQuyen, '')) = 'Q2'
      OR LOWER(ISNULL(q.TenQuyen, '')) LIKE N'%khach%'
      OR LOWER(ISNULL(q.TenQuyen, '')) LIKE N'%customer%'
    )
    ORDER BY tk.NgayTao DESC;
  `);

  return normalizeText(result.recordset?.[0]?.accountId);
}

async function readBookingState(pool, bookingCode) {
  const result = await pool
    .request()
    .input('bookingCode', sql.VarChar(30), bookingCode)
    .query(`
      SELECT TOP 1
        dx.MaChuyen AS bookingCode,
        dx.TrangThaiChuyen AS tripStatus,
        dx.TrangThaiThanhToan AS bookingPaymentStatus,
        dx.MaTKTaiXeDuocMoi AS dispatchedDriverSystemAccountId,
        tt.TrangThaiThanhToan AS paymentStatus,
        tt.GatewayAppTransId AS gatewayAppTransId,
        tt.GatewayLastReturnCode AS gatewayLastReturnCode
      FROM dbo.DatXe dx
      LEFT JOIN dbo.ThanhToan tt ON tt.MaChuyen = dx.MaChuyen
      WHERE dx.MaChuyen = @bookingCode;
    `);

  return result.recordset?.[0] ?? null;
}

async function createZaloBooking(accountId) {
  const searchPayload = {
    vehicle: 'motorbike',
    scheduleEnabled: false,
    pickup: { label: 'Bến xe Miền Đông, Bình Thạnh, TP.HCM', source: 'manual' },
    destination: { label: 'Sân bay Tân Sơn Nhất, Tân Bình, TP.HCM', source: 'manual' },
  };

  const searchResult = await requestJson('/api/rides/search', {
    method: 'POST',
    body: searchPayload,
  });

  const selectedRideId = normalizeText(searchResult.data?.results?.[0]?.id);

  if (!searchResult.ok || !selectedRideId) {
    throw new Error(`Search ride failed: HTTP ${searchResult.status} ${JSON.stringify(searchResult.data)}`);
  }

  const payload = {
    accountId,
    ...searchPayload,
    selectedRideId,
    paymentMethod: 'wallet',
    paymentProvider: 'zalopay',
    customerName: 'Probe ZaloPay',
    customerPhone: '0900000001',
  };

  const result = await requestJson('/api/rides/book', {
    method: 'POST',
    body: payload,
  });

  if (!result.ok || !result.data?.booking?.bookingCode) {
    throw new Error(`Book ride failed: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  }

  return result.data;
}

async function sendZaloCallback({ bookingCode, appTransId, amount, status, key2 }) {
  const callbackDataObject = {
    app_id: String(env.zaloPayAppId),
    app_trans_id: appTransId,
    app_time: Date.now(),
    amount: Math.round(Number(amount ?? 0)),
    server_time: Date.now(),
    status,
    zp_trans_id: `ZP_TEST_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    embed_data: JSON.stringify({
      bookingCode,
      accountId: '',
      paymentProvider: 'zalopay',
    }),
  };

  const data = JSON.stringify(callbackDataObject);
  const mac = computeZaloCallbackMac(data, key2);

  const callbackResult = await requestJson('/api/rides/payments/zalopay/callback', {
    method: 'POST',
    body: { data, mac },
  });

  return {
    requestPayload: callbackDataObject,
    response: callbackResult,
  };
}

async function fetchPaymentStatus(bookingCode, accountId) {
  return requestJson(`/api/rides/${encodeURIComponent(bookingCode)}/payment-status?accountId=${encodeURIComponent(accountId)}`);
}

async function run() {
  if (!env.zaloPayAppId || !env.zaloPayKey2) {
    throw new Error('Missing ZaloPay config (ZALOPAY_APP_ID/ZALOPAY_KEY2).');
  }

  const sqlPool = await sql.connect(getSqlConfig());

  try {
    const accountId = await resolveCustomerAccountId(sqlPool);

    if (!accountId) {
      throw new Error('No customer account found to run probe.');
    }

    const failedBooking = await createZaloBooking(accountId);
    const failedCode = normalizeText(failedBooking.booking?.bookingCode);
    const failedAppTransId = normalizeText(failedBooking.paymentGateway?.appTransId);
    const failedAmount = Number(failedBooking.booking?.price ?? 0);

    const failedCallback = await sendZaloCallback({
      bookingCode: failedCode,
      appTransId: failedAppTransId,
      amount: failedAmount,
      status: 2,
      key2: env.zaloPayKey2,
    });

    const failedApiStatus = await fetchPaymentStatus(failedCode, accountId);
    const failedDbState = await readBookingState(sqlPool, failedCode);

    const successBooking = await createZaloBooking(accountId);
    const successCode = normalizeText(successBooking.booking?.bookingCode);
    const successAppTransId = normalizeText(successBooking.paymentGateway?.appTransId);
    const successAmount = Number(successBooking.booking?.price ?? 0);

    const successCallback = await sendZaloCallback({
      bookingCode: successCode,
      appTransId: successAppTransId,
      amount: successAmount,
      status: 1,
      key2: env.zaloPayKey2,
    });

    const successApiStatus = await fetchPaymentStatus(successCode, accountId);
    const successDbState = await readBookingState(sqlPool, successCode);

    const summary = {
      accountId,
      failedCase: {
        bookingCode: failedCode,
        callbackHttp: failedCallback.response.status,
        callbackBody: failedCallback.response.data,
        paymentStatusApi: failedApiStatus.data?.payment ?? null,
        db: failedDbState,
      },
      successCase: {
        bookingCode: successCode,
        callbackHttp: successCallback.response.status,
        callbackBody: successCallback.response.data,
        paymentStatusApi: successApiStatus.data?.payment ?? null,
        db: successDbState,
      },
    };

    console.log(JSON.stringify(summary, null, 2));

    const failedPayment = normalizeText(failedDbState?.paymentStatus).toLowerCase();
    const failedTrip = normalizeText(failedDbState?.tripStatus).toLowerCase();
    const successPayment = normalizeText(successDbState?.paymentStatus).toLowerCase();

    if (failedPayment !== 'thatbai' || failedTrip !== 'dahuy') {
      throw new Error(`FAILED_CASE_ASSERTION: expected paymentStatus=ThatBai and tripStatus=DaHuy, got ${failedDbState?.paymentStatus}/${failedDbState?.tripStatus}`);
    }

    if (successPayment !== 'dathanhtoan') {
      throw new Error(`SUCCESS_CASE_ASSERTION: expected paymentStatus=DaThanhToan, got ${successDbState?.paymentStatus}`);
    }
  } finally {
    await sqlPool.close();
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
