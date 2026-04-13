import { closeIcon } from '../../assets/icons';
import { adminDriverService } from '../../services/adminDriverService';
import ConfirmDialog from '../ui/ConfirmDialog';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';

const DRIVER_STATUS_META = {
  active: { label: 'Hoạt động', tone: 'active' },
  locked: { label: 'Bị khóa', tone: 'locked' },
  pending: { label: 'Chờ duyệt', tone: 'pending' },
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả', tone: 'neutral' },
  { value: 'active', label: 'Hoạt động', tone: 'active' },
  { value: 'locked', label: 'Bị khóa', tone: 'locked' },
  { value: 'pending', label: 'Chờ duyệt', tone: 'pending' },
];
const DRIVER_BANK_NAME_OPTIONS = [
  'ABBANK',
  'ACB',
  'Agribank',
  'ANZ Việt Nam',
  'BAC A BANK',
  'BAOVIET Bank',
  'BIDV',
  'BVBank',
  'CBBank',
  'CIMB Việt Nam',
  'Co-opBank',
  'DBS Bank Việt Nam',
  'DongA Bank',
  'Eximbank',
  'GPBank',
  'HDBank',
  'Hong Leong Bank Việt Nam',
  'HSBC Việt Nam',
  'Indovina Bank',
  'KBank Việt Nam',
  'KienlongBank',
  'LPBank',
  'MB',
  'MSB',
  'Nam A Bank',
  'NCB',
  'OCB',
  'OceanBank',
  'PGBank',
  'Public Bank Việt Nam',
  'PVcomBank',
  'Sacombank',
  'Saigonbank',
  'SCB',
  'SeABank',
  'SHB',
  'Shinhan Bank Việt Nam',
  'Standard Chartered Việt Nam',
  'Techcombank',
  'TPBank',
  'UOB Việt Nam',
  'VBSP (Ngân hàng Chính sách xã hội)',
  'VDB (Ngân hàng Phát triển Việt Nam)',
  'VIB',
  'Viet A Bank',
  'Vietbank',
  'VietCapitalBank',
  'Vietcombank',
  'VietinBank',
  'VPBank',
  'Woori Bank Việt Nam',
];
const frontendApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const backendPublicBaseUrl = frontendApiBaseUrl.replace(/\/?api\/?$/, '');

function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

function buildDriverImageCandidateUrls(imageValue, fallbackDirectories = []) {
  const normalizedValue = String(imageValue ?? '').trim();

  if (!normalizedValue) {
    return [];
  }

  if (/^https?:\/\//i.test(normalizedValue) || normalizedValue.startsWith('data:')) {
    return [normalizedValue];
  }

  if (normalizedValue.startsWith('/')) {
    const candidates = [`${backendPublicBaseUrl}${normalizedValue}`];

    if (normalizedValue.toLowerCase().startsWith('/uploads/')) {
      const fileNameOnly = normalizedValue.split('/').filter(Boolean).pop() ?? '';

      if (fileNameOnly) {
        const encodedFileName = encodePathSegment(fileNameOnly);
        const baseDirectories = fallbackDirectories
          .map((directory) => String(directory ?? '').trim())
          .filter(Boolean)
          .map((directory) => (directory.startsWith('/') ? directory : `/${directory}`));

        baseDirectories.forEach((directory) => {
          candidates.push(`${backendPublicBaseUrl}${directory}/${encodedFileName}`);
        });
      }
    }

    return Array.from(new Set(candidates));
  }

  if (normalizedValue.includes('/')) {
    const encodedPath = normalizedValue
      .split('/')
      .filter(Boolean)
      .map(encodePathSegment)
      .join('/');
    return [`${backendPublicBaseUrl}/${encodedPath}`];
  }

  const encodedFileName = encodePathSegment(normalizedValue);
  const baseDirectories = fallbackDirectories
    .map((directory) => String(directory ?? '').trim())
    .filter(Boolean)
    .map((directory) => (directory.startsWith('/') ? directory : `/${directory}`));

  const candidateUrls = baseDirectories.map((directory) => `${backendPublicBaseUrl}${directory}/${encodedFileName}`);

  if (!baseDirectories.includes('/uploads')) {
    candidateUrls.push(`${backendPublicBaseUrl}/uploads/${encodedFileName}`);
  }

  return Array.from(new Set(candidateUrls));
}

function isDriverApproved(driver = null) {
  const normalizedDriverStatus = String(driver?.driverStatus ?? '')
    .trim()
    .toLowerCase();

  return normalizedDriverStatus === 'hoatdong' || normalizedDriverStatus === 'hoantat';
}

function isDriverAccountLocked(driver = null) {
  return String(driver?.accountStatus ?? '')
    .trim()
    .toLowerCase() === 'khoa';
}

function DriverImagePreview({ label, value, file = null, fallbackDirectories = [], showEmptyState = false }) {
  const localFilePreviewUrl = useMemo(() => (isFileInstance(file) ? URL.createObjectURL(file) : ''), [file]);
  const fallbackDirectoryKey = Array.isArray(fallbackDirectories) ? fallbackDirectories.join('|') : '';
  const candidateUrls = useMemo(
    () => (localFilePreviewUrl ? [localFilePreviewUrl] : buildDriverImageCandidateUrls(value, fallbackDirectories)),
    [value, fallbackDirectoryKey, localFilePreviewUrl],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
    setHasLoadError(false);
  }, [value, fallbackDirectoryKey, localFilePreviewUrl]);

  useEffect(
    () => () => {
      if (localFilePreviewUrl) {
        URL.revokeObjectURL(localFilePreviewUrl);
      }
    },
    [localFilePreviewUrl],
  );

  const resolvedUrl = candidateUrls[candidateIndex] ?? '';

  if (!resolvedUrl || hasLoadError) {
    return showEmptyState ? (
      <div className="admin-driver-modal__image-frame is-empty" aria-label={`Khung ảnh ${label}`}></div>
    ) : null;
  }

  const handleImageLoadError = () => {
    if (candidateIndex < candidateUrls.length - 1) {
      setCandidateIndex((currentIndex) => currentIndex + 1);
      return;
    }

    setHasLoadError(true);
  };

  return (
    <div className="admin-driver-modal__image-frame" title={label}>
      <img src={resolvedUrl} alt={label} loading="lazy" onError={handleImageLoadError} />
    </div>
  );
}

function normalizeSearchToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function sanitizePhoneDigits(value, maxLength = 15) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, maxLength);
}

function sanitizeCccdDigits(value, maxLength = 12) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, maxLength);
}

function normalizeUploadedDriverAssetPath(value) {
  const normalizedValue = String(value ?? '').trim();

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

function isFileInstance(fileValue) {
  return typeof File !== 'undefined' && fileValue instanceof File;
}

function createEmptyDriverDocumentFiles() {
  return {
    avatarFile: null,
    identityFrontFile: null,
    identityBackFile: null,
    licenseFrontFile: null,
    licenseBackFile: null,
    backgroundFile: null,
    vehicleFrontFile: null,
    vehicleSideFile: null,
    vehicleRearFile: null,
  };
}

function buildDriverDocumentUploadFormData(driverDocumentFiles = {}) {
  const documentUploadFormData = new FormData();
  let hasFiles = false;

  const appendIfFileExists = (fieldName, fileValue) => {
    if (!isFileInstance(fileValue)) {
      return;
    }

    documentUploadFormData.append(fieldName, fileValue);
    hasFiles = true;
  };

  appendIfFileExists('portrait', driverDocumentFiles.avatarFile);
  appendIfFileExists('identityFront', driverDocumentFiles.identityFrontFile);
  appendIfFileExists('identityBack', driverDocumentFiles.identityBackFile);
  appendIfFileExists('licenseFront', driverDocumentFiles.licenseFrontFile);
  appendIfFileExists('licenseBack', driverDocumentFiles.licenseBackFile);
  appendIfFileExists('background', driverDocumentFiles.backgroundFile);
  appendIfFileExists('vehicleFront', driverDocumentFiles.vehicleFrontFile);
  appendIfFileExists('vehicleSide', driverDocumentFiles.vehicleSideFile);
  appendIfFileExists('vehicleRear', driverDocumentFiles.vehicleRearFile);

  return {
    formData: documentUploadFormData,
    hasFiles,
  };
}

function mergeDriverFormWithUploadedPaths(driverForm = {}, uploadedDocumentPaths = {}) {
  const normalizedUploadedDocumentPaths =
    uploadedDocumentPaths && typeof uploadedDocumentPaths === 'object' ? uploadedDocumentPaths : {};

  const avatar =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.portrait) ||
    String(driverForm.avatar ?? '').trim();
  const identityFrontImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.identityFront) ||
    String(driverForm.identityFrontImage ?? '').trim();
  const identityBackImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.identityBack) ||
    String(driverForm.identityBackImage ?? '').trim();
  const licenseFrontImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.licenseFront) ||
    String(driverForm.licenseFrontImage ?? driverForm.licenseImage ?? '').trim();
  const licenseBackImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.licenseBack) ||
    String(driverForm.licenseBackImage ?? '').trim();
  const backgroundImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.background) ||
    String(driverForm.backgroundImage ?? '').trim();
  const vehicleFrontImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleFront) ||
    String(driverForm.vehicleFrontImage ?? '').trim();
  const vehicleSideImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleSide) ||
    String(driverForm.vehicleSideImage ?? '').trim();
  const vehicleRearImage =
    normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleRear) ||
    String(driverForm.vehicleRearImage ?? '').trim();

  return {
    ...driverForm,
    avatar,
    identityFrontImage,
    identityBackImage,
    licenseImage: licenseFrontImage,
    licenseFrontImage,
    licenseBackImage,
    backgroundImage,
    vehicleFrontImage,
    vehicleSideImage,
    vehicleRearImage,
    vehicleImage:
      vehicleSideImage ||
      vehicleFrontImage ||
      vehicleRearImage ||
      String(driverForm.vehicleImage ?? '').trim(),
  };
}

function hasCompleteDriverDocumentSet(driverForm = {}) {
  const requiredDocumentImages = [
    driverForm.avatar,
    driverForm.identityFrontImage,
    driverForm.identityBackImage,
    driverForm.licenseFrontImage ?? driverForm.licenseImage,
    driverForm.licenseBackImage,
    driverForm.backgroundImage,
    driverForm.vehicleFrontImage,
    driverForm.vehicleSideImage,
    driverForm.vehicleRearImage,
  ];

  return requiredDocumentImages.every((imageValue) => Boolean(normalizeUploadedDriverAssetPath(imageValue)));
}

function createEmptyDriverForm() {
  return {
    fullName: '',
    phone: '',
    email: '',
    address: '',
    cccd: '',
    avatar: '',
    licenseImage: '',
    identityFrontImage: '',
    identityBackImage: '',
    licenseFrontImage: '',
    licenseBackImage: '',
    backgroundImage: '',
    vehicleName: '',
    vehicleImage: '',
    vehicleFrontImage: '',
    vehicleSideImage: '',
    vehicleRearImage: '',
    licensePlate: '',
    bankName: '',
    bankAccountNumber: '',
    bankAccountHolder: '',
    emergencyRelationship: '',
    emergencyFullName: '',
    emergencyPhone: '',
    emergencyAddress: '',
  };
}

function buildDriverFormFromDriver(driver = null) {
  if (!driver) {
    return createEmptyDriverForm();
  }

  const driverIdentityImages = driver.identityImages ?? driver.vehicleInfo?.identityImages ?? {};
  const driverLicenseImages = driver.licenseImages ?? driver.vehicleInfo?.licenseImages ?? {};
  const driverVehicleImages = driver.vehicleImages ?? driver.vehicleInfo?.images ?? {};

  const identityFrontImage = String(driverIdentityImages.front ?? '').trim();
  const identityBackImage = String(driverIdentityImages.back ?? '').trim();
  const licenseFrontImage = String(driverLicenseImages.front ?? driver.licenseImage ?? '').trim();
  const licenseBackImage = String(driverLicenseImages.back ?? '').trim();
  const vehicleFrontImage = String(driverVehicleImages.front ?? '').trim();
  const vehicleSideImage = String(driverVehicleImages.side ?? '').trim();
  const vehicleRearImage = String(driverVehicleImages.rear ?? '').trim();
  const vehicleImage = String(
    driver.vehicleInfo?.image ??
      vehicleSideImage ??
      vehicleFrontImage ??
      vehicleRearImage,
  ).trim();

  return {
    fullName: String(driver.name ?? '').trim(),
    phone: String(driver.phone ?? '').trim(),
    email: String(driver.email ?? '').trim(),
    address: String(driver.address ?? '').trim(),
    cccd: String(driver.cccd ?? '').trim(),
    avatar: String(driver.avatar ?? '').trim(),
    licenseImage: licenseFrontImage,
    identityFrontImage,
    identityBackImage,
    licenseFrontImage,
    licenseBackImage,
    backgroundImage: String(driver.backgroundImage ?? '').trim(),
    vehicleName: String(driver.vehicleInfo?.name ?? '').trim(),
    vehicleImage,
    vehicleFrontImage,
    vehicleSideImage,
    vehicleRearImage,
    licensePlate: String(driver.vehicleInfo?.licensePlate ?? driver.licensePlate ?? '').trim(),
    bankName: String(driver.bank?.bankName ?? '').trim(),
    bankAccountNumber: String(driver.bank?.accountNumber ?? '').trim(),
    bankAccountHolder: String(driver.bank?.accountHolder ?? '').trim(),
    emergencyRelationship: String(driver.emergencyContact?.relationship ?? '').trim(),
    emergencyFullName: String(driver.emergencyContact?.fullName ?? '').trim(),
    emergencyPhone: String(driver.emergencyContact?.phone ?? '').trim(),
    emergencyAddress: String(driver.emergencyContact?.address ?? '').trim(),
  };
}

function buildDriverFormSnapshot(driverForm = null) {
  if (!driverForm) {
    return createEmptyDriverForm();
  }

  return {
    fullName: String(driverForm.fullName ?? '').trim(),
    phone: String(driverForm.phone ?? '').trim(),
    email: String(driverForm.email ?? '').trim(),
    address: String(driverForm.address ?? '').trim(),
    cccd: String(driverForm.cccd ?? '').trim(),
    avatar: String(driverForm.avatar ?? '').trim(),
    licenseImage: String(driverForm.licenseImage ?? '').trim(),
    identityFrontImage: String(driverForm.identityFrontImage ?? '').trim(),
    identityBackImage: String(driverForm.identityBackImage ?? '').trim(),
    licenseFrontImage: String(driverForm.licenseFrontImage ?? '').trim(),
    licenseBackImage: String(driverForm.licenseBackImage ?? '').trim(),
    backgroundImage: String(driverForm.backgroundImage ?? '').trim(),
    vehicleName: String(driverForm.vehicleName ?? '').trim(),
    vehicleImage: String(driverForm.vehicleImage ?? '').trim(),
    vehicleFrontImage: String(driverForm.vehicleFrontImage ?? '').trim(),
    vehicleSideImage: String(driverForm.vehicleSideImage ?? '').trim(),
    vehicleRearImage: String(driverForm.vehicleRearImage ?? '').trim(),
    licensePlate: String(driverForm.licensePlate ?? '').trim(),
    bankName: String(driverForm.bankName ?? '').trim(),
    bankAccountNumber: String(driverForm.bankAccountNumber ?? '').trim(),
    bankAccountHolder: String(driverForm.bankAccountHolder ?? '').trim(),
    emergencyRelationship: String(driverForm.emergencyRelationship ?? '').trim(),
    emergencyFullName: String(driverForm.emergencyFullName ?? '').trim(),
    emergencyPhone: String(driverForm.emergencyPhone ?? '').trim(),
    emergencyAddress: String(driverForm.emergencyAddress ?? '').trim(),
  };
}

function buildPayloadFromDriverForm(driverForm = {}) {
  const identityImages = {
    front: String(driverForm.identityFrontImage ?? '').trim(),
    back: String(driverForm.identityBackImage ?? '').trim(),
  };

  const licenseImages = {
    front: String(driverForm.licenseFrontImage ?? driverForm.licenseImage ?? '').trim(),
    back: String(driverForm.licenseBackImage ?? '').trim(),
  };

  const vehicleImages = {
    front: String(driverForm.vehicleFrontImage ?? '').trim(),
    side: String(driverForm.vehicleSideImage ?? '').trim(),
    rear: String(driverForm.vehicleRearImage ?? '').trim(),
  };

  const resolvedVehicleImage =
    String(driverForm.vehicleImage ?? '').trim() || vehicleImages.side || vehicleImages.front || vehicleImages.rear;

  return {
    fullName: String(driverForm.fullName ?? '').trim(),
    phone: String(driverForm.phone ?? '').trim(),
    email: String(driverForm.email ?? '').trim(),
    address: String(driverForm.address ?? '').trim(),
    cccd: String(driverForm.cccd ?? '').trim(),
    avatar: String(driverForm.avatar ?? '').trim(),
    identityImages,
    licenseImage: licenseImages.front,
    licenseImages,
    backgroundImage: String(driverForm.backgroundImage ?? '').trim(),
    vehicleInfo: {
      name: String(driverForm.vehicleName ?? '').trim(),
      image: resolvedVehicleImage,
      licensePlate: String(driverForm.licensePlate ?? '').trim(),
      images: vehicleImages,
      identityImages,
      licenseImages,
    },
    bank: {
      bankName: String(driverForm.bankName ?? '').trim(),
      accountNumber: String(driverForm.bankAccountNumber ?? '').trim(),
      accountHolder: String(driverForm.bankAccountHolder ?? '').trim(),
    },
    emergencyContact: {
      relationship: String(driverForm.emergencyRelationship ?? '').trim(),
      fullName: String(driverForm.emergencyFullName ?? '').trim(),
      phone: String(driverForm.emergencyPhone ?? '').trim(),
      address: String(driverForm.emergencyAddress ?? '').trim(),
    },
  };
}

function validateDriverForm(driverForm) {
  const fullName = String(driverForm.fullName ?? '').trim();
  const phone = String(driverForm.phone ?? '').trim();
  const cccd = String(driverForm.cccd ?? '').trim();
  const licensePlate = String(driverForm.licensePlate ?? '').trim();
  const vehicleLicensePlatePattern = /^\d{2}[A-Z]{1,2}-\d{3,5}(?:\.\d{2})?$/i;
  const phoneNumberPattern = /^\d{8,15}$/;
  const cccdPattern = /^\d{12}$/;

  if (!fullName || !phone || !cccd || !licensePlate) {
    return 'Vui lòng nhập đầy đủ Tên tài xế, SĐT, CCCD và Biển số.';
  }

  if (!phoneNumberPattern.test(phone)) {
    return 'SĐT tài xế chỉ được chứa chữ số (8-15 số).';
  }

  if (!cccdPattern.test(cccd)) {
    return 'CCCD không hợp lệ (phải đúng 12 chữ số).';
  }

  const emergencyPhone = String(driverForm.emergencyPhone ?? '').trim();

  if (emergencyPhone && !phoneNumberPattern.test(emergencyPhone)) {
    return 'SĐT liên hệ khẩn cấp chỉ được chứa chữ số (8-15 số).';
  }

  if (!vehicleLicensePlatePattern.test(licensePlate.toUpperCase())) {
    return 'Biển số xe không đúng định dạng. Ví dụ hợp lệ: 43A-12345 hoặc 43A-123.45';
  }

  return '';
}

export default function AdminDriverManagementModal({ open = false, onClose }) {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editorMode, setEditorMode] = useState('none');
  const [editingDriverId, setEditingDriverId] = useState('');
  const [driverForm, setDriverForm] = useState(createEmptyDriverForm);
  const [driverInitialSnapshot, setDriverInitialSnapshot] = useState(createEmptyDriverForm);
  const [driverDocumentFiles, setDriverDocumentFiles] = useState(createEmptyDriverDocumentFiles);
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');
  const [activeActionKey, setActiveActionKey] = useState('');
  const [driverLockConfirm, setDriverLockConfirm] = useState(null);

  const editingDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(editingDriverId)) ?? null,
    [drivers, editingDriverId],
  );

  const filterCounts = useMemo(() => {
    const countResult = {
      all: drivers.length,
      active: 0,
      locked: 0,
      pending: 0,
    };

    drivers.forEach((driver) => {
      if (driver.status === 'active') {
        countResult.active += 1;
      }

      if (driver.status === 'locked') {
        countResult.locked += 1;
      }

      if (driver.status === 'pending') {
        countResult.pending += 1;
      }
    });

    return countResult;
  }, [drivers]);

  const filteredDrivers = useMemo(() => {
    const normalizedKeyword = normalizeSearchToken(searchKeyword);

    return drivers.filter((driver) => {
      if (statusFilter !== 'all' && driver.status !== statusFilter) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      const searchBundle = normalizeSearchToken(
        `${driver.name ?? ''} ${driver.phone ?? ''} ${driver.licensePlate ?? driver.vehicleInfo?.licensePlate ?? ''}`,
      );

      return searchBundle.includes(normalizedKeyword);
    });
  }, [drivers, searchKeyword, statusFilter]);

  const filteredBankOptions = useMemo(() => {
    const normalizedKeyword = normalizeSearchToken(driverForm.bankName);

    if (!normalizedKeyword) {
      return DRIVER_BANK_NAME_OPTIONS;
    }

    return DRIVER_BANK_NAME_OPTIONS.filter((bankOption) =>
      normalizeSearchToken(bankOption).includes(normalizedKeyword),
    );
  }, [driverForm.bankName]);

  const isBusy = loading || Boolean(activeActionKey);

  const fetchDrivers = async ({ showLoader = true } = {}) => {
    if (showLoader) {
      setLoading(true);
    }

    setRequestError('');

    try {
      const result = await adminDriverService.listDrivers();
      setDrivers(Array.isArray(result?.drivers) ? result.drivers : []);
    } catch (error) {
      setRequestError(error.message || 'Không thể tải danh sách tài xế lúc này.');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    void fetchDrivers({ showLoader: true });
  }, [open]);

  useEffect(() => {
    if (open) {
      return;
    }

    setDrivers([]);
    setSearchKeyword('');
    setStatusFilter('all');
    setEditorMode('none');
    setEditingDriverId('');
    setDriverForm(createEmptyDriverForm());
    setDriverInitialSnapshot(createEmptyDriverForm());
    setDriverDocumentFiles(createEmptyDriverDocumentFiles());
    setBankDropdownOpen(false);
    setFormError('');
    setRequestError('');
    setActionFeedback('');
    setActiveActionKey('');
    setDriverLockConfirm(null);
  }, [open]);

  useEffect(() => {
    if (!actionFeedback) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setActionFeedback('');
    }, 2600);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [actionFeedback]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const closeEditor = () => {
    setEditorMode('none');
    setEditingDriverId('');
    setDriverForm(createEmptyDriverForm());
    setDriverInitialSnapshot(createEmptyDriverForm());
    setDriverDocumentFiles(createEmptyDriverDocumentFiles());
    setBankDropdownOpen(false);
    setFormError('');
  };

  const openCreateDriverForm = () => {
    setEditorMode('create');
    setEditingDriverId('');
    setDriverForm(createEmptyDriverForm());
    setDriverInitialSnapshot(createEmptyDriverForm());
    setDriverDocumentFiles(createEmptyDriverDocumentFiles());
    setBankDropdownOpen(false);
    setFormError('');
    setRequestError('');
  };

  const openViewDriver = (driver) => {
    setEditorMode('view');
    setEditingDriverId(driver.id);
    const nextDriverForm = buildDriverFormFromDriver(driver);

    setDriverForm(nextDriverForm);
    setDriverInitialSnapshot(buildDriverFormSnapshot(nextDriverForm));
    setDriverDocumentFiles(createEmptyDriverDocumentFiles());
    setBankDropdownOpen(false);
    setFormError('');
  };

  const openEditDriver = (driver) => {
    setEditorMode('edit');
    setEditingDriverId(driver.id);
    const nextDriverForm = buildDriverFormFromDriver(driver);

    setDriverForm(nextDriverForm);
    setDriverInitialSnapshot(buildDriverFormSnapshot(nextDriverForm));
    setDriverDocumentFiles(createEmptyDriverDocumentFiles());
    setBankDropdownOpen(false);
    setFormError('');
  };

  const switchViewerToEditMode = (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    const currentDriver = editingDriver;

    if (currentDriver && !isDriverApproved(currentDriver)) {
      setFormError('Chỉ hồ sơ đã duyệt mới được chỉnh sửa.');
      return;
    }

    if (currentDriver) {
      openEditDriver(currentDriver);
      return;
    }

    setEditorMode('edit');
    setFormError('');

    setDriverForm((current) => ({
      ...current,
    }));
  };

  const runDriverAction = async (actionKey, actionFn, successFallbackMessage) => {
    setActiveActionKey(actionKey);
    setRequestError('');

    try {
      const result = await actionFn();
      setActionFeedback(result?.message ?? successFallbackMessage);
      await fetchDrivers({ showLoader: false });
    } catch (error) {
      setRequestError(error.message || 'Không thể xử lý thao tác tài xế lúc này.');
    } finally {
      setActiveActionKey('');
    }
  };

  const handleApproveDriver = async (driverId) => {
    await runDriverAction(
      `approve-${driverId}`,
      () => adminDriverService.approveDriver(driverId),
      'Đã duyệt tài xế thành công.',
    );
  };

  const handleRejectDriver = async (driverId) => {
    await runDriverAction(
      `reject-${driverId}`,
      () => adminDriverService.rejectDriver(driverId),
      'Đã từ chối tài xế.',
    );
  };

  const handleToggleDriverLock = async (driver) => {
    if (isDriverAccountLocked(driver)) {
      setRequestError('Tài khoản đang bị khóa. Hãy mở khóa tài khoản trước khi mở chức năng Tài xế.');
      return;
    }

    const driverName = String(driver.name ?? 'tài xế này').trim() || 'tài xế này';
    const isUnlockAction = driver.status === 'locked';

    setDriverLockConfirm({
      driverId: String(driver.id),
      driverName,
      action: isUnlockAction ? 'unlock' : 'lock',
    });
  };

  const confirmDriverLockAction = async () => {
    if (!driverLockConfirm) {
      return;
    }

    const { driverId, action } = driverLockConfirm;
    setDriverLockConfirm(null);

    if (action === 'unlock') {
      await runDriverAction(
        `unlock-${driverId}`,
        () => adminDriverService.unlockDriver(driverId),
        'Đã mở lại chức năng Tài xế và khôi phục quyền Tài xế.',
      );
      return;
    }

    await runDriverAction(
      `lock-${driverId}`,
      () => adminDriverService.lockDriver(driverId),
      'Đã khóa chức năng Tài xế (không khóa tài khoản). Quyền đã chuyển về Khách hàng.',
    );
  };

  const cancelDriverLockConfirm = () => {
    setDriverLockConfirm(null);
  };

  const handleDriverFormChange = (field, value) => {
    const normalizedValue =
      field === 'phone' || field === 'emergencyPhone'
        ? sanitizePhoneDigits(value)
        : field === 'cccd'
          ? sanitizeCccdDigits(value)
          : value;

    setDriverForm((current) => ({
      ...current,
      [field]: normalizedValue,
    }));
  };

  const handleBankOptionSelect = (bankOption) => {
    handleDriverFormChange('bankName', bankOption);
    setBankDropdownOpen(false);
  };

  const handleDriverDocumentFileChange = (fieldName, event) => {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type?.startsWith('image/')) {
      setFormError('Vui lòng chọn tệp ảnh hợp lệ (JPG, PNG, WEBP...).');
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setFormError('Mỗi ảnh hồ sơ tài xế chỉ được tối đa 5MB.');
      return;
    }

    setDriverDocumentFiles((current) => ({
      ...current,
      [fieldName]: selectedFile,
    }));
    setFormError('');
  };

  const renderImageUploadFrame = ({
    fieldName,
    inputId,
    fieldLabel,
    imageLabel,
    value,
    fallbackDirectories,
  }) => {
    const selectedFile = driverDocumentFiles[fieldName];
    const hasImage = Boolean(String(value ?? '').trim() || selectedFile);
    const uploadHintText = hasImage ? 'Nhấn vào khung để đổi ảnh' : 'Nhấn vào khung để tải ảnh';

    return (
      <div className="admin-driver-modal__image-item">
        <span>{fieldLabel}</span>

        {editorMode === 'view' ? null : (
          <input
            id={inputId}
            className="admin-driver-modal__file-input"
            type="file"
            accept="image/*"
            onChange={(event) => handleDriverDocumentFileChange(fieldName, event)}
            disabled={isBusy}
          />
        )}

        {editorMode === 'view' ? (
          <div className="admin-driver-modal__image-upload-frame is-readonly">
            <DriverImagePreview
              label={imageLabel}
              value={value}
              file={selectedFile}
              fallbackDirectories={fallbackDirectories}
              showEmptyState
            />
            {!hasImage ? <span className="admin-driver-modal__image-upload-hint">Chưa có ảnh</span> : null}
          </div>
        ) : (
          <label className="admin-driver-modal__image-upload-frame" htmlFor={inputId}>
            <DriverImagePreview
              label={imageLabel}
              value={value}
              file={selectedFile}
              fallbackDirectories={fallbackDirectories}
              showEmptyState
            />
            <span className="admin-driver-modal__image-upload-hint">{uploadHintText}</span>
          </label>
        )}
      </div>
    );
  };

  const handleSaveDriver = async (event) => {
    event.preventDefault();

    if (editorMode === 'view') {
      return;
    }

    setFormError('');
    setRequestError('');

    const validationError = validateDriverForm(driverForm);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (editorMode === 'edit') {
      const hasDriverDocumentChanges = Object.values(driverDocumentFiles).some((fileValue) => Boolean(fileValue));
      const currentSnapshot = buildDriverFormSnapshot(driverForm);
      const baselineSnapshot = driverInitialSnapshot ?? createEmptyDriverForm();

      if (!hasDriverDocumentChanges && JSON.stringify(currentSnapshot) === JSON.stringify(baselineSnapshot)) {
        setFormError('Thông tin chưa thay đổi. Hãy chỉnh sửa trước khi Lưu thay đổi.');
        return;
      }
    }

    setActiveActionKey('save-driver');

    try {
      let nextDriverForm = driverForm;

      const { formData: driverDocumentUploadFormData, hasFiles: hasNewUploadFiles } =
        buildDriverDocumentUploadFormData(driverDocumentFiles);

      if (hasNewUploadFiles) {
        const uploadResult = await adminDriverService.uploadDriverDocuments(driverDocumentUploadFormData);
        const uploadedDocumentPaths = uploadResult?.files ?? {};

        nextDriverForm = mergeDriverFormWithUploadedPaths(driverForm, uploadedDocumentPaths);
        setDriverForm(nextDriverForm);
        setDriverDocumentFiles(createEmptyDriverDocumentFiles());
      }

      if (editorMode === 'create' && !hasCompleteDriverDocumentSet(nextDriverForm)) {
        setFormError('Vui lòng tải đủ ảnh hồ sơ tài xế: avatar, CCCD 2 mặt, bằng lái 2 mặt, lý lịch và 3 ảnh xe.');
        return;
      }

      const payload = buildPayloadFromDriverForm(nextDriverForm);

      const result =
        editorMode === 'create'
          ? await adminDriverService.createDriver(payload)
          : await adminDriverService.updateDriver(editingDriverId, payload);

      setActionFeedback(
        result?.message ?? (editorMode === 'create' ? 'Đã thêm tài xế mới thành công.' : 'Đã cập nhật tài xế thành công.'),
      );
      closeEditor();
      await fetchDrivers({ showLoader: false });
    } catch (error) {
      setRequestError(error.message || 'Không thể lưu thông tin tài xế lúc này.');
    } finally {
      setActiveActionKey('');
    }
  };

  return createPortal(
    <div className="admin-driver-modal" role="dialog" aria-modal="true" aria-label="Quản lý tài xế">
      <div className="admin-driver-modal__backdrop" onClick={onClose} aria-hidden="true" />

      <div className="admin-driver-modal__window">
        <button className="admin-driver-modal__close" type="button" onClick={onClose} aria-label="Đóng quản lý tài xế">
          <img className="admin-driver-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="admin-driver-modal__header">
          <div className="admin-driver-modal__header-copy">
            <p className="admin-driver-modal__eyebrow">ADMIN / TÀI XẾ</p>
            <h3>Quản lý tài xế</h3>
            <p>Điều phối hồ sơ tài xế và trạng thái hoạt động</p>
          </div>

          <div className="admin-driver-modal__header-stats" aria-label="Thống kê tài xế">
            <div className="admin-driver-modal__stat-card">
              <strong>{filterCounts.all}</strong>
              <span>Tổng tài xế</span>
            </div>

            <div className="admin-driver-modal__stat-card">
              <strong>{filterCounts.active}</strong>
              <span>Hoạt động</span>
            </div>

            <div className="admin-driver-modal__stat-card">
              <strong>{filterCounts.locked}</strong>
              <span>Bị khóa</span>
            </div>

            <div className="admin-driver-modal__stat-card">
              <strong>{filterCounts.pending}</strong>
              <span>Chờ duyệt</span>
            </div>
          </div>
        </header>

        <div className="admin-driver-modal__toolbar">
          <label className="admin-driver-modal__search" htmlFor="admin-driver-search-input">
            <span className="admin-driver-modal__sr-only">Tìm kiếm tài xế</span>
            <input
              id="admin-driver-search-input"
              type="text"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="Nhập tên hoặc SĐT..."
            />
          </label>

          <button className="admin-driver-modal__add-button" type="button" onClick={openCreateDriverForm} disabled={isBusy}>
            Thêm tài xế
          </button>
        </div>

        <div className="admin-driver-modal__filters" role="tablist" aria-label="Lọc trạng thái tài xế">
          {FILTER_OPTIONS.map((filterOption) => (
            <button
              key={filterOption.value}
              className={`admin-driver-modal__filter admin-driver-modal__filter--${filterOption.tone}${
                statusFilter === filterOption.value ? ' is-active' : ''
              }`}
              type="button"
              role="tab"
              aria-selected={statusFilter === filterOption.value}
              onClick={() => setStatusFilter(filterOption.value)}
              disabled={isBusy}
            >
              <span>{filterOption.label}</span>
              <strong>{filterCounts[filterOption.value]}</strong>
            </button>
          ))}
        </div>

        {loading ? <p className="admin-driver-modal__loading">Đang tải dữ liệu tài xế...</p> : null}
        {requestError ? <p className="admin-driver-modal__error">{requestError}</p> : null}
        {actionFeedback ? <p className="admin-driver-modal__feedback">{actionFeedback}</p> : null}

        <div className="admin-driver-modal__table-wrap">
          <table className="admin-driver-modal__table" aria-label="Danh sách tài xế">
            <thead>
              <tr>
                <th>Tên</th>
                <th>SĐT</th>
                <th>Biển số</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length > 0 ? (
                filteredDrivers.map((driver) => {
                  const statusMeta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.pending;
                  const accountLocked = isDriverAccountLocked(driver);

                  return (
                    <tr key={driver.id}>
                      <td>{driver.name}</td>
                      <td>{driver.phone}</td>
                      <td>{driver.licensePlate || driver.vehicleInfo?.licensePlate || 'Chưa cập nhật'}</td>
                      <td>
                        <span className="admin-driver-modal__status-text">{statusMeta.label}</span>
                        <span className={`admin-driver-modal__status-dot admin-driver-modal__status-dot--${statusMeta.tone}`} aria-hidden="true" />
                      </td>
                      <td>
                        <div className="admin-driver-modal__row-actions">
                          <button
                            className="admin-driver-modal__action admin-driver-modal__action--view"
                            type="button"
                            onClick={() => openViewDriver(driver)}
                            disabled={isBusy}
                          >
                            Xem
                          </button>

                          {driver.status === 'pending' ? (
                            <>
                              <button
                                className="admin-driver-modal__action admin-driver-modal__action--approve"
                                type="button"
                                onClick={() => void handleApproveDriver(driver.id)}
                                disabled={isBusy}
                              >
                                Duyệt
                              </button>
                              <button
                                className="admin-driver-modal__action admin-driver-modal__action--reject"
                                type="button"
                                onClick={() => void handleRejectDriver(driver.id)}
                                disabled={isBusy}
                              >
                                Từ chối
                              </button>
                            </>
                          ) : (
                            <>
                              {isDriverApproved(driver) ? (
                                <button
                                  className="admin-driver-modal__action admin-driver-modal__action--edit"
                                  type="button"
                                  onClick={() => openEditDriver(driver)}
                                  disabled={isBusy}
                                >
                                  Sửa
                                </button>
                              ) : null}

                              <button
                                className={`admin-driver-modal__action ${
                                  driver.status === 'locked' ? 'admin-driver-modal__action--unlock' : 'admin-driver-modal__action--lock'
                                }`}
                                type="button"
                                onClick={() => void handleToggleDriverLock(driver)}
                                disabled={isBusy || accountLocked}
                                title={
                                  accountLocked
                                    ? 'Tài khoản đang bị khóa. Hãy mở khóa tài khoản trước khi mở chức năng Tài xế.'
                                    : driver.status === 'locked'
                                      ? 'Mở khóa chức năng Tài xế'
                                      : 'Khóa chức năng Tài xế'
                                }
                              >
                                {driver.status === 'locked' ? 'Mở' : 'Khóa'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="admin-driver-modal__empty-row" colSpan={5}>
                    Không có tài xế phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editorMode !== 'none' ? (
        <div className="admin-driver-modal__editor-overlay" role="dialog" aria-modal="true" aria-label="Hồ sơ tài xế">
          <div className="admin-driver-modal__editor-backdrop" onClick={closeEditor} aria-hidden="true" />

          <section
            className="admin-driver-modal__editor-sheet"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="admin-driver-modal__editor-head">
              <h4>
                {editorMode === 'create'
                  ? 'Thêm tài xế mới'
                  : editorMode === 'edit'
                    ? 'Chỉnh sửa thông tin tài xế'
                    : 'Xem thông tin tài xế'}
              </h4>
            </div>

            <form className="admin-driver-modal__editor-form" onSubmit={handleSaveDriver}>
              <section className="admin-driver-modal__editor-group">
                <h5>Thông tin cơ bản</h5>
                <div className="admin-driver-modal__editor-grid">
                  <label>
                    <span>Tên tài xế</span>
                    <input
                      type="text"
                      value={driverForm.fullName}
                      onChange={(event) => handleDriverFormChange('fullName', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Nguyễn Văn A"
                    />
                  </label>

                  <label>
                    <span>Số điện thoại</span>
                    <input
                      type="text"
                      value={driverForm.phone}
                      onChange={(event) => handleDriverFormChange('phone', event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={15}
                      disabled={editorMode === 'view'}
                      placeholder="09xxxxxxxx"
                    />
                  </label>

                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      value={driverForm.email}
                      onChange={(event) => handleDriverFormChange('email', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="taixe@example.com"
                    />
                  </label>

                  <label>
                    <span>CCCD</span>
                    <input
                      type="text"
                      value={driverForm.cccd}
                      onChange={(event) => handleDriverFormChange('cccd', event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={12}
                      disabled={editorMode === 'view'}
                      placeholder="012345678912"
                    />
                  </label>

                  <label className="is-wide">
                    <span>Địa chỉ</span>
                    <input
                      type="text"
                      value={driverForm.address}
                      onChange={(event) => handleDriverFormChange('address', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Liên Chiểu, Đà Nẵng"
                    />
                  </label>
                </div>
              </section>

              <section className="admin-driver-modal__editor-group">
                <h5>Thông tin xe</h5>
                <div className="admin-driver-modal__editor-grid">
                  <label>
                    <span>Biển số xe</span>
                    <input
                      type="text"
                      value={driverForm.licensePlate}
                      onChange={(event) => handleDriverFormChange('licensePlate', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="43A-12345"
                    />
                  </label>

                  <label>
                    <span>Tên xe</span>
                    <input
                      type="text"
                      value={driverForm.vehicleName}
                      onChange={(event) => handleDriverFormChange('vehicleName', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Honda Wave"
                    />
                  </label>
                </div>
              </section>

              <section className="admin-driver-modal__editor-group">
                <h5>Ngân hàng</h5>
                <div className="admin-driver-modal__editor-grid">
                  <label>
                    <span>Ngân hàng</span>
                    <div className="driver-bank-modal__combobox">
                      <input
                        type="text"
                        value={driverForm.bankName}
                        onFocus={() => {
                          if (editorMode !== 'view') {
                            setBankDropdownOpen(true);
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            setBankDropdownOpen(false);
                          }, 120);
                        }}
                        onChange={(event) => handleDriverFormChange('bankName', event.target.value)}
                        disabled={editorMode === 'view'}
                        placeholder="Gõ để tìm hoặc chọn ngân hàng"
                      />

                      {editorMode !== 'view' && bankDropdownOpen ? (
                        <div className="driver-bank-modal__dropdown" role="listbox" aria-label="Danh sách ngân hàng">
                          {filteredBankOptions.length > 0 ? (
                            filteredBankOptions.map((bankOption, index) => (
                              <button
                                key={bankOption}
                                className={`driver-bank-modal__dropdown-option${
                                  normalizeSearchToken(bankOption) === normalizeSearchToken(driverForm.bankName)
                                    ? ' is-selected'
                                    : ''
                                }`}
                                style={{ '--item-order': index }}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                }}
                                onClick={() => handleBankOptionSelect(bankOption)}
                              >
                                {bankOption}
                              </button>
                            ))
                          ) : (
                            <p className="driver-bank-modal__dropdown-empty">Không tìm thấy ngân hàng phù hợp.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </label>

                  <label>
                    <span>Số tài khoản</span>
                    <input
                      type="text"
                      value={driverForm.bankAccountNumber}
                      onChange={(event) => handleDriverFormChange('bankAccountNumber', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="1234567890"
                    />
                  </label>

                  <label className="is-wide">
                    <span>Chủ tài khoản (không dấu)</span>
                    <input
                      type="text"
                      value={driverForm.bankAccountHolder}
                      onChange={(event) => handleDriverFormChange('bankAccountHolder', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Nguyen Van A"
                    />
                  </label>
                </div>
              </section>

              <section className="admin-driver-modal__editor-group">
                <h5>Liên hệ khẩn cấp</h5>
                <div className="admin-driver-modal__editor-grid">
                  <label>
                    <span>Quan hệ</span>
                    <input
                      type="text"
                      value={driverForm.emergencyRelationship}
                      onChange={(event) => handleDriverFormChange('emergencyRelationship', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Anh"
                    />
                  </label>

                  <label>
                    <span>Họ và tên</span>
                    <input
                      type="text"
                      value={driverForm.emergencyFullName}
                      onChange={(event) => handleDriverFormChange('emergencyFullName', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Nguyen Van D"
                    />
                  </label>

                  <label>
                    <span>SĐT</span>
                    <input
                      type="text"
                      value={driverForm.emergencyPhone}
                      onChange={(event) => handleDriverFormChange('emergencyPhone', event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={15}
                      disabled={editorMode === 'view'}
                      placeholder="0911111111"
                    />
                  </label>

                  <label className="is-wide">
                    <span>Địa chỉ</span>
                    <input
                      type="text"
                      value={driverForm.emergencyAddress}
                      onChange={(event) => handleDriverFormChange('emergencyAddress', event.target.value)}
                      disabled={editorMode === 'view'}
                      placeholder="Thanh Khe, Da Nang"
                    />
                  </label>
                </div>
              </section>

              <section className="admin-driver-modal__editor-group">
                <h5>Hồ sơ ảnh</h5>
                <div className="admin-driver-modal__image-groups">
                  <div className="admin-driver-modal__image-row">
                    {renderImageUploadFrame({
                      fieldName: 'avatarFile',
                      inputId: 'admin-driver-avatar-file-input',
                      fieldLabel: 'Avatar',
                      imageLabel: 'Ảnh đại diện tài xế',
                      value: driverForm.avatar,
                      fallbackDirectories: ['/uploads/avatars', '/uploads'],
                    })}

                    {renderImageUploadFrame({
                      fieldName: 'backgroundFile',
                      inputId: 'admin-driver-background-file-input',
                      fieldLabel: 'Lý lịch tư pháp',
                      imageLabel: 'Ảnh lý lịch tư pháp tài xế',
                      value: driverForm.backgroundImage,
                      fallbackDirectories: ['/uploads/drivers/backgrounds', '/uploads'],
                    })}
                  </div>

                  <div className="admin-driver-modal__image-row">
                    {renderImageUploadFrame({
                      fieldName: 'identityFrontFile',
                      inputId: 'admin-driver-identity-front-file-input',
                      fieldLabel: 'CCCD mặt trước',
                      imageLabel: 'Ảnh CCCD mặt trước',
                      value: driverForm.identityFrontImage,
                      fallbackDirectories: ['/uploads/drivers/identities', '/uploads'],
                    })}

                    {renderImageUploadFrame({
                      fieldName: 'identityBackFile',
                      inputId: 'admin-driver-identity-back-file-input',
                      fieldLabel: 'CCCD mặt sau',
                      imageLabel: 'Ảnh CCCD mặt sau',
                      value: driverForm.identityBackImage,
                      fallbackDirectories: ['/uploads/drivers/identities', '/uploads'],
                    })}
                  </div>

                  <div className="admin-driver-modal__image-row">
                    {renderImageUploadFrame({
                      fieldName: 'licenseFrontFile',
                      inputId: 'admin-driver-license-front-file-input',
                      fieldLabel: 'Bằng lái mặt trước',
                      imageLabel: 'Ảnh bằng lái mặt trước',
                      value: driverForm.licenseFrontImage || driverForm.licenseImage,
                      fallbackDirectories: ['/uploads/drivers/licenses', '/uploads'],
                    })}

                    {renderImageUploadFrame({
                      fieldName: 'licenseBackFile',
                      inputId: 'admin-driver-license-back-file-input',
                      fieldLabel: 'Bằng lái mặt sau',
                      imageLabel: 'Ảnh bằng lái mặt sau',
                      value: driverForm.licenseBackImage,
                      fallbackDirectories: ['/uploads/drivers/licenses', '/uploads'],
                    })}
                  </div>

                  <div className="admin-driver-modal__image-row admin-driver-modal__image-row--three">
                    {renderImageUploadFrame({
                      fieldName: 'vehicleFrontFile',
                      inputId: 'admin-driver-vehicle-front-file-input',
                      fieldLabel: 'Ảnh xe phía trước',
                      imageLabel: 'Ảnh xe phía trước',
                      value: driverForm.vehicleFrontImage,
                      fallbackDirectories: ['/uploads/drivers/vehicles', '/uploads'],
                    })}

                    {renderImageUploadFrame({
                      fieldName: 'vehicleSideFile',
                      inputId: 'admin-driver-vehicle-side-file-input',
                      fieldLabel: 'Ảnh xe bên hông',
                      imageLabel: 'Ảnh xe bên hông',
                      value: driverForm.vehicleSideImage || driverForm.vehicleImage,
                      fallbackDirectories: ['/uploads/drivers/vehicles', '/uploads'],
                    })}

                    {renderImageUploadFrame({
                      fieldName: 'vehicleRearFile',
                      inputId: 'admin-driver-vehicle-rear-file-input',
                      fieldLabel: 'Ảnh xe phía sau',
                      imageLabel: 'Ảnh xe phía sau',
                      value: driverForm.vehicleRearImage,
                      fallbackDirectories: ['/uploads/drivers/vehicles', '/uploads'],
                    })}
                  </div>
                </div>
              </section>

              {formError ? <p className="admin-driver-modal__editor-error">{formError}</p> : null}

              <div className="admin-driver-modal__editor-actions">
                {editorMode === 'view' ? (
                  <>
                    <button className="admin-driver-modal__editor-button admin-driver-modal__editor-button--ghost" type="button" onClick={closeEditor}>
                      Đóng
                    </button>
                    {isDriverApproved(editingDriver) ? (
                      <button
                        className="admin-driver-modal__editor-button admin-driver-modal__editor-button--primary"
                        type="button"
                        onClick={switchViewerToEditMode}
                        disabled={isBusy}
                      >
                        Chuyển sang chỉnh sửa
                      </button>
                    ) : (
                      <p className="admin-driver-modal__editor-hint">Chỉ hồ sơ đã duyệt mới được chỉnh sửa.</p>
                    )}
                  </>
                ) : (
                  <>
                    <button className="admin-driver-modal__editor-button admin-driver-modal__editor-button--ghost" type="button" onClick={closeEditor}>
                      Hủy
                    </button>
                    <button className="admin-driver-modal__editor-button admin-driver-modal__editor-button--primary" type="submit" disabled={isBusy}>
                      {editorMode === 'create' ? 'Lưu tài xế mới' : 'Lưu thay đổi'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(driverLockConfirm)}
        title={driverLockConfirm?.action === 'unlock' ? 'Xác nhận mở chức năng Tài xế' : 'Xác nhận khóa chức năng Tài xế'}
        description={
          driverLockConfirm?.action === 'unlock'
            ? `Bạn có chắc chắn muốn mở chức năng Tài xế cho ${driverLockConfirm?.driverName ?? 'tài xế này'} không?`
            : `Bạn có chắc chắn muốn khóa chức năng Tài xế cho ${driverLockConfirm?.driverName ?? 'tài xế này'} không?`
        }
        confirmLabel={driverLockConfirm?.action === 'unlock' ? 'Mở' : 'Khóa'}
        cancelLabel="Hủy"
        confirmTone="danger"
        onCancel={cancelDriverLockConfirm}
        onConfirm={confirmDriverLockAction}
        ariaLabel={driverLockConfirm?.action === 'unlock' ? 'Xác nhận mở chức năng Tài xế' : 'Xác nhận khóa chức năng Tài xế'}
      />
    </div>,
    document.body,
  );
}
