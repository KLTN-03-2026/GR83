import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { closeIcon, locationIcon, originIcon, pinIcon, motorbikeIcon, carIcon, busIcon } from '../../assets/icons';
import './BookingGuideModal.css';

const RIDE_OPTIONS = {
  motorbike: [
    { id: 'bike-saving', title: 'RiBike tiết kiệm', subtitle: '4 chỗ', price: '30.000đ', icon: motorbikeIcon },
    { id: 'bike-standard', title: 'RiBike phổ thông', subtitle: '4 chỗ', price: '43.000đ', icon: motorbikeIcon },
    { id: 'bike-plus', title: 'RiBike Plus', subtitle: '6 chỗ', price: '45.000đ', icon: motorbikeIcon },
  ],
  car: [
    { id: 'car-saving', title: 'RiCar tiết kiệm', subtitle: '4 chỗ', price: '80.000đ', icon: carIcon },
    { id: 'car-vip', title: 'RiCar Vip', subtitle: '4 chỗ', price: '90.000đ', icon: carIcon },
    { id: 'car-plus', title: 'RiCar Plus', subtitle: '6 chỗ', price: '110.000đ', icon: carIcon },
    { id: 'car-minibus', title: 'RiCar MiniBus', subtitle: '16 chỗ', price: '100.000đ', icon: busIcon },
    { id: 'car-bus', title: 'RiCar Bus', subtitle: '30 chỗ', price: '110.000đ', icon: busIcon },
  ],
  intercity: [
    { id: 'intercity-saving', title: 'RiCar tiết kiệm', subtitle: '4 chỗ', price: '250.000đ', icon: carIcon },
    { id: 'intercity-vip', title: 'RiCar Vip', subtitle: '4 chỗ', price: '350.000đ', icon: carIcon },
    { id: 'intercity-plus', title: 'RiCar Plus', subtitle: '6 chỗ', price: '500.000đ', icon: carIcon },
    { id: 'intercity-minibus', title: 'RiCar MiniBus', subtitle: '16 chỗ', price: '1.000.000đ', icon: busIcon },
    { id: 'intercity-bus', title: 'RiCar Bus', subtitle: '30 chỗ', price: '2.000.000đ', icon: busIcon },
  ],
};

const VEHICLE_TABS = [
  { id: 'motorbike', label: 'Xe máy' },
  { id: 'car', label: 'Ô tô' },
  { id: 'intercity', label: 'Xe liên tỉnh' },
];

const GUIDE_STEPS = [
  {
    id: 1,
    title: 'Bước 1',
    description: 'Nhập điểm đón và điểm đến',
    vehicle: 'intercity',
    pickup: 'Hòa Xuân',
    destination: 'Huế',
    activeRide: 'intercity-saving',
  },
  {
    id: 2,
    title: 'Bước 2: Chọn loại xe',
    description: '',
    vehicle: 'motorbike',
    pickup: 'Hòa Xuân',
    destination: 'Hoàng Minh Thảo',
    activeRide: 'bike-saving',
  },
  {
    id: 3,
    title: 'Bước 3: Chọn hạng xe (RiCar tiết kiệm, RiCar Vip...)',
    description: '',
    vehicle: 'intercity',
    pickup: 'Hòa Xuân',
    destination: 'Huế',
    activeRide: 'intercity-saving',
  },
  {
    id: 4,
    title: 'Bước 4: Chọn phương thức thanh toán',
    description: '',
    vehicle: 'car',
    pickup: 'Hòa Xuân',
    destination: 'Hội An',
    activeRide: 'car-saving',
    activePayment: 'online',
  },
  {
    id: 5,
    title: 'Bước 5: Chọn mã giảm giá',
    description: '',
    vehicle: 'intercity',
    pickup: 'Hòa Xuân',
    destination: 'Huế',
    activeRide: 'intercity-saving',
    activePromo: true,
  },
  {
    id: 6,
    title: 'Bước 6: Xác nhận đặt xe',
    description: '',
    vehicle: 'motorbike',
    pickup: 'Hòa Xuân',
    destination: 'Hoàng Minh Thảo',
    activeRide: 'bike-saving',
    confirm: true,
  },
];

function BookingMockup({ step }) {
  const options = RIDE_OPTIONS[step.vehicle] ?? RIDE_OPTIONS.motorbike;

  return (
    <article className="booking-guide-modal__mockup">
      <div className="booking-guide-modal__tabs" role="tablist" aria-label="Loại xe">
        {VEHICLE_TABS.map((tab) => (
          <span
            key={tab.id}
            className={`booking-guide-modal__tab${tab.id === step.vehicle ? ' is-active' : ''}`}
          >
            {tab.label}
          </span>
        ))}
      </div>

      <div className="booking-guide-modal__route-mode">
        <img src={locationIcon} alt="" aria-hidden="true" />
        <span>Đường đi</span>
      </div>

      <div className="booking-guide-modal__route-card">
        <div className="booking-guide-modal__route-row">
          <img src={originIcon} alt="" aria-hidden="true" />
          <span>{step.pickup}</span>
        </div>
        <div className="booking-guide-modal__route-divider" />
        <div className="booking-guide-modal__route-row">
          <img src={pinIcon} alt="" aria-hidden="true" />
          <span>{step.destination}</span>
        </div>
      </div>

      <div className="booking-guide-modal__payment-row">
        <span className={`booking-guide-modal__chip${step.activePayment === 'cash' || !step.activePayment ? ' is-active' : ''}`}>Tiền mặt</span>
        <span className={`booking-guide-modal__chip${step.activePayment === 'online' ? ' is-active' : ''}`}>Online</span>
        <span className={`booking-guide-modal__chip${step.activePromo ? ' is-active' : ''}`}>Mã giảm giá</span>
      </div>

      <button className="booking-guide-modal__confirm-btn" type="button">
        Đặt xe
      </button>

      <div className="booking-guide-modal__ride-list">
        {options.map((item) => (
          <div className={`booking-guide-modal__ride-item${item.id === step.activeRide ? ' is-active' : ''}`} key={item.id}>
            <img src={item.icon} alt="" aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <span>{item.subtitle}</span>
            </div>
            <em>{item.price}</em>
          </div>
        ))}
      </div>

      <span className="booking-guide-modal__badge" aria-hidden="true">{step.id}</span>
    </article>
  );
}

export default function BookingGuideModal({ open = false, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="booking-guide-modal" role="dialog" aria-modal="true" aria-label="Hướng dẫn đặt xe">
      <div className="booking-guide-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="booking-guide-modal__window">
        <button className="booking-guide-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng hướng dẫn">
          <img src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="booking-guide-modal__header">
          <h3>Hướng dẫn đặt xe</h3>
          <p>Dễ dàng chỉ với 6 bước đơn giản</p>
        </header>

        <div className="booking-guide-modal__steps">
          {GUIDE_STEPS.map((step) => (
            <section className="booking-guide-modal__step" key={step.id}>
              <div className="booking-guide-modal__step-copy">
                <span className="booking-guide-modal__step-index">{step.id}</span>
                <h4>{step.title}</h4>
                {step.description ? <p>{step.description}</p> : null}
              </div>

              <span className="booking-guide-modal__step-arrow" aria-hidden="true">
                <span className="booking-guide-modal__step-arrow-icon">→</span>
              </span>

              <BookingMockup step={step} />
            </section>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
