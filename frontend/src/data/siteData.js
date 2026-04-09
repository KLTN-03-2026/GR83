import { busIcon, carIcon, motorbikeIcon, promoFlashIcon, promoSaleIcon, promoVoucherIcon } from '../assets/icons';

export const vehicleTabs = [
  {
    id: 'motorbike',
    label: 'Xe máy',
    icon: motorbikeIcon,
  },
  {
    id: 'car',
    label: 'Ô tô',
    icon: carIcon,
  },
  {
    id: 'intercity',
    label: 'Xe liên tỉnh',
    icon: busIcon,
  },
];

export const serviceCards = [
  {
    id: 'motorbike',
    title: 'Xe máy',
    description: 'Nhanh chóng, tiết kiệm, phù hợp cho những quãng đường ngắn trong thành phố.',
    image: motorbikeIcon,
  },
  {
    id: 'car',
    title: 'Ô tô',
    description: 'Thoải mái, an toàn và phù hợp cho gia đình hoặc nhóm bạn nhỏ.',
    image: carIcon,
  },
  {
    id: 'intercity',
    title: 'Xe liên tỉnh',
    description: 'Tiện lợi cho những chuyến đi xa, liên tỉnh và các hành trình dài.',
    image: busIcon,
  },
];

export const promoCards = [
  {
    id: 'flash',
    title: 'Ưu đãi 1 (giảm giá / flash sale)',
    description: 'Flash sale theo tuần giúp tiết kiệm chi phí cho mọi chuyến đi.',
    badge: 'Giảm đến 50%',
    image: promoFlashIcon,
  },
  {
    id: 'voucher',
    title: 'Ưu đãi 2 (voucher / giảm tiền)',
    description: 'Voucher giảm giá áp dụng ngay khi đặt xe, dễ dùng và nhanh chóng.',
    badge: 'Giảm 25.000đ',
    image: promoVoucherIcon,
  },
  {
    id: 'season',
    title: 'Ưu đãi 3 (deal theo mùa)',
    description: 'Các deal theo mùa luôn sẵn sàng để người dùng săn ưu đãi tốt nhất.',
    badge: 'Deal theo mùa',
    image: promoSaleIcon,
  },
];

export const testimonials = [
  {
    id: 'anh',
    name: 'Nguyễn Minh Anh',
    text: 'SmartRide dễ dùng, đặt xe nhanh và giao diện rất rõ ràng. Tôi dùng gần như mỗi ngày.',
  },
  {
    id: 'bao',
    name: 'Trần Quốc Bảo',
    text: 'Tính ổn định tốt, tài xế đến đúng giờ và trải nghiệm thanh toán rất mượt.',
  },
  {
    id: 'ha',
    name: 'Lê Thu Hà',
    text: 'Tôi thích cách hệ thống hiển thị lộ trình và hỗ trợ người dùng rất trực quan.',
  },
];
