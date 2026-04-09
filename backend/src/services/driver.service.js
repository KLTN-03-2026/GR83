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

  const rawVehicleImages = rawVehicleInfo.images ?? rawVehicleInfo.vehicleImages ?? {};

  return {
    front: normalizeDriverAssetPath(rawVehicleImages.front ?? rawVehicleInfo.frontImage ?? rawVehicleInfo.hinhTruoc),
    side: normalizeDriverAssetPath(
      rawVehicleImages.side ?? rawVehicleInfo.sideImage ?? rawVehicleInfo.image ?? rawVehicleInfo.vehicleImage ?? rawVehicleInfo.hinhXe,
    ),
    rear: normalizeDriverAssetPath(rawVehicleImages.rear ?? rawVehicleInfo.rearImage ?? rawVehicleInfo.hinhSau),
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
  const vehicleInfo = safeJsonParse(row.ThongTinXe, {});
  const emergencyContact = parseEmergencyContact(row.LienHeKC);
  const driverState = getDriverState(row.TrangThaiTaiKhoan, row.TrangThaiTaiXe);

  const storedVehicleImages = parseDriverVehicleImages(vehicleInfo);
  const storedIdentityImages = parseDriverDocumentImages(vehicleInfo.identityImages ?? vehicleInfo.cccdImages);
  const storedLicenseImagesFromVehicle = parseDriverDocumentImages(vehicleInfo.licenseImages ?? vehicleInfo.bangLaiImages);
  const storedLicenseImagesFromColumn = parseDriverDocumentImages(safeJsonParse(row.BangLai, row.BangLai));

  const normalizedIdentityImages = {
    front: storedIdentityImages.front,
    back: storedIdentityImages.back,
  };

  const normalizedLicenseImages = {
    front: storedLicenseImagesFromVehicle.front || storedLicenseImagesFromColumn.front,
    back: storedLicenseImagesFromVehicle.back || storedLicenseImagesFromColumn.back,
  };

  const normalizedVehicleImages = {
    front: storedVehicleImages.front,
    side: storedVehicleImages.side,
    rear: storedVehicleImages.rear,
  };

  const normalizedVehicleInfo = {
    image:
      normalizeDriverAssetPath(vehicleInfo.image ?? vehicleInfo.vehicleImage) ||
      normalizedVehicleImages.side ||
      normalizedVehicleImages.front ||
      normalizedVehicleImages.rear,
    licensePlate: normalizeText(vehicleInfo.licensePlate ?? vehicleInfo.bienSoXe),
    name: normalizeText(vehicleInfo.name ?? vehicleInfo.vehicleName ?? vehicleInfo.tenXe),
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
  const rawVehicleImages = rawVehicleInfo.images ?? rawVehicleInfo.vehicleImages ?? {};
  const vehicleFrontImage = normalizeDriverAssetPath(
    payload.vehicleFrontImage ?? rawVehicleImages.front ?? rawVehicleInfo.frontImage,
  );
  const vehicleSideImage = normalizeDriverAssetPath(
    payload.vehicleSideImage ?? rawVehicleImages.side ?? rawVehicleInfo.sideImage ?? rawVehicleInfo.image ?? rawVehicleInfo.vehicleImage,
  );
  const vehicleRearImage = normalizeDriverAssetPath(
    payload.vehicleRearImage ?? rawVehicleImages.rear ?? rawVehicleInfo.rearImage,
  );

  const vehicleLicensePlate = normalizeText(
    payload.licensePlate ?? rawVehicleInfo.licensePlate ?? rawVehicleInfo.bienSoXe,
  ).toUpperCase();
  const vehicleName = normalizeText(payload.vehicleName ?? rawVehicleInfo.name ?? rawVehicleInfo.vehicleName ?? rawVehicleInfo.tenXe);

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
      vehicleSideImage,
      vehicleRearImage,
    ].filter((value) => !value).length;

    if (missingDocumentCount > 0) {
      throw createHttpError(400, 'Vui lòng tải đầy đủ ảnh hồ sơ tài xế (avatar, CCCD, bằng lái, lý lịch và 3 ảnh xe).');
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
      image: vehicleImage,
      licensePlate: vehicleLicensePlate,
      name: vehicleName,
      images: {
        front: vehicleFrontImage,
        side: vehicleSideImage,
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

    const currentVehicleInfo = safeJsonParse(existingDriver.ThongTinXe, {});
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
      name: parsedPayload.vehicleInfo.name || normalizeText(currentVehicleInfo.name ?? currentVehicleInfo.vehicleName),
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
