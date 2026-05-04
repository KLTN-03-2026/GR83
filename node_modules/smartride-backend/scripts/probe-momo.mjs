import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

function normalizeText(value) {
  return String(value ?? '').trim();
}

function requireEnv(name) {
  const value = normalizeText(process.env[name]);

  if (!value) {
    throw new Error(`Missing ${name} in backend/.env`);
  }

  return value;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function hmacSha256(data, secret) {
  return createHmac('sha256', String(secret ?? ''))
    .update(String(data ?? ''))
    .digest('hex');
}

function toBase64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function printStep(title) {
  console.log(`\n[STEP] ${title}`);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data: parsed,
  };
}

async function main() {
  const isMockMode = parseBoolean(process.env.MOMO_MOCK_MODE, false);
  const partnerCode = isMockMode ? 'MOCK_PARTNER' : requireEnv('MOMO_PARTNER_CODE');
  const accessKey = isMockMode ? 'MOCK_ACCESS' : requireEnv('MOMO_ACCESS_KEY');
  const secretKey = isMockMode ? 'MOCK_SECRET' : requireEnv('MOMO_SECRET_KEY');
  const createOrderUrl = normalizeText(process.env.MOMO_CREATE_ORDER_URL) || 'https://test-payment.momo.vn/v2/gateway/api/create';
  const queryOrderUrl = normalizeText(process.env.MOMO_QUERY_ORDER_URL) || 'https://test-payment.momo.vn/v2/gateway/api/query';
  const callbackUrl = requireEnv('MOMO_CALLBACK_URL');
  const redirectUrl = normalizeText(process.env.MOMO_REDIRECT_URL) || 'http://localhost:5173/';
  const requestType = normalizeText(process.env.MOMO_REQUEST_TYPE) || 'captureWallet';
  const backendPort = Number(process.env.PORT ?? 4000);
  const backendBaseUrl = normalizeText(process.env.PROBE_BACKEND_BASE_URL) || `http://localhost:${backendPort}`;
  const callbackApiUrl = `${backendBaseUrl.replace(/\/+$/, '')}/api/rides/payments/momo/callback`;

  const amount = 15000;
  const probeBookingCode = `PROBEMOMO${Date.now().toString().slice(-8)}`;
  const createOrderId = `SR_${probeBookingCode}_${Date.now()}`;
  const createRequestId = `${createOrderId}_REQ`;
  const createOrderInfo = `SmartRide MoMo probe ${probeBookingCode}`;
  const createExtraData = toBase64Json({
    bookingCode: probeBookingCode,
    accountId: 'probe-account',
    paymentProvider: 'momo',
    redirectUrl,
    probe: true,
  });

  if (isMockMode) {
    printStep('Create/query gateway are mocked (MOMO_MOCK_MODE=true)');
    console.log({
      mock: true,
      createOrderUrl,
      queryOrderUrl,
      note: 'Skipping real MoMo API calls because mock mode is enabled.',
    });
  } else {
    printStep('Create order (MoMo sandbox)');
  const createRawSignature = [
    `accessKey=${accessKey}`,
    `amount=${amount}`,
    `extraData=${createExtraData}`,
    `ipnUrl=${callbackUrl}`,
    `orderId=${createOrderId}`,
    `orderInfo=${createOrderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${createRequestId}`,
    `requestType=${requestType}`,
  ].join('&');
  const createSignature = hmacSha256(createRawSignature, secretKey);

  const createPayload = {
    partnerCode,
    partnerName: 'SmartRide',
    storeId: 'SmartRide',
    requestId: createRequestId,
    amount: String(amount),
    orderId: createOrderId,
    orderInfo: createOrderInfo,
    redirectUrl,
    ipnUrl: callbackUrl,
    lang: 'vi',
    requestType,
    autoCapture: true,
    extraData: createExtraData,
    signature: createSignature,
  };

  const createResult = await postJson(createOrderUrl, createPayload);
  console.log(`HTTP ${createResult.status}`);
  console.log(createResult.data);

  const createResultCode = Number(createResult.data?.resultCode ?? createResult.data?.errorCode ?? NaN);

  if (!createResult.ok || !Number.isFinite(createResultCode) || createResultCode !== 0) {
    throw new Error(`MoMo create failed with resultCode=${Number.isFinite(createResultCode) ? createResultCode : 'unknown'}`);
  }

  printStep('Query order status (MoMo sandbox)');
  const queryRequestId = `${createOrderId}_QUERY_${Date.now()}`;
  const queryRawSignature = [
    `accessKey=${accessKey}`,
    `orderId=${createOrderId}`,
    `partnerCode=${partnerCode}`,
    `requestId=${queryRequestId}`,
  ].join('&');
  const querySignature = hmacSha256(queryRawSignature, secretKey);

  const queryPayload = {
    partnerCode,
    requestId: queryRequestId,
    orderId: createOrderId,
    lang: 'vi',
    signature: querySignature,
  };

  const queryResult = await postJson(queryOrderUrl, queryPayload);
  console.log(`HTTP ${queryResult.status}`);
  console.log(queryResult.data);

  if (!queryResult.ok) {
    throw new Error(`MoMo query failed with HTTP ${queryResult.status}`);
  }
  }

  printStep('Callback signature path test (POST to local backend)');
  const callbackOrderId = `SR_${probeBookingCode}_${Date.now()}_CALLBACK`;
  const callbackRequestId = `${callbackOrderId}_REQ`;
  const callbackTransId = String(Date.now());
  const callbackResponseTime = String(Date.now());
  const callbackMessage = 'Successful.';
  const callbackResultCode = 0;
  const callbackOrderType = 'momo_wallet';
  const callbackPayType = 'qr';
  const callbackOrderInfo = `SmartRide MoMo callback probe ${probeBookingCode}`;
  const callbackExtraData = toBase64Json({
    bookingCode: probeBookingCode,
    source: 'probe-callback',
  });

  const callbackRawSignature = [
    `accessKey=${accessKey}`,
    `amount=${amount}`,
    `extraData=${callbackExtraData}`,
    `message=${callbackMessage}`,
    `orderId=${callbackOrderId}`,
    `orderInfo=${callbackOrderInfo}`,
    `orderType=${callbackOrderType}`,
    `partnerCode=${partnerCode}`,
    `payType=${callbackPayType}`,
    `requestId=${callbackRequestId}`,
    `responseTime=${callbackResponseTime}`,
    `resultCode=${callbackResultCode}`,
    `transId=${callbackTransId}`,
  ].join('&');
  const callbackSignature = hmacSha256(callbackRawSignature, secretKey);

  const callbackPayload = {
    partnerCode,
    orderId: callbackOrderId,
    requestId: callbackRequestId,
    amount,
    orderInfo: callbackOrderInfo,
    orderType: callbackOrderType,
    transId: callbackTransId,
    resultCode: callbackResultCode,
    message: callbackMessage,
    payType: callbackPayType,
    responseTime: callbackResponseTime,
    extraData: callbackExtraData,
    signature: callbackSignature,
  };

  const callbackResult = await postJson(callbackApiUrl, callbackPayload);
  console.log(`HTTP ${callbackResult.status}`);
  console.log(callbackResult.data);

  if (!callbackResult.ok) {
    throw new Error(`Backend callback endpoint failed with HTTP ${callbackResult.status}. Ensure backend is running at ${callbackApiUrl}`);
  }

  console.log('\nProbe completed.');
  console.log(`- mockMode: ${isMockMode}`);
  console.log(`- createOrderUrl: ${createOrderUrl}`);
  console.log(`- queryOrderUrl: ${queryOrderUrl}`);
  console.log(`- callbackApiUrl: ${callbackApiUrl}`);
  console.log(`- probeBookingCode: ${probeBookingCode}`);
}

main().catch((error) => {
  console.error('\nProbe failed.');
  console.error(error?.message || error);
  process.exit(1);
});
