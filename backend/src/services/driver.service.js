import sql from 'mssql';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { getSqlServerPool } from './database.service.js';

const driverRoleCode = 'Q3';
const customerRoleCode = 'Q2';
const accountActiveStatus = 'HoatDong';
const accountLockedStatus = 'Khoa';
const driverPendingStatus = 'ChoDuyet';
const driverCompletedStatus = 'HoatDong';
const driverLockedStatus = 'Khoa';
const driverFilterStatuses = new Set(['all', 'active', 'locked', 'pending']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const phoneNumberPattern = /^\d{8,15}$/;
const cccdPattern = /^\d{12}$/;
const vehicleLicensePlatePattern = /^\d{2}[A-Z]{1,2}-\d{3,5}(?:\.\d{2})?$/i;
const emergencyContactSeparator = '||';
const driverWalletTransactionTypes = new Set(['topup', 'transfer', 'receive', 'adjustment']);
const vehicleChangeRequestStatuses = new Set(['pending', 'approved', 'rejected']);
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

  if (driverWalletTransactionTypes.has(normalizedValue)) {
    return normalizedValue;
  }

  return fallbackValue;
}

function normalizeVehicleChangeRequestStatus(value, fallbackValue = 'pending') {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (vehicleChangeRequestStatuses.has(normalizedValue)) {
    return normalizedValue;
  }

  return fallbackValue;
}

function mapWalletTransactionRow(row = {}) {
  const amount = normalizeCurrencyAmount(row.SoTien);

  return {
    id: Number(row.MaGD ?? 0) || 0,
    driverId: normalizeText(row.MaTK),
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

function mapVehicleChangeRequestRow(row = {}) {
  return {
    id: Number(row.MaYC ?? 0) || 0,
    driverId: normalizeText(row.MaTK),
    oldVehicleName: normalizeText(row.LoaiXeCu),
    oldLicensePlate: normalizeText(row.BienSoCu),
    newVehicleName: normalizeText(row.LoaiXeMoi),
    newLicensePlate: normalizeText(row.BienSoMoi),
    status: normalizeVehicleChangeRequestStatus(row.TrangThai),
    rejectReason: normalizeText(row.GhiChuTuChoi),
    approvedByAccountId: normalizeText(row.NguoiDuyetMaTK),
    driverSeen: Boolean(row.TaiXeDaXem),
    createdAt: row.NgayTao ?? null,
    updatedAt: row.NgayCapNhat ?? null,
    resolvedAt: row.NgayXuLy ?? null,
    notifiedAt: row.NgayThongBaoTaiXe ?? null,
    driverName: normalizeText(row.Ten),
    driverPhone: normalizeText(row.SDT),
    driverEmail: normalizeText(row.Email),
  };
}

function normalizeSearchKeyword(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDriverFilterStatus(value) {
  const normalizedStatus = normalizeText(value || 'all').toLowerCase();

  if (!driverFilterStatuses.has(normalizedStatus)) {
    throw createHttpError(400, 'Bộ lọc trạng thái tài xế không hợp lệ.');
  }

  return normalizedStatus;
}

function removeVietnameseDiacritics(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSmtpFromAddress() {
  const fromEmail = normalizeText(env.smtpFromEmail);
  const fromName = normalizeText(env.smtpFromName);

  if (!fromEmail) {
    throw createHttpError(500, 'Hệ thống chưa cấu hình SMTP_FROM_EMAIL để gửi email duyệt tài xế.');
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

  const smtpHost = normalizeText(env.smtpHost);
  const smtpPort = Number(env.smtpPort ?? 0);

  if (!smtpHost || !Number.isFinite(smtpPort) || smtpPort <= 0) {
    throw createHttpError(500, 'Hệ thống chưa cấu hình SMTP_HOST/SMTP_PORT để gửi email duyệt tài xế.');
  }

  const smtpUser = normalizeText(env.smtpUser);
  const smtpPassword = normalizeText(env.smtpPassword);

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

async function sendDriverApprovalEmail({ fullName, email }) {
  const receiverEmail = normalizeText(email).toLowerCase();

  if (!receiverEmail || !emailPattern.test(receiverEmail)) {
    return false;
  }

  const transporter = getSmtpTransporter();
  const receiverName = normalizeText(fullName) || 'ban';
  const escapedReceiverName = escapeHtml(receiverName);

  try {
    await transporter.sendMail({
      from: getSmtpFromAddress(),
      to: receiverEmail,
      subject: 'SmartRide - Ho so tai xe da duoc duyet',
      text: [
        `Xin chao ${receiverName},`,
        '',
        'Ho so dang ky tai xe SmartRide cua ban da duoc duyet.',
        'Ban co the dang nhap ung dung de tiep tuc cac buoc kich hoat va nhan cuoc xe.',
        '',
        'Cam on ban da dong hanh cung SmartRide.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <p>Xin chao <strong>${escapedReceiverName}</strong>,</p>
          <p>Ho so dang ky tai xe SmartRide cua ban da duoc duyet.</p>
          <p>Ban co the dang nhap ung dung de tiep tuc cac buoc kich hoat va nhan cuoc xe.</p>
          <p>Cam on ban da dong hanh cung SmartRide.</p>
        </div>
      `,
    });
  } catch {
    throw createHttpError(502, 'Không thể gửi email thông báo duyệt tài xế lúc này.');
  }

  return true;
}

function safeJsonParse(rawValue, fallbackValue = {}) {
  if (!rawValue) {
    return fallbackValue;
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  const normalizedRawValue = String(rawValue).trim();

  if (!normalizedRawValue) {
    return fallbackValue;
  }

  try {
    const parsedValue = JSON.parse(normalizedRawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function parseEmergencyContact(rawValue = null) {
  const emptyContact = {
    relationship: '',
    fullName: '',
    phone: '',
    address: '',
  };

  if (rawValue === null || rawValue === undefined) {
    return emptyContact;
  }

  if (Array.isArray(rawValue)) {
    const [relationship, fullName, phone, ...addressParts] = rawValue;
    return {
      relationship: normalizeText(relationship),
      fullName: normalizeText(fullName),
      phone: normalizeText(phone),
      address: normalizeText(addressParts.join(emergencyContactSeparator)),
    };
  }

  if (typeof rawValue === 'object') {
    return {
      relationship: normalizeText(rawValue.relationship ?? rawValue.quanHe),
      fullName: normalizeText(rawValue.fullName ?? rawValue.hoVaTen),
      phone: normalizeText(rawValue.phone ?? rawValue.sdt),
      address: normalizeText(rawValue.address ?? rawValue.diaChi),
    };
  }

  const normalizedRawValue = String(rawValue).trim();

  if (!normalizedRawValue) {
    return emptyContact;
  }

  try {
    const parsedJsonValue = JSON.parse(normalizedRawValue);
    return parseEmergencyContact(parsedJsonValue);
  } catch {
    // Continue with delimiter-based fallback.
  }

  const contactParts = normalizedRawValue.split(emergencyContactSeparator).map((item) => normalizeText(item));

  if (contactParts.length >= 4) {
    const [relationship, fullName, phone, ...addressParts] = contactParts;
    return {
      relationship,
      fullName,
      phone,
      address: normalizeText(addressParts.join(emergencyContactSeparator)),
    };
  }

  return {
    relationship: normalizedRawValue,
    fullName: '',
    phone: '',
    address: '',
  };
}

function packEmergencyContact(rawValue = {}) {
  const normalizedContact = parseEmergencyContact(rawValue);
  return JSON.stringify([
    normalizedContact.relationship,
    normalizedContact.fullName,
    normalizedContact.phone,
    normalizedContact.address,
  ]);
}

function buildDriverEmailFromPhone(phone) {
  const numericPhone = normalizeText(phone).replace(/\D/g, '') || String(Date.now()).slice(-8);
  return `taixe-${numericPhone}@smartride.local`.toLowerCase();
}

function normalizeDriverAssetPath(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(normalizedValue) || normalizedValue.startsWith('data:')) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith('/')) {
    return normalizedValue;
  }

  return `/${normalizedValue.replace(/^\/+/, '')}`;
}

function parseDriverDocumentImages(rawValue = null) {
  const emptyImages = {
    front: '',
    back: '',
  };

  if (rawValue === null || rawValue === undefined) {
    return emptyImages;
  }

  if (typeof rawValue === 'string') {
    return {
      front: normalizeDriverAssetPath(rawValue),
      back: '',
    };
  }

  if (Array.isArray(rawValue)) {
    return {
      front: normalizeDriverAssetPath(rawValue[0]),
      back: normalizeDriverAssetPath(rawValue[1]),
    };
  }

  if (typeof rawValue !== 'object') {
    return emptyImages;
  }

  return {
    front: normalizeDriverAssetPath(rawValue.front ?? rawValue.matTruoc ?? rawValue.image ?? rawValue.anhTruoc),
    back: normalizeDriverAssetPath(rawValue.back ?? rawValue.matSau ?? rawValue.anhSau),
  };
}

function parseDriverVehicleImages(rawVehicleInfo = {}) {
  if (!rawVehicleInfo || typeof rawVehicleInfo !== 'object') {
    return {
      front: '',
      side: '',
      rear: '',
    };
  }

  const rawVehicleImages = rawVehicleInfo.images ?? rawVehicleInfo.vehicleImages ?? rawVehicleInfo.hinhAnhXe ?? {};
  const registrationImage = normalizeDriverAssetPath(
    rawVehicleInfo.registrationImage
    ?? rawVehicleInfo.giayDangKyXe
    ?? rawVehicleInfo.giayToXe
    ?? rawVehicleInfo.sideImage,
  );

  return {
    front: normalizeDriverAssetPath(
      rawVehicleImages.front ?? rawVehicleInfo.frontImage ?? rawVehicleInfo.hinhTruoc ?? rawVehicleInfo.vehicleFrontImage,
    ),
    side: normalizeDriverAssetPath(
      rawVehicleImages.side
      ?? registrationImage
      ?? rawVehicleInfo.sideImage
      ?? rawVehicleInfo.image
      ?? rawVehicleInfo.vehicleImage
      ?? rawVehicleInfo.hinhXe
      ?? rawVehicleInfo.vehicleSideImage,
    ),
    rear: normalizeDriverAssetPath(
      rawVehicleImages.rear ?? rawVehicleInfo.rearImage ?? rawVehicleInfo.hinhSau ?? rawVehicleInfo.vehicleRearImage,
    ),
  };
}

function normalizeVehicleType(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) {
    return '';
  }

  if (['motorbike', 'xe may', 'xemay', 'bike', 'motor'].includes(normalizedValue)) {
    return 'motorbike';
  }

  if (['car', 'oto', 'o to', 'xe hoi', 'xe 4 cho', 'xe4cho'].includes(normalizedValue)) {
    return 'car';
  }

  if (['intercity', 'lien tinh', 'xe lien tinh', 'xelientinh'].includes(normalizedValue)) {
    return 'intercity';
  }

  return normalizedValue;
}

function parseVehicleInfoString(rawValue) {
  const normalizedRawValue = normalizeText(rawValue);

  if (!normalizedRawValue) {
    return {};
  }

  const splitParts = normalizedRawValue.split('|').map((item) => normalizeText(item));

  if (splitParts.length >= 2) {
    return {
      licensePlate: splitParts[0],
      vehicleType: splitParts[1],
      name: splitParts[2] || splitParts[1],
    };
  }

  return {
    name: normalizedRawValue,
  };
}

function normalizeDriverVehicleInfo(rawVehicleInfo = {}) {
  let parsedVehicleInfo = {};

  if (typeof rawVehicleInfo === 'string') {
    const normalizedRawValue = normalizeText(rawVehicleInfo);

    if (normalizedRawValue) {
      try {
        const parsedJsonValue = JSON.parse(normalizedRawValue);
        parsedVehicleInfo = parsedJsonValue && typeof parsedJsonValue === 'object'
          ? parsedJsonValue
          : parseVehicleInfoString(normalizedRawValue);
      } catch {
        parsedVehicleInfo = parseVehicleInfoString(normalizedRawValue);
      }
    }
  } else if (rawVehicleInfo && typeof rawVehicleInfo === 'object') {
    parsedVehicleInfo = rawVehicleInfo;
  }

  const normalizedVehicleImages = parseDriverVehicleImages(parsedVehicleInfo);
  const normalizedIdentityImages = parseDriverDocumentImages(parsedVehicleInfo.identityImages ?? parsedVehicleInfo.cccdImages);
  const normalizedLicenseImages = parseDriverDocumentImages(parsedVehicleInfo.licenseImages ?? parsedVehicleInfo.bangLaiImages);
  const normalizedVehicleType = normalizeVehicleType(
    parsedVehicleInfo.vehicleType
    ?? parsedVehicleInfo.type
    ?? parsedVehicleInfo.loaiXe
    ?? parsedVehicleInfo.vehicleCategory,
  );
  const normalizedVehicleName = normalizeText(
    parsedVehicleInfo.name
    ?? parsedVehicleInfo.vehicleName
    ?? parsedVehicleInfo.tenXe
    ?? parsedVehicleInfo.loaiXe,
  ) || normalizedVehicleType;
  const normalizedLicensePlate = normalizeText(
    parsedVehicleInfo.licensePlate ?? parsedVehicleInfo.bienSoXe,
  ).toUpperCase();
  const normalizedRegistrationImage =
    normalizeDriverAssetPath(
      parsedVehicleInfo.registrationImage
      ?? parsedVehicleInfo.giayDangKyXe
      ?? parsedVehicleInfo.giayToXe,
    ) || normalizedVehicleImages.side;

  return {
    image:
      normalizeDriverAssetPath(parsedVehicleInfo.image ?? parsedVehicleInfo.vehicleImage ?? parsedVehicleInfo.hinhXe)
      || normalizedVehicleImages.side
      || normalizedVehicleImages.front
      || normalizedVehicleImages.rear,
    licensePlate: normalizedLicensePlate,
    bienSoXe: normalizedLicensePlate,
    name: normalizedVehicleName,
    vehicleName: normalizedVehicleName,
    vehicleType: normalizedVehicleType,
    brand: normalizeText(parsedVehicleInfo.brand ?? parsedVehicleInfo.hangXe),
    model: normalizeText(parsedVehicleInfo.model ?? parsedVehicleInfo.dongXe),
    color: normalizeText(parsedVehicleInfo.color ?? parsedVehicleInfo.mauXe),
    year: normalizeText(parsedVehicleInfo.year ?? parsedVehicleInfo.namSanXuat),
    seatCount: normalizeText(parsedVehicleInfo.seatCount ?? parsedVehicleInfo.soCho),
    registrationImage: normalizedRegistrationImage,
    giayDangKyXe: normalizedRegistrationImage,
    images: normalizedVehicleImages,
    identityImages: {
      front: normalizedIdentityImages.front,
      back: normalizedIdentityImages.back,
    },
    licenseImages: {
      front: normalizedLicenseImages.front,
      back: normalizedLicenseImages.back,
    },
  };
}

function getDriverState(accountStatus, driverStatus) {
  const normalizedAccountStatus = normalizeText(accountStatus).toLowerCase();
  const normalizedDriverStatus = normalizeText(driverStatus).toLowerCase();

  if (
    normalizedAccountStatus === accountLockedStatus.toLowerCase() ||
    normalizedDriverStatus === driverLockedStatus.toLowerCase()
  ) {
    return 'locked';
  }

  if (normalizedDriverStatus === driverPendingStatus.toLowerCase()) {
    return 'pending';
  }

  return 'active';
}

function mapDriverRowToResponse(row = {}) {
  const vehicleInfo = normalizeDriverVehicleInfo(row.ThongTinXe);
  const emergencyContact = parseEmergencyContact(row.LienHeKC);
  const driverState = getDriverState(row.TrangThaiTaiKhoan, row.TrangThaiTaiXe);
  const storedLicenseImagesFromColumn = parseDriverDocumentImages(safeJsonParse(row.BangLai, row.BangLai));

  const normalizedIdentityImages = {
    front: normalizeDriverAssetPath(vehicleInfo.identityImages.front),
    back: normalizeDriverAssetPath(vehicleInfo.identityImages.back),
  };

  const normalizedLicenseImages = {
    front: normalizeDriverAssetPath(vehicleInfo.licenseImages.front) || storedLicenseImagesFromColumn.front,
    back: normalizeDriverAssetPath(vehicleInfo.licenseImages.back) || storedLicenseImagesFromColumn.back,
  };

  const normalizedVehicleImages = {
    front: normalizeDriverAssetPath(vehicleInfo.images.front),
    side: normalizeDriverAssetPath(vehicleInfo.images.side),
    rear: normalizeDriverAssetPath(vehicleInfo.images.rear),
  };

  const normalizedVehicleInfo = {
    ...vehicleInfo,
    image:
      normalizeDriverAssetPath(vehicleInfo.image) ||
      normalizedVehicleImages.side ||
      normalizedVehicleImages.front ||
      normalizedVehicleImages.rear,
    licensePlate: normalizeText(vehicleInfo.licensePlate).toUpperCase(),
    name: normalizeText(vehicleInfo.name) || normalizeText(vehicleInfo.vehicleType),
    vehicleType: normalizeVehicleType(vehicleInfo.vehicleType),
    images: normalizedVehicleImages,
    identityImages: normalizedIdentityImages,
    licenseImages: normalizedLicenseImages,
  };

  const normalizedEmergencyContact = {
    relationship: normalizeText(emergencyContact.relationship),
    fullName: normalizeText(emergencyContact.fullName),
    phone: normalizeText(emergencyContact.phone),
    address: normalizeText(emergencyContact.address),
  };

  return {
    id: normalizeText(row.MaTK),
    roleCode: normalizeText(row.MaQuyen),
    name: normalizeText(row.Ten),
    phone: normalizeText(row.SDT),
    email: normalizeText(row.Email),
    username: normalizeText(row.TaiKhoan),
    birthDate: row.NgaySinh ?? null,
    gender: normalizeText(row.GioiTinh),
    avatar: normalizeDriverAssetPath(row.AvatarTaiXe || row.AvatarTaiKhoan),
    address: normalizeText(row.DiaChiTaiXe || row.DiaChiTaiKhoan),
    cccd: normalizeText(row.CCCD),
    licenseImage: normalizedLicenseImages.front,
    backgroundImage: normalizeDriverAssetPath(row.LyLich),
    identityImages: normalizedIdentityImages,
    licenseImages: normalizedLicenseImages,
    status: driverState,
    accountStatus: normalizeText(row.TrangThaiTaiKhoan),
    driverStatus: normalizeText(row.TrangThaiTaiXe),
    bank: {
      id: normalizeText(row.MaNH),
      accountHolder: normalizeText(row.HoVaTenNganHang),
      accountNumber: normalizeText(row.STK),
      bankName: normalizeText(row.TenNganHang),
    },
    vehicleInfo: normalizedVehicleInfo,
    vehicleImages: normalizedVehicleImages,
    vehicleType: normalizedVehicleInfo.vehicleType,
    emergencyContact: normalizedEmergencyContact,
    licensePlate: normalizedVehicleInfo.licensePlate,
    createdAt: row.NgayTaoTaiXe ?? null,
    updatedAt: row.NgayCapNhatTaiXe ?? null,
  };
}

function parseDriverPayload(payload = {}, { forUpdate = false } = {}) {
  const fullName = normalizeText(payload.fullName ?? payload.name);
  const phone = normalizeText(payload.phone ?? payload.sdt);
  const email = normalizeText(payload.email).toLowerCase();
  const avatar = normalizeDriverAssetPath(payload.avatar);
  const address = normalizeText(payload.address ?? payload.diaChi);
  const cccd = normalizeText(payload.cccd);
  const backgroundImage = normalizeDriverAssetPath(payload.backgroundImage ?? payload.lyLich);

  const rawIdentityImages = payload.identityImages ?? payload.cccdImages ?? {};
  const identityFrontImage = normalizeDriverAssetPath(
    payload.identityFrontImage ?? payload.identityFront ?? payload.cccdFrontImage ?? rawIdentityImages.front,
  );
  const identityBackImage = normalizeDriverAssetPath(
    payload.identityBackImage ?? payload.identityBack ?? payload.cccdBackImage ?? rawIdentityImages.back,
  );

  const rawVehicleInfo = payload.vehicleInfo ?? payload.thongTinXe ?? {};
  const normalizedRawVehicleInfo = normalizeDriverVehicleInfo(rawVehicleInfo);
  const rawVehicleImages =
    (rawVehicleInfo && typeof rawVehicleInfo === 'object'
      ? (rawVehicleInfo.images ?? rawVehicleInfo.vehicleImages ?? {})
      : {});
  const vehicleFrontImage = normalizeDriverAssetPath(
    payload.vehicleFrontImage ?? rawVehicleImages.front ?? rawVehicleInfo.frontImage ?? normalizedRawVehicleInfo.images.front,
  );
  const vehicleSideImage = normalizeDriverAssetPath(
    payload.vehicleSideImage
    ?? rawVehicleImages.side
    ?? rawVehicleInfo.sideImage
    ?? rawVehicleInfo.image
    ?? rawVehicleInfo.vehicleImage
    ?? normalizedRawVehicleInfo.images.side,
  );
  const vehicleRearImage = normalizeDriverAssetPath(
    payload.vehicleRearImage ?? rawVehicleImages.rear ?? rawVehicleInfo.rearImage ?? normalizedRawVehicleInfo.images.rear,
  );
  const vehicleRegistrationImage = normalizeDriverAssetPath(
    payload.vehicleRegistrationImage
    ?? payload.registrationImage
    ?? rawVehicleInfo.registrationImage
    ?? rawVehicleInfo.giayDangKyXe
    ?? rawVehicleImages.side
    ?? rawVehicleInfo.sideImage
    ?? normalizedRawVehicleInfo.registrationImage
    ?? normalizedRawVehicleInfo.images.side,
  );

  const vehicleLicensePlate = normalizeText(
    payload.licensePlate ?? rawVehicleInfo.licensePlate ?? rawVehicleInfo.bienSoXe ?? normalizedRawVehicleInfo.licensePlate,
  ).toUpperCase();
  const vehicleType = normalizeVehicleType(
    payload.vehicleType
    ?? rawVehicleInfo.vehicleType
    ?? rawVehicleInfo.type
    ?? rawVehicleInfo.loaiXe
    ?? normalizedRawVehicleInfo.vehicleType,
  );
  const vehicleName = normalizeText(
    payload.vehicleName
    ?? rawVehicleInfo.name
    ?? rawVehicleInfo.vehicleName
    ?? rawVehicleInfo.tenXe
    ?? normalizedRawVehicleInfo.name
    ?? vehicleType,
  );
  const vehicleBrand = normalizeText(payload.vehicleBrand ?? rawVehicleInfo.brand ?? rawVehicleInfo.hangXe ?? normalizedRawVehicleInfo.brand);
  const vehicleModel = normalizeText(payload.vehicleModel ?? rawVehicleInfo.model ?? rawVehicleInfo.dongXe ?? normalizedRawVehicleInfo.model);
  const vehicleColor = normalizeText(payload.vehicleColor ?? rawVehicleInfo.color ?? rawVehicleInfo.mauXe ?? normalizedRawVehicleInfo.color);
  const vehicleYear = normalizeText(payload.vehicleYear ?? rawVehicleInfo.year ?? rawVehicleInfo.namSanXuat ?? normalizedRawVehicleInfo.year);
  const vehicleSeatCount = normalizeText(payload.vehicleSeatCount ?? rawVehicleInfo.seatCount ?? rawVehicleInfo.soCho ?? normalizedRawVehicleInfo.seatCount);

  const rawLicenseImages = payload.licenseImages ?? rawVehicleInfo.licenseImages ?? payload.bangLaiImages ?? {};
  const licenseFrontImage = normalizeDriverAssetPath(
    payload.licenseFrontImage ?? payload.licenseImage ?? payload.bangLai ?? rawLicenseImages.front,
  );
  const licenseBackImage = normalizeDriverAssetPath(
    payload.licenseBackImage ?? rawLicenseImages.back,
  );

  const licenseImage = licenseFrontImage;
  const vehicleImage =
    normalizeDriverAssetPath(payload.vehicleImage ?? rawVehicleInfo.image ?? rawVehicleInfo.vehicleImage ?? rawVehicleInfo.hinhXe) ||
    vehicleSideImage ||
    vehicleFrontImage ||
    vehicleRearImage;

  const rawEmergencyContact = payload.emergencyContact ?? payload.lienHeKC ?? {};
  const normalizedEmergencyContact = parseEmergencyContact(rawEmergencyContact);
  const emergencyRelationship = normalizeText(payload.emergencyRelationship ?? normalizedEmergencyContact.relationship);
  const emergencyFullName = normalizeText(payload.emergencyFullName ?? normalizedEmergencyContact.fullName);
  const emergencyPhone = normalizeText(payload.emergencyPhone ?? normalizedEmergencyContact.phone);
  const emergencyAddress = normalizeText(payload.emergencyAddress ?? normalizedEmergencyContact.address);

  const rawBank = payload.bank ?? {};
  const bankName = normalizeText(payload.bankName ?? rawBank.bankName ?? rawBank.nganHang);
  const bankAccountNumber = normalizeText(payload.bankAccountNumber ?? rawBank.accountNumber ?? rawBank.stk);
  const bankAccountHolderRaw = normalizeText(payload.bankAccountHolder ?? rawBank.accountHolder ?? rawBank.hoVaTen ?? fullName);
  const bankAccountHolder = removeVietnameseDiacritics(bankAccountHolderRaw);

  if (!forUpdate) {
    if (!fullName || !phone || !cccd || !vehicleLicensePlate) {
      throw createHttpError(400, 'Vui lòng nhập đầy đủ tên tài xế, SĐT, CCCD và biển số xe.');
    }

    const missingDocumentCount = [
      avatar,
      identityFrontImage,
      identityBackImage,
      licenseFrontImage,
      licenseBackImage,
      backgroundImage,
      vehicleFrontImage,
      vehicleRegistrationImage || vehicleSideImage,
    ].filter((value) => !value).length;

    if (missingDocumentCount > 0) {
      throw createHttpError(400, 'Vui lòng tải đầy đủ ảnh hồ sơ tài xế (avatar, CCCD, bằng lái, lý lịch, ảnh xe và ảnh giấy đăng ký xe).');
    }
  }

  if (email && !emailPattern.test(email)) {
    throw createHttpError(400, 'Email tài xế không đúng định dạng hợp lệ.');
  }

  if (cccd && !cccdPattern.test(cccd)) {
    throw createHttpError(400, 'CCCD không hợp lệ (phải đúng 12 chữ số).');
  }

  if (phone && phone.length > 15) {
    throw createHttpError(400, 'Số điện thoại không hợp lệ (tối đa 15 ký tự).');
  }

  if (phone && !phoneNumberPattern.test(phone)) {
    throw createHttpError(400, 'Số điện thoại tài xế chỉ được chứa chữ số (8-15 số).');
  }

  if (emergencyPhone && !phoneNumberPattern.test(emergencyPhone)) {
    throw createHttpError(400, 'Số điện thoại liên hệ khẩn cấp chỉ được chứa chữ số (8-15 số).');
  }

  if (vehicleLicensePlate && !vehicleLicensePlatePattern.test(vehicleLicensePlate)) {
    throw createHttpError(400, 'Biển số xe không đúng định dạng. Ví dụ hợp lệ: 43A-12345 hoặc 43A-123.45');
  }

  return {
    fullName,
    phone,
    email,
    avatar,
    address,
    cccd,
    licenseImage,
    backgroundImage,
    identityImages: {
      front: identityFrontImage,
      back: identityBackImage,
    },
    licenseImages: {
      front: licenseFrontImage,
      back: licenseBackImage,
    },
    vehicleInfo: {
      image: vehicleFrontImage || vehicleImage,
      vehicleImage: vehicleFrontImage || vehicleImage,
      hinhXe: vehicleFrontImage || vehicleImage,
      registrationImage: vehicleRegistrationImage || vehicleSideImage,
      giayDangKyXe: vehicleRegistrationImage || vehicleSideImage,
      licensePlate: vehicleLicensePlate,
      bienSoXe: vehicleLicensePlate,
      name: vehicleName,
      vehicleName,
      tenXe: vehicleName,
      vehicleType,
      loaiXe: vehicleType,
      brand: vehicleBrand,
      hangXe: vehicleBrand,
      model: vehicleModel,
      dongXe: vehicleModel,
      color: vehicleColor,
      mauXe: vehicleColor,
      year: vehicleYear,
      namSanXuat: vehicleYear,
      seatCount: vehicleSeatCount,
      soCho: vehicleSeatCount,
      images: {
        front: vehicleFrontImage || vehicleImage,
        side: vehicleRegistrationImage || vehicleSideImage,
        rear: vehicleRearImage,
      },
      identityImages: {
        front: identityFrontImage,
        back: identityBackImage,
      },
      licenseImages: {
        front: licenseFrontImage,
        back: licenseBackImage,
      },
    },
    emergencyContact: {
      relationship: emergencyRelationship,
      fullName: emergencyFullName,
      phone: emergencyPhone,
      address: emergencyAddress,
    },
    bankInfo: {
      accountHolder: bankAccountHolder,
      accountNumber: bankAccountNumber,
      bankName,
    },
  };
}

function parseDriverApplicationIdentityPayload(payload = {}) {
  const accountId = normalizeText(payload.accountId ?? payload.maTK);
  const identifier = normalizeText(payload.identifier ?? payload.email ?? payload.username).toLowerCase();

  if (!accountId && !identifier) {
    throw createHttpError(400, 'Thiếu thông tin tài khoản để nộp hồ sơ tài xế.');
  }

  return {
    accountId,
    identifier,
  };
}

function buildListDriversSql() {
  return `
    SELECT
      tx.MaTK,
      tk.MaQuyen,
      tk.Ten,
      tk.SDT,
      tk.Email,
      tk.TaiKhoan,
      tk.NgaySinh,
      tk.GioiTinh,
      tk.Avatar AS AvatarTaiKhoan,
      tk.DiaChi AS DiaChiTaiKhoan,
      tk.TrangThai AS TrangThaiTaiKhoan,
      tx.Avatar AS AvatarTaiXe,
      tx.DiaChi AS DiaChiTaiXe,
      tx.CCCD,
      tx.BangLai,
      tx.LyLich,
      tx.MaNH,
      tx.ThongTinXe,
      tx.LienHeKC,
      tx.TrangThai AS TrangThaiTaiXe,
      tx.NgayTao AS NgayTaoTaiXe,
      tx.NgayCapNhat AS NgayCapNhatTaiXe,
      nh.HoVaTen AS HoVaTenNganHang,
      nh.STK,
      nh.NganHang AS TenNganHang
    FROM TaiXe tx
    INNER JOIN TaiKhoan tk ON tk.MaTK = tx.MaTK
    LEFT JOIN NganHang nh ON nh.MaNH = tx.MaNH
    WHERE
      (
        @statusFilter = 'all'
        OR (@statusFilter = 'pending' AND tx.TrangThai = N'ChoDuyet')
        OR (@statusFilter = 'active' AND tx.TrangThai = N'HoatDong' AND tk.TrangThai = N'HoatDong')
        OR (@statusFilter = 'locked' AND (tx.TrangThai = N'Khoa' OR tk.TrangThai = N'Khoa'))
      )
      AND
      (
        @keyword = ''
        OR LOWER(ISNULL(tk.Ten, '')) LIKE '%' + @keyword + '%'
        OR LOWER(ISNULL(tk.SDT, '')) LIKE '%' + @keyword + '%'
        OR LOWER(ISNULL(JSON_VALUE(tx.ThongTinXe, '$.licensePlate'), '')) LIKE '%' + @keyword + '%'
        OR LOWER(ISNULL(JSON_VALUE(tx.ThongTinXe, '$.bienSoXe'), '')) LIKE '%' + @keyword + '%'
      )
    ORDER BY
      CASE
        WHEN tx.TrangThai = N'Khoa' OR tk.TrangThai = N'Khoa' THEN 3
        WHEN tx.TrangThai = N'ChoDuyet' THEN 1
        ELSE 2
      END,
      tx.NgayCapNhat DESC,
      tx.MaTK DESC;
  `;
}

async function getDriverRows(filters = {}) {
  const pool = await getSqlServerPool();
  const statusFilter = normalizeDriverFilterStatus(filters.status);
  const keyword = normalizeSearchKeyword(filters.keyword);

  const queryResult = await pool
    .request()
    .input('statusFilter', sql.VarChar(16), statusFilter)
    .input('keyword', sql.VarChar(255), keyword)
    .query(buildListDriversSql());

  return queryResult.recordset ?? [];
}

async function getDriverRowById(driverId, transaction = null) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const request = transaction
    ? new sql.Request(transaction)
    : (await getSqlServerPool()).request();

  const queryResult = await request
    .input('driverId', sql.VarChar(20), normalizedDriverId)
    .query(`
      SELECT
        tx.MaTK,
        tk.MaQuyen,
        tk.Ten,
        tk.SDT,
        tk.Email,
        tk.TaiKhoan,
        tk.NgaySinh,
        tk.GioiTinh,
        tk.Avatar AS AvatarTaiKhoan,
        tk.DiaChi AS DiaChiTaiKhoan,
        tk.TrangThai AS TrangThaiTaiKhoan,
        tx.Avatar AS AvatarTaiXe,
        tx.DiaChi AS DiaChiTaiXe,
        tx.CCCD,
        tx.BangLai,
        tx.LyLich,
        tx.MaNH,
        tx.ThongTinXe,
        tx.LienHeKC,
        tx.TrangThai AS TrangThaiTaiXe,
        tx.NgayTao AS NgayTaoTaiXe,
        tx.NgayCapNhat AS NgayCapNhatTaiXe,
        nh.HoVaTen AS HoVaTenNganHang,
        nh.STK,
        nh.NganHang AS TenNganHang
      FROM TaiXe tx
      INNER JOIN TaiKhoan tk ON tk.MaTK = tx.MaTK
      LEFT JOIN NganHang nh ON nh.MaNH = tx.MaNH
      WHERE tx.MaTK = @driverId;
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function getAccountForDriverApplication({ accountId, identifier }, transaction) {
  const queryResult = await new sql.Request(transaction)
    .input('accountId', sql.VarChar(20), accountId)
    .input('identifier', sql.VarChar(150), identifier)
    .query(`
      SELECT TOP 1
        MaTK,
        TaiKhoan,
        MaQuyen,
        Ten,
        Email,
        SDT,
        DiaChi,
        Avatar,
        TrangThai
      FROM TaiKhoan
      WHERE
        (@accountId <> '' AND MaTK = @accountId)
        OR (
          @identifier <> ''
          AND (
            LOWER(ISNULL(Email, '')) = @identifier
            OR LOWER(ISNULL(TaiKhoan, '')) = @identifier
          )
        )
      ORDER BY CASE WHEN (@accountId <> '' AND MaTK = @accountId) THEN 0 ELSE 1 END;
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function ensureDriverApplicationAvailable(accountId, transaction) {
  const queryResult = await new sql.Request(transaction)
    .input('accountId', sql.VarChar(20), accountId)
    .query(`
      SELECT TOP 1
        MaTK,
        TrangThai
      FROM TaiXe
      WHERE MaTK = @accountId;
    `);

  const existingDriver = queryResult.recordset?.[0] ?? null;

  if (!existingDriver) {
    return;
  }

  const normalizedDriverStatus = normalizeText(existingDriver.TrangThai).toLowerCase();

  if (normalizedDriverStatus === driverPendingStatus.toLowerCase()) {
    throw createHttpError(409, 'Hồ sơ tài xế đã được nộp và đang chờ quản trị viên duyệt.');
  }

  if (normalizedDriverStatus === driverLockedStatus.toLowerCase()) {
    throw createHttpError(
      423,
      'Chức năng Tài xế của tài khoản này đang bị khóa. Đây không phải khóa tài khoản, vui lòng liên hệ quản trị viên để mở lại.',
    );
  }

  throw createHttpError(409, 'Tài khoản này đã là tài xế đang hoạt động.');
}

async function getDriverRowOrThrow(driverId, transaction = null) {
  const driverRow = await getDriverRowById(driverId, transaction);

  if (!driverRow) {
    throw createHttpError(404, 'Không tìm thấy tài xế.');
  }

  return driverRow;
}

async function ensureDriverWalletRow(driverId, transaction = null) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const request = transaction
    ? new sql.Request(transaction)
    : (await getSqlServerPool()).request();

  const queryResult = await request
    .input('driverId', sql.VarChar(20), normalizedDriverId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Vi WHERE MaTK = @driverId)
      BEGIN
        INSERT INTO dbo.Vi (MaTK, SoDu)
        VALUES (@driverId, 0);
      END

      SELECT TOP 1 MaVi, MaTK, SoDu, NgayTao, NgayCapNhat
      FROM dbo.Vi
      WHERE MaTK = @driverId;
    `);

  return queryResult.recordset?.[0] ?? null;
}

async function appendWalletTransaction(transaction, payload = {}) {
  const normalizedDriverId = normalizeText(payload.driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Thiếu mã tài xế để ghi nhận giao dịch ví.');
  }

  const normalizedAmount = normalizeCurrencyAmount(payload.amount);

  if (!normalizedAmount) {
    throw createHttpError(400, 'Số tiền giao dịch phải khác 0.');
  }

  const transactionType = normalizeWalletTransactionType(payload.type);

  const insertedResult = await new sql.Request(transaction)
    .input('driverId', sql.VarChar(20), normalizedDriverId)
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
      WHERE MaTK = @driverId;

      UPDATE dbo.Vi
      SET SoDu = SoDu + @amount,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @driverId;

      SELECT @walletAfter = SoDu
      FROM dbo.Vi
      WHERE MaTK = @driverId;

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
        @driverId,
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

async function getDriverWalletSnapshot(driverId) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const driverRow = await getDriverRowOrThrow(normalizedDriverId);
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const walletRow = await ensureDriverWalletRow(normalizedDriverId, transaction);

    const transactionsResult = await new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizedDriverId)
      .query(`
        SELECT TOP 30 *
        FROM dbo.GiaoDichVi
        WHERE MaTK = @driverId
        ORDER BY NgayTao DESC, MaGD DESC;
      `);

    await transaction.commit();

    return {
      success: true,
      message: 'Lấy thông tin ví tài xế thành công.',
      wallet: {
        id: Number(walletRow?.MaVi ?? 0) || 0,
        driverId: normalizedDriverId,
        balance: normalizeCurrencyAmount(walletRow?.SoDu),
        balanceFormatted: `${new Intl.NumberFormat('vi-VN').format(normalizeCurrencyAmount(walletRow?.SoDu))} đ`,
        updatedAt: walletRow?.NgayCapNhat ?? null,
      },
      driver: mapDriverRowToResponse(driverRow),
      transactions: (transactionsResult.recordset ?? []).map(mapWalletTransactionRow),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
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
  const description = normalizeText(payload.description ?? payload.noiDung) || 'Chuyển tiền ví tài xế';

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

function parseVehicleChangePayload(payload = {}) {
  const newVehicleName = normalizeText(payload.vehicleName ?? payload.loaiXeMoi ?? payload.newVehicleName);
  const newLicensePlate = normalizeText(payload.licensePlate ?? payload.bienSoMoi ?? payload.newLicensePlate).toUpperCase();

  if (!newVehicleName) {
    throw createHttpError(400, 'Vui lòng nhập loại xe mới.');
  }

  if (!newLicensePlate || !vehicleLicensePlatePattern.test(newLicensePlate)) {
    throw createHttpError(400, 'Biển số xe mới không đúng định dạng. Ví dụ hợp lệ: 43A-12345 hoặc 43A-123.45');
  }

  return {
    newVehicleName,
    newLicensePlate,
  };
}

function parseVehicleChangeDecisionPayload(payload = {}) {
  const note = normalizeText(payload.note ?? payload.reason ?? payload.ghiChu);
  return {
    note,
  };
}

async function getNextAccountId(transaction) {
  const queryResult = await new sql.Request(transaction).query(`
    SELECT MAX(TRY_CAST(SUBSTRING(MaTK, 3, 18) AS INT)) AS maxSequence
    FROM TaiKhoan
    WHERE MaTK LIKE 'TK%';
  `);

  const currentMaxSequence = Number(queryResult.recordset?.[0]?.maxSequence ?? 0);
  const nextSequence = Number.isFinite(currentMaxSequence) ? currentMaxSequence + 1 : 1;
  return `TK${String(nextSequence).padStart(4, '0')}`;
}

async function getNextBankId(transaction) {
  const queryResult = await new sql.Request(transaction).query(`
    SELECT MAX(TRY_CAST(SUBSTRING(MaNH, 3, 18) AS INT)) AS maxSequence
    FROM NganHang
    WHERE MaNH LIKE 'NH%';
  `);

  const currentMaxSequence = Number(queryResult.recordset?.[0]?.maxSequence ?? 0);
  const nextSequence = Number.isFinite(currentMaxSequence) ? currentMaxSequence + 1 : 1;
  return `NH${String(nextSequence).padStart(4, '0')}`;
}

async function validateUniqueDriverIdentity({ email, username, phone }, transaction) {
  const queryResult = await new sql.Request(transaction)
    .input('email', sql.VarChar(150), email)
    .input('username', sql.VarChar(150), username)
    .input('phone', sql.VarChar(15), phone)
    .query(`
      SELECT TOP 1 MaTK
      FROM TaiKhoan
      WHERE LOWER(ISNULL(Email, '')) = LOWER(@email)
         OR LOWER(ISNULL(TaiKhoan, '')) = LOWER(@username)
         OR (@phone <> '' AND LOWER(ISNULL(SDT, '')) = LOWER(@phone));
    `);

  if (queryResult.recordset?.[0]?.MaTK) {
    throw createHttpError(409, 'Email, tên tài khoản hoặc số điện thoại đã tồn tại.');
  }
}

async function updateDriverStatusInternal(driverId, { accountStatus, driverStatus, roleCode }) {
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existingDriver = await getDriverRowOrThrow(driverId, transaction);
    const resolvedRoleCode = normalizeText(roleCode ?? existingDriver.MaQuyen).toUpperCase() || driverRoleCode;

    const updateRequest = new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizeText(driverId))
      .input('accountStatus', sql.NVarChar(20), accountStatus ?? normalizeText(existingDriver.TrangThaiTaiKhoan))
      .input('driverStatus', sql.NVarChar(20), driverStatus ?? normalizeText(existingDriver.TrangThaiTaiXe))
      .input('roleCode', sql.Char(2), resolvedRoleCode);

    await updateRequest.query(`
      UPDATE TaiKhoan
      SET TrangThai = @accountStatus,
          MaQuyen = @roleCode,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @driverId;

      UPDATE TaiXe
      SET TrangThai = @driverStatus,
          NgayCapNhat = SYSDATETIME()
      WHERE MaTK = @driverId;
    `);

    const updatedDriverRow = await getDriverRowOrThrow(driverId, transaction);

    await transaction.commit();
    return mapDriverRowToResponse(updatedDriverRow);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listDrivers(filters = {}) {
  const driverRows = await getDriverRows(filters);
  const drivers = driverRows.map(mapDriverRowToResponse);

  const summary = drivers.reduce(
    (accumulator, driver) => {
      accumulator.total += 1;
      accumulator[driver.status] += 1;
      return accumulator;
    },
    { total: 0, active: 0, locked: 0, pending: 0 },
  );

  return {
    success: true,
    message: 'Lấy danh sách tài xế thành công.',
    summary,
    drivers,
  };
}

export async function createDriver(payload = {}) {
  const parsedPayload = parseDriverPayload(payload, { forUpdate: false });
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const accountId = await getNextAccountId(transaction);
    const bankId = await getNextBankId(transaction);
    const resolvedEmail = parsedPayload.email || buildDriverEmailFromPhone(parsedPayload.phone);
    const resolvedUsername = resolvedEmail.toLowerCase();

    if (!emailPattern.test(resolvedEmail)) {
      throw createHttpError(400, 'Không thể tạo email mặc định hợp lệ cho tài xế.');
    }

    await validateUniqueDriverIdentity(
      {
        email: resolvedEmail,
        username: resolvedUsername,
        phone: parsedPayload.phone,
      },
      transaction,
    );

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(20), accountId)
      .input('username', sql.VarChar(150), resolvedUsername)
      .input('password', sql.VarChar(255), '123456')
      .input('roleCode', sql.Char(2), driverRoleCode)
      .input('fullName', sql.NVarChar(100), parsedPayload.fullName)
      .input('email', sql.VarChar(150), resolvedEmail)
      .input('phone', sql.VarChar(15), parsedPayload.phone || null)
      .input('address', sql.NVarChar(255), parsedPayload.address || null)
      .input('avatar', sql.NVarChar(500), parsedPayload.avatar || null)
      .input('status', sql.NVarChar(20), accountActiveStatus)
      .query(`
        INSERT INTO TaiKhoan (MaTK, TaiKhoan, MatKhau, MaQuyen, Ten, Email, SDT, DiaChi, Avatar, TrangThai)
        VALUES (@accountId, @username, @password, @roleCode, @fullName, @email, @phone, @address, @avatar, @status);
      `);

    await new sql.Request(transaction)
      .input('bankId', sql.VarChar(20), bankId)
      .input('accountHolder', sql.NVarChar(120), parsedPayload.bankInfo.accountHolder || removeVietnameseDiacritics(parsedPayload.fullName))
      .input('accountNumber', sql.VarChar(30), parsedPayload.bankInfo.accountNumber || `000${Date.now().toString().slice(-7)}`)
      .input('bankName', sql.NVarChar(120), parsedPayload.bankInfo.bankName || 'Chua cap nhat')
      .query(`
        INSERT INTO NganHang (MaNH, HoVaTen, STK, NganHang)
        VALUES (@bankId, @accountHolder, @accountNumber, @bankName);
      `);

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(20), accountId)
      .input('avatar', sql.NVarChar(500), parsedPayload.avatar || null)
      .input('address', sql.NVarChar(255), parsedPayload.address || null)
      .input('cccd', sql.VarChar(20), parsedPayload.cccd)
      .input('licenseImage', sql.NVarChar(500), parsedPayload.licenseImage || null)
      .input('backgroundImage', sql.NVarChar(500), parsedPayload.backgroundImage || null)
      .input('bankId', sql.VarChar(20), bankId)
      .input('vehicleInfo', sql.NVarChar(sql.MAX), JSON.stringify(parsedPayload.vehicleInfo))
      .input('emergencyContact', sql.NVarChar(sql.MAX), packEmergencyContact(parsedPayload.emergencyContact))
      .input('driverStatus', sql.NVarChar(20), driverPendingStatus)
      .query(`
        INSERT INTO TaiXe (MaTK, Avatar, DiaChi, CCCD, BangLai, LyLich, MaNH, ThongTinXe, LienHeKC, TrangThai)
        VALUES (
          @accountId,
          @avatar,
          @address,
          @cccd,
          @licenseImage,
          @backgroundImage,
          @bankId,
          @vehicleInfo,
          @emergencyContact,
          @driverStatus
        );
      `);

    const createdDriverRow = await getDriverRowOrThrow(accountId, transaction);
    await transaction.commit();

    return {
      success: true,
      message: 'Thêm tài xế thành công. Tài xế đang ở trạng thái chờ duyệt.',
      driver: mapDriverRowToResponse(createdDriverRow),
    };
  } catch (error) {
    await transaction.rollback();

    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Dữ liệu tài xế bị trùng (email, SĐT, CCCD hoặc STK).');
    }

    throw error;
  }
}

export async function registerDriverApplication(payload = {}) {
  const identityPayload = parseDriverApplicationIdentityPayload(payload);
  const parsedPayload = parseDriverPayload(payload, { forUpdate: false });
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const accountRow = await getAccountForDriverApplication(identityPayload, transaction);

    if (!accountRow?.MaTK) {
      throw createHttpError(404, 'Không tìm thấy tài khoản để nộp hồ sơ tài xế. Vui lòng đăng nhập lại.');
    }

    const normalizedAccountStatus = normalizeText(accountRow.TrangThai).toLowerCase();

    if (normalizedAccountStatus === accountLockedStatus.toLowerCase()) {
      throw createHttpError(403, 'Tài khoản đang bị khóa nên không thể nộp hồ sơ tài xế.');
    }

    if (normalizeText(accountRow.MaQuyen).toUpperCase() === 'Q1') {
      throw createHttpError(403, 'Tài khoản quản trị không thể nộp hồ sơ tài xế.');
    }

    await ensureDriverApplicationAvailable(accountRow.MaTK, transaction);

    const bankId = await getNextBankId(transaction);
    const resolvedFullName = parsedPayload.fullName || normalizeText(accountRow.Ten);
    const resolvedPhone = parsedPayload.phone || normalizeText(accountRow.SDT);
    const resolvedAddress = parsedPayload.address || normalizeText(accountRow.DiaChi);
    const resolvedAvatar = parsedPayload.avatar || normalizeText(accountRow.Avatar);

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(20), accountRow.MaTK)
      .input('fullName', sql.NVarChar(100), resolvedFullName || null)
      .input('phone', sql.VarChar(15), resolvedPhone || null)
      .input('address', sql.NVarChar(255), resolvedAddress || null)
      .input('avatar', sql.NVarChar(500), resolvedAvatar || null)
      .query(`
        UPDATE TaiKhoan
        SET Ten = COALESCE(@fullName, Ten),
            SDT = COALESCE(@phone, SDT),
            DiaChi = COALESCE(@address, DiaChi),
            Avatar = COALESCE(@avatar, Avatar),
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @accountId;
      `);

    await new sql.Request(transaction)
      .input('bankId', sql.VarChar(20), bankId)
      .input('accountHolder', sql.NVarChar(120), parsedPayload.bankInfo.accountHolder || removeVietnameseDiacritics(resolvedFullName))
      .input('accountNumber', sql.VarChar(30), parsedPayload.bankInfo.accountNumber)
      .input('bankName', sql.NVarChar(120), parsedPayload.bankInfo.bankName)
      .query(`
        INSERT INTO NganHang (MaNH, HoVaTen, STK, NganHang)
        VALUES (@bankId, @accountHolder, @accountNumber, @bankName);
      `);

    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(20), accountRow.MaTK)
      .input('avatar', sql.NVarChar(500), resolvedAvatar || null)
      .input('address', sql.NVarChar(255), resolvedAddress || null)
      .input('cccd', sql.VarChar(20), parsedPayload.cccd)
      .input('licenseImage', sql.NVarChar(500), parsedPayload.licenseImage || null)
      .input('backgroundImage', sql.NVarChar(500), parsedPayload.backgroundImage || null)
      .input('bankId', sql.VarChar(20), bankId)
      .input('vehicleInfo', sql.NVarChar(sql.MAX), JSON.stringify(parsedPayload.vehicleInfo))
      .input('emergencyContact', sql.NVarChar(sql.MAX), packEmergencyContact(parsedPayload.emergencyContact))
      .input('driverStatus', sql.NVarChar(20), driverPendingStatus)
      .query(`
        INSERT INTO TaiXe (MaTK, Avatar, DiaChi, CCCD, BangLai, LyLich, MaNH, ThongTinXe, LienHeKC, TrangThai)
        VALUES (
          @accountId,
          @avatar,
          @address,
          @cccd,
          @licenseImage,
          @backgroundImage,
          @bankId,
          @vehicleInfo,
          @emergencyContact,
          @driverStatus
        );
      `);

    const pendingDriverRow = await getDriverRowOrThrow(accountRow.MaTK, transaction);

    await transaction.commit();

    return {
      success: true,
      message:
        'Đã nộp hồ sơ, đang chờ duyệt từ quản trị viên. Vui lòng chú ý thông báo Email để nhận kết quả duyệt và hướng dẫn kích hoạt tài khoản tài xế.',
      driver: mapDriverRowToResponse(pendingDriverRow),
    };
  } catch (error) {
    await transaction.rollback();

    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Thông tin hồ sơ tài xế bị trùng (CCCD hoặc số tài khoản).');
    }

    throw error;
  }
}

export async function updateDriver(driverId, payload = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const parsedPayload = parseDriverPayload(payload, { forUpdate: true });
  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existingDriver = await getDriverRowOrThrow(normalizedDriverId, transaction);
    const normalizedDriverStatus = normalizeText(existingDriver.TrangThaiTaiXe).toLowerCase();

    if (normalizedDriverStatus !== driverCompletedStatus.toLowerCase()) {
      throw createHttpError(403, 'Chỉ có thể chỉnh sửa hồ sơ tài xế đã được duyệt.');
    }

    await new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizedDriverId)
      .input('fullName', sql.NVarChar(100), parsedPayload.fullName || normalizeText(existingDriver.Ten))
      .input('phone', sql.VarChar(15), parsedPayload.phone || normalizeText(existingDriver.SDT) || null)
      .input('address', sql.NVarChar(255), parsedPayload.address || normalizeText(existingDriver.DiaChiTaiXe || existingDriver.DiaChiTaiKhoan) || null)
      .input('avatar', sql.NVarChar(500), parsedPayload.avatar || normalizeText(existingDriver.AvatarTaiXe || existingDriver.AvatarTaiKhoan) || null)
      .query(`
        UPDATE TaiKhoan
        SET Ten = @fullName,
            SDT = @phone,
            DiaChi = @address,
            Avatar = @avatar,
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @driverId;
      `);

    const currentVehicleInfo = normalizeDriverVehicleInfo(existingDriver.ThongTinXe);
    const currentEmergencyContact = parseEmergencyContact(existingDriver.LienHeKC);

    const currentVehicleImages = parseDriverVehicleImages(currentVehicleInfo);
    const currentIdentityImages = parseDriverDocumentImages(currentVehicleInfo.identityImages ?? currentVehicleInfo.cccdImages);
    const currentLicenseImages = parseDriverDocumentImages(
      currentVehicleInfo.licenseImages ?? safeJsonParse(existingDriver.BangLai, existingDriver.BangLai),
    );

    const mergedVehicleImages = {
      front: parsedPayload.vehicleInfo.images.front || currentVehicleImages.front,
      side: parsedPayload.vehicleInfo.images.side || currentVehicleImages.side,
      rear: parsedPayload.vehicleInfo.images.rear || currentVehicleImages.rear,
    };

    const mergedIdentityImages = {
      front: parsedPayload.identityImages.front || currentIdentityImages.front,
      back: parsedPayload.identityImages.back || currentIdentityImages.back,
    };

    const mergedLicenseImages = {
      front: parsedPayload.licenseImages.front || currentLicenseImages.front,
      back: parsedPayload.licenseImages.back || currentLicenseImages.back,
    };

    const mergedVehicleInfo = {
      image:
        parsedPayload.vehicleInfo.image ||
        mergedVehicleImages.side ||
        mergedVehicleImages.front ||
        mergedVehicleImages.rear ||
        normalizeDriverAssetPath(currentVehicleInfo.image ?? currentVehicleInfo.vehicleImage),
      licensePlate:
        parsedPayload.vehicleInfo.licensePlate ||
        normalizeText(currentVehicleInfo.licensePlate ?? currentVehicleInfo.bienSoXe).toUpperCase(),
      bienSoXe:
        parsedPayload.vehicleInfo.licensePlate ||
        normalizeText(currentVehicleInfo.licensePlate ?? currentVehicleInfo.bienSoXe).toUpperCase(),
      name: parsedPayload.vehicleInfo.name || normalizeText(currentVehicleInfo.name ?? currentVehicleInfo.vehicleName),
      vehicleName: parsedPayload.vehicleInfo.name || normalizeText(currentVehicleInfo.name ?? currentVehicleInfo.vehicleName),
      vehicleType:
        normalizeVehicleType(parsedPayload.vehicleInfo.vehicleType)
        || normalizeVehicleType(currentVehicleInfo.vehicleType)
        || normalizeVehicleType(parsedPayload.vehicleInfo.name)
        || normalizeVehicleType(currentVehicleInfo.name),
      brand: parsedPayload.vehicleInfo.brand || normalizeText(currentVehicleInfo.brand),
      model: parsedPayload.vehicleInfo.model || normalizeText(currentVehicleInfo.model),
      color: parsedPayload.vehicleInfo.color || normalizeText(currentVehicleInfo.color),
      year: parsedPayload.vehicleInfo.year || normalizeText(currentVehicleInfo.year),
      seatCount: parsedPayload.vehicleInfo.seatCount || normalizeText(currentVehicleInfo.seatCount),
      images: mergedVehicleImages,
      identityImages: mergedIdentityImages,
      licenseImages: mergedLicenseImages,
    };

    const mergedEmergencyContact = {
      relationship:
        parsedPayload.emergencyContact.relationship || normalizeText(currentEmergencyContact.relationship),
      fullName:
        parsedPayload.emergencyContact.fullName || normalizeText(currentEmergencyContact.fullName),
      phone: parsedPayload.emergencyContact.phone || normalizeText(currentEmergencyContact.phone),
      address: parsedPayload.emergencyContact.address || normalizeText(currentEmergencyContact.address),
    };

    await new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizedDriverId)
      .input('avatar', sql.NVarChar(500), parsedPayload.avatar || normalizeText(existingDriver.AvatarTaiXe) || null)
      .input('address', sql.NVarChar(255), parsedPayload.address || normalizeText(existingDriver.DiaChiTaiXe) || null)
      .input('cccd', sql.VarChar(20), parsedPayload.cccd || normalizeText(existingDriver.CCCD) || null)
      .input('licenseImage', sql.NVarChar(500), mergedLicenseImages.front || null)
      .input('backgroundImage', sql.NVarChar(500), parsedPayload.backgroundImage || normalizeText(existingDriver.LyLich) || null)
      .input('vehicleInfo', sql.NVarChar(sql.MAX), JSON.stringify(mergedVehicleInfo))
      .input('emergencyContact', sql.NVarChar(sql.MAX), packEmergencyContact(mergedEmergencyContact))
      .query(`
        UPDATE TaiXe
        SET Avatar = @avatar,
            DiaChi = @address,
            CCCD = @cccd,
            BangLai = @licenseImage,
            LyLich = @backgroundImage,
            ThongTinXe = @vehicleInfo,
            LienHeKC = @emergencyContact,
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @driverId;
      `);

    await new sql.Request(transaction)
      .input('bankId', sql.VarChar(20), normalizeText(existingDriver.MaNH))
      .input(
        'accountHolder',
        sql.NVarChar(120),
        parsedPayload.bankInfo.accountHolder || normalizeText(existingDriver.HoVaTenNganHang) || removeVietnameseDiacritics(parsedPayload.fullName),
      )
      .input('accountNumber', sql.VarChar(30), parsedPayload.bankInfo.accountNumber || normalizeText(existingDriver.STK) || `000${Date.now().toString().slice(-7)}`)
      .input('bankName', sql.NVarChar(120), parsedPayload.bankInfo.bankName || normalizeText(existingDriver.TenNganHang) || 'Chua cap nhat')
      .query(`
        UPDATE NganHang
        SET HoVaTen = @accountHolder,
            STK = @accountNumber,
            NganHang = @bankName,
            NgayCapNhat = SYSDATETIME()
        WHERE MaNH = @bankId;
      `);

    const updatedDriverRow = await getDriverRowOrThrow(normalizedDriverId, transaction);
    await transaction.commit();

    return {
      success: true,
      message: 'Cập nhật tài xế thành công.',
      driver: mapDriverRowToResponse(updatedDriverRow),
    };
  } catch (error) {
    await transaction.rollback();

    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Dữ liệu cập nhật bị trùng (SĐT, CCCD hoặc STK).');
    }

    throw error;
  }
}

export async function approveDriver(driverId) {
  const driverRow = await getDriverRowOrThrow(driverId);

  if (normalizeText(driverRow.TrangThaiTaiXe).toLowerCase() !== driverPendingStatus.toLowerCase()) {
    throw createHttpError(400, 'Chỉ có thể duyệt hồ sơ đang ở trạng thái chờ duyệt.');
  }

  const updatedDriver = await updateDriverStatusInternal(driverId, {
    accountStatus: accountActiveStatus,
    driverStatus: driverCompletedStatus,
    roleCode: driverRoleCode,
  });

  let approvalMessage = 'Đã duyệt tài xế thành công.';
  let emailNotificationSent = false;

  try {
    emailNotificationSent = await sendDriverApprovalEmail({
      fullName: updatedDriver.name,
      email: updatedDriver.email,
    });

    if (emailNotificationSent) {
      approvalMessage = 'Đã duyệt tài xế thành công và đã gửi email thông báo cho tài xế.';
    }
  } catch {
    approvalMessage = 'Đã duyệt tài xế thành công nhưng chưa gửi được email thông báo. Vui lòng kiểm tra cấu hình SMTP.';
  }

  return {
    success: true,
    message: approvalMessage,
    emailNotificationSent,
    driver: updatedDriver,
  };
}

export async function rejectDriver(driverId) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existingDriver = await getDriverRowOrThrow(normalizedDriverId, transaction);
    const normalizedDriverStatus = normalizeText(existingDriver.TrangThaiTaiXe).toLowerCase();

    if (normalizedDriverStatus !== driverPendingStatus.toLowerCase()) {
      throw createHttpError(400, 'Chỉ có thể từ chối hồ sơ đang ở trạng thái chờ duyệt.');
    }

    const bankId = normalizeText(existingDriver.MaNH);
    const accountRoleCode = normalizeText(existingDriver.MaQuyen).toUpperCase();

    await new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizedDriverId)
      .query(`
        DELETE FROM TaiXe
        WHERE MaTK = @driverId;
      `);

    if (bankId) {
      await new sql.Request(transaction)
        .input('bankId', sql.VarChar(20), bankId)
        .query(`
          DELETE FROM NganHang
          WHERE MaNH = @bankId;
        `);
    }

    if (accountRoleCode === driverRoleCode) {
      await new sql.Request(transaction)
        .input('driverId', sql.VarChar(20), normalizedDriverId)
        .query(`
          DELETE FROM TaiKhoan
          WHERE MaTK = @driverId;
        `);
    } else {
      await new sql.Request(transaction)
        .input('driverId', sql.VarChar(20), normalizedDriverId)
        .input('customerRoleCode', sql.Char(2), customerRoleCode)
        .input('accountStatus', sql.NVarChar(20), accountActiveStatus)
        .query(`
          UPDATE TaiKhoan
          SET MaQuyen = @customerRoleCode,
              TrangThai = @accountStatus,
              NgayCapNhat = SYSDATETIME()
          WHERE MaTK = @driverId;
        `);
    }

    await transaction.commit();

    return {
      success: true,
      message: 'Đã từ chối hồ sơ tài xế và xóa dữ liệu đăng ký.',
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function lockDriver(driverId) {
  const driverRow = await getDriverRowOrThrow(driverId);
  const updatedDriver = await updateDriverStatusInternal(driverId, {
    accountStatus: normalizeText(driverRow.TrangThaiTaiKhoan) || accountActiveStatus,
    driverStatus: driverLockedStatus,
    roleCode: customerRoleCode,
  });

  return {
    success: true,
    message: 'Đã khóa chức năng Tài xế. Tài khoản vẫn hoạt động bình thường với quyền Khách hàng.',
    driver: updatedDriver,
  };
}

export async function unlockDriver(driverId) {
  const driverRow = await getDriverRowOrThrow(driverId);

  if (normalizeText(driverRow.TrangThaiTaiKhoan).toLowerCase() === accountLockedStatus.toLowerCase()) {
    throw createHttpError(403, 'Tài khoản đang bị khóa. Hãy mở khóa tài khoản trước khi mở chức năng Tài xế.');
  }

  const updatedDriver = await updateDriverStatusInternal(driverId, {
    accountStatus: normalizeText(driverRow.TrangThaiTaiKhoan) || accountActiveStatus,
    driverStatus: driverCompletedStatus,
    roleCode: driverRoleCode,
  });

  return {
    success: true,
    message: 'Đã mở lại chức năng Tài xế. Tài khoản vẫn giữ trạng thái hiện tại.',
    driver: updatedDriver,
  };
}

export async function ensureDriverSchema() {
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
    WHERE tk.MaQuyen = 'Q3'
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.Vi AS tv
        WHERE tv.MaTK = tk.MaTK
      );

    IF OBJECT_ID(N'dbo.TaiXeYeuCauDoiThongTinXe', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TaiXeYeuCauDoiThongTinXe
      (
        MaYC              INT            IDENTITY(1,1) NOT NULL,
        MaTK              VARCHAR(20)    NOT NULL,
        LoaiXeCu          NVARCHAR(120)  NOT NULL,
        BienSoCu          VARCHAR(20)    NOT NULL,
        LoaiXeMoi         NVARCHAR(120)  NOT NULL,
        BienSoMoi         VARCHAR(20)    NOT NULL,
        TrangThai         VARCHAR(20)    NOT NULL CONSTRAINT DF_TaiXeYeuCauDoiThongTinXe_TrangThai DEFAULT 'pending',
        GhiChuTuChoi      NVARCHAR(500)  NULL,
        NguoiDuyetMaTK    VARCHAR(20)    NULL,
        TaiXeDaXem        BIT            NOT NULL CONSTRAINT DF_TaiXeYeuCauDoiThongTinXe_TaiXeDaXem DEFAULT 0,
        NgayTao           DATETIME2(0)   NOT NULL CONSTRAINT DF_TaiXeYeuCauDoiThongTinXe_NgayTao DEFAULT SYSDATETIME(),
        NgayCapNhat       DATETIME2(0)   NOT NULL CONSTRAINT DF_TaiXeYeuCauDoiThongTinXe_NgayCapNhat DEFAULT SYSDATETIME(),
        NgayXuLy          DATETIME2(0)   NULL,
        NgayThongBaoTaiXe DATETIME2(0)   NULL,
        CONSTRAINT PK_TaiXeYeuCauDoiThongTinXe PRIMARY KEY (MaYC),
        CONSTRAINT FK_TaiXeYeuCauDoiThongTinXe_TaiKhoan FOREIGN KEY (MaTK)
          REFERENCES dbo.TaiKhoan(MaTK)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT FK_TaiXeYeuCauDoiThongTinXe_NguoiDuyet FOREIGN KEY (NguoiDuyetMaTK)
          REFERENCES dbo.TaiKhoan(MaTK)
          ON UPDATE NO ACTION
          ON DELETE NO ACTION,
        CONSTRAINT CK_TaiXeYeuCauDoiThongTinXe_TrangThai CHECK (TrangThai IN ('pending', 'approved', 'rejected'))
      );
    END;

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

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = N'IX_TaiXeYeuCauDoiThongTinXe_TrangThai_NgayTao'
        AND object_id = OBJECT_ID(N'dbo.TaiXeYeuCauDoiThongTinXe')
    )
    BEGIN
      CREATE INDEX IX_TaiXeYeuCauDoiThongTinXe_TrangThai_NgayTao
      ON dbo.TaiXeYeuCauDoiThongTinXe (TrangThai, NgayTao DESC, MaYC DESC);
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = N'UX_TaiXeYeuCauDoiThongTinXe_Pending'
        AND object_id = OBJECT_ID(N'dbo.TaiXeYeuCauDoiThongTinXe')
    )
    BEGIN
      CREATE UNIQUE INDEX UX_TaiXeYeuCauDoiThongTinXe_Pending
      ON dbo.TaiXeYeuCauDoiThongTinXe (MaTK)
      WHERE TrangThai = 'pending';
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

    IF OBJECT_ID(N'dbo.TR_TaiXeYeuCauDoiThongTinXe_SetNgayCapNhat', N'TR') IS NULL
    BEGIN
      EXEC('CREATE TRIGGER dbo.TR_TaiXeYeuCauDoiThongTinXe_SetNgayCapNhat
      ON dbo.TaiXeYeuCauDoiThongTinXe
      AFTER UPDATE
      AS
      BEGIN
        SET NOCOUNT ON;
        UPDATE target
        SET target.NgayCapNhat = SYSDATETIME()
        FROM dbo.TaiXeYeuCauDoiThongTinXe AS target
        INNER JOIN inserted AS i ON i.MaYC = target.MaYC;
      END');
    END;
  `);
}

export async function getDriverWallet(driverId) {
  return getDriverWalletSnapshot(driverId);
}

export async function listDriverWalletTransactions(driverId, filters = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  await getDriverRowOrThrow(normalizedDriverId);

  const request = (await getSqlServerPool())
    .request()
    .input('driverId', sql.VarChar(20), normalizedDriverId);

  const whereConditions = ['MaTK = @driverId'];

  const typeFilter = normalizeText(filters.type).toLowerCase();
  if (driverWalletTransactionTypes.has(typeFilter)) {
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

export async function topupDriverWallet(driverId, payload = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const parsedPayload = parseWalletTopupPayload(payload);
  await getDriverRowOrThrow(normalizedDriverId);

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await ensureDriverWalletRow(normalizedDriverId, transaction);

    const transactionRow = await appendWalletTransaction(transaction, {
      driverId: normalizedDriverId,
      type: 'topup',
      amount: parsedPayload.amount,
      description: parsedPayload.description,
      referenceCode: parsedPayload.referenceCode || `${parsedPayload.method.toUpperCase()}-${Date.now()}`,
    });

    const walletRow = await ensureDriverWalletRow(normalizedDriverId, transaction);

    await transaction.commit();

    return {
      success: true,
      message: 'Nạp tiền vào ví thành công.',
      wallet: {
        id: Number(walletRow?.MaVi ?? 0) || 0,
        driverId: normalizedDriverId,
        balance: normalizeCurrencyAmount(walletRow?.SoDu),
        balanceFormatted: `${new Intl.NumberFormat('vi-VN').format(normalizeCurrencyAmount(walletRow?.SoDu))} đ`,
        updatedAt: walletRow?.NgayCapNhat ?? null,
      },
      transaction: mapWalletTransactionRow(transactionRow),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function transferDriverWallet(driverId, payload = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const parsedPayload = parseWalletTransferPayload(payload);
  const senderDriver = await getDriverRowOrThrow(normalizedDriverId);

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

  if (normalizeText(recipientRow.MaTK) === normalizedDriverId) {
    throw createHttpError(400, 'Không thể chuyển tiền cho chính tài khoản của bạn.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const senderWalletRow = await ensureDriverWalletRow(normalizedDriverId, transaction);
    await ensureDriverWalletRow(recipientRow.MaTK, transaction);

    const currentBalance = normalizeCurrencyAmount(senderWalletRow?.SoDu);

    if (parsedPayload.amount > currentBalance) {
      throw createHttpError(400, 'Số dư không đủ để thực hiện giao dịch chuyển tiền.');
    }

    const transferReferenceCode = `TRF-${Date.now()}`;

    const debitTransaction = await appendWalletTransaction(transaction, {
      driverId: normalizedDriverId,
      type: 'transfer',
      amount: -Math.abs(parsedPayload.amount),
      description: parsedPayload.description,
      recipientPhone: parsedPayload.recipientPhone,
      senderPhone: normalizeText(senderDriver.SDT),
      referenceCode: transferReferenceCode,
    });

    await appendWalletTransaction(transaction, {
      driverId: recipientRow.MaTK,
      type: 'receive',
      amount: Math.abs(parsedPayload.amount),
      description: `Nhận tiền từ ${normalizeText(senderDriver.Ten) || normalizeText(senderDriver.SDT) || normalizedDriverId}`,
      recipientPhone: parsedPayload.recipientPhone,
      senderPhone: normalizeText(senderDriver.SDT),
      referenceCode: transferReferenceCode,
    });

    const latestWalletRow = await ensureDriverWalletRow(normalizedDriverId, transaction);

    await transaction.commit();

    return {
      success: true,
      message: 'Chuyển tiền thành công.',
      wallet: {
        id: Number(latestWalletRow?.MaVi ?? 0) || 0,
        driverId: normalizedDriverId,
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

export async function getDriverProfile(driverId) {
  const driverRow = await getDriverRowOrThrow(driverId);

  return {
    success: true,
    message: 'Lấy hồ sơ tài xế thành công.',
    driver: mapDriverRowToResponse(driverRow),
  };
}

export async function createVehicleChangeRequest(driverId, payload = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  const parsedPayload = parseVehicleChangePayload(payload);
  const existingDriver = await getDriverRowOrThrow(normalizedDriverId);
  const normalizedDriverStatus = normalizeText(existingDriver.TrangThaiTaiXe).toLowerCase();

  if (normalizedDriverStatus !== driverCompletedStatus.toLowerCase()) {
    throw createHttpError(403, 'Chỉ tài xế đã được duyệt mới có thể gửi yêu cầu đổi thông tin xe.');
  }

  const vehicleInfo = safeJsonParse(existingDriver.ThongTinXe, {});
  const oldVehicleName = normalizeText(vehicleInfo.name ?? vehicleInfo.vehicleName ?? '');
  const oldLicensePlate = normalizeText(vehicleInfo.licensePlate ?? vehicleInfo.bienSoXe ?? '').toUpperCase();

  if (
    parsedPayload.newVehicleName.toLowerCase() === oldVehicleName.toLowerCase() &&
    parsedPayload.newLicensePlate.toLowerCase() === oldLicensePlate.toLowerCase()
  ) {
    throw createHttpError(400, 'Thông tin xe mới trùng với thông tin hiện tại.');
  }

  try {
    const insertResult = await (await getSqlServerPool())
      .request()
      .input('driverId', sql.VarChar(20), normalizedDriverId)
      .input('oldVehicleName', sql.NVarChar(120), oldVehicleName)
      .input('oldLicensePlate', sql.VarChar(20), oldLicensePlate)
      .input('newVehicleName', sql.NVarChar(120), parsedPayload.newVehicleName)
      .input('newLicensePlate', sql.VarChar(20), parsedPayload.newLicensePlate)
      .query(`
        DECLARE @CreatedRequests TABLE
        (
          MaYC INT,
          MaTK VARCHAR(20),
          LoaiXeCu NVARCHAR(120),
          BienSoCu VARCHAR(20),
          LoaiXeMoi NVARCHAR(120),
          BienSoMoi VARCHAR(20),
          TrangThai VARCHAR(20),
          GhiChuTuChoi NVARCHAR(500),
          NguoiDuyetMaTK VARCHAR(20),
          TaiXeDaXem BIT,
          NgayTao DATETIME2(0),
          NgayCapNhat DATETIME2(0),
          NgayXuLy DATETIME2(0),
          NgayThongBaoTaiXe DATETIME2(0)
        );

        INSERT INTO dbo.TaiXeYeuCauDoiThongTinXe
        (
          MaTK,
          LoaiXeCu,
          BienSoCu,
          LoaiXeMoi,
          BienSoMoi,
          TrangThai,
          TaiXeDaXem
        )
        OUTPUT
          INSERTED.MaYC,
          INSERTED.MaTK,
          INSERTED.LoaiXeCu,
          INSERTED.BienSoCu,
          INSERTED.LoaiXeMoi,
          INSERTED.BienSoMoi,
          INSERTED.TrangThai,
          INSERTED.GhiChuTuChoi,
          INSERTED.NguoiDuyetMaTK,
          INSERTED.TaiXeDaXem,
          INSERTED.NgayTao,
          INSERTED.NgayCapNhat,
          INSERTED.NgayXuLy,
          INSERTED.NgayThongBaoTaiXe
        INTO @CreatedRequests
        VALUES
        (
          @driverId,
          @oldVehicleName,
          @oldLicensePlate,
          @newVehicleName,
          @newLicensePlate,
          'pending',
          0
        );

        SELECT *
        FROM @CreatedRequests;
      `);

    const createdRequest = insertResult.recordset?.[0] ?? null;

    return {
      success: true,
      message: 'Đã gửi yêu cầu thay đổi thông tin xe. Vui lòng chờ quản trị viên duyệt.',
      request: mapVehicleChangeRequestRow(createdRequest),
    };
  } catch (error) {
    if (isSqlUniqueConstraintError(error)) {
      throw createHttpError(409, 'Bạn đang có yêu cầu thay đổi thông tin xe chờ duyệt.');
    }

    throw error;
  }
}

export async function listPendingVehicleChangeRequests() {
  const queryResult = await (await getSqlServerPool())
    .request()
    .query(`
      SELECT
        yc.*,
        tk.Ten,
        tk.SDT,
        tk.Email
      FROM dbo.TaiXeYeuCauDoiThongTinXe yc
      INNER JOIN dbo.TaiKhoan tk ON tk.MaTK = yc.MaTK
      WHERE yc.TrangThai = 'pending'
      ORDER BY yc.NgayTao ASC, yc.MaYC ASC;
    `);

  return {
    success: true,
    message: 'Lấy danh sách yêu cầu đổi thông tin xe đang chờ duyệt thành công.',
    requests: (queryResult.recordset ?? []).map(mapVehicleChangeRequestRow),
  };
}

export async function getVehicleChangeRequestDetail(requestId) {
  const normalizedRequestId = Number(requestId);

  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    throw createHttpError(400, 'Mã yêu cầu thay đổi thông tin xe không hợp lệ.');
  }

  const queryResult = await (await getSqlServerPool())
    .request()
    .input('requestId', sql.Int, normalizedRequestId)
    .query(`
      SELECT
        yc.*,
        tk.Ten,
        tk.SDT,
        tk.Email
      FROM dbo.TaiXeYeuCauDoiThongTinXe yc
      INNER JOIN dbo.TaiKhoan tk ON tk.MaTK = yc.MaTK
      WHERE yc.MaYC = @requestId;
    `);

  const requestRow = queryResult.recordset?.[0] ?? null;

  if (!requestRow) {
    throw createHttpError(404, 'Không tìm thấy yêu cầu thay đổi thông tin xe.');
  }

  const driverProfile = await getDriverProfile(requestRow.MaTK);

  return {
    success: true,
    message: 'Lấy chi tiết yêu cầu thành công.',
    request: mapVehicleChangeRequestRow(requestRow),
    driver: driverProfile.driver,
  };
}

export async function approveVehicleChangeRequest(requestId, payload = {}) {
  const normalizedRequestId = Number(requestId);
  const approvedByAccountId = normalizeText(payload.approvedByAccountId ?? payload.adminAccountId);

  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    throw createHttpError(400, 'Mã yêu cầu thay đổi thông tin xe không hợp lệ.');
  }

  if (!approvedByAccountId) {
    throw createHttpError(400, 'Thiếu thông tin tài khoản quản trị viên duyệt yêu cầu.');
  }

  const pool = await getSqlServerPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const detailResult = await new sql.Request(transaction)
      .input('requestId', sql.Int, normalizedRequestId)
      .query(`
        SELECT TOP 1 *
        FROM dbo.TaiXeYeuCauDoiThongTinXe
        WHERE MaYC = @requestId;
      `);

    const currentRequest = detailResult.recordset?.[0] ?? null;

    if (!currentRequest) {
      throw createHttpError(404, 'Không tìm thấy yêu cầu thay đổi thông tin xe.');
    }

    if (normalizeVehicleChangeRequestStatus(currentRequest.TrangThai) !== 'pending') {
      throw createHttpError(400, 'Yêu cầu này đã được xử lý trước đó.');
    }

    const driverRow = await getDriverRowOrThrow(currentRequest.MaTK, transaction);
    const vehicleInfo = normalizeDriverVehicleInfo(driverRow.ThongTinXe);
    const approvedVehicleName = normalizeText(currentRequest.LoaiXeMoi);
    const approvedLicensePlate = normalizeText(currentRequest.BienSoMoi).toUpperCase();

    const nextVehicleInfo = {
      ...vehicleInfo,
      name: approvedVehicleName,
      vehicleName: approvedVehicleName,
      vehicleType: normalizeVehicleType(approvedVehicleName) || normalizeVehicleType(vehicleInfo.vehicleType),
      licensePlate: approvedLicensePlate,
      bienSoXe: approvedLicensePlate,
    };

    await new sql.Request(transaction)
      .input('driverId', sql.VarChar(20), normalizeText(currentRequest.MaTK))
      .input('vehicleInfo', sql.NVarChar(sql.MAX), JSON.stringify(nextVehicleInfo))
      .query(`
        UPDATE dbo.TaiXe
        SET ThongTinXe = @vehicleInfo,
            NgayCapNhat = SYSDATETIME()
        WHERE MaTK = @driverId;
      `);

    const updatedRequestResult = await new sql.Request(transaction)
      .input('requestId', sql.Int, normalizedRequestId)
      .input('approvedByAccountId', sql.VarChar(20), approvedByAccountId)
      .query(`
        DECLARE @UpdatedRequests TABLE
        (
          MaYC INT,
          MaTK VARCHAR(20),
          LoaiXeCu NVARCHAR(120),
          BienSoCu VARCHAR(20),
          LoaiXeMoi NVARCHAR(120),
          BienSoMoi VARCHAR(20),
          TrangThai VARCHAR(20),
          GhiChuTuChoi NVARCHAR(500),
          NguoiDuyetMaTK VARCHAR(20),
          TaiXeDaXem BIT,
          NgayTao DATETIME2(0),
          NgayCapNhat DATETIME2(0),
          NgayXuLy DATETIME2(0),
          NgayThongBaoTaiXe DATETIME2(0)
        );

        UPDATE dbo.TaiXeYeuCauDoiThongTinXe
        SET TrangThai = 'approved',
            NguoiDuyetMaTK = @approvedByAccountId,
            TaiXeDaXem = 0,
            NgayXuLy = SYSDATETIME(),
            NgayThongBaoTaiXe = SYSDATETIME(),
            GhiChuTuChoi = NULL
        OUTPUT
          INSERTED.MaYC,
          INSERTED.MaTK,
          INSERTED.LoaiXeCu,
          INSERTED.BienSoCu,
          INSERTED.LoaiXeMoi,
          INSERTED.BienSoMoi,
          INSERTED.TrangThai,
          INSERTED.GhiChuTuChoi,
          INSERTED.NguoiDuyetMaTK,
          INSERTED.TaiXeDaXem,
          INSERTED.NgayTao,
          INSERTED.NgayCapNhat,
          INSERTED.NgayXuLy,
          INSERTED.NgayThongBaoTaiXe
        INTO @UpdatedRequests
        WHERE MaYC = @requestId;

        SELECT *
        FROM @UpdatedRequests;
      `);

    await transaction.commit();

    return {
      success: true,
      message: 'Đã duyệt yêu cầu thay đổi thông tin xe.',
      request: mapVehicleChangeRequestRow(updatedRequestResult.recordset?.[0] ?? null),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function rejectVehicleChangeRequest(requestId, payload = {}) {
  const normalizedRequestId = Number(requestId);
  const approvedByAccountId = normalizeText(payload.approvedByAccountId ?? payload.adminAccountId);
  const parsedDecisionPayload = parseVehicleChangeDecisionPayload(payload);

  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    throw createHttpError(400, 'Mã yêu cầu thay đổi thông tin xe không hợp lệ.');
  }

  if (!approvedByAccountId) {
    throw createHttpError(400, 'Thiếu thông tin tài khoản quản trị viên xử lý yêu cầu.');
  }

  const updatedResult = await (await getSqlServerPool())
    .request()
    .input('requestId', sql.Int, normalizedRequestId)
    .input('approvedByAccountId', sql.VarChar(20), approvedByAccountId)
    .input('rejectNote', sql.NVarChar(500), normalizeNullableText(parsedDecisionPayload.note))
    .query(`
      DECLARE @UpdatedRequests TABLE
      (
        MaYC INT,
        MaTK VARCHAR(20),
        LoaiXeCu NVARCHAR(120),
        BienSoCu VARCHAR(20),
        LoaiXeMoi NVARCHAR(120),
        BienSoMoi VARCHAR(20),
        TrangThai VARCHAR(20),
        GhiChuTuChoi NVARCHAR(500),
        NguoiDuyetMaTK VARCHAR(20),
        TaiXeDaXem BIT,
        NgayTao DATETIME2(0),
        NgayCapNhat DATETIME2(0),
        NgayXuLy DATETIME2(0),
        NgayThongBaoTaiXe DATETIME2(0)
      );

      UPDATE dbo.TaiXeYeuCauDoiThongTinXe
      SET TrangThai = 'rejected',
          NguoiDuyetMaTK = @approvedByAccountId,
          TaiXeDaXem = 0,
          NgayXuLy = SYSDATETIME(),
          NgayThongBaoTaiXe = SYSDATETIME(),
          GhiChuTuChoi = @rejectNote
      OUTPUT
        INSERTED.MaYC,
        INSERTED.MaTK,
        INSERTED.LoaiXeCu,
        INSERTED.BienSoCu,
        INSERTED.LoaiXeMoi,
        INSERTED.BienSoMoi,
        INSERTED.TrangThai,
        INSERTED.GhiChuTuChoi,
        INSERTED.NguoiDuyetMaTK,
        INSERTED.TaiXeDaXem,
        INSERTED.NgayTao,
        INSERTED.NgayCapNhat,
        INSERTED.NgayXuLy,
        INSERTED.NgayThongBaoTaiXe
      INTO @UpdatedRequests
      WHERE MaYC = @requestId AND TrangThai = 'pending';

      SELECT *
      FROM @UpdatedRequests;
    `);

  const requestRow = updatedResult.recordset?.[0] ?? null;

  if (!requestRow) {
    throw createHttpError(400, 'Yêu cầu không tồn tại hoặc đã được xử lý trước đó.');
  }

  return {
    success: true,
    message: 'Đã từ chối yêu cầu thay đổi thông tin xe.',
    request: mapVehicleChangeRequestRow(requestRow),
  };
}

export async function listDriverVehicleChangeResolutions(driverId, filters = {}) {
  const normalizedDriverId = normalizeText(driverId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  await getDriverRowOrThrow(normalizedDriverId);

  const request = (await getSqlServerPool())
    .request()
    .input('driverId', sql.VarChar(20), normalizedDriverId);

  const whereConditions = [
    'MaTK = @driverId',
    "TrangThai IN ('approved', 'rejected')",
  ];

  if (String(filters.unseenOnly ?? '').trim().toLowerCase() === 'true') {
    whereConditions.push('TaiXeDaXem = 0');
  }

  const queryResult = await request.query(`
    SELECT TOP 20 *
    FROM dbo.TaiXeYeuCauDoiThongTinXe
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY NgayXuLy DESC, MaYC DESC;
  `);

  return {
    success: true,
    message: 'Lấy kết quả yêu cầu thay đổi thông tin xe thành công.',
    requests: (queryResult.recordset ?? []).map(mapVehicleChangeRequestRow),
  };
}

export async function acknowledgeDriverVehicleChangeResolution(driverId, requestId) {
  const normalizedDriverId = normalizeText(driverId);
  const normalizedRequestId = Number(requestId);

  if (!normalizedDriverId) {
    throw createHttpError(400, 'Mã tài xế không hợp lệ.');
  }

  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    throw createHttpError(400, 'Mã yêu cầu không hợp lệ.');
  }

  const updateResult = await (await getSqlServerPool())
    .request()
    .input('driverId', sql.VarChar(20), normalizedDriverId)
    .input('requestId', sql.Int, normalizedRequestId)
    .query(`
      DECLARE @UpdatedRequests TABLE
      (
        MaYC INT,
        MaTK VARCHAR(20),
        LoaiXeCu NVARCHAR(120),
        BienSoCu VARCHAR(20),
        LoaiXeMoi NVARCHAR(120),
        BienSoMoi VARCHAR(20),
        TrangThai VARCHAR(20),
        GhiChuTuChoi NVARCHAR(500),
        NguoiDuyetMaTK VARCHAR(20),
        TaiXeDaXem BIT,
        NgayTao DATETIME2(0),
        NgayCapNhat DATETIME2(0),
        NgayXuLy DATETIME2(0),
        NgayThongBaoTaiXe DATETIME2(0)
      );

      UPDATE dbo.TaiXeYeuCauDoiThongTinXe
      SET TaiXeDaXem = 1,
          NgayCapNhat = SYSDATETIME()
      OUTPUT
        INSERTED.MaYC,
        INSERTED.MaTK,
        INSERTED.LoaiXeCu,
        INSERTED.BienSoCu,
        INSERTED.LoaiXeMoi,
        INSERTED.BienSoMoi,
        INSERTED.TrangThai,
        INSERTED.GhiChuTuChoi,
        INSERTED.NguoiDuyetMaTK,
        INSERTED.TaiXeDaXem,
        INSERTED.NgayTao,
        INSERTED.NgayCapNhat,
        INSERTED.NgayXuLy,
        INSERTED.NgayThongBaoTaiXe
      INTO @UpdatedRequests
      WHERE MaYC = @requestId
        AND MaTK = @driverId
        AND TrangThai IN ('approved', 'rejected');

      SELECT *
      FROM @UpdatedRequests;
    `);

  const acknowledgedRow = updateResult.recordset?.[0] ?? null;

  if (!acknowledgedRow) {
    throw createHttpError(404, 'Không tìm thấy kết quả yêu cầu cần xác nhận.');
  }

  return {
    success: true,
    message: 'Đã xác nhận thông báo kết quả yêu cầu đổi thông tin xe.',
    request: mapVehicleChangeRequestRow(acknowledgedRow),
  };
}
