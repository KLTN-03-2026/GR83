import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { closeIcon, userIcon } from '../../assets/icons';
import RoutePreviewMap from './RoutePreviewMap';
import { rideService } from '../../services/rideService';

registerLocale('vi-VN', vi);

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function formatDateTime(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return '--';
  }

  return format(parsed, 'dd/MM/yyyy HH:mm');
}

function formatDistance(distanceKm) {
  const normalized = Number(distanceKm ?? 0);
  if (!Number.isFinite(normalized)) {
    return '--';
  }

  return `${normalized.toFixed(1)} km`;
}

function formatRating(score) {
  const normalized = Number(score ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 'Chưa đánh giá';
  }

  return `${normalized.toFixed(0)} ★`;
}

export default function CustomerTripIssueReportModal({ open, onClose, trip, accountId }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [meta, setMeta] = useState({
    issueTypes: [],
    trip: null,
    alreadyReported: false,
  });
  const [issueType, setIssueType] = useState('');
  const [description, setDescription] = useState('');
  const [incidentAt, setIncidentAt] = useState(null);
  const [attachmentFile, setAttachmentFile] = useState(null);

  useEffect(() => {
    if (!open || !trip?.bookingCode || !accountId) {
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSuccessMessage('');
    setDescription('');
    setAttachmentFile(null);

    rideService.getTripIssueReportMeta(trip.bookingCode, { accountId }, { signal: controller.signal })
      .then((response) => {
        const nextIssueTypes = Array.isArray(response?.issueTypes) ? response.issueTypes : [];
        const nextTrip = response?.trip ?? null;
        setMeta({
          issueTypes: nextIssueTypes,
          trip: nextTrip,
          alreadyReported: Boolean(response?.alreadyReported),
        });

        if (response?.alreadyReported) {
          setError('Bạn đã khiếu nại cho chuyến đi này. Vui lòng chờ admin xử lý.');
        }

        setIssueType(nextIssueTypes[0]?.id ?? '');
        setIncidentAt(nextTrip?.bookedAt ? new Date(nextTrip.bookedAt) : new Date());
      })
      .catch((loadError) => {
        if (loadError?.name === 'AbortError') {
          return;
        }

        // For network errors, silently fall back so the form is still usable
        if (!loadError?.status) {
          setMeta((current) => ({
            ...current,
            issueTypes: current.issueTypes.length > 0 ? current.issueTypes : [
              { id: 'fare-issue', label: 'Giá cước / thanh toán' },
              { id: 'driver-attitude', label: 'Thái độ tài xế' },
              { id: 'unsafe-driving', label: 'Tài xế lái xe không an toàn' },
              { id: 'lost-item', label: 'Thất lạc đồ dùng' },
              { id: 'app-error', label: 'Lỗi ứng dụng' },
              { id: 'other', label: 'Lý do khác' },
            ],
          }));
          setIssueType((current) => current || 'fare-issue');
          return;
        }

        setError(loadError?.message || 'Không thể tải dữ liệu báo lỗi.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [accountId, open, trip?.bookingCode]);

  const resolvedTrip = useMemo(() => meta.trip ?? trip ?? null, [meta.trip, trip]);

  const handleAttachmentChange = (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      setAttachmentFile(null);
      return;
    }

    if (!nextFile.type.startsWith('image/')) {
      setError('Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP.');
      event.target.value = '';
      return;
    }

    if (nextFile.size > 5 * 1024 * 1024) {
      setError('Ảnh đính kèm tối đa 5MB.');
      event.target.value = '';
      return;
    }

    setError('');
    setAttachmentFile(nextFile);
  };

  const handleSubmit = async () => {
    if (!trip?.bookingCode || !accountId) {
      setError('Không tìm thấy chuyến đi để báo lỗi.');
      return;
    }

    if (meta.alreadyReported) {
      setError('Bạn đã khiếu nại cho chuyến đi này. Vui lòng chờ admin xử lý.');
      return;
    }

    if (!issueType) {
      setError('Vui lòng chọn loại báo lỗi.');
      return;
    }

    if (normalizeText(description).length < 10) {
      setError('Mô tả chi tiết cần tối thiểu 10 ký tự.');
      return;
    }

    const payload = new FormData();
    payload.append('accountId', String(accountId));
    payload.append('reporterRoleCode', 'Q2');
    payload.append('issueType', issueType);
    payload.append('description', normalizeText(description));
    if (incidentAt instanceof Date && !Number.isNaN(incidentAt.getTime())) {
      payload.append('incidentAt', incidentAt.toISOString());
    }
    if (attachmentFile) {
      payload.append('attachment', attachmentFile);
    }

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await rideService.submitTripIssueReport(trip.bookingCode, payload);
      setSuccessMessage(response?.message || 'Đã gửi báo lỗi thành công.');
      setDescription('');
      setAttachmentFile(null);
      setTimeout(() => {
        onClose?.();
      }, 900);
    } catch (submitError) {
      const submitErrorMessage = String(submitError?.message ?? '').trim();

      // In unstable network/CORS scenarios the server may persist the complaint
      // but the client fails to receive response; re-check once before showing hard error.
      if (!submitError?.status && submitErrorMessage) {
        try {
          const verification = await rideService.getTripIssueReportMeta(trip.bookingCode, { accountId });

          if (verification?.alreadyReported) {
            setMeta((currentMeta) => ({ ...currentMeta, alreadyReported: true }));
            setSuccessMessage('Đã gửi báo lỗi thành công. Chúng tôi sẽ xử lý trong thời gian sớm nhất.');
            setDescription('');
            setAttachmentFile(null);
            setTimeout(() => {
              onClose?.();
            }, 900);
            return;
          }
        } catch {
          // Keep original submit error if verification is unavailable.
        }
      }

      if (submitError?.status === 409) {
        setMeta((currentMeta) => ({ ...currentMeta, alreadyReported: true }));
        setError('Bạn đã khiếu nại cho chuyến đi này. Vui lòng chờ admin xử lý.');
      } else {
        const isNetworkError = !submitError?.status;
        setError(isNetworkError
          ? 'Không thể gửi báo lỗi. Vui lòng kiểm tra kết nối mạng và thử lại.'
          : (submitError?.message || 'Không thể gửi báo lỗi.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !trip) {
    return null;
  }

  return createPortal(
    <div className="customer-issue-modal" role="dialog" aria-modal="true" aria-label="Báo lỗi / Khiếu nại">
      <div className="customer-issue-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="customer-issue-modal__window">
        <button className="customer-issue-modal__close" type="button" onClick={onClose} aria-label="Đóng">
          <img src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <div className="customer-issue-modal__grid">
          <div className="customer-issue-modal__trip-card">
            <div className="customer-issue-modal__map">
              <RoutePreviewMap
                pickupLabel={resolvedTrip?.pickupLabel}
                destinationLabel={resolvedTrip?.destinationLabel}
                pickupPosition={resolvedTrip?.pickupPosition}
                destinationPosition={resolvedTrip?.destinationPosition}
                routeGeometry={resolvedTrip?.routeGeometry}
              />
            </div>

            <div className="customer-issue-modal__trip-meta">
              <div className="customer-issue-modal__trip-time">{formatDateTime(resolvedTrip?.bookedAt)}</div>
              <div className="customer-issue-modal__trip-line">
                <strong>{resolvedTrip?.rideTitle || resolvedTrip?.vehicleLabel || 'Chuyến đi SmartRide'}</strong>
                <span>{formatDistance(resolvedTrip?.routeDistanceKm)} · {Number(resolvedTrip?.etaMinutes ?? 0) || 0} mins</span>
              </div>
              <div className="customer-issue-modal__location">
                <span className="customer-issue-modal__dot customer-issue-modal__dot--pickup" />
                <div>
                  <strong>{resolvedTrip?.pickupLabel || '--'}</strong>
                  <small>{formatDateTime(resolvedTrip?.bookedAt)}</small>
                </div>
              </div>
              <div className="customer-issue-modal__location">
                <span className="customer-issue-modal__dot customer-issue-modal__dot--destination" />
                <div>
                  <strong>{resolvedTrip?.destinationLabel || '--'}</strong>
                  <small>{formatDateTime(resolvedTrip?.bookedAt)}</small>
                </div>
              </div>
            </div>

            <div className="customer-issue-modal__driver-card">
              <div className="customer-issue-modal__driver-avatar">
                <img src={userIcon} alt="" aria-hidden="true" />
              </div>
              <div className="customer-issue-modal__driver-info">
                <div>
                  <span>Tài xế</span>
                  <strong>{resolvedTrip?.driverName || resolvedTrip?.driverDisplayName || 'Đang cập nhật'}</strong>
                </div>
                <div>
                  <span>Biển số</span>
                  <strong>{resolvedTrip?.driverVehicleLicensePlate || resolvedTrip?.driverLicensePlate || 'Đang cập nhật'}</strong>
                </div>
                <div>
                  <span>Đánh giá chuyến đi</span>
                  <strong>{formatRating(resolvedTrip?.ratingScore)}</strong>
                </div>
              </div>
            </div>

            <div className="customer-issue-modal__privacy-note">
              Thông tin của bạn được bảo mật và chỉ dùng để xử lý khiếu nại.
            </div>
          </div>

          <div className="customer-issue-modal__form-card">
            <h2>Báo lỗi / Khiếu nại</h2>
            <p>Vui lòng chọn lý do và nhập nội dung báo lỗi. Chúng tôi sẽ xử lý trong thời gian sớm nhất.</p>

            <label className="customer-issue-modal__field">
              <span>Loại báo lỗi *</span>
              <select
                className="customer-issue-modal__select"
                value={issueType}
                onChange={(event) => setIssueType(event.target.value)}
                disabled={loading || submitting || meta.alreadyReported}
              >
                <option value="">Chọn lý do báo lỗi</option>
                {meta.issueTypes.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="customer-issue-modal__field">
              <span>Mô tả chi tiết *</span>
              <textarea
                className="customer-issue-modal__textarea"
                rows={6}
                maxLength={500}
                placeholder="Vui lòng nhập chi tiết nội dung báo lỗi của bạn..."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={loading || submitting || meta.alreadyReported}
              />
              <small>{description.length}/500</small>
            </label>

            <label className="customer-issue-modal__field">
              <span>Thời gian xảy ra sự việc</span>
              <DatePicker
                selected={incidentAt}
                onChange={(value) => setIncidentAt(value)}
                locale="vi-VN"
                dateFormat="dd/MM/yyyy HH:mm"
                showTimeSelect
                timeIntervals={5}
                timeCaption="Giờ"
                className="customer-issue-modal__date-input"
                calendarClassName="admin-user-modal__date-calendar"
                popperClassName="admin-user-modal__date-popper"
                popperPlacement="bottom-start"
                showPopperArrow={false}
                disabled={loading || submitting || meta.alreadyReported}
              />
            </label>

            <label className="customer-issue-modal__field">
              <span>Đính kèm hình ảnh (nếu có)</span>
              <div className="customer-issue-modal__upload-box">
                <input type="file" accept="image/*" onChange={handleAttachmentChange} disabled={loading || submitting || meta.alreadyReported} />
                <div>
                  <strong>{attachmentFile ? attachmentFile.name : 'Chọn ảnh hoặc kéo thả vào đây'}</strong>
                  <small>Hỗ trợ JPG, PNG, WEBP tối đa 5MB</small>
                </div>
              </div>
            </label>

            {error ? <div className="customer-issue-modal__error">{error}</div> : null}
            {successMessage ? <div className="customer-issue-modal__success">{successMessage}</div> : null}

            <div className="customer-issue-modal__actions">
              <button className="customer-issue-modal__secondary" type="button" onClick={onClose} disabled={submitting}>Hủy bỏ</button>
              <button className="customer-issue-modal__primary" type="button" onClick={handleSubmit} disabled={loading || submitting || meta.alreadyReported}>
                {meta.alreadyReported ? 'Đã khiếu nại' : submitting ? 'Đang gửi...' : 'Gửi báo lỗi'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
