import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { closeIcon } from '../../assets/icons';
import { driverSupportService } from '../../services/driverSupportService';
import { connectRideEventStream } from '../../services/rideRealtimeService';

const FORCE_TRIP_CANCELLED_EVENT_NAME = 'smartride:force-trip-cancelled';
const FORCE_TRIP_CANCELLED_STORAGE_KEY = 'smartride.forceTripCancelled';

const FALLBACK_ISSUES = [
  { id: 'accident', label: 'Tai nạn khẩn cấp' },
  { id: 'vehicle-issue', label: 'Xe gặp sự cố' },
  { id: 'customer-conflict', label: 'Mâu thuẫn với khách' },
  { id: 'safety-threat', label: 'Nguy cơ an toàn' },
  { id: 'app-error', label: 'Lỗi ứng dụng' },
  { id: 'other', label: 'Sự cố khác' },
];

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusLabel(status) {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'resolved') return 'Đã xử lý';
  if (normalized === 'processing') return 'Đang xử lý';
  if (normalized === 'rejected') return 'Từ chối';
  return 'Mới gửi';
}

export default function DriverSupportSafetyModal({ open, onClose, driverId, onNotify, onForceTripCancelled }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState({
    contact: {
      hotline: '19001234',
      email: 'support@smartride.vn',
      chatLabel: 'Chat với CSKH',
    },
    issueTypes: FALLBACK_ISSUES,
    activeTrip: null,
    canSubmit: false,
    recentRequests: [],
  });
  const [issueType, setIssueType] = useState('');
  const [description, setDescription] = useState('');

  const issueOptions = useMemo(() => {
    if (Array.isArray(overview.issueTypes) && overview.issueTypes.length > 0) {
      return overview.issueTypes;
    }

    return FALLBACK_ISSUES;
  }, [overview.issueTypes]);

  useEffect(() => {
    if (!issueType && issueOptions.length > 0) {
      setIssueType(issueOptions[0].id);
    }
  }, [issueOptions, issueType]);

  const loadData = useCallback(async () => {
    if (!driverId) {
      setError('Không tìm thấy thông tin tài xế.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [overviewResponse, listResponse] = await Promise.all([
        driverSupportService.getOverview(driverId),
        driverSupportService.listRequests(driverId, { limit: 6 }),
      ]);

      setOverview({
        contact: overviewResponse?.contact ?? {
          hotline: '19001234',
          email: 'support@smartride.vn',
          chatLabel: 'Chat với CSKH',
        },
        issueTypes: Array.isArray(overviewResponse?.issueTypes) ? overviewResponse.issueTypes : FALLBACK_ISSUES,
        activeTrip: overviewResponse?.activeTrip ?? null,
        canSubmit: Boolean(overviewResponse?.canSubmit),
        recentRequests: Array.isArray(listResponse?.items)
          ? listResponse.items
          : Array.isArray(overviewResponse?.recentRequests)
            ? overviewResponse.recentRequests
            : [],
      });
    } catch (loadError) {
      setError(loadError?.message || 'Không thể tải dữ liệu hỗ trợ.');
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    if (!open) return;
    void loadData();

    const intervalId = setInterval(() => {
      if (!driverId) return;
      driverSupportService.getOverview(driverId).then((overviewResponse) => {
        setOverview((current) => ({
          ...current,
          activeTrip: overviewResponse?.activeTrip ?? null,
          canSubmit: Boolean(overviewResponse?.canSubmit),
        }));
      }).catch(() => {/* ignore background polling errors */});
    }, 2500);

    return () => clearInterval(intervalId);
  }, [open, loadData, driverId]);

  useEffect(() => {
    if (!open || !driverId) {
      return undefined;
    }

    const normalizedDriverId = String(driverId).trim().toLowerCase();

    const disconnect = connectRideEventStream({
      accountId: String(driverId).trim(),
      roleCode: 'Q3',
      onEvent: (eventPayload) => {
        const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();

        if (eventType !== 'ride.trip.status.updated') {
          return;
        }

        const eventDriverAccountId = String(
          eventPayload?.driverAccountId ?? eventPayload?.booking?.driverAccountId ?? '',
        ).trim().toLowerCase();
        const eventTripStatus = String(eventPayload?.tripStatus ?? eventPayload?.booking?.tripStatus ?? '').trim().toLowerCase();

        if (eventDriverAccountId && eventDriverAccountId !== normalizedDriverId) {
          return;
        }

        if (eventTripStatus === 'danhanchuyen') {
          void loadData();
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [driverId, loadData, open]);

  const handleSubmit = useCallback(async () => {
    if (!driverId) {
      setError('Không tìm thấy thông tin tài xế.');
      return;
    }

    if (!issueType) {
      setError('Vui lòng chọn loại sự cố.');
      return;
    }

    if (!overview?.canSubmit || !overview?.activeTrip?.bookingCode) {
      setError('Chỉ có thể gửi báo cáo khi tài xế đang thực hiện chuyến đi.');
      return;
    }

    if (String(description ?? '').trim().length < 10) {
      setError('Mô tả sự cố cần tối thiểu 10 ký tự.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await driverSupportService.createRequest(driverId, {
        issueType,
        description,
      });

      const createdRequest = response?.request;
      if (createdRequest) {
        setOverview((current) => ({
          ...current,
          recentRequests: [createdRequest, ...(current.recentRequests ?? [])].slice(0, 6),
        }));
      }

      setDescription('');
      setOverview((current) => ({
        ...current,
        activeTrip: null,
        canSubmit: false,
      }));

      const cancelledBookingCode = String(response?.cancelledBookingCode ?? '').trim();

      if (cancelledBookingCode) {
        onForceTripCancelled?.(cancelledBookingCode);

        if (typeof window !== 'undefined') {
          const forceCancelPayload = {
            bookingCode: cancelledBookingCode,
            source: 'driver-support',
            createdAt: new Date().toISOString(),
          };

          try {
            window.localStorage.setItem(FORCE_TRIP_CANCELLED_STORAGE_KEY, JSON.stringify(forceCancelPayload));
          } catch {
            // Ignore storage failures.
          }

          try {
            window.dispatchEvent(new CustomEvent(FORCE_TRIP_CANCELLED_EVENT_NAME, { detail: forceCancelPayload }));
          } catch {
            // Ignore event dispatch failures.
          }
        }
      }

      onNotify?.(
        response?.message || `Đã gửi báo cáo và hủy chuyến ${response?.cancelledBookingCode || ''}.`,
        'success',
      );
    } catch (submitError) {
      setError(submitError?.message || 'Không thể gửi báo cáo sự cố.');
    } finally {
      setSubmitting(false);
    }
  }, [description, driverId, issueType, onNotify, overview?.activeTrip?.bookingCode, overview?.canSubmit]);

  if (!open) return null;

  return createPortal(
    <div className="driver-support-modal" role="dialog" aria-modal="true" aria-label="Hỗ trợ và an toàn">
      <div className="driver-support-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="driver-support-modal__window">
        <div className="driver-support-modal__header">
          <h2 className="driver-support-modal__title">Hỗ trợ và an toàn</h2>
          <button className="driver-support-modal__close" type="button" onClick={onClose} aria-label="Đóng">
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>

        <div className="driver-support-modal__content">
          <p className="driver-support-modal__sub">Liên hệ hỗ trợ:</p>
          <div className="driver-support-modal__quick-actions">
            <a className="driver-support-modal__quick-action driver-support-modal__quick-action--sos" href={`tel:${overview.contact.hotline}`}>
              <strong>SOS</strong>
              <span>Khẩn cấp</span>
            </a>
            <a className="driver-support-modal__quick-action driver-support-modal__quick-action--call" href={`tel:${overview.contact.hotline}`}>
              <strong>Gọi tổng đài</strong>
              <span>{overview.contact.hotline}</span>
            </a>
            <a className="driver-support-modal__quick-action driver-support-modal__quick-action--chat" href={`mailto:${overview.contact.email}`}>
              <strong>{overview.contact.chatLabel || 'Chat với CSKH'}</strong>
              <span>{overview.contact.email}</span>
            </a>
          </div>

          <div className="driver-support-modal__contact-lines">
            <div><span>Hotline:</span> <strong>{overview.contact.hotline}</strong></div>
            <div><span>Email:</span> <strong>{overview.contact.email}</strong></div>
          </div>

          <div className="driver-support-modal__form-title">Báo cáo sự cố</div>

          <div className="driver-support-modal__contact-lines">
            <div>
              <span>Đơn đang thực hiện:</span>{' '}
              <strong>{overview?.activeTrip?.bookingCode || 'Không có đơn đang thực hiện'}</strong>
            </div>
          </div>

          <select
            className="driver-support-modal__select"
            value={issueType}
            onChange={(event) => setIssueType(event.target.value)}
            disabled={loading || submitting || !overview?.canSubmit}
          >
            <option value="">-- Chọn loại sự cố --</option>
            {issueOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          <textarea
            className="driver-support-modal__textarea"
            rows={4}
            placeholder="Mô tả sự cố..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading || submitting || !overview?.canSubmit}
          />

          {error && <div className="driver-support-modal__error">{error}</div>}

          <div className="driver-support-modal__actions">
            <button
              type="button"
              className="driver-support-modal__submit"
              onClick={handleSubmit}
              disabled={loading || submitting || !overview?.canSubmit}
            >
              {submitting ? 'Đang gửi...' : 'Gửi báo cáo'}
            </button>
          </div>

          <div className="driver-support-modal__history">
            <h4>Yêu cầu gần đây</h4>
            {loading ? (
              <div className="driver-support-modal__empty">Đang tải dữ liệu...</div>
            ) : overview.recentRequests.length === 0 ? (
              <div className="driver-support-modal__empty">Chưa có yêu cầu hỗ trợ nào.</div>
            ) : (
              <ul>
                {overview.recentRequests.map((item) => (
                  <li key={`${item.id}-${item.createdAt}`}>
                    <div className="driver-support-modal__history-line">
                      <strong>{item.issueLabel || 'Sự cố'}</strong>
                      <span>{getStatusLabel(item.status)}</span>
                    </div>
                    <p>{item.description}</p>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
