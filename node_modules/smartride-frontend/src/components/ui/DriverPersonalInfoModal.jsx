import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeIcon } from '../../assets/icons';
import { driverVehicleRequestService } from '../../services/driverVehicleRequestService';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function buildVehicleLabel(driver = {}) {
  const vehicleName = normalizeText(driver?.vehicleInfo?.name || driver?.vehicleInfo?.vehicleName);
  const licensePlate = normalizeText(driver?.vehicleInfo?.licensePlate || driver?.vehicleInfo?.bienSoXe).toUpperCase();

  return {
    vehicleName,
    licensePlate,
  };
}

function formatBirthDate(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return '';
  }

  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return normalizedValue;
  }

  return date.toLocaleDateString('vi-VN');
}

function resolveAvatarLetter(name) {
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    return 'T';
  }

  return normalizedName.charAt(0).toUpperCase();
}

export default function DriverPersonalInfoModal({
  open = false,
  onClose,
  driverId = '',
  onNotify,
  onRequestSubmitted,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [driverProfile, setDriverProfile] = useState(null);
  const [vehicleNameDraft, setVehicleNameDraft] = useState('');
  const [licensePlateDraft, setLicensePlateDraft] = useState('');

  const resolvedDriverId = normalizeText(driverId);

  const loadDriverProfile = async () => {
    if (!resolvedDriverId) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await driverVehicleRequestService.getDriverProfile(resolvedDriverId);
      const driver = response?.driver ?? null;
      const vehicle = buildVehicleLabel(driver);
      setDriverProfile(driver);
      setVehicleNameDraft(vehicle.vehicleName);
      setLicensePlateDraft(vehicle.licensePlate);
    } catch (error) {
      onNotify?.(error?.message || 'Không thể tải thông tin tài xế.', 'error', 2800);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setDriverProfile(null);
      setVehicleNameDraft('');
      setLicensePlateDraft('');
      return;
    }

    void loadDriverProfile();
  }, [open, resolvedDriverId]);

  const currentVehicle = useMemo(() => buildVehicleLabel(driverProfile), [driverProfile]);
  const canSubmitRequest =
    normalizeText(vehicleNameDraft) &&
    normalizeText(licensePlateDraft) &&
    (normalizeText(vehicleNameDraft).toLowerCase() !== currentVehicle.vehicleName.toLowerCase() ||
      normalizeText(licensePlateDraft).toUpperCase() !== currentVehicle.licensePlate.toUpperCase());

  const resolvedDriverName = normalizeText(driverProfile?.fullName || driverProfile?.name);
  const resolvedBankName = normalizeText(driverProfile?.bank?.bankName);
  const resolvedBankAccountNumber = normalizeText(driverProfile?.bank?.accountNumber);
  const resolvedGender = normalizeText(driverProfile?.gender) || 'Khác';
  const resolvedBirthDate = formatBirthDate(driverProfile?.birthDate);

  const handleSubmitChangeRequest = async () => {
    if (!resolvedDriverId || isSubmitting) {
      return;
    }

    if (!canSubmitRequest) {
      onNotify?.('Bạn chưa thay đổi thông tin xe để cập nhật.', 'error', 2600);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await driverVehicleRequestService.createChangeRequest(resolvedDriverId, {
        vehicleName: normalizeText(vehicleNameDraft),
        licensePlate: normalizeText(licensePlateDraft).toUpperCase(),
      });

      onNotify?.(response?.message || 'Đã gửi yêu cầu thay đổi thông tin xe.', 'success', 2400);
      onRequestSubmitted?.(response?.request);
      onClose?.();
    } catch (error) {
      onNotify?.(error?.message || 'Không thể gửi yêu cầu thay đổi thông tin xe.', 'error', 3200);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshProfile = () => {
    void handleSubmitChangeRequest();
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="role-feature-modal" role="dialog" aria-modal="true" aria-label="Thông tin tài xế">
      <div className="role-feature-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <div className="role-feature-modal__window role-feature-modal__window--driver-profile">
        <button className="role-feature-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng thông tin tài xế">
          <img className="role-feature-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <section className="driver-profile-sheet">
          <h3 className="driver-profile-sheet__title">Thông tin cá nhân tài xế</h3>

          {isLoading ? <p className="driver-profile-sheet__loading">Đang tải dữ liệu...</p> : null}

          {!isLoading && driverProfile ? (
            <div className="driver-profile-sheet__layout">
              <aside className="driver-profile-sheet__sidebar">
                <div className="driver-profile-sheet__avatar" aria-hidden="true">
                  {normalizeText(driverProfile?.avatar) ? (
                    <img src={driverProfile.avatar} alt="" />
                  ) : (
                    <span>{resolveAvatarLetter(resolvedDriverName)}</span>
                  )}
                </div>

                <p className="driver-profile-sheet__name">{resolvedDriverName || 'Tài xế SmartRide'}</p>

                <div className="driver-profile-sheet__sidebar-actions">
                  <button
                    className="driver-profile-sheet__button driver-profile-sheet__button--success"
                    type="button"
                    onClick={handleRefreshProfile}
                    disabled={isLoading || isSubmitting}
                  >
                    cập nhật
                  </button>
                  <button className="driver-profile-sheet__button driver-profile-sheet__button--danger" type="button" onClick={() => onClose?.()}>
                    Hủy
                  </button>
                </div>
              </aside>

              <div className="driver-profile-sheet__form-area">
                <section className="driver-profile-sheet__section">
                  <h4>Thông tin cá nhân</h4>
                  <div className="driver-profile-sheet__grid driver-profile-sheet__grid--three">
                    <label>
                      <span>Số điện thoại</span>
                      <input type="text" value={normalizeText(driverProfile.phone)} readOnly />
                    </label>
                    <label>
                      <span>Ngày sinh</span>
                      <input type="text" value={resolvedBirthDate || 'Chưa cập nhật'} readOnly />
                    </label>
                    <label>
                      <span>Địa chỉ</span>
                      <input type="text" value={normalizeText(driverProfile.address)} readOnly />
                    </label>
                    <label>
                      <span>Email</span>
                      <input type="text" value={normalizeText(driverProfile.email)} readOnly />
                    </label>
                    <label>
                      <span>CCCD</span>
                      <input type="text" value={normalizeText(driverProfile.cccd)} readOnly />
                    </label>
                    <label>
                      <span>Giới tính</span>
                      <input type="text" value={resolvedGender} readOnly />
                    </label>
                  </div>
                </section>

                <section className="driver-profile-sheet__section">
                  <h4>Tài khoản ngân hàng</h4>
                  <div className="driver-profile-sheet__grid driver-profile-sheet__grid--two">
                    <label>
                      <span>Ngân hàng</span>
                      <input type="text" value={resolvedBankName || 'Chưa cập nhật'} readOnly />
                    </label>
                    <label>
                      <span>Số tài khoản</span>
                      <input type="text" value={resolvedBankAccountNumber || 'Chưa cập nhật'} readOnly />
                    </label>
                  </div>
                </section>

                <section className="driver-profile-sheet__section">
                  <h4>Thông tin xe</h4>
                  <div className="driver-profile-sheet__vehicle-row">
                    <div className="driver-profile-sheet__grid driver-profile-sheet__grid--two">
                      <label>
                        <span>Loại xe</span>
                        <input
                          type="text"
                          value={vehicleNameDraft}
                          onChange={(event) => setVehicleNameDraft(event.target.value.slice(0, 120))}
                          placeholder="Ví dụ: Xe máy"
                        />
                      </label>
                      <label>
                        <span>Biển số</span>
                        <input
                          type="text"
                          value={licensePlateDraft}
                          onChange={(event) => setLicensePlateDraft(event.target.value.toUpperCase().slice(0, 20))}
                          placeholder="Ví dụ: 43A-12345"
                        />
                      </label>
                    </div>

                    <button
                      className="driver-profile-sheet__request-button"
                      type="button"
                      onClick={handleSubmitChangeRequest}
                      disabled={isLoading || isSubmitting}
                    >
                      {isSubmitting ? 'Đang gửi...' : 'Yêu cầu thay đổi'}
                    </button>
                  </div>
                </section>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>,
    document.body,
  );
}
