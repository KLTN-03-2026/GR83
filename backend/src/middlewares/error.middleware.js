import { env } from '../config/env.js';

const sqlServerConnectionLogCooldownMs = (() => {
  const parsedCooldownMs = Number(env.dbConnectionRetryCooldownMs ?? 30000);
  return Number.isFinite(parsedCooldownMs) && parsedCooldownMs >= 0 ? parsedCooldownMs : 30000;
})();

let lastSqlServerConnectionErrorLogAt = 0;

function isSqlServerConnectionTimeoutError(error) {
  const message = String(error?.message ?? '');

  return error?.code === 'ETIMEOUT'
    || error?.code === 'SQLSERVER_CONNECTION_COOLDOWN'
    || /Failed to connect to/i.test(message)
    || /SQL Server connection unavailable/i.test(message);
}

function logError(error) {
  if (isSqlServerConnectionTimeoutError(error)) {
    const now = Date.now();

    if (now - lastSqlServerConnectionErrorLogAt < sqlServerConnectionLogCooldownMs) {
      return;
    }

    lastSqlServerConnectionErrorLogAt = now;
    console.error(`[db] ${error?.message ?? 'SQL Server connection failed.'}`);
    return;
  }

  console.error(error);
}

export function errorHandler(error, request, response, next) {
  logError(error);

  const isDatabaseUnavailable = isSqlServerConnectionTimeoutError(error);

  const statusCode = isDatabaseUnavailable
    ? 503
    : Number.isInteger(error?.statusCode)
    ? error.statusCode
    : Number.isInteger(error?.status)
      ? error.status
      : error?.type === 'entity.too.large'
        ? 413
        : 500;

  const message =
    isDatabaseUnavailable
      ? 'Hệ thống cơ sở dữ liệu tạm thời không khả dụng. Vui lòng thử lại sau.'
      : statusCode === 413
      ? 'Dữ liệu gửi lên quá lớn. Vui lòng giảm kích thước ảnh hoặc thử lại với dữ liệu ngắn hơn.'
      : statusCode >= 500
        ? 'Internal Server Error'
        : error?.message || 'Bad Request';

  response.status(statusCode).json({
    success: false,
    message,
  });
}
