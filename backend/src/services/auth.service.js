import { OAuth2Client } from 'google-auth-library';
import { randomInt, randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import sql from 'mssql';
import { env } from '../config/env.js';
import { getSqlServerPool } from './database.service.js';

const googleAuthClient = new OAuth2Client();
const googleUserInfoEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo';
const loginAttemptTracker = new Map();
const profileGenderDatabaseValues = {
  nam: 'Nam',
  nu: 'Nu',
  khac: 'Khac',
};
const profileGenderClientValues = {
  nam: 'Nam',
  nu: 'Nữ',
  khac: 'Khác',
};
const customerRoleCode = 'Q2';
const adminRoleCode = 'Q1';
const activeAccountStatus = 'HoatDong';
const driverLockedStatus = 'Khoa';
const lockedAccountSupportPhone = '0328752800';
const lockedAccountSupportMessage = `Tài khoản đang bị khóa. Vui lòng liên hệ ${lockedAccountSupportPhone} để được giải đáp.`;
const emailValidationPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const phoneNumberValidationPattern = /^\d{8,15}$/;
const invalidEmailDnsCodes = new Set(['ENOTFOUND', 'ENODATA', 'SERVFAIL', 'NODATA', 'NOTFOUND']);
const transientEmailDnsCodes = new Set(['ETIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN']);
const pendingSignupSessions = new Map();
const pendingPasswordResetSessions = new Map();
const googlePasswordChangeTickets = new Map();
const passwordResetTickets = new Map();
const verificationCodePattern = /^\d{6}$/;
const signupOtpExpiresMs = Math.max(1, Number(env.signupOtpExpiresMinutes ?? 10)) * 60 * 1000;
const signupOtpResendCooldownMs = Math.max(1, Number(env.signupOtpResendCooldownSeconds ?? 60)) * 1000;
const signupOtpMaxVerifyAttempts = Math.max(1, Number(env.signupOtpMaxVerifyAttempts ?? 5));
const googlePasswordTicketExpiresMs =
  Math.max(1, Number(env.googlePasswordTokenExpiresMinutes ?? 10)) * 60 * 1000;
let smtpTransporter = null;

function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details && typeof details === 'object') {
    error.details = details;
  }

  return error;
}

function isSqlUniqueConstraintError(error) {
  return error?.number === 2601 || error?.number === 2627;
}

function normalizeIdentifier(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeVietnameseText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeProfileGenderToken(value) {
  return normalizeVietnameseText(value)
    .trim()
    .toLowerCase();
}

function mapStoredProfileGenderForClient(value) {
  const genderToken = normalizeProfileGenderToken(value);
  return profileGenderClientValues[genderToken] ?? '';
}

function buildAccountLockKey(identifier, accountRow) {
  if (accountRow?.MaTK) {
    return `account:${String(accountRow.MaTK).trim().toLowerCase()}`;
  }

  return `identifier:${normalizeIdentifier(identifier)}`;
}

function getActiveLockState(lockKey) {
  const currentState = loginAttemptTracker.get(lockKey);

  if (!currentState?.lockUntilMs) {
    return null;
  }

  const remainingSeconds = Math.ceil((currentState.lockUntilMs - Date.now()) / 1000);

  if (remainingSeconds <= 0) {
    currentState.lockUntilMs = 0;
    currentState.lockSeconds = 0;
    loginAttemptTracker.set(lockKey, currentState);
    return null;
  }

  return {
    failedAttempts: currentState.failedAttempts,
    lockSeconds: currentState.lockSeconds,
    remainingSeconds,
  };
}

function resolveLockDuration(failedAttempts) {
  if (failedAttempts >= 5) {
    return 60;
  }

  if (failedAttempts === 3) {
    return 30;
  }

  return 0;
}

function markFailedLogin(lockKey) {
  const currentState = loginAttemptTracker.get(lockKey) ?? {
    failedAttempts: 0,
    lockUntilMs: 0,
    lockSeconds: 0,
  };

  const failedAttempts = currentState.failedAttempts + 1;
  const lockSeconds = resolveLockDuration(failedAttempts);

  const nextState = {
    failedAttempts,
    lockSeconds,
    lockUntilMs: lockSeconds > 0 ? Date.now() + lockSeconds * 1000 : 0,
  };

  loginAttemptTracker.set(lockKey, nextState);

  return {
    failedAttempts,
    lockSeconds,
    remainingSeconds: lockSeconds,
  };
}

function clearFailedLoginState(lockKey) {
  loginAttemptTracker.delete(lockKey);
}

function parseCredentialsPayload(payload = {}) {
  const identifier = String(payload.identifier ?? payload.email ?? payload.username ?? '').trim();
  const password = String(payload.password ?? '').trim();

  if (!identifier || !password) {
    throw createHttpError(400, 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
  }

  return { identifier, password };
}

function mapAccountRowToAuthUser(accountRow = {}) {
  const displayName = String(accountRow.Ten ?? '').trim() || String(accountRow.TaiKhoan ?? '').trim();
  const driverStatus = String(accountRow.DriverTrangThai ?? '').trim();
  const driverFeatureLocked = driverStatus.toLowerCase() === driverLockedStatus.toLowerCase();

  return {
    id: accountRow.MaTK,
    username: accountRow.TaiKhoan,
    email: accountRow.Email,
    name: displayName,
    roleCode: accountRow.MaQuyen,
    accountStatus: accountRow.TrangThai,
    driverStatus,
    driverFeatureLocked,
  };
}

function parseSignupPayload(payload = {}) {
  const fullName = String(payload.fullName ?? payload.name ?? '').trim();
  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '').trim();

  if (!fullName || !email || !password) {
    throw createHttpError(400, 'Vui lòng nhập đầy đủ họ tên, email và mật khẩu.');
  }

  if (!emailValidationPattern.test(email)) {
    throw createHttpError(400, 'Email không đúng định dạng hợp lệ.');
  }

  if (password.length < 3) {
    throw createHttpError(400, 'Mật khẩu phải có ít nhất 3 ký tự.');
  }

  return {
    fullName,
    email,
    password,
  };
}

function buildUsernameFromEmail(email) {
  const rawLocalPart = String(email ?? '')
    .split('@')[0]
    ?.trim()
    .toLowerCase();
  const normalizedLocalPart = rawLocalPart?.replace(/[^a-z0-9._-]/g, '') ?? '';

  if (!normalizedLocalPart) {
    return 'khachhang';
  }

  return normalizedLocalPart.slice(0, 40);
}

function buildGoogleBootstrapPassword(tokenPayload = {}) {
  const normalizedSeed = String(tokenPayload.sub ?? '').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = normalizedSeed.slice(-8) || String(Date.now()).slice(-8);
  return `Gg@${suffix}`;
}

function buildAccountPhonePlaceholder(accountId) {
  const accountDigits = String(accountId ?? '')
    .replace(/\D/g, '')
    .slice(-10)
    .padStart(10, '0');

  return `SR${accountDigits}`;
}

function isAccountPhonePlaceholder(phone) {
  return /^SR\d{10}$/i.test(String(phone ?? '').trim());
}

function normalizeStoredAccountPhone(phone, accountId) {
  const normalizedPhone = String(phone ?? '').trim();

  if (normalizedPhone) {
    return normalizedPhone;
  }

  return buildAccountPhonePlaceholder(accountId);
}

function mapProfilePhoneForClient(phone) {
  const normalizedPhone = String(phone ?? '').trim();

  if (!normalizedPhone) {
    return '';
  }

  return isAccountPhonePlaceholder(normalizedPhone) ? '' : normalizedPhone;
}

function maskEmailAddress(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  if (!normalizedEmail.includes('@')) {
    return normalizedEmail;
  }

  const [localPart, domainPart] = normalizedEmail.split('@');

  if (!localPart || !domainPart) {
    return normalizedEmail;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] ?? ''}***@${domainPart}`;
  }

  return `${localPart.slice(0, 2)}***@${domainPart}`;
}

function buildSignupVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function getRemainingSeconds(targetTimestampMs) {
  const remainingMs = Number(targetTimestampMs ?? 0) - Date.now();

  if (remainingMs <= 0) {
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

function cleanupExpiredSignupSessions() {
  const currentTimestampMs = Date.now();

  for (const [token, session] of pendingSignupSessions.entries()) {
    if (Number(session?.expiresAtMs ?? 0) <= currentTimestampMs) {
      pendingSignupSessions.delete(token);
    }
  }
}

function cleanupExpiredPasswordResetSessions() {
  const currentTimestampMs = Date.now();

  for (const [token, session] of pendingPasswordResetSessions.entries()) {
    if (Number(session?.expiresAtMs ?? 0) <= currentTimestampMs) {
      pendingPasswordResetSessions.delete(token);
    }
  }
}

function cleanupExpiredGooglePasswordTickets() {
  const currentTimestampMs = Date.now();

  for (const [token, ticket] of googlePasswordChangeTickets.entries()) {
    if (Number(ticket?.expiresAtMs ?? 0) <= currentTimestampMs) {
      googlePasswordChangeTickets.delete(token);
    }
  }
}

function cleanupExpiredPasswordResetTickets() {
  const currentTimestampMs = Date.now();

  for (const [token, ticket] of passwordResetTickets.entries()) {
    if (Number(ticket?.expiresAtMs ?? 0) <= currentTimestampMs) {
      passwordResetTickets.delete(token);
    }
  }
}

function getSmtpFromAddress() {
  const fromEmail = String(env.smtpFromEmail ?? '').trim();
  const fromName = String(env.smtpFromName ?? '').trim();

  if (!fromEmail) {
    throw createHttpError(500, 'Hệ thống chưa cấu hình SMTP_FROM_EMAIL để gửi mã xác nhận.');
  }

  if (!fromName) {
    return fromEmail;
  }

  return `${fromName} <${fromEmail}>`;
}

function getSmtpTransporter() {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const smtpHost = String(env.smtpHost ?? '').trim();
  const smtpPort = Number(env.smtpPort ?? 0);

  if (!smtpHost || !Number.isFinite(smtpPort) || smtpPort <= 0) {
    throw createHttpError(500, 'Hệ thống chưa cấu hình SMTP_HOST/SMTP_PORT để gửi mã xác nhận.');
  }

  const smtpUser = String(env.smtpUser ?? '').trim();
  const smtpPassword = String(env.smtpPassword ?? '').trim();

  if ((smtpUser && !smtpPassword) || (!smtpUser && smtpPassword)) {
    throw createHttpError(500, 'Cấu hình SMTP_USER/SMTP_PASSWORD chưa đầy đủ.');
  }

  smtpTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: Boolean(env.smtpSecure),
    tls: {
      rejectUnauthorized: Boolean(env.smtpTlsRejectUnauthorized),
    },
    auth: smtpUser
      ? {
          user: smtpUser,
          pass: smtpPassword,
        }
      : undefined,
  });

  return smtpTransporter;
}

async function sendSignupVerificationCodeEmail({ fullName, email, verificationCode }) {
  const transporter = getSmtpTransporter();
  const receiverName = String(fullName ?? '').trim() || 'bạn';
  const emailSubject = 'SmartRide - Ma xac nhan dang ky tai khoan';
  const expiresMinutes = Math.max(1, Math.ceil(signupOtpExpiresMs / 60000));

  try {
    await transporter.sendMail({
      from: getSmtpFromAddress(),
      to: String(email ?? '').trim(),
      subject: emailSubject,
      text: [
        `Xin chao ${receiverName},`,
        '',
        `Ma xac nhan dang ky SmartRide cua ban la: ${verificationCode}`,
        `Ma co hieu luc trong ${expiresMinutes} phut.`,
        '',
        'Neu ban khong thuc hien yeu cau nay, vui long bo qua email.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <p>Xin chao <strong>${receiverName}</strong>,</p>
          <p>Ma xac nhan dang ky SmartRide cua ban la:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 12px 0;">${verificationCode}</p>
          <p>Ma co hieu luc trong <strong>${expiresMinutes} phut</strong>.</p>
          <p>Neu ban khong thuc hien yeu cau nay, vui long bo qua email.</p>
        </div>
      `,
    });
  } catch {
    throw createHttpError(502, 'Không thể gửi email xác nhận lúc này. Vui lòng thử lại sau.');
  }
}

async function sendPasswordResetCodeEmail({ fullName, email, verificationCode }) {
  const transporter = getSmtpTransporter();
  const receiverName = String(fullName ?? '').trim() || 'bạn';
  const emailSubject = 'SmartRide - Ma xac nhan quen mat khau';
  const expiresMinutes = Math.max(1, Math.ceil(signupOtpExpiresMs / 60000));

  try {
    await transporter.sendMail({
      from: getSmtpFromAddress(),
      to: String(email ?? '').trim(),
      subject: emailSubject,
      text: [
        `Xin chao ${receiverName},`,
        '',
        `Ma OTP dat lai mat khau SmartRide cua ban la: ${verificationCode}`,
        `Ma co hieu luc trong ${expiresMinutes} phut.`,
        '',
        'Neu ban khong thuc hien yeu cau nay, vui long bo qua email.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <p>Xin chao <strong>${receiverName}</strong>,</p>
          <p>Ma OTP dat lai mat khau SmartRide cua ban la:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 12px 0;">${verificationCode}</p>
          <p>Ma co hieu luc trong <strong>${expiresMinutes} phut</strong>.</p>
          <p>Neu ban khong thuc hien yeu cau nay, vui long bo qua email.</p>
        </div>
      `,
    });
  } catch {
    throw createHttpError(502, 'Không thể gửi email OTP quên mật khẩu lúc này. Vui lòng thử lại sau.');
  }
}

function findPendingSignupSessionByEmail(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  for (const session of pendingSignupSessions.values()) {
    if (String(session?.email ?? '').trim().toLowerCase() === normalizedEmail) {
      return session;
    }
  }

  return null;
}

function createOrRefreshSignupSession(signupPayload, existingSession = null) {
  const token = String(existingSession?.token ?? '').trim() || randomUUID();
  const verificationCode = buildSignupVerificationCode();
  const createdAtMs = Date.now();

  return {
    token,
    fullName: signupPayload.fullName,
    email: signupPayload.email,
    password: signupPayload.password,
    verificationCode,
    verifyAttemptsRemaining: signupOtpMaxVerifyAttempts,
    resendAvailableAtMs: createdAtMs + signupOtpResendCooldownMs,
    expiresAtMs: createdAtMs + signupOtpExpiresMs,
    createdAtMs: Number(existingSession?.createdAtMs ?? createdAtMs),
  };
}

function parseSignupVerificationRequestPayload(payload = {}) {
  const signupToken = String(payload.signupToken ?? payload.verificationToken ?? '').trim();

  if (signupToken) {
    return {
      signupToken,
      signupPayload: null,
    };
  }

  return {
    signupToken: null,
    signupPayload: parseSignupPayload(payload),
  };
}

function parseSignupVerificationConfirmPayload(payload = {}) {
  const signupToken = String(payload.signupToken ?? payload.verificationToken ?? '').trim();
  const verificationCode = String(payload.verificationCode ?? payload.code ?? '').trim();

  if (!signupToken || !verificationCode) {
    throw createHttpError(400, 'Thiếu signupToken hoặc mã xác nhận đăng ký.');
  }

  if (!verificationCodePattern.test(verificationCode)) {
    throw createHttpError(400, 'Mã xác nhận phải gồm đúng 6 chữ số.');
  }

  return {
    signupToken,
    verificationCode,
  };
}

function parseForgotPasswordRequestPayload(payload = {}) {
  const resetToken = String(payload.resetToken ?? payload.forgotPasswordToken ?? '').trim();

  if (resetToken) {
    return {
      resetToken,
      email: '',
    };
  }

  const email = String(payload.email ?? '').trim().toLowerCase();

  if (!email) {
    throw createHttpError(400, 'Vui lòng nhập email đã đăng ký tài khoản.');
  }

  if (!emailValidationPattern.test(email)) {
    throw createHttpError(400, 'Email không đúng định dạng hợp lệ.');
  }

  return {
    resetToken: '',
    email,
  };
}

function parseForgotPasswordVerifyPayload(payload = {}) {
  const resetToken = String(payload.resetToken ?? payload.forgotPasswordToken ?? '').trim();
  const verificationCode = String(payload.verificationCode ?? payload.code ?? '').trim();

  if (!resetToken || !verificationCode) {
    throw createHttpError(400, 'Thiếu resetToken hoặc mã OTP quên mật khẩu.');
  }

  if (!verificationCodePattern.test(verificationCode)) {
    throw createHttpError(400, 'Mã OTP phải gồm đúng 6 chữ số.');
  }

  return {
    resetToken,
    verificationCode,
  };
}

function getPendingSignupSessionOrThrow(signupToken) {
  cleanupExpiredSignupSessions();
  const session = pendingSignupSessions.get(signupToken);

  if (!session) {
    throw createHttpError(410, 'Phiên xác thực đăng ký đã hết hạn. Vui lòng đăng ký lại để nhận mã mới.');
  }

  return session;
}

function buildSignupVerificationResponse(session, message) {
  return {
    success: true,
    message,
    signupToken: session.token,
    email: session.email,
    maskedEmail: maskEmailAddress(session.email),
    expiresInSeconds: getRemainingSeconds(session.expiresAtMs),
    resendAfterSeconds: getRemainingSeconds(session.resendAvailableAtMs),
  };
}

function findPendingPasswordResetSessionByEmail(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  for (const session of pendingPasswordResetSessions.values()) {
    if (String(session?.email ?? '').trim().toLowerCase() === normalizedEmail) {
      return session;
    }
  }

  return null;
}

function createOrRefreshPasswordResetSession(sessionPayload, existingSession = null) {
  const token = String(existingSession?.token ?? '').trim() || randomUUID();
  const verificationCode = buildSignupVerificationCode();
  const createdAtMs = Date.now();

  return {
    token,
    accountId: sessionPayload.accountId,
    fullName: sessionPayload.fullName,
    email: sessionPayload.email,
    verificationCode,
    verifyAttemptsRemaining: signupOtpMaxVerifyAttempts,
    resendAvailableAtMs: createdAtMs + signupOtpResendCooldownMs,
    expiresAtMs: createdAtMs + signupOtpExpiresMs,
    createdAtMs: Number(existingSession?.createdAtMs ?? createdAtMs),
  };
}

function getPendingPasswordResetSessionOrThrow(resetToken) {
  cleanupExpiredPasswordResetSessions();
  const session = pendingPasswordResetSessions.get(resetToken);

  if (!session) {
    throw createHttpError(410, 'Phiên xác thực quên mật khẩu đã hết hạn. Vui lòng yêu cầu mã mới.');
  }

  return session;
}

function buildForgotPasswordResponse(session, message) {
  return {
    success: true,
    message,
    resetToken: session.token,
    email: session.email,
    maskedEmail: maskEmailAddress(session.email),
    expiresInSeconds: getRemainingSeconds(session.expiresAtMs),
    resendAfterSeconds: getRemainingSeconds(session.resendAvailableAtMs),
  };
}

function createGooglePasswordChangeTicket(accountRow = {}) {
  cleanupExpiredGooglePasswordTickets();
  const accountId = String(accountRow.MaTK ?? '').trim();

  if (!accountId) {
    return '';
  }

  const ticketToken = randomUUID();
  googlePasswordChangeTickets.set(ticketToken, {
    accountId,
    currentPassword: String(accountRow.MatKhau ?? ''),
    expiresAtMs: Date.now() + googlePasswordTicketExpiresMs,
  });

  return ticketToken;
}

function getGooglePasswordChangeTicket(ticketToken) {
  cleanupExpiredGooglePasswordTickets();
  return googlePasswordChangeTickets.get(String(ticketToken ?? '').trim()) ?? null;
}

function consumeGooglePasswordChangeTicket(ticketToken) {
  googlePasswordChangeTickets.delete(String(ticketToken ?? '').trim());
}

function clearGooglePasswordChangeTicketsForAccount(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim().toLowerCase();

  if (!normalizedAccountId) {
    return;
  }

  for (const [ticketToken, ticket] of googlePasswordChangeTickets.entries()) {
    if (String(ticket?.accountId ?? '').trim().toLowerCase() === normalizedAccountId) {
      googlePasswordChangeTickets.delete(ticketToken);
    }
  }
}

function createPasswordResetTicket(accountId) {
  cleanupExpiredPasswordResetTickets();
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    return '';
  }

  const ticketToken = randomUUID();
  passwordResetTickets.set(ticketToken, {
    accountId: normalizedAccountId,
    expiresAtMs: Date.now() + googlePasswordTicketExpiresMs,
  });

  return ticketToken;
}

function getPasswordResetTicket(ticketToken) {
  cleanupExpiredPasswordResetTickets();
  return passwordResetTickets.get(String(ticketToken ?? '').trim()) ?? null;
}

function consumePasswordResetTicket(ticketToken) {
  passwordResetTickets.delete(String(ticketToken ?? '').trim());
}

function clearPasswordResetTicketsForAccount(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim().toLowerCase();

  if (!normalizedAccountId) {
    return;
  }

  for (const [ticketToken, ticket] of passwordResetTickets.entries()) {
    if (String(ticket?.accountId ?? '').trim().toLowerCase() === normalizedAccountId) {
      passwordResetTickets.delete(ticketToken);
    }
  }
}

async function validateRealEmailAddress(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  if (!emailValidationPattern.test(normalizedEmail)) {
    throw createHttpError(400, 'Email không đúng định dạng hợp lệ.');
  }

  const domain = normalizedEmail.split('@')[1]?.trim();

  if (!domain || !domain.includes('.')) {
    throw createHttpError(400, 'Tên miền email không hợp lệ.');
  }

  try {
    const mxRecords = await dns.resolveMx(domain);

    if (Array.isArray(mxRecords) && mxRecords.length > 0) {
      return;
    }

    throw createHttpError(400, 'Email không tồn tại hoặc không nhận thư.');
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }

    if (invalidEmailDnsCodes.has(error?.code)) {
      throw createHttpError(400, 'Email không tồn tại hoặc không nhận thư.');
    }

    if (transientEmailDnsCodes.has(error?.code)) {
      throw createHttpError(503, 'Không thể kiểm tra email lúc này. Vui lòng thử lại sau.');
    }

    throw createHttpError(400, 'Email không hợp lệ hoặc chưa thể xác minh.');
  }
}

function parseChangePasswordPayload(payload = {}) {
  const identifier = String(payload.identifier ?? payload.email ?? payload.username ?? '').trim();
  const accountId = String(payload.accountId ?? payload.userId ?? '').trim() || null;
  const bootstrapToken = String(payload.bootstrapToken ?? payload.passwordChangeToken ?? '').trim() || null;
  const passwordResetToken = String(payload.passwordResetToken ?? '').trim() || null;
  const currentPassword = String(payload.currentPassword ?? '').trim();
  const newPassword = String(payload.newPassword ?? '').trim();

  const hasIdentity = Boolean(identifier || accountId);
  const hasTokenBasedAuth = Boolean(bootstrapToken || passwordResetToken);

  if ((!hasTokenBasedAuth && (!hasIdentity || !currentPassword)) || !newPassword) {
    throw createHttpError(400, 'Vui lòng nhập đầy đủ thông tin đổi mật khẩu.');
  }

  if (newPassword.length < 3) {
    throw createHttpError(400, 'Mật khẩu mới phải có ít nhất 3 ký tự.');
  }

  if (currentPassword && currentPassword === newPassword) {
    throw createHttpError(400, 'Mật khẩu mới phải khác mật khẩu cũ.');
  }

  return {
    identifier,
    accountId,
    bootstrapToken,
    passwordResetToken,
    currentPassword,
    newPassword,
  };
}

function parseAccountResolverPayload(payload = {}) {
  const identifier = String(payload.identifier ?? payload.email ?? payload.username ?? '').trim();
  const accountId = String(payload.accountId ?? payload.userId ?? '').trim() || null;

  if (!identifier && !accountId) {
    throw createHttpError(400, 'Thiếu thông tin tài khoản.');
  }

  return {
    identifier,
    accountId,
  };
}

function normalizeProfileGender(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const genderToken = normalizeProfileGenderToken(normalizedValue);
  const matchedGender = profileGenderDatabaseValues[genderToken];

  if (!matchedGender) {
    throw createHttpError(400, 'Giới tính không hợp lệ. Chỉ chấp nhận Nam, Nữ hoặc Khác.');
  }

  return matchedGender;
}

function parseDateOnlyValue(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw createHttpError(400, 'Ngày sinh không hợp lệ. Định dạng phải là YYYY-MM-DD.');
  }

  return normalizedValue;
}

function formatDateOnlyValue(value) {
  if (!value) {
    return '';
  }

  const dateValue = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(dateValue.getTime())) {
    return '';
  }

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function mapAccountRowToProfile(accountRow = {}) {
  const driverStatus = String(accountRow.DriverTrangThai ?? '').trim();

  return {
    id: accountRow.MaTK,
    username: accountRow.TaiKhoan ?? '',
    fullName: accountRow.Ten ?? '',
    email: accountRow.Email ?? '',
    phone: mapProfilePhoneForClient(accountRow.SDT),
    address: accountRow.DiaChi ?? '',
    avatar: accountRow.Avatar ?? '',
    dateOfBirth: formatDateOnlyValue(accountRow.NgaySinh),
    gender: mapStoredProfileGenderForClient(accountRow.GioiTinh),
    roleCode: accountRow.MaQuyen ?? '',
    accountStatus: accountRow.TrangThai ?? '',
    driverStatus,
    driverFeatureLocked: driverStatus.toLowerCase() === driverLockedStatus.toLowerCase(),
  };
}

function getAccountDirectoryStatus(accountStatus) {
  const normalizedAccountStatus = normalizeIdentifier(accountStatus);
  const lockedStatus = normalizeIdentifier(driverLockedStatus);
  const activeStatus = normalizeIdentifier(activeAccountStatus);

  if (normalizedAccountStatus === lockedStatus) {
    return 'locked';
  }

  if (normalizedAccountStatus === 'choduyet') {
    return 'pending';
  }

  if (normalizedAccountStatus === activeStatus || !normalizedAccountStatus) {
    return 'active';
  }

  return 'active';
}

function mapAccountRowToDirectoryUser(accountRow = {}) {
  const fullName = String(accountRow.Ten ?? '').trim() || String(accountRow.TaiKhoan ?? '').trim();
  const roleCode = String(accountRow.MaQuyen ?? '').trim();
  const accountStatus = String(accountRow.TrangThai ?? '').trim();
  const driverStatus = String(accountRow.DriverTrangThai ?? '').trim();
  const normalizedStatus = getAccountDirectoryStatus(accountStatus);

  return {
    id: String(accountRow.MaTK ?? '').trim(),
    username: String(accountRow.TaiKhoan ?? '').trim(),
    fullName,
    email: String(accountRow.Email ?? '').trim(),
    phone: mapProfilePhoneForClient(accountRow.SDT),
    address: String(accountRow.DiaChi ?? '').trim(),
    avatar: String(accountRow.Avatar ?? '').trim(),
    dateOfBirth: formatDateOnlyValue(accountRow.NgaySinh),
    gender: mapStoredProfileGenderForClient(accountRow.GioiTinh),
    roleCode,
    roleLabel: getRoleLabel(roleCode),
    status: normalizedStatus,
    statusLabel: getAccountStatusLabel(normalizedStatus),
    accountStatus,
    driverStatus,
    driverBankId: String(accountRow.DriverBankId ?? '').trim(),
    isAdmin: isAdminRoleCode(roleCode),
    canDelete: !isAdminRoleCode(roleCode),
    canLock: !isAdminRoleCode(roleCode),
  };
}

function getRoleLabel(roleCode) {
  const normalizedRoleCode = String(roleCode ?? '').trim().toUpperCase();

  if (normalizedRoleCode === adminRoleCode) {
    return 'Quản trị viên';
  }

  if (normalizedRoleCode === 'Q3') {
    return 'Tài xế';
  }

  return 'Khách hàng';
}

function getAccountStatusLabel(status) {
  const normalizedStatus = normalizeIdentifier(status);

  if (normalizedStatus === 'locked' || normalizedStatus === 'khoa') {
    return 'Bị khóa';
  }

  if (normalizedStatus === 'pending' || normalizedStatus === 'choduyet') {
    return 'Chờ duyệt';
  }

  return 'Hoạt động';
}

function isAdminRoleCode(roleCode) {
  return String(roleCode ?? '').trim().toUpperCase() === adminRoleCode;
}

function normalizeAccountRoleCode(roleCode, fallbackRoleCode = customerRoleCode) {
  const normalizedRoleCode = String(roleCode ?? '').trim().toUpperCase();

  if (normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3') {
    return normalizedRoleCode;
  }

  return String(fallbackRoleCode ?? customerRoleCode).trim().toUpperCase() || customerRoleCode;
}

function normalizeManagementAccountStatus(status, fallbackStatus = activeAccountStatus) {
  const normalizedStatus = normalizeIdentifier(status);
  const normalizedFallbackStatus = String(fallbackStatus ?? '').trim();

  if (!normalizedStatus || normalizedStatus === 'active' || normalizedStatus === 'hoatdong') {
    return activeAccountStatus;
  }

  if (normalizedStatus === 'locked' || normalizedStatus === 'khoa') {
    return driverLockedStatus;
  }

  if (normalizedStatus === 'pending' || normalizedStatus === 'choduyet') {
    return 'ChoDuyet';
  }

  if (normalizedFallbackStatus) {
    return normalizeManagementAccountStatus(normalizedFallbackStatus, activeAccountStatus);
  }

  throw createHttpError(400, 'Trạng thái tài khoản không hợp lệ.');
}

function parseManagementAccountPayload(payload = {}, existingAccount = {}) {
  const fullName = String(payload.fullName ?? existingAccount.Ten ?? existingAccount.fullName ?? '').trim();
  const email = String(payload.email ?? existingAccount.Email ?? existingAccount.email ?? '').trim().toLowerCase();
  const phone = String(payload.phone ?? existingAccount.SDT ?? existingAccount.phone ?? '').trim();
  const address = String(payload.address ?? existingAccount.DiaChi ?? existingAccount.address ?? '').trim();
  const avatar = String(payload.avatar ?? existingAccount.Avatar ?? existingAccount.avatar ?? '').trim();
  const dateOfBirth = parseDateOnlyValue(payload.dateOfBirth ?? existingAccount.NgaySinh ?? existingAccount.dateOfBirth ?? '');
  const gender = normalizeProfileGender(payload.gender ?? existingAccount.GioiTinh ?? existingAccount.gender ?? '');
  const roleCode = normalizeAccountRoleCode(
    payload.roleCode ?? existingAccount.MaQuyen ?? existingAccount.roleCode ?? customerRoleCode,
  );
  const status = normalizeManagementAccountStatus(
    payload.status ?? existingAccount.TrangThai ?? existingAccount.status ?? activeAccountStatus,
  );

  if (!fullName) {
    throw createHttpError(400, 'Họ và tên không được để trống.');
  }

  if (!email) {
    throw createHttpError(400, 'Email không được để trống.');
  }

  if (!emailValidationPattern.test(email)) {
    throw createHttpError(400, 'Email không hợp lệ.');
  }

  if (phone && !phoneNumberValidationPattern.test(phone)) {
    throw createHttpError(400, 'Số điện thoại chỉ được chứa chữ số (8-15 số).');
  }

  if (avatar.length > 500) {
    throw createHttpError(400, 'Đường dẫn ảnh đại diện quá dài.');
  }

  if (isAdminRoleCode(roleCode) && status !== activeAccountStatus) {
    throw createHttpError(403, 'Tài khoản quản trị không thể bị khóa.');
  }

  return {
    fullName,
    email,
    phone,
    address,
    avatar,
    dateOfBirth,
    gender,
    roleCode,
    status,
  };
}

function normalizeManagementUsername(username) {
  const normalizedUsername = String(username ?? '').trim();

  if (!normalizedUsername) {
    throw createHttpError(400, 'Tên đăng nhập không được để trống.');
  }

  if (normalizedUsername.length > 150) {
    throw createHttpError(400, 'Tên đăng nhập không được vượt quá 150 ký tự.');
  }

  if (/\s/.test(normalizedUsername)) {
    throw createHttpError(400, 'Tên đăng nhập không được chứa khoảng trắng.');
  }

  return normalizedUsername;
}

function parseManagementCreateAccountPayload(payload = {}) {
  const username = normalizeManagementUsername(payload.username);
  const accountPayload = parseManagementAccountPayload(payload, {});

  if (!accountPayload.phone) {
    throw createHttpError(400, 'Số điện thoại không được để trống.');
  }

  return {
    ...accountPayload,
    username,
  };
}

function parseProfileUpdatePayload(payload = {}) {
  const resolver = parseAccountResolverPayload(payload);
  const fullName = String(payload.fullName ?? payload.name ?? '').trim();
  const email = String(payload.email ?? '').trim();
  const phone = String(payload.phone ?? payload.sdt ?? '').trim();
  const address = String(payload.address ?? payload.diaChi ?? '').trim();
  const avatar = String(payload.avatar ?? '').trim();
  const dateOfBirth = parseDateOnlyValue(payload.dateOfBirth ?? payload.ngaySinh ?? '');
  const gender = normalizeProfileGender(payload.gender ?? payload.gioiTinh ?? '');

  if (!fullName) {
    throw createHttpError(400, 'Họ và tên không được để trống.');
  }

  if (!email) {
    throw createHttpError(400, 'Email không được để trống.');
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw createHttpError(400, 'Email không hợp lệ.');
  }

  if (phone && !phoneNumberValidationPattern.test(phone)) {
    throw createHttpError(400, 'Số điện thoại chỉ được chứa chữ số (8-15 số).');
  }

  if (avatar.length > 500) {
    throw createHttpError(400, 'Đường dẫn ảnh đại diện quá dài.');
  }

  return {
    ...resolver,
    fullName,
    email,
    phone,
    address,
    avatar,
    dateOfBirth,
    gender,
  };
}

async function findAccountByIdentifier(identifier) {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('identifier', sql.VarChar(255), identifier)
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.TaiKhoan,
        tk.MatKhau,
        tk.MaQuyen,
        tk.Ten,
        tk.Email,
        tk.TrangThai,
        tx.TrangThai AS DriverTrangThai
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE LOWER(ISNULL(tk.TaiKhoan, '')) = LOWER(@identifier)
         OR LOWER(ISNULL(tk.Email, '')) = LOWER(@identifier)
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function findAccountByEmail(email) {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('email', sql.VarChar(255), String(email ?? '').trim())
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.TaiKhoan,
        tk.MatKhau,
        tk.MaQuyen,
        tk.Ten,
        tk.Email,
        tk.TrangThai,
        tx.TrangThai AS DriverTrangThai
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE LOWER(ISNULL(tk.Email, '')) = LOWER(@email)
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function findAccountByUsername(username) {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('username', sql.VarChar(150), String(username ?? '').trim())
    .query(`
      SELECT TOP 1
        MaTK,
        TaiKhoan,
        MatKhau,
        MaQuyen,
        Ten,
        Email,
        TrangThai
      FROM TaiKhoan
      WHERE LOWER(ISNULL(TaiKhoan, '')) = LOWER(@username)
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function findAccountById(accountId) {
  return findAccountForPasswordChange({ identifier: '', accountId: String(accountId ?? '').trim() });
}

async function generateNextAccountId() {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .query(`
      SELECT MAX(TRY_CAST(SUBSTRING(MaTK, 3, 18) AS INT)) AS maxSequence
      FROM TaiKhoan
      WHERE MaTK LIKE 'TK%'
    `);

  const currentMaxSequence = Number(queryResult.recordset?.[0]?.maxSequence ?? 0);
  const nextSequence = Number.isFinite(currentMaxSequence) ? currentMaxSequence + 1 : 1;
  const paddedSequence = String(nextSequence).padStart(4, '0');

  return `TK${paddedSequence}`;
}

async function generateUniqueUsername(email) {
  const baseUsername = buildUsernameFromEmail(email);
  let nextUsername = baseUsername;
  let sequence = 1;

  while (sequence <= 9999) {
    const existingAccount = await findAccountByUsername(nextUsername);

    if (!existingAccount) {
      return nextUsername;
    }

    const suffix = String(sequence);
    const maxBaseLength = Math.max(1, 150 - suffix.length - 1);
    nextUsername = `${baseUsername.slice(0, maxBaseLength)}-${suffix}`;
    sequence += 1;
  }

  return `khachhang-${Date.now()}`.slice(0, 150);
}

async function createCustomerAccount({ fullName, email, password, preferredUsername = '', phone = '' }) {
  const accountId = await generateNextAccountId();
  const normalizedPreferredUsername = String(preferredUsername ?? '').trim().toLowerCase();
  const normalizedEmailAsUsername = String(email ?? '').trim().toLowerCase();
  const storedPhone = normalizeStoredAccountPhone(phone, accountId);

  // TaiKhoan for email/google registrations must match the email by product rule.
  const username = normalizedPreferredUsername || normalizedEmailAsUsername;

  if (!username) {
    throw createHttpError(400, 'Không thể tạo tên tài khoản từ email đăng ký.');
  }

  if (username.length > 150) {
    throw createHttpError(400, 'Email đăng ký vượt quá 150 ký tự nên không thể dùng làm tên tài khoản.');
  }

  const existingUsernameAccount = await findAccountByUsername(username);

  if (existingUsernameAccount) {
    throw createHttpError(
      409,
      'Tên tài khoản nội bộ đã tồn tại. Vui lòng liên hệ quản trị viên để được hỗ trợ chuyển đổi.',
    );
  }

  const pool = await getSqlServerPool();

  await pool
    .request()
    .input('accountId', sql.VarChar(20), accountId)
    .input('username', sql.VarChar(150), username)
    .input('password', sql.VarChar(255), password)
    .input('roleCode', sql.Char(2), customerRoleCode)
    .input('fullName', sql.NVarChar(100), fullName)
    .input('email', sql.VarChar(150), email)
    .input('phone', sql.VarChar(15), storedPhone)
    .input('status', sql.NVarChar(20), activeAccountStatus)
    .query(`
      INSERT INTO TaiKhoan (MaTK, TaiKhoan, MatKhau, MaQuyen, Ten, Email, SDT, TrangThai)
      VALUES (@accountId, @username, @password, @roleCode, @fullName, @email, @phone, @status)
    `);

  return findAccountById(accountId);
}

async function createManagementAccount(payload = {}) {
  const accountPayload = parseManagementCreateAccountPayload(payload);
  const existingUsernameAccount = await findAccountByUsername(accountPayload.username);

  if (existingUsernameAccount) {
    throw createHttpError(409, 'Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác.');
  }

  const accountId = await generateNextAccountId();
  const storedPhone = normalizeStoredAccountPhone(accountPayload.phone, accountId);
  const initialPassword = storedPhone;
  const pool = await getSqlServerPool();

  try {
    await pool
      .request()
      .input('accountId', sql.VarChar(20), accountId)
      .input('username', sql.VarChar(150), accountPayload.username)
      .input('password', sql.VarChar(255), initialPassword)
      .input('roleCode', sql.Char(2), accountPayload.roleCode)
      .input('fullName', sql.NVarChar(100), accountPayload.fullName)
      .input('email', sql.VarChar(150), accountPayload.email)
      .input('phone', sql.VarChar(15), storedPhone)
      .input('address', sql.NVarChar(255), accountPayload.address || null)
      .input('avatar', sql.NVarChar(500), accountPayload.avatar || null)
      .input('dateOfBirth', sql.Date, accountPayload.dateOfBirth || null)
      .input('gender', sql.NVarChar(10), accountPayload.gender || null)
      .input('status', sql.NVarChar(20), accountPayload.status)
      .query(`
        INSERT INTO TaiKhoan (MaTK, TaiKhoan, MatKhau, MaQuyen, Ten, Email, SDT, DiaChi, Avatar, NgaySinh, GioiTinh, TrangThai)
        VALUES (@accountId, @username, @password, @roleCode, @fullName, @email, @phone, @address, @avatar, @dateOfBirth, @gender, @status)
      `);
  } catch (error) {
    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Tên đăng nhập, email hoặc số điện thoại đã tồn tại.');
    }

    throw error;
  }

  const createdAccount = await findAccountForManagement(accountId);

  return {
    success: true,
    message: 'Tạo tài khoản thành công. Mật khẩu khởi tạo là số điện thoại.',
    account: mapAccountRowToDirectoryUser(createdAccount),
  };
}

async function findAccountForPasswordChange({ identifier, accountId }) {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('accountId', sql.VarChar(64), accountId ?? '')
    .input('identifier', sql.VarChar(255), identifier)
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.TaiKhoan,
        tk.MatKhau,
        tk.MaQuyen,
        tk.Ten,
        tk.Email,
        tk.TrangThai,
        tx.TrangThai AS DriverTrangThai
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE (
          @accountId <> ''
          AND LOWER(ISNULL(tk.MaTK, '')) = LOWER(@accountId)
        )
        OR (
          @identifier <> ''
          AND (
            LOWER(ISNULL(tk.Email, '')) = LOWER(@identifier)
            OR LOWER(ISNULL(tk.TaiKhoan, '')) = LOWER(@identifier)
          )
        )
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function findAccountForProfile({ identifier, accountId }) {
  const pool = await getSqlServerPool();
  const queryResult = await pool
    .request()
    .input('accountId', sql.VarChar(64), accountId ?? '')
    .input('identifier', sql.VarChar(255), identifier)
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.TaiKhoan,
        tk.MatKhau,
        tk.MaQuyen,
        tk.Ten,
        tk.Email,
        tk.SDT,
        tk.DiaChi,
        tk.Avatar,
        tk.NgaySinh,
        tk.GioiTinh,
        tk.TrangThai,
        tx.TrangThai AS DriverTrangThai
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE (
          @accountId <> ''
          AND LOWER(ISNULL(tk.MaTK, '')) = LOWER(@accountId)
        )
        OR (
          @identifier <> ''
          AND (
            LOWER(ISNULL(tk.Email, '')) = LOWER(@identifier)
            OR LOWER(ISNULL(tk.TaiKhoan, '')) = LOWER(@identifier)
          )
        )
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function updateAccountPassword(accountId, newPassword) {
  const pool = await getSqlServerPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(64), String(accountId))
    .input('newPassword', sql.VarChar(255), newPassword)
    .query(`
      UPDATE TaiKhoan
      SET MatKhau = @newPassword
      WHERE MaTK = @accountId
    `);
}

async function updateAccountProfileById(accountId, profilePayload) {
  const pool = await getSqlServerPool();
  const storedPhone = normalizeStoredAccountPhone(profilePayload.phone, accountId);

  await pool
    .request()
    .input('accountId', sql.VarChar(64), String(accountId))
    .input('fullName', sql.NVarChar(100), profilePayload.fullName)
    .input('email', sql.VarChar(150), profilePayload.email)
    .input('phone', sql.VarChar(15), storedPhone)
    .input('address', sql.NVarChar(255), profilePayload.address || null)
    .input('avatar', sql.NVarChar(500), profilePayload.avatar || null)
    .input('dateOfBirth', sql.Date, profilePayload.dateOfBirth || null)
    .input('gender', sql.NVarChar(10), profilePayload.gender || null)
    .query(`
      UPDATE TaiKhoan
      SET Ten = @fullName,
          Email = @email,
          SDT = @phone,
          DiaChi = @address,
          Avatar = @avatar,
          NgaySinh = @dateOfBirth,
          GioiTinh = @gender,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @accountId
    `);
}

async function updateAvatarByAccountId(accountId, avatarPath) {
  const pool = await getSqlServerPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(64), String(accountId))
    .input('avatar', sql.NVarChar(500), avatarPath)
    .query(`
      UPDATE TaiKhoan
      SET Avatar = @avatar,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @accountId
    `);
}

async function findAccountForManagement(accountId, transaction = null) {
  const pool = await getSqlServerPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  const queryResult = await request
    .input('accountId', sql.VarChar(64), String(accountId ?? '').trim())
    .query(`
      SELECT TOP 1
        tk.MaTK,
        tk.TaiKhoan,
        tk.Ten,
        tk.Email,
        tk.SDT,
        tk.DiaChi,
        tk.Avatar,
        tk.NgaySinh,
        tk.GioiTinh,
        tk.MaQuyen,
        tk.TrangThai,
        tx.TrangThai AS DriverTrangThai,
        tx.MaNH AS DriverBankId
      FROM TaiKhoan tk
      LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
      WHERE LOWER(ISNULL(tk.MaTK, '')) = LOWER(@accountId)
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function updateAccountManagementById(accountId, accountPayload, transaction) {
  const storedPhone = normalizeStoredAccountPhone(accountPayload.phone, accountId);

  await new sql.Request(transaction)
    .input('accountId', sql.VarChar(64), String(accountId))
    .input('fullName', sql.NVarChar(100), accountPayload.fullName)
    .input('email', sql.VarChar(150), accountPayload.email)
    .input('phone', sql.VarChar(15), storedPhone)
    .input('address', sql.NVarChar(255), accountPayload.address || null)
    .input('avatar', sql.NVarChar(500), accountPayload.avatar || null)
    .input('dateOfBirth', sql.Date, accountPayload.dateOfBirth || null)
    .input('gender', sql.NVarChar(10), accountPayload.gender || null)
    .input('roleCode', sql.Char(2), accountPayload.roleCode)
    .input('status', sql.NVarChar(20), accountPayload.status)
    .query(`
      UPDATE TaiKhoan
      SET Ten = @fullName,
          Email = @email,
          SDT = @phone,
          DiaChi = @address,
          Avatar = @avatar,
          NgaySinh = @dateOfBirth,
          GioiTinh = @gender,
          MaQuyen = @roleCode,
          TrangThai = @status,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @accountId
    `);
}

async function lockAccountById(accountId, statusValue) {
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const accountRow = await findAccountForManagement(accountId, transaction);

    if (!accountRow) {
      throw createHttpError(404, 'Không tìm thấy tài khoản cần xử lý.');
    }

    if (isAdminRoleCode(accountRow.MaQuyen)) {
      throw createHttpError(403, 'Tài khoản quản trị không thể bị khóa.');
    }

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(64), String(accountId))
      .input('status', sql.NVarChar(20), statusValue)
      .query(`
        UPDATE TaiKhoan
        SET TrangThai = @status,
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @accountId
      `);

    await transaction.commit();
    return accountRow;
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

async function deleteAccountById(accountId) {
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const accountRow = await findAccountForManagement(accountId, transaction);

    if (!accountRow) {
      throw createHttpError(404, 'Không tìm thấy tài khoản cần xóa.');
    }

    if (isAdminRoleCode(accountRow.MaQuyen)) {
      throw createHttpError(403, 'Tài khoản quản trị không thể bị xóa.');
    }

    const bankId = String(accountRow.DriverBankId ?? '').trim();

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(64), String(accountId))
      .query(`
        DELETE FROM TaiXe
        WHERE MaTK = @accountId
      `);

    if (bankId) {
      await new sql.Request(transaction)
        .input('bankId', sql.VarChar(20), bankId)
        .query(`
          DELETE FROM NganHang
          WHERE MaNH = @bankId
        `);
    }

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(64), String(accountId))
      .query(`
        DELETE FROM TaiKhoan
        WHERE MaTK = @accountId
      `);

    await transaction.commit();
    return accountRow;
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

function isInactiveAccount(status) {
  return String(status ?? '').trim().toLowerCase() === 'khoa';
}

function getGoogleAudiences() {
  return String(env.googleAuthClientId ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function verifyGoogleCredential(payload = {}) {
  const credential = typeof payload.credential === 'string' ? payload.credential.trim() : '';
  const accessToken = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';

  if (!credential && !accessToken) {
    throw createHttpError(400, 'Thiếu credential hoặc accessToken từ Google Sign-In.');
  }

  if (credential) {
    return verifyGoogleIdTokenCredential(credential);
  }

  return verifyGoogleAccessToken(accessToken);
}

async function verifyGoogleIdTokenCredential(credential) {
  const audiences = getGoogleAudiences();

  if (audiences.length === 0) {
    throw createHttpError(500, 'Thiếu GOOGLE_AUTH_CLIENT_ID trong backend/.env.');
  }

  let ticket;

  try {
    ticket = await googleAuthClient.verifyIdToken({
      idToken: credential,
      audience: audiences.length === 1 ? audiences[0] : audiences,
    });
  } catch {
    throw createHttpError(401, 'Google credential không hợp lệ hoặc đã hết hạn.');
  }

  const tokenPayload = ticket.getPayload();

  if (!tokenPayload?.sub || !tokenPayload?.email) {
    throw createHttpError(401, 'Không thể lấy thông tin tài khoản Google.');
  }

  if (tokenPayload.email_verified === false) {
    throw createHttpError(401, 'Email Google chưa được xác minh.');
  }

  return tokenPayload;
}

async function verifyGoogleAccessToken(accessToken) {
  let userInfoResponse;

  try {
    userInfoResponse = await fetch(googleUserInfoEndpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw createHttpError(502, 'Không thể kết nối Google để xác thực access token.');
  }

  if (!userInfoResponse.ok) {
    throw createHttpError(401, 'Google access token không hợp lệ hoặc đã hết hạn.');
  }

  let tokenPayload;

  try {
    tokenPayload = await userInfoResponse.json();
  } catch {
    throw createHttpError(502, 'Phản hồi xác thực Google không hợp lệ.');
  }

  if (!tokenPayload?.sub || !tokenPayload?.email) {
    throw createHttpError(401, 'Không thể lấy thông tin tài khoản Google.');
  }

  if (tokenPayload.email_verified === false) {
    throw createHttpError(401, 'Email Google chưa được xác minh.');
  }

  return tokenPayload;
}

function buildGoogleAuthResult(accountRow, { entryPoint = 'login', accountCreated = false } = {}) {
  const requiresPasswordChange = Boolean(accountCreated);
  const passwordChangeToken = requiresPasswordChange
    ? createGooglePasswordChangeTicket(accountRow)
    : '';
  let message = 'Đăng nhập Google thành công.';

  if (entryPoint === 'signup') {
    message = accountCreated
      ? 'Đăng ký Google thành công.'
      : 'Tài khoản Google đã tồn tại. Hệ thống đã đăng nhập cho bạn.';
  } else if (accountCreated) {
    message = 'Đăng nhập Google thành công.';
  }

  return {
    success: true,
    message,
    provider: 'google',
    accountCreated,
    googleAccountStatus: accountCreated ? 'created' : 'existing',
    requiresPasswordChange,
    passwordChangeToken,
    passwordTokenExpiresInSeconds: requiresPasswordChange
      ? getRemainingSeconds(Date.now() + googlePasswordTicketExpiresMs)
      : 0,
    passwordPromptMessage: requiresPasswordChange
      ? 'Tài khoản vừa được tạo từ Google. Vui lòng đặt mật khẩu mới để tăng bảo mật.'
      : '',
    user: mapAccountRowToAuthUser(accountRow),
  };
}

async function resolveGoogleAccount(tokenPayload, { allowCreateIfMissing = false } = {}) {
  const email = String(tokenPayload?.email ?? '').trim().toLowerCase();

  if (!email) {
    throw createHttpError(401, 'Không thể lấy email từ tài khoản Google.');
  }

  let accountRow = await findAccountByEmail(email);
  let accountCreated = false;

  if (!accountRow) {
    if (!allowCreateIfMissing) {
      throw createHttpError(409, 'Email Google này chưa được đăng ký trong hệ thống.');
    }

    try {
      accountRow = await createCustomerAccount({
        fullName: tokenPayload?.name ?? email,
        email,
        password: buildGoogleBootstrapPassword(tokenPayload),
        preferredUsername: email,
      });
      accountCreated = true;
    } catch (error) {
      if (isSqlUniqueConstraintError(error)) {
        throw createHttpError(409, 'Email Google này đã được đăng ký trong hệ thống.');
      }

      throw error;
    }
  }

  if (!accountRow) {
    throw createHttpError(500, 'Không thể xử lý tài khoản Google lúc này.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  return {
    accountRow,
    accountCreated,
  };
}

export async function requestSignupVerificationCode(payload = {}) {
  cleanupExpiredSignupSessions();
  const requestPayload = parseSignupVerificationRequestPayload(payload);

  if (requestPayload.signupToken) {
    const session = getPendingSignupSessionOrThrow(requestPayload.signupToken);
    const resendAfterSeconds = getRemainingSeconds(session.resendAvailableAtMs);

    if (resendAfterSeconds > 0) {
      throw createHttpError(
        429,
        `Mã xác nhận đã được gửi trước đó. Vui lòng chờ ${resendAfterSeconds}s để gửi lại.`,
        {
          signupToken: session.token,
          retryAfterSeconds: resendAfterSeconds,
          maskedEmail: maskEmailAddress(session.email),
        },
      );
    }

    const refreshedSession = createOrRefreshSignupSession(
      {
        fullName: session.fullName,
        email: session.email,
        password: session.password,
      },
      session,
    );

    pendingSignupSessions.set(refreshedSession.token, refreshedSession);
    await sendSignupVerificationCodeEmail({
      fullName: refreshedSession.fullName,
      email: refreshedSession.email,
      verificationCode: refreshedSession.verificationCode,
    });

    return buildSignupVerificationResponse(
      refreshedSession,
      `Đã gửi lại mã xác nhận tới ${maskEmailAddress(refreshedSession.email)}.`,
    );
  }

  const signupPayload = requestPayload.signupPayload;
  const existingAccount = await findAccountByEmail(signupPayload.email);

  if (existingAccount) {
    throw createHttpError(409, 'Email này đã được đăng ký. Vui lòng đăng nhập.');
  }

  await validateRealEmailAddress(signupPayload.email);

  const sameEmailSession = findPendingSignupSessionByEmail(signupPayload.email);

  if (sameEmailSession) {
    const resendAfterSeconds = getRemainingSeconds(sameEmailSession.resendAvailableAtMs);

    if (resendAfterSeconds > 0) {
      throw createHttpError(
        429,
        `Mã xác nhận đã được gửi trước đó. Vui lòng chờ ${resendAfterSeconds}s để gửi lại.`,
        {
          signupToken: sameEmailSession.token,
          retryAfterSeconds: resendAfterSeconds,
          maskedEmail: maskEmailAddress(sameEmailSession.email),
        },
      );
    }
  }

  const session = createOrRefreshSignupSession(signupPayload, sameEmailSession);
  pendingSignupSessions.set(session.token, session);
  await sendSignupVerificationCodeEmail({
    fullName: session.fullName,
    email: session.email,
    verificationCode: session.verificationCode,
  });

  return buildSignupVerificationResponse(
    session,
    `Mã xác nhận đã được gửi tới ${maskEmailAddress(session.email)}. Vui lòng kiểm tra email để hoàn tất đăng ký.`,
  );
}

export async function verifySignupVerificationCode(payload = {}) {
  const { signupToken, verificationCode } = parseSignupVerificationConfirmPayload(payload);
  const session = getPendingSignupSessionOrThrow(signupToken);

  if (session.verificationCode !== verificationCode) {
    const remainingAttempts = Number(session.verifyAttemptsRemaining ?? signupOtpMaxVerifyAttempts) - 1;

    if (remainingAttempts <= 0) {
      pendingSignupSessions.delete(session.token);
      throw createHttpError(429, 'Bạn đã nhập sai mã xác nhận quá nhiều lần. Vui lòng đăng ký lại.');
    }

    pendingSignupSessions.set(session.token, {
      ...session,
      verifyAttemptsRemaining: remainingAttempts,
    });

    throw createHttpError(400, `Mã xác nhận không đúng. Bạn còn ${remainingAttempts} lần thử.`, {
      remainingAttempts,
    });
  }

  const existingAccount = await findAccountByEmail(session.email);

  if (existingAccount) {
    pendingSignupSessions.delete(session.token);
    throw createHttpError(409, 'Email này đã được đăng ký. Vui lòng đăng nhập.');
  }

  let createdAccount = null;

  try {
    createdAccount = await createCustomerAccount({
      fullName: session.fullName,
      email: session.email,
      password: session.password,
      preferredUsername: session.email,
    });
  } catch (error) {
    if (isSqlUniqueConstraintError(error)) {
      pendingSignupSessions.delete(session.token);
      throw createHttpError(409, 'Email này đã được đăng ký. Vui lòng đăng nhập.');
    }

    throw error;
  }

  pendingSignupSessions.delete(session.token);

  if (!createdAccount) {
    throw createHttpError(500, 'Không thể tạo tài khoản mới lúc này.');
  }

  return {
    success: true,
    message: 'Đăng ký tài khoản thành công.',
    provider: 'password',
    user: mapAccountRowToAuthUser(createdAccount),
  };
}

export async function requestForgotPasswordCode(payload = {}) {
  cleanupExpiredPasswordResetSessions();
  const requestPayload = parseForgotPasswordRequestPayload(payload);

  if (requestPayload.resetToken) {
    const session = getPendingPasswordResetSessionOrThrow(requestPayload.resetToken);
    const resendAfterSeconds = getRemainingSeconds(session.resendAvailableAtMs);

    if (resendAfterSeconds > 0) {
      throw createHttpError(
        429,
        `Mã OTP đã được gửi trước đó. Vui lòng chờ ${resendAfterSeconds}s để gửi lại.`,
        {
          resetToken: session.token,
          retryAfterSeconds: resendAfterSeconds,
          maskedEmail: maskEmailAddress(session.email),
        },
      );
    }

    const refreshedSession = createOrRefreshPasswordResetSession(
      {
        accountId: session.accountId,
        fullName: session.fullName,
        email: session.email,
      },
      session,
    );

    pendingPasswordResetSessions.set(refreshedSession.token, refreshedSession);
    await sendPasswordResetCodeEmail({
      fullName: refreshedSession.fullName,
      email: refreshedSession.email,
      verificationCode: refreshedSession.verificationCode,
    });

    return buildForgotPasswordResponse(
      refreshedSession,
      `Đã gửi lại mã OTP tới ${maskEmailAddress(refreshedSession.email)}.`,
    );
  }

  const accountRow = await findAccountByEmail(requestPayload.email);

  if (!accountRow) {
    throw createHttpError(404, 'Email này chưa được đăng ký. Vui lòng kiểm tra lại.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  const sameEmailSession = findPendingPasswordResetSessionByEmail(accountRow.Email);

  if (sameEmailSession) {
    const resendAfterSeconds = getRemainingSeconds(sameEmailSession.resendAvailableAtMs);

    if (resendAfterSeconds > 0) {
      throw createHttpError(
        429,
        `Mã OTP đã được gửi trước đó. Vui lòng chờ ${resendAfterSeconds}s để gửi lại.`,
        {
          resetToken: sameEmailSession.token,
          retryAfterSeconds: resendAfterSeconds,
          maskedEmail: maskEmailAddress(sameEmailSession.email),
        },
      );
    }
  }

  const session = createOrRefreshPasswordResetSession(
    {
      accountId: accountRow.MaTK,
      fullName: accountRow.Ten,
      email: String(accountRow.Email ?? '').trim().toLowerCase(),
    },
    sameEmailSession,
  );

  pendingPasswordResetSessions.set(session.token, session);
  await sendPasswordResetCodeEmail({
    fullName: session.fullName,
    email: session.email,
    verificationCode: session.verificationCode,
  });

  return buildForgotPasswordResponse(
    session,
    `Mã OTP đã được gửi tới ${maskEmailAddress(session.email)}. Vui lòng kiểm tra email để tiếp tục.`,
  );
}

export async function verifyForgotPasswordCode(payload = {}) {
  const { resetToken, verificationCode } = parseForgotPasswordVerifyPayload(payload);
  const session = getPendingPasswordResetSessionOrThrow(resetToken);

  if (session.verificationCode !== verificationCode) {
    const remainingAttempts = Number(session.verifyAttemptsRemaining ?? signupOtpMaxVerifyAttempts) - 1;

    if (remainingAttempts <= 0) {
      pendingPasswordResetSessions.delete(session.token);
      throw createHttpError(429, 'Bạn đã nhập sai mã OTP quá nhiều lần. Vui lòng yêu cầu mã mới.');
    }

    pendingPasswordResetSessions.set(session.token, {
      ...session,
      verifyAttemptsRemaining: remainingAttempts,
    });

    throw createHttpError(400, `Mã OTP không đúng. Bạn còn ${remainingAttempts} lần thử.`, {
      remainingAttempts,
    });
  }

  const accountRow = await findAccountForPasswordChange({
    identifier: session.email,
    accountId: session.accountId,
  });

  if (!accountRow) {
    pendingPasswordResetSessions.delete(session.token);
    throw createHttpError(404, 'Không tìm thấy tài khoản cho email này.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    pendingPasswordResetSessions.delete(session.token);
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  const passwordResetToken = createPasswordResetTicket(accountRow.MaTK);
  pendingPasswordResetSessions.delete(session.token);

  if (!passwordResetToken) {
    throw createHttpError(500, 'Không thể khởi tạo phiên đặt lại mật khẩu lúc này.');
  }

  return {
    success: true,
    message: 'Xác thực email thành công. Vui lòng đặt mật khẩu mới.',
    maskedEmail: maskEmailAddress(accountRow.Email),
    passwordResetToken,
    passwordTokenExpiresInSeconds: getRemainingSeconds(Date.now() + googlePasswordTicketExpiresMs),
  };
}

export async function signupWithCredentials(payload = {}) {
  const signupPayload = parseSignupPayload(payload);
  const existingAccount = await findAccountByEmail(signupPayload.email);

  if (existingAccount) {
    throw createHttpError(409, 'Email này đã được đăng ký. Vui lòng dùng email khác.');
  }

  await validateRealEmailAddress(signupPayload.email);

  let createdAccount = null;

  try {
    createdAccount = await createCustomerAccount({
      ...signupPayload,
      preferredUsername: signupPayload.email,
    });
  } catch (error) {
    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Email này đã được đăng ký. Vui lòng dùng email khác.');
    }

    throw error;
  }

  if (!createdAccount) {
    throw createHttpError(500, 'Không thể tạo tài khoản mới lúc này.');
  }

  return {
    success: true,
    message: 'Đăng ký tài khoản thành công.',
    provider: 'password',
    user: mapAccountRowToAuthUser(createdAccount),
  };
}

export async function loginWithGoogle(payload = {}) {
  const tokenPayload = await verifyGoogleCredential(payload);
  const { accountRow, accountCreated } = await resolveGoogleAccount(tokenPayload, { allowCreateIfMissing: true });

  return buildGoogleAuthResult(accountRow, {
    entryPoint: 'login',
    accountCreated,
  });
}

export async function signupWithGoogle(payload = {}) {
  const tokenPayload = await verifyGoogleCredential(payload);
  const { accountRow, accountCreated } = await resolveGoogleAccount(tokenPayload, { allowCreateIfMissing: true });

  return buildGoogleAuthResult(accountRow, {
    entryPoint: 'signup',
    accountCreated,
  });
}

export async function loginWithCredentials(payload = {}) {
  const { identifier, password } = parseCredentialsPayload(payload);
  const accountRow = await findAccountByIdentifier(identifier);
  const lockKey = buildAccountLockKey(identifier, accountRow);
  const activeLock = getActiveLockState(lockKey);

  if (activeLock) {
    throw createHttpError(
      423,
      `Tài khoản đang bị khóa tạm. Vui lòng thử lại sau ${activeLock.remainingSeconds}s.`,
      { lockout: activeLock },
    );
  }

  const passwordMatched = accountRow && String(accountRow.MatKhau ?? '') === password;

  if (!passwordMatched) {
    const failedState = markFailedLogin(lockKey);

    if (failedState.lockSeconds > 0) {
      throw createHttpError(
        423,
        `Đăng nhập sai ${failedState.failedAttempts} lần. Tài khoản bị khóa tạm ${failedState.lockSeconds}s.`,
        { lockout: failedState },
      );
    }

    throw createHttpError(401, 'Tài khoản hoặc mật khẩu không đúng.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    throw createHttpError(403, lockedAccountSupportMessage);
  }

  clearFailedLoginState(lockKey);

  return {
    success: true,
    message: 'Đăng nhập thành công.',
    welcomeMessage: 'chào mừng bạn đến với website SmartRide',
    provider: 'password',
    user: mapAccountRowToAuthUser(accountRow),
  };
}

export async function changePassword(payload = {}) {
  const { identifier, accountId, bootstrapToken, passwordResetToken, currentPassword, newPassword } =
    parseChangePasswordPayload(payload);
  let resolvedAccountId = accountId;
  let matchedCurrentPassword = currentPassword;
  let accountRow = null;
  let skipCurrentPasswordValidation = false;

  if (bootstrapToken) {
    const passwordTicket = getGooglePasswordChangeTicket(bootstrapToken);

    if (!passwordTicket) {
      throw createHttpError(401, 'Phiên đổi mật khẩu Google đã hết hạn. Vui lòng đăng nhập Google lại.');
    }

    resolvedAccountId = resolvedAccountId || passwordTicket.accountId;
    accountRow = await findAccountForPasswordChange({ identifier, accountId: resolvedAccountId });

    if (!accountRow) {
      throw createHttpError(404, 'Không tìm thấy tài khoản để đổi mật khẩu.');
    }

    if (String(accountRow.MaTK ?? '').trim().toLowerCase() !== String(passwordTicket.accountId ?? '').trim().toLowerCase()) {
      throw createHttpError(403, 'Phiên đổi mật khẩu Google không khớp với tài khoản hiện tại.');
    }

    matchedCurrentPassword = String(passwordTicket.currentPassword ?? '').trim();

    if (!matchedCurrentPassword) {
      consumeGooglePasswordChangeTicket(bootstrapToken);
      throw createHttpError(401, 'Phiên đổi mật khẩu Google không hợp lệ. Vui lòng đăng nhập Google lại.');
    }
  } else if (passwordResetToken) {
    const resetTicket = getPasswordResetTicket(passwordResetToken);

    if (!resetTicket) {
      throw createHttpError(401, 'Phiên đặt lại mật khẩu đã hết hạn. Vui lòng xác thực email lại.');
    }

    resolvedAccountId = resolvedAccountId || resetTicket.accountId;
    accountRow = await findAccountForPasswordChange({ identifier, accountId: resolvedAccountId });

    if (!accountRow) {
      consumePasswordResetTicket(passwordResetToken);
      throw createHttpError(404, 'Không tìm thấy tài khoản để đổi mật khẩu.');
    }

    if (String(accountRow.MaTK ?? '').trim().toLowerCase() !== String(resetTicket.accountId ?? '').trim().toLowerCase()) {
      consumePasswordResetTicket(passwordResetToken);
      throw createHttpError(403, 'Phiên đặt lại mật khẩu không khớp với tài khoản hiện tại.');
    }

    skipCurrentPasswordValidation = true;
  } else {
    accountRow = await findAccountForPasswordChange({ identifier, accountId: resolvedAccountId });
  }

  if (!accountRow) {
    throw createHttpError(404, 'Không tìm thấy tài khoản để đổi mật khẩu.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  if (!skipCurrentPasswordValidation && String(accountRow.MatKhau ?? '') !== matchedCurrentPassword) {
    if (bootstrapToken) {
      consumeGooglePasswordChangeTicket(bootstrapToken);
      throw createHttpError(401, 'Phiên đổi mật khẩu Google đã hết hiệu lực. Vui lòng đăng nhập Google lại.');
    }

    throw createHttpError(401, 'Mật khẩu cũ không đúng.');
  }

  await updateAccountPassword(accountRow.MaTK, newPassword);
  clearGooglePasswordChangeTicketsForAccount(accountRow.MaTK);
  clearPasswordResetTicketsForAccount(accountRow.MaTK);

  const lockKeySeed = identifier || accountRow.Email || accountRow.TaiKhoan || String(accountRow.MaTK);
  clearFailedLoginState(buildAccountLockKey(lockKeySeed, accountRow));

  return {
    success: true,
    message: 'Đổi mật khẩu thành công.',
  };
}

export async function getProfile(payload = {}) {
  const resolver = parseAccountResolverPayload(payload);
  const accountRow = await findAccountForProfile(resolver);

  if (!accountRow) {
    throw createHttpError(404, 'Không tìm thấy thông tin người dùng.');
  }

  return {
    success: true,
    message: 'Lấy thông tin cá nhân thành công.',
    profile: mapAccountRowToProfile(accountRow),
  };
}

export async function listAccounts() {
  const pool = await getSqlServerPool();
  const queryResult = await pool.request().query(`
    SELECT
      tk.MaTK,
      tk.TaiKhoan,
      tk.Ten,
      tk.Email,
      tk.SDT,
      tk.DiaChi,
      tk.Avatar,
      tk.NgaySinh,
      tk.GioiTinh,
      tk.MaQuyen,
      tk.TrangThai,
      tx.TrangThai AS DriverTrangThai,
      tx.MaNH AS DriverBankId
    FROM TaiKhoan tk
    LEFT JOIN TaiXe tx ON tx.MaTK = tk.MaTK
    ORDER BY
      COALESCE(NULLIF(LTRIM(RTRIM(tk.Ten)), ''), NULLIF(LTRIM(RTRIM(tk.TaiKhoan)), ''), tk.MaTK)
  `);

  return {
    success: true,
    message: 'Lấy danh sách tài khoản thành công.',
    accounts: (queryResult.recordset ?? []).map(mapAccountRowToDirectoryUser),
  };
}

export async function getAccountDetails(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    throw createHttpError(400, 'Thiếu mã tài khoản cần xem chi tiết.');
  }

  const accountRow = await findAccountForManagement(normalizedAccountId);

  if (!accountRow) {
    throw createHttpError(404, 'Không tìm thấy tài khoản cần xem chi tiết.');
  }

  return {
    success: true,
    message: 'Lấy chi tiết tài khoản thành công.',
    account: mapAccountRowToDirectoryUser(accountRow),
  };
}

export async function createAccount(payload = {}) {
  return createManagementAccount(payload);
}

export async function updateAccount(accountId, payload = {}, uploadedFile = null) {
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    throw createHttpError(400, 'Thiếu mã tài khoản cần cập nhật.');
  }

  const accountRow = await findAccountForManagement(normalizedAccountId);

  if (!accountRow) {
    throw createHttpError(404, 'Không tìm thấy tài khoản cần cập nhật.');
  }

  const accountPayload = parseManagementAccountPayload(
    {
      ...payload,
      ...(uploadedFile ? { avatar: `/uploads/avatars/${uploadedFile.filename}` } : {}),
    },
    accountRow,
  );
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    await updateAccountManagementById(normalizedAccountId, accountPayload, transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => {});

    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Email hoặc số điện thoại đã tồn tại. Vui lòng kiểm tra lại.');
    }

    throw error;
  }

  const updatedAccount = await findAccountForManagement(normalizedAccountId);

  return {
    success: true,
    message: 'Cập nhật tài khoản thành công.',
    account: mapAccountRowToDirectoryUser(updatedAccount),
  };
}

export async function deleteAccount(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    throw createHttpError(400, 'Thiếu mã tài khoản cần xóa.');
  }

  await deleteAccountById(normalizedAccountId);

  return {
    success: true,
    message: 'Xóa tài khoản thành công.',
  };
}

export async function lockAccount(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    throw createHttpError(400, 'Thiếu mã tài khoản cần khóa.');
  }

  const accountRow = await lockAccountById(normalizedAccountId, driverLockedStatus);

  return {
    success: true,
    message: 'Đã khóa tài khoản. Tài khoản sẽ không đăng nhập được cho tới khi admin mở khóa.',
    account: mapAccountRowToDirectoryUser({
      ...accountRow,
      TrangThai: driverLockedStatus,
    }),
  };
}

export async function unlockAccount(accountId) {
  const normalizedAccountId = String(accountId ?? '').trim();

  if (!normalizedAccountId) {
    throw createHttpError(400, 'Thiếu mã tài khoản cần mở khóa.');
  }

  const accountRow = await lockAccountById(normalizedAccountId, activeAccountStatus);

  return {
    success: true,
    message: 'Đã mở khóa tài khoản. Tài khoản có thể đăng nhập lại.',
    account: mapAccountRowToDirectoryUser({
      ...accountRow,
      TrangThai: activeAccountStatus,
    }),
  };
}

export async function updateProfile(payload = {}) {
  const profilePayload = parseProfileUpdatePayload(payload);
  const currentAccount = await findAccountForProfile(profilePayload);

  if (!currentAccount) {
    throw createHttpError(404, 'Không tìm thấy thông tin người dùng để cập nhật.');
  }

  if (isInactiveAccount(currentAccount.TrangThai)) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  try {
    await updateAccountProfileById(currentAccount.MaTK, profilePayload);
  } catch (error) {
    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Email hoặc số điện thoại đã tồn tại. Vui lòng kiểm tra lại.');
    }

    const sqlErrorMessage = String(error?.message ?? '').toLowerCase();

    if (error?.number === 547 && sqlErrorMessage.includes('gioitinh')) {
      const fallbackGender =
        profilePayload.gender === 'Nu'
          ? 'Nữ'
          : profilePayload.gender === 'Khac'
            ? 'Khác'
            : profilePayload.gender;

      if (fallbackGender && fallbackGender !== profilePayload.gender) {
        try {
          await updateAccountProfileById(currentAccount.MaTK, {
            ...profilePayload,
            gender: fallbackGender,
          });
        } catch {
          throw createHttpError(400, 'Giới tính không hợp lệ. Chỉ chấp nhận Nam, Nữ hoặc Khác.');
        }
      } else {
        throw createHttpError(400, 'Giới tính không hợp lệ. Chỉ chấp nhận Nam, Nữ hoặc Khác.');
      }
    } else {
      throw error;
    }
  }

  const updatedAccount = await findAccountForProfile({ accountId: currentAccount.MaTK, identifier: '' });

  return {
    success: true,
    message: 'Cập nhật thông tin cá nhân thành công.',
    profile: mapAccountRowToProfile(updatedAccount),
  };
}

export async function updateProfileAvatar(payload = {}, uploadedFile = null) {
  if (!uploadedFile) {
    throw createHttpError(400, 'Vui lòng chọn ảnh đại diện để tải lên.');
  }

  const resolver = parseAccountResolverPayload(payload);
  const accountRow = await findAccountForProfile(resolver);

  if (!accountRow) {
    throw createHttpError(404, 'Không tìm thấy người dùng để cập nhật ảnh đại diện.');
  }

  if (isInactiveAccount(accountRow.TrangThai)) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Vui lòng liên hệ quản trị viên.');
  }

  const avatarPath = `/uploads/avatars/${uploadedFile.filename}`;
  await updateAvatarByAccountId(accountRow.MaTK, avatarPath);
  const updatedAccount = await findAccountForProfile({ accountId: accountRow.MaTK, identifier: '' });

  return {
    success: true,
    message: 'Cập nhật ảnh đại diện thành công.',
    avatarUrl: avatarPath,
    profile: mapAccountRowToProfile(updatedAccount),
  };
}
