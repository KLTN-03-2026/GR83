import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { closeIcon, starIcon } from '../../assets/icons';
import { rideService } from '../../services/rideService';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseDate(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function formatDateTime(value) {
  const parsedDate = parseDate(value);

  if (!parsedDate) {
    return '--';
  }

  return format(parsedDate, 'HH:mm · dd/MM/yyyy');
}

function formatShortDate(value) {
  const parsedDate = parseDate(value);

  if (!parsedDate) {
    return '--';
  }

  return format(parsedDate, 'dd/MM/yyyy');
}

function formatNumber(value, maximumFractionDigits = 0) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return '0';
  }

  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(normalizedValue);
}

function getInitials(name) {
  const parts = normalizeText(name)
    .split(' ')
    .filter(Boolean);

  if (parts.length === 0) {
    return 'TX';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function extractTripHistoryItems(response) {
  if (Array.isArray(response?.items)) {
    return response.items;
  }

  if (Array.isArray(response?.history)) {
    return response.history;
  }

  if (Array.isArray(response?.data?.items)) {
    return response.data.items;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return [];
}

function getRatingCounts(reviewSummary = {}) {
  return [1, 2, 3, 4, 5].reduce((counts, ratingValue) => {
    const normalizedValue = Number(reviewSummary.ratingCounts?.[ratingValue] ?? reviewSummary.ratingCounts?.[String(ratingValue)] ?? 0);
    counts[ratingValue] = Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : 0;
    return counts;
  }, {});
}

function buildReviewSummary(items = [], historySummary = {}, reviewSummary = {}) {
  const normalizedCounts = getRatingCounts(reviewSummary);
  const hasServerSummary = Number(reviewSummary.totalReviews ?? 0) > 0 || Number(reviewSummary.averageRating ?? 0) > 0;

  if (hasServerSummary) {
    return {
      totalReviews: Number(reviewSummary.totalReviews ?? 0) || 0,
      averageRating: Number(reviewSummary.averageRating ?? 0) || 0,
      ratingCounts: normalizedCounts,
      firstTripAt: normalizeText(reviewSummary.firstTripAt ?? ''),
      latestReviewAt: normalizeText(reviewSummary.latestReviewAt ?? ''),
      latestTripAt: normalizeText(reviewSummary.latestTripAt ?? ''),
      totalTrips: Number(historySummary.totalTrips ?? items.length) || items.length,
      completedTrips: Number(historySummary.completedTrips ?? 0) || 0,
    };
  }

  const fallbackCounts = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  let totalReviews = 0;
  let ratingTotal = 0;
  let earliestTripAt = null;
  let latestTripAt = null;
  let latestReviewAt = null;

  items.forEach((item) => {
    const tripDate = parseDate(item.completedAt ?? item.bookedAt ?? item.updatedAt);

    if (tripDate) {
      if (!earliestTripAt || tripDate < earliestTripAt) {
        earliestTripAt = tripDate;
      }

      if (!latestTripAt || tripDate > latestTripAt) {
        latestTripAt = tripDate;
      }
    }

    const ratingValue = Number(item.ratingScore ?? 0);

    if (!Number.isFinite(ratingValue) || ratingValue <= 0) {
      return;
    }

    const normalizedRating = Math.max(1, Math.min(5, Math.round(ratingValue)));
    totalReviews += 1;
    ratingTotal += normalizedRating;
    fallbackCounts[normalizedRating] += 1;

    const reviewDate = parseDate(item.ratingSubmittedAt ?? item.completedAt ?? item.bookedAt);

    if (reviewDate && (!latestReviewAt || reviewDate > latestReviewAt)) {
      latestReviewAt = reviewDate;
    }
  });

  return {
    totalReviews,
    averageRating: totalReviews > 0 ? Number((ratingTotal / totalReviews).toFixed(2)) : 0,
    ratingCounts: fallbackCounts,
    firstTripAt: earliestTripAt?.toISOString?.() ?? '',
    latestReviewAt: latestReviewAt?.toISOString?.() ?? '',
    latestTripAt: latestTripAt?.toISOString?.() ?? '',
    totalTrips: Number(historySummary.totalTrips ?? items.length) || items.length,
    completedTrips: Number(historySummary.completedTrips ?? 0) || 0,
  };
}

function formatStarDisplay(ratingValue) {
  const normalizedRating = Number(ratingValue);
  const filledStars = Number.isFinite(normalizedRating) ? Math.max(0, Math.min(5, Math.round(normalizedRating))) : 0;

  return Array.from({ length: 5 }, (_, index) => ({
    filled: index < filledStars,
  }));
}

function getLatestNonEmptyValue(items, key) {
  return items.find((item) => normalizeText(item?.[key]))?.[key] ?? '';
}

export default function DriverReviewModal({
  open = false,
  accountId = '',
  accountDisplayName = '',
  accountIdentifier = '',
  accountPhone = '',
  onClose,
}) {
  const [historyItems, setHistoryItems] = useState([]);
  const [historySummary, setHistorySummary] = useState({});
  const [reviewSummary, setReviewSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resolvedAccountId = useMemo(() => normalizeText(accountId), [accountId]);
  const resolvedIdentifier = useMemo(() => normalizeText(accountIdentifier), [accountIdentifier]);

  const reviewItems = useMemo(() => {
    return historyItems
      .filter((item) => Number(item?.ratingScore ?? 0) > 0)
      .slice()
      .sort((left, right) => {
        const leftTime = parseDate(left.ratingSubmittedAt ?? left.completedAt ?? left.bookedAt ?? left.updatedAt)?.getTime() ?? 0;
        const rightTime = parseDate(right.ratingSubmittedAt ?? right.completedAt ?? right.bookedAt ?? right.updatedAt)?.getTime() ?? 0;

        return rightTime - leftTime;
      });
  }, [historyItems]);

  const mergedReviewSummary = useMemo(() => buildReviewSummary(historyItems, historySummary, reviewSummary), [historyItems, historySummary, reviewSummary]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setHistoryItems([]);
    setHistorySummary({});
    setReviewSummary({});
    setError('');
    setLoading(true);

    const controller = new AbortController();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const loadReviews = async () => {
      try {
        const response = await rideService.getTripHistory(
          {
            accountId: resolvedAccountId,
            identifier: resolvedIdentifier,
            roleCode: 'Q3',
            limit: 40,
          },
          { signal: controller.signal },
        );

        const normalizedItems = extractTripHistoryItems(response);
        setHistoryItems(normalizedItems);
        setHistorySummary(response?.summary ?? response?.data?.summary ?? {});
        setReviewSummary(response?.reviewSummary ?? response?.data?.reviewSummary ?? {});
      } catch (loadError) {
        if (loadError?.name === 'AbortError') {
          return;
        }

        setError(loadError?.message || 'Không thể tải dữ liệu đánh giá.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadReviews();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open, resolvedAccountId, resolvedIdentifier]);

  if (!open) {
    return null;
  }

  const driverName = normalizeText(
    accountDisplayName || getLatestNonEmptyValue(reviewItems, 'driverDisplayName') || getLatestNonEmptyValue(historyItems, 'driverDisplayName') || accountIdentifier || 'Tài xế',
  );
  const driverLicensePlate = normalizeText(
    getLatestNonEmptyValue(reviewItems, 'driverLicensePlate')
      || getLatestNonEmptyValue(reviewItems, 'driverVehicleLicensePlate')
      || getLatestNonEmptyValue(historyItems, 'driverLicensePlate')
      || getLatestNonEmptyValue(historyItems, 'driverVehicleLicensePlate'),
  );
  const joinedAtLabel = formatShortDate(mergedReviewSummary.firstTripAt || reviewItems[reviewItems.length - 1]?.bookedAt || historyItems[historyItems.length - 1]?.bookedAt);
  const latestReviewLabel = formatDateTime(mergedReviewSummary.latestReviewAt || reviewItems[0]?.ratingSubmittedAt || reviewItems[0]?.completedAt || reviewItems[0]?.bookedAt);
  const averageRating = Number(mergedReviewSummary.averageRating ?? 0) || 0;
  const averageRatingLabel = averageRating > 0 ? averageRating.toFixed(2) : '0.00';
  const totalReviewsLabel = formatNumber(mergedReviewSummary.totalReviews ?? reviewItems.length);
  const completedTripsLabel = formatNumber(mergedReviewSummary.completedTrips ?? historySummary?.completedTrips ?? 0);
  const positiveRate = mergedReviewSummary.totalReviews > 0
    ? Math.round(((Number(mergedReviewSummary.ratingCounts?.[4] ?? 0) + Number(mergedReviewSummary.ratingCounts?.[5] ?? 0)) / mergedReviewSummary.totalReviews) * 100)
    : 0;

  const heroStats = [
    { label: 'Điểm trung bình', value: averageRatingLabel },
    { label: 'Tổng đánh giá', value: totalReviewsLabel },
    { label: '4-5 sao', value: `${positiveRate}%` },
    { label: 'Chuyến hoàn thành', value: completedTripsLabel },
  ];

  const ratingDistribution = [5, 4, 3, 2, 1].map((ratingValue) => {
    const count = Number(mergedReviewSummary.ratingCounts?.[ratingValue] ?? 0) || 0;
    const percentage = mergedReviewSummary.totalReviews > 0 ? Math.round((count / mergedReviewSummary.totalReviews) * 100) : 0;

    return {
      ratingValue,
      count,
      percentage,
    };
  });

  const noteText = mergedReviewSummary.totalReviews > 0
    ? `Đã ghi nhận ${totalReviewsLabel} đánh giá, cập nhật mới nhất lúc ${latestReviewLabel}.`
    : 'Tài khoản hiện tại chưa có đánh giá nào được ghi nhận.';

  return createPortal(
    <div className="driver-review-modal" role="dialog" aria-modal="true" aria-label="Xem đánh giá của tài xế">
      <div className="driver-review-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="driver-review-modal__window">
        <button className="driver-review-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng popup xem đánh giá">
          <img className="driver-review-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="driver-review-modal__hero">
          <div className="driver-review-modal__hero-copy">
            <p className="driver-review-modal__eyebrow">Xem đánh giá</p>
            <h3>Đánh giá của chính tài xế</h3>
            <p className="driver-review-modal__summary-text">
              Tổng hợp các nhận xét từ chuyến đi đã hoàn thành, hiển thị theo đúng tài khoản tài xế đang đăng nhập.
            </p>

            <div className="driver-review-modal__hero-chips">
              <span className="driver-review-modal__hero-chip">Tài xế: {driverName || '--'}</span>
              <span className="driver-review-modal__hero-chip">Biển số: {driverLicensePlate || 'Đang cập nhật'}</span>
              <span className="driver-review-modal__hero-chip">Tham gia: {joinedAtLabel}</span>
            </div>
          </div>

          <div className="driver-review-modal__hero-stats" aria-label="Tổng quan đánh giá">
            {heroStats.map((stat) => (
              <article className="driver-review-modal__hero-stat" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </article>
            ))}
          </div>
        </header>

        <div className="driver-review-modal__content">
          <aside className="driver-review-modal__summary">
            <div className="driver-review-modal__profile-card">
              <div className="driver-review-modal__avatar-shell" aria-hidden="true">
                <div className="driver-review-modal__avatar">{getInitials(driverName)}</div>
                <div className="driver-review-modal__avatar-badge">
                  <img className="driver-review-modal__avatar-badge-icon" src={starIcon} alt="" aria-hidden="true" />
                </div>
              </div>

              <div className="driver-review-modal__profile-copy">
                <p className="driver-review-modal__section-kicker">Hồ sơ tài xế</p>
                <h4>{driverName || 'Tài xế'}</h4>
                <span>{driverLicensePlate || 'Đang cập nhật biển số'}</span>
                <p>{accountPhone ? `Liên hệ: ${accountPhone}` : 'Chỉ hiển thị dữ liệu của tài khoản hiện tại.'}</p>
              </div>
            </div>

            <div className="driver-review-modal__score-card">
              <div className="driver-review-modal__score-copy">
                <p className="driver-review-modal__section-kicker">Điểm đánh giá</p>
                <strong>{averageRatingLabel}</strong>
                <span>{totalReviewsLabel} nhận xét được gửi bởi khách hàng.</span>
              </div>

              <div className="driver-review-modal__score-stars" aria-label={`Điểm trung bình ${averageRatingLabel} trên 5`}>
                {formatStarDisplay(averageRating).map((star, index) => (
                  <span key={`driver-review-star-${index}`} className={star.filled ? 'is-filled' : ''} aria-hidden="true">★</span>
                ))}
              </div>
            </div>

            <div className="driver-review-modal__distribution-card">
              <div className="driver-review-modal__section-head">
                <div>
                  <p className="driver-review-modal__section-kicker">Phân bố sao</p>
                  <h4>Biểu đồ đánh giá</h4>
                </div>
                <span>{mergedReviewSummary.totalReviews > 0 ? `${positiveRate}% tích cực` : 'Chưa có dữ liệu'}</span>
              </div>

              <div className="driver-review-modal__distribution-list">
                {ratingDistribution.map((item) => (
                  <div className="driver-review-modal__distribution-row" key={item.ratingValue}>
                    <span className="driver-review-modal__distribution-label">
                      <img className="driver-review-modal__distribution-icon" src={starIcon} alt="" aria-hidden="true" />
                      {item.ratingValue}
                    </span>

                    <div className="driver-review-modal__distribution-track" aria-hidden="true">
                      <span style={{ width: `${item.percentage}%` }} />
                    </div>

                    <strong>{formatNumber(item.count)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <p className="driver-review-modal__summary-note">{noteText}</p>
          </aside>

          <section className="driver-review-modal__reviews" aria-label="Danh sách đánh giá">
            <div className="driver-review-modal__reviews-head">
              <div>
                <p className="driver-review-modal__section-kicker">Danh sách nhận xét</p>
                <h4>Phản hồi mới nhất</h4>
              </div>

              <span>{formatNumber(reviewItems.length)} đánh giá hiển thị</span>
            </div>

            <div className="driver-review-modal__review-list">
              {loading ? (
                <div className="driver-review-modal__empty-state">
                  <strong>Đang tải dữ liệu đánh giá</strong>
                  <p>Hệ thống đang đồng bộ lịch sử chuyến đi và các nhận xét liên quan.</p>
                </div>
              ) : error ? (
                <div className="driver-review-modal__empty-state driver-review-modal__empty-state--error">
                  <strong>Không thể tải đánh giá</strong>
                  <p>{error}</p>
                </div>
              ) : reviewItems.length > 0 ? (
                reviewItems.map((item) => {
                  const ratingValue = Math.max(1, Math.min(5, Math.round(Number(item.ratingScore ?? 0) || 0)));
                  const comment = normalizeText(item.ratingComment) || 'Khách hàng chưa để lại nhận xét.';
                  const reviewTimeLabel = formatDateTime(item.ratingSubmittedAt ?? item.completedAt ?? item.bookedAt ?? item.updatedAt);
                  const routeLabel = [item.pickupLabel, item.destinationLabel].filter(Boolean).join(' → ');

                  return (
                    <article className="driver-review-modal__review-card" key={item.id}>
                      <div className="driver-review-modal__review-head">
                        <div className="driver-review-modal__review-avatar" aria-hidden="true">
                          {getInitials(item.customerName || item.bookingCode)}
                        </div>

                        <div className="driver-review-modal__review-copy">
                          <strong>{normalizeText(item.customerName) || 'Khách hàng'}</strong>
                          <span>
                            {normalizeText(item.bookingCode) || '--'} · {reviewTimeLabel}
                          </span>
                        </div>

                        <div className="driver-review-modal__review-rating" aria-label={`Đánh giá ${ratingValue} trên 5 sao`}>
                          <span>{ratingValue.toFixed(1)}</span>
                          <div className="driver-review-modal__review-stars" aria-hidden="true">
                            {Array.from({ length: 5 }, (_, index) => (
                              <span key={`${item.id ?? 'review'}-${index}`} className={index < ratingValue ? 'is-filled' : ''}>★</span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <p className="driver-review-modal__review-comment">{comment}</p>

                      <div className="driver-review-modal__review-meta">
                        {routeLabel ? <span>{routeLabel}</span> : null}
                        {normalizeText(item.rideTitle) ? <span>{item.rideTitle}</span> : null}
                        {normalizeText(item.priceFormatted) ? <span>{item.priceFormatted}</span> : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="driver-review-modal__empty-state">
                  <strong>Chưa có đánh giá nào</strong>
                  <p>Hiện tại tài khoản này chưa nhận được phản hồi sau chuyến đi hoàn thành.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}