import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { closeIcon } from '../../assets/icons';

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function formatDate(value, pattern = 'dd/MM/yyyy') {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return '--';
  }

  return format(date, pattern);
}

function formatCurrency(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '0 VND';
  }

  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.max(0, amount))} VND`;
}

const SERVICE_FEE_BY_VEHICLE = {
  motorbike: 5000,
  car: 7000,
  intercity: 10000,
};

function getServiceFee(vehicle) {
  return SERVICE_FEE_BY_VEHICLE[vehicle] ?? SERVICE_FEE_BY_VEHICLE.motorbike;
}

function openPrintDialog() {
  if (typeof window === 'undefined') {
    return;
  }

  window.print();
}

export default function TripInvoiceModal({ open = false, invoice = null, onClose }) {
  if (!open || !invoice) {
    return null;
  }

  const bookingCode = normalizeText(invoice.bookingCode);
  const invoiceCode = normalizeText(invoice.invoiceCode || invoice.paymentCode || `HDX-${bookingCode}`);
  const bookedAt = invoice.bookedAt ? new Date(invoice.bookedAt) : null;
  const completedAt = invoice.completedAt ? new Date(invoice.completedAt) : null;
  const pickupTime = bookedAt && !Number.isNaN(bookedAt.getTime()) ? format(bookedAt, 'HH:mm') : '--:--';
  const destinationTime = completedAt && !Number.isNaN(completedAt.getTime()) ? format(completedAt, 'HH:mm') : '--:--';

  const serviceFee = getServiceFee(invoice.vehicle);
  const basePrice = Number(invoice.originalPrice || invoice.price || 0);
  const discountAmount = Number(invoice.discountAmount || 0);
  const totalPrice = basePrice + serviceFee - discountAmount;

  return createPortal(
    <div className="trip-invoice-modal" role="dialog" aria-modal="true" aria-label="Hóa đơn chuyến đi">
      <div className="trip-invoice-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="trip-invoice-modal__window" onClick={(event) => event.stopPropagation()}>
        <header className="trip-invoice-modal__header">
          <h2>SMARTRIDE</h2>
          <button type="button" onClick={() => onClose?.()} aria-label="Đóng hóa đơn">
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </header>

        <div className="trip-invoice-modal__content" id="trip-invoice-print-area">
          <div className="trip-invoice-modal__title-wrap">
            <h3>Hóa đơn chuyến đi</h3>
            <p>Chúc bạn có những chuyến đi an toàn và thuận lợi cùng SmartRide!</p>
          </div>

          <div className="trip-invoice-modal__grid">
            <div className="trip-invoice-modal__left">
              <dl className="trip-invoice-modal__meta-list">
                <div><dt>Mã đặt xe:</dt><dd>{bookingCode || '--'}</dd></div>
                <div><dt>Mã hóa đơn:</dt><dd>{invoiceCode || '--'}</dd></div>
                <div><dt>Ngày:</dt><dd>{formatDate(invoice.bookedAt)}</dd></div>
                <div><dt>Thời gian đặt:</dt><dd>{pickupTime}</dd></div>
              </dl>

              <div className="trip-invoice-modal__total-row">
                <span>Tổng tiền:</span>
                <strong>{formatCurrency(totalPrice)}</strong>
              </div>

              <section className="trip-invoice-modal__section">
                <h4>Chi tiết</h4>
                <dl className="trip-invoice-modal__detail-list">
                  <div><dt>Giá theo quãng đường:</dt><dd>{formatCurrency(basePrice)}</dd></div>
                  <div><dt>Phí dịch vụ:</dt><dd>{formatCurrency(serviceFee)}</dd></div>
                  <div><dt>Khuyến mãi:</dt><dd>- {formatCurrency(discountAmount)}</dd></div>
                </dl>
              </section>

              <div className="trip-invoice-modal__final-row">
                <span>Tổng cộng:</span>
                <strong>{formatCurrency(totalPrice)}</strong>
              </div>

              <div className="trip-invoice-modal__bottom-grid">
                <div>
                  <h5>Loại xe</h5>
                  <p>{normalizeText(invoice.vehicleLabel) || '--'}</p>
                </div>
                <div>
                  <h5>Phương thức thanh toán</h5>
                  <p>{normalizeText(invoice.paymentLabel) || 'Tiền mặt'}</p>
                </div>
              </div>
            </div>

            <div className="trip-invoice-modal__right">
              <button className="trip-invoice-modal__pdf-button" type="button" onClick={openPrintDialog}>
                Xuất file PDF
              </button>

              <section className="trip-invoice-modal__section trip-invoice-modal__section--route">
                <h4>Chuyến đi của bạn</h4>
                <p>{Number(invoice.routeDistanceKm || 0).toFixed(1)} km - {Number(invoice.etaMinutes || 0)} phút</p>

                <div className="trip-invoice-modal__route-point">
                  <span className="dot dot--pickup" />
                  <div>
                    <strong>{normalizeText(invoice.pickupLabel) || '--'}</strong>
                    <small>{pickupTime}</small>
                  </div>
                </div>

                <div className="trip-invoice-modal__route-point">
                  <span className="dot dot--destination" />
                  <div>
                    <strong>{normalizeText(invoice.destinationLabel) || '--'}</strong>
                    <small>{destinationTime}</small>
                  </div>
                </div>
              </section>

              <section className="trip-invoice-modal__driver-box">
                <p><strong>Tài xế thực hiện chuyến đi:</strong> {normalizeText(invoice.driverDisplayName) || '--'}</p>
                <p><strong>Số điện thoại:</strong> {normalizeText(invoice.driverPhone) || '--'}</p>
                <p><strong>Biển số xe:</strong> {normalizeText(invoice.driverLicensePlate || invoice.driverVehicleLicensePlate) || '--'}</p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
