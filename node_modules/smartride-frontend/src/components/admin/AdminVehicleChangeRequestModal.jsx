import { createPortal } from 'react-dom';
import { closeIcon } from '../../assets/icons';

function normalizeText(value) {
  return String(value ?? '').trim();
}

export default function AdminVehicleChangeRequestModal({
  open = false,
  requestItem = null,
  requestDetail = null,
  loading = false,
  actionLoading = false,
  viewMode = 'summary',
  rejectNote = '',
  onRejectNoteChange,
  onClose,
  onViewProfile,
  onBackToSummary,
  onApprove,
  onReject,
}) {
  if (!open || !requestItem) {
    return null;
  }

  return createPortal(
    <div className="role-feature-modal" role="dialog" aria-modal="true" aria-label="Yêu cầu thay đổi thông tin xe">
      <div className="role-feature-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <div className="role-feature-modal__window role-feature-modal__window--admin-vehicle-request">
        <button className="role-feature-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng thông báo duyệt">
          <img className="role-feature-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <p className="role-feature-modal__role">Quản trị viên</p>
        <h3 className="role-feature-modal__title">Yêu cầu thay đổi thông tin xe</h3>

        {viewMode === 'summary' ? (
          <>
            <p className="role-feature-modal__summary">
              Tài xế <strong>{normalizeText(requestItem.driverName) || normalizeText(requestItem.driverId)}</strong> vừa gửi yêu cầu cập nhật xe.
            </p>

            <section className="driver-profile-modal__section">
              <h4>Thông tin thay đổi</h4>
              <div className="driver-profile-modal__grid">
                <label>
                  <span>Loại xe cũ</span>
                  <input type="text" value={normalizeText(requestItem.oldVehicleName)} readOnly />
                </label>
                <label>
                  <span>Biển số cũ</span>
                  <input type="text" value={normalizeText(requestItem.oldLicensePlate)} readOnly />
                </label>
                <label>
                  <span>Loại xe mới</span>
                  <input type="text" value={normalizeText(requestItem.newVehicleName)} readOnly />
                </label>
                <label>
                  <span>Biển số mới</span>
                  <input type="text" value={normalizeText(requestItem.newLicensePlate)} readOnly />
                </label>
              </div>
            </section>

            <section className="driver-profile-modal__section">
              <h4>Ghi chú từ chối (nếu có)</h4>
              <textarea
                className="driver-profile-modal__textarea"
                value={rejectNote}
                onChange={(event) => onRejectNoteChange?.(event.target.value.slice(0, 500))}
                placeholder="Nhập lý do từ chối để tài xế nhận được thông báo rõ ràng"
              />
            </section>

            <div className="role-feature-modal__actions">
              <button className="role-feature-modal__action role-feature-modal__action--ghost" type="button" onClick={() => onViewProfile?.()}>
                Xem hồ sơ
              </button>
              <button
                className="role-feature-modal__action role-feature-modal__action--ghost"
                type="button"
                onClick={() => onReject?.()}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang xử lý...' : 'Từ chối'}
              </button>
              <button
                className="role-feature-modal__action role-feature-modal__action--primary"
                type="button"
                onClick={() => onApprove?.()}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang xử lý...' : 'Đồng ý'}
              </button>
            </div>
          </>
        ) : null}

        {viewMode === 'profile' ? (
          <>
            <p className="role-feature-modal__summary">Thông tin hồ sơ tài xế để đối soát trước khi ra quyết định.</p>
            {loading ? <p className="role-feature-modal__auth-note">Đang tải hồ sơ...</p> : null}

            {!loading && requestDetail?.driver ? (
              <div className="driver-profile-modal__content">
                <section className="driver-profile-modal__section">
                  <h4>Hồ sơ tài xế</h4>
                  <div className="driver-profile-modal__grid">
                    <label>
                      <span>Họ và tên</span>
                      <input type="text" value={normalizeText(requestDetail.driver.fullName || requestDetail.driver.name)} readOnly />
                    </label>
                    <label>
                      <span>Số điện thoại</span>
                      <input type="text" value={normalizeText(requestDetail.driver.phone)} readOnly />
                    </label>
                    <label>
                      <span>Email</span>
                      <input type="text" value={normalizeText(requestDetail.driver.email)} readOnly />
                    </label>
                    <label>
                      <span>Trạng thái hồ sơ</span>
                      <input type="text" value={normalizeText(requestDetail.driver.driverStatusLabel || requestDetail.driver.driverStatus)} readOnly />
                    </label>
                  </div>
                </section>

                <section className="driver-profile-modal__section">
                  <h4>Thông tin xe hiện tại</h4>
                  <div className="driver-profile-modal__grid">
                    <label>
                      <span>Loại xe</span>
                      <input type="text" value={normalizeText(requestDetail.driver?.vehicleInfo?.name || requestDetail.driver?.vehicleInfo?.vehicleName)} readOnly />
                    </label>
                    <label>
                      <span>Biển số</span>
                      <input type="text" value={normalizeText(requestDetail.driver?.vehicleInfo?.licensePlate || requestDetail.driver?.vehicleInfo?.bienSoXe)} readOnly />
                    </label>
                  </div>
                </section>
              </div>
            ) : null}

            <div className="role-feature-modal__actions">
              <button className="role-feature-modal__action role-feature-modal__action--ghost" type="button" onClick={() => onBackToSummary?.()}>
                Quay lại
              </button>
              <button
                className="role-feature-modal__action role-feature-modal__action--primary"
                type="button"
                onClick={() => onApprove?.()}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang xử lý...' : 'Đồng ý'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
