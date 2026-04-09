function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  googleMapsServerApiKey: process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '',
  googleAuthClientId: process.env.GOOGLE_AUTH_CLIENT_ID ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpTlsRejectUnauthorized: parseBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFromName: process.env.SMTP_FROM_NAME ?? 'SmartRide',
  smtpFromEmail: process.env.SMTP_FROM_EMAIL ?? '',
  signupOtpExpiresMinutes: Number(process.env.SIGNUP_OTP_EXPIRES_MINUTES ?? 10),
  signupOtpResendCooldownSeconds: Number(process.env.SIGNUP_OTP_RESEND_COOLDOWN_SECONDS ?? 60),
  signupOtpMaxVerifyAttempts: Number(process.env.SIGNUP_OTP_MAX_VERIFY_ATTEMPTS ?? 5),
  googlePasswordTokenExpiresMinutes: Number(process.env.GOOGLE_PASSWORD_TOKEN_EXPIRES_MINUTES ?? 10),
  dbHost: process.env.DB_HOST ?? 'localhost',
  dbPort: Number(process.env.DB_PORT ?? 1433),
  dbName: process.env.DB_NAME ?? '',
  dbUser: process.env.DB_USER ?? '',
  dbPassword: process.env.DB_PASSWORD ?? '',
  dbEncrypt: parseBoolean(process.env.DB_ENCRYPT, false),
  dbTrustServerCertificate: parseBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000),
  dbRequestTimeoutMs: Number(process.env.DB_REQUEST_TIMEOUT_MS ?? 15000),
};
