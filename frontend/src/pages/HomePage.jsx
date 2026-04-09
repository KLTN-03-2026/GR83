import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import DestinationPickerModal from '../components/ui/DestinationPickerModal';
import RoutePreviewMap from '../components/ui/RoutePreviewMap';
import SectionHeading from '../components/ui/SectionHeading';
import { createLocationRecord, useAppContext } from '../context/AppContext';
import {
  busIcon,
  carIcon,
  chatbotIcon,
  closeIcon,
  clockIcon,
  helpIcon,
  loginGoogleIcon,
  loginHidePassIcon,
  loginShowPassIcon,
  locationIcon,
  motorbikeIcon,
  originIcon,
  pinIcon,
  phoneIcon,
  quoteIcon,
  starIcon,
  swapIcon,
  userIcon,
} from '../assets/icons';
import { promoCards, serviceCards, testimonials, vehicleTabs } from '../data/siteData';
import { classNames } from '../utils/classNames';
import { authService } from '../services/authService';
import { driverSignupService } from '../services/driverSignupService';
import { rideService } from '../services/rideService';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format, isValid, parse } from 'date-fns';
import { vi } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('vi-VN', vi);

const MOCKUP_RIDE_OPTIONS = {
  motorbike: [
    { id: 'bike-saving', title: 'RiBike tiết kiệm', subtitle: '1 chỗ', price: '30.000đ', icon: motorbikeIcon },
    { id: 'bike-standard', title: 'RiBike phổ thông', subtitle: '1 chỗ', price: '43.000đ', icon: motorbikeIcon },
    { id: 'bike-plus', title: 'RiBike Plus', subtitle: '1 chỗ', price: '45.000đ', icon: motorbikeIcon },
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

const MOCKUP_ROUTE_PRESETS = {
  motorbike: {
    pickup: 'Hòa Xuân',
    destination: 'Hoàng Minh Thảo',
  },
  car: {
    pickup: 'Hòa Xuân',
    destination: 'Hội An',
  },
  intercity: {
    pickup: 'Hòa Xuân',
    destination: 'Huế',
  },
};

const BOOKING_PAYMENT_METHODS = {
  cash: {
    id: 'cash',
    label: 'Tiền mặt',
    shortLabel: 'Tiền mặt',
    description: 'Thanh toán trực tiếp với tài xế khi kết thúc chuyến.',
  },
  qr: {
    id: 'qr',
    label: 'Thanh toán bằng QR code',
    shortLabel: 'QR code',
    description: 'Quét mã QR để thanh toán nhanh ngay trên điện thoại.',
  },
  wallet: {
    id: 'wallet',
    label: 'Thanh toán bằng Ví điện tử',
    shortLabel: 'Ví điện tử',
    description: 'Chọn Zalo pay, Momo hoặc Shopee pay để thanh toán.',
  },
};

const BOOKING_WALLET_PROVIDERS = [
  { id: 'zalopay', label: 'Zalo pay' },
  { id: 'momo', label: 'Momo' },
  { id: 'shopeepay', label: 'Shopee pay' },
];

const BOOKING_OTHER_PAYMENT_METHODS = [BOOKING_PAYMENT_METHODS.qr, BOOKING_PAYMENT_METHODS.wallet];

const DRIVER_SIGNUP_ITEMS = {
  left: [
    { id: 'portrait', label: 'Ảnh chân dung', icon: userIcon },
    { id: 'identity', label: 'CMND / CCCD / Hộ chiếu', icon: userIcon },
    { id: 'license', label: 'Bằng lái xe', icon: carIcon },
    { id: 'background', label: 'Lý lịch tư pháp', icon: quoteIcon },
    { id: 'emergency', label: 'Liên hệ khẩn cấp', icon: phoneIcon },
  ],
  right: [
    { id: 'residence', label: 'Địa chỉ tạm trú', icon: pinIcon },
    { id: 'bank', label: 'Tài khoản ngân hàng', icon: busIcon },
    { id: 'terms', label: 'Điều khoản dịch vụ', icon: helpIcon },
    { id: 'commit', label: 'Cam kết', icon: starIcon },
    { id: 'vehicle', label: 'Thông tin xe', icon: motorbikeIcon },
  ],
};

const DRIVER_SIGNUP_ALL_ITEMS = [...DRIVER_SIGNUP_ITEMS.left, ...DRIVER_SIGNUP_ITEMS.right];
const DRIVER_PORTRAIT_ITEM_ID = 'portrait';
const DRIVER_IDENTITY_ITEM_ID = 'identity';
const DRIVER_LICENSE_ITEM_ID = 'license';
const DRIVER_BACKGROUND_ITEM_ID = 'background';
const DRIVER_EMERGENCY_ITEM_ID = 'emergency';
const DRIVER_RESIDENCE_ITEM_ID = 'residence';
const DRIVER_BANK_ITEM_ID = 'bank';
const DRIVER_TERMS_ITEM_ID = 'terms';
const DRIVER_COMMIT_ITEM_ID = 'commit';
const DRIVER_VEHICLE_ITEM_ID = 'vehicle';
const DRIVER_SIGNUP_SUBMITTED_FIELD_BY_ITEM_ID = {
  [DRIVER_PORTRAIT_ITEM_ID]: 'portraitSubmitted',
  [DRIVER_IDENTITY_ITEM_ID]: 'identitySubmitted',
  [DRIVER_LICENSE_ITEM_ID]: 'licenseSubmitted',
  [DRIVER_BACKGROUND_ITEM_ID]: 'backgroundSubmitted',
  [DRIVER_EMERGENCY_ITEM_ID]: 'emergencySubmitted',
  [DRIVER_RESIDENCE_ITEM_ID]: 'residenceSubmitted',
  [DRIVER_BANK_ITEM_ID]: 'bankSubmitted',
  [DRIVER_TERMS_ITEM_ID]: 'serviceTermsSubmitted',
  [DRIVER_COMMIT_ITEM_ID]: 'commitmentSubmitted',
  [DRIVER_VEHICLE_ITEM_ID]: 'vehicleSubmitted',
};
const DRIVER_PORTRAIT_TERMS = [
  'Ảnh chân dung phải là ảnh thật của chính bạn, chụp rõ mặt, không đeo kính râm và không bị che khuất.',
  'Ảnh phải được chụp trong vòng 06 tháng gần nhất, không qua chỉnh sửa làm sai lệch nhận dạng.',
  'Không sử dụng ảnh của người khác, ảnh từ giấy tờ cũ, hoặc ảnh có watermark của bên thứ ba.',
  'Bạn đồng ý cho SmartRide sử dụng ảnh để xác thực tài khoản, đối soát hồ sơ và xử lý khiếu nại khi cần.',
  'Nếu thông tin ảnh không trung thực, hồ sơ có thể bị từ chối hoặc khóa theo chính sách vận hành.',
];
const DRIVER_PORTRAIT_CAPTURE_GUIDES = [
  'Chụp chính diện từ vai trở lên, đủ sáng, nền đơn giản, không ngược sáng.',
  'Giữ camera ngang tầm mắt, khoảng cách 40-60cm để khuôn mặt chiếm phần lớn khung hình.',
  'Không dùng filter làm thay đổi màu da hoặc đặc điểm nhận dạng.',
  'Ảnh định dạng JPG/PNG/WEBP, dung lượng khuyến nghị dưới 5MB.',
];
const DRIVER_IDENTITY_TERMS = [
  'Giấy tờ tùy thân phải còn hiệu lực và thông tin trùng khớp với hồ sơ tài khoản đã đăng ký.',
  'Bạn cần cung cấp đầy đủ ảnh mặt trước và mặt sau của CMND/CCCD hoặc trang thông tin Hộ chiếu.',
  'Ảnh phải rõ nét toàn bộ 4 góc giấy tờ, không bị lóa sáng, không bị che mất ký tự quan trọng.',
  'SmartRide được phép sử dụng thông tin giấy tờ để xác thực danh tính, tuân thủ quy định pháp luật và chống gian lận.',
  'Nếu giấy tờ giả mạo hoặc sai lệch, hồ sơ sẽ bị từ chối và tài khoản có thể bị khóa vĩnh viễn.',
];
const DRIVER_IDENTITY_CAPTURE_GUIDES = [
  'Chụp tại nơi đủ sáng, đặt giấy tờ trên nền phẳng, không gấp hoặc cong mép.',
  'Mặt trước và mặt sau phải là 2 ảnh riêng biệt, không ghép ảnh.',
  'Không dùng app chỉnh sửa làm mờ số CMND/CCCD, mã QR hoặc ngày cấp.',
  'Định dạng JPG/PNG/WEBP, mỗi ảnh khuyến nghị dưới 5MB.',
];
const DRIVER_LICENSE_TERMS = [
  'Bằng lái xe phải còn hiệu lực và phù hợp với loại phương tiện bạn đăng ký hoạt động.',
  'Bạn cần tải đủ 2 ảnh riêng biệt: mặt trước và mặt sau bằng lái xe.',
  'Ảnh phải rõ nét, không lóa sáng, không che khuất thông tin hạng bằng và thời hạn.',
  'SmartRide được phép dùng ảnh bằng lái để xác thực hồ sơ tài xế và đối soát tuân thủ.',
  'Nếu bằng lái giả mạo hoặc không hợp lệ, hồ sơ sẽ bị từ chối hoặc khóa theo chính sách.',
];
const DRIVER_LICENSE_CAPTURE_GUIDES = [
  'Đặt bằng lái trên nền phẳng, chụp đủ 4 góc và không cắt mất viền.',
  'Mặt trước và mặt sau cần chụp riêng, không dùng ảnh ghép.',
  'Không chỉnh sửa làm mờ hoặc thay đổi thông tin trên bằng lái.',
  'Định dạng JPG/PNG/WEBP, mỗi ảnh khuyến nghị dưới 5MB.',
];
const DRIVER_BACKGROUND_TERMS = [
  'Lý lịch tư pháp phải là giấy tờ hợp lệ, còn giá trị sử dụng theo quy định pháp luật.',
  'Bạn chỉ cần tải 1 ảnh chính theo chiều dọc, hiển thị rõ toàn bộ nội dung giấy tờ.',
  'Ảnh phải rõ nét, không bị lóa sáng, không bị cắt mất thông tin quan trọng.',
  'SmartRide được phép dùng ảnh lý lịch tư pháp để xác thực hồ sơ và tuân thủ chính sách an toàn.',
  'Nếu thông tin không trung thực hoặc giấy tờ không hợp lệ, hồ sơ có thể bị từ chối hoặc khóa.',
];
const DRIVER_BACKGROUND_CAPTURE_GUIDES = [
  'Đặt giấy tờ theo chiều dọc, chụp trọn vẹn 4 góc và không che mất dòng chữ.',
  'Giữ camera song song với mặt giấy, tránh nghiêng hoặc méo phối cảnh.',
  'Chụp nơi đủ sáng, không dùng filter làm biến dạng màu hoặc nội dung.',
  'Định dạng JPG/PNG/WEBP, dung lượng ảnh khuyến nghị dưới 5MB.',
];
const DRIVER_EMERGENCY_TERMS = [
  'Bạn cam kết cung cấp thông tin liên hệ khẩn cấp là người thật, có thể liên lạc khi cần hỗ trợ an toàn chuyến đi.',
  'Thông tin phải chính xác và được cập nhật khi có thay đổi để đảm bảo xử lý sự cố kịp thời.',
  'SmartRide chỉ sử dụng thông tin liên hệ khẩn cấp cho mục đích bảo mật, an toàn vận hành và tuân thủ pháp luật.',
  'Nếu phát hiện thông tin sai lệch hoặc giả mạo, hồ sơ tài xế có thể bị từ chối hoặc khóa theo chính sách hệ thống.',
];
const DRIVER_EMERGENCY_RELATIONSHIP_SUGGESTIONS = [
  'Cha',
  'Mẹ',
  'Ông',
  'Bà',
  'Anh',
  'Chị',
  'Em',
  'Vợ',
  'Chồng',
  'Người thân khác',
];
const DRIVER_EMERGENCY_CONTACT_SEPARATOR = '||';
const DRIVER_RESIDENCE_TERMS = [
  'Bạn cam kết địa chỉ tạm trú cung cấp là địa chỉ thực tế và đang có thể nhận thư từ, bưu phẩm từ SmartRide.',
  'Địa chỉ này sẽ được dùng để gửi thông báo, đồng phục và các ấn phẩm vận hành nên cần chính xác tuyệt đối.',
  'Nếu địa chỉ không chính xác hoặc không còn hiệu lực, hồ sơ có thể bị yêu cầu cập nhật lại trước khi duyệt.',
  'Bạn chịu trách nhiệm cập nhật lại địa chỉ ngay khi có thay đổi để tránh thất lạc thư từ hoặc vật phẩm.',
];
const DRIVER_BANK_TERMS = [
  'Bạn cam kết thông tin tài khoản ngân hàng là chính xác và thuộc quyền sử dụng hợp pháp của bạn.',
  'Thông tin tài khoản được dùng cho đối soát thanh toán, hoàn tiền và các nghiệp vụ tài chính liên quan đến hoạt động tài xế.',
  'Nếu thông tin sai lệch, giao dịch có thể bị chậm xử lý hoặc bị từ chối cho đến khi cập nhật đúng dữ liệu.',
  'Bạn chịu trách nhiệm cập nhật lại ngay khi thay đổi chủ thẻ, ngân hàng hoặc số tài khoản.',
];
const DRIVER_VEHICLE_CAPTURE_GUIDES = [
  'Tải đủ 3 ảnh xe: góc trước, góc ngang và góc sau.',
  'Mỗi ảnh cần chụp rõ, đủ sáng, và thấy toàn bộ xe trong khung hình.',
  'Ảnh phải đúng xe đăng ký vận hành, không dùng ảnh mẫu trên mạng.',
  'Định dạng JPG/PNG/WEBP, khuyến nghị dưới 5MB mỗi ảnh.',
];
const DRIVER_SERVICE_TERMS_BENEFITS = [
  'Được ưu tiên phân bổ chuyến theo khu vực hoạt động và khung giờ cao điểm nếu duy trì tỷ lệ nhận chuyến tốt.',
  'Nhận hỗ trợ vận hành 24/7, hướng dẫn xử lý tình huống khẩn cấp và kênh chăm sóc đối tác chuyên biệt.',
  'Được tham gia các chương trình thưởng tuần/tháng theo doanh thu, tỷ lệ hoàn thành chuyến và đánh giá hành khách.',
  'Được truy cập báo cáo thu nhập minh bạch theo ngày/tuần/tháng ngay trên hệ thống SmartRide.',
];
const DRIVER_SERVICE_TERMS_REQUIREMENTS = [
  'Tài xế đồng ý tuân thủ đầy đủ quy chuẩn an toàn vận hành, ứng xử với hành khách và quy định pháp luật hiện hành.',
  'Tài xế đồng ý sử dụng tài khoản đúng mục đích, không cho thuê, không chuyển nhượng hoặc chia sẻ cho người khác sử dụng.',
  'Tài xế đồng ý mức chiết khấu dịch vụ là 30% trên mỗi cước chuyến xe thành công; phần còn lại được ghi nhận vào thu nhập đối tác.',
  'SmartRide có quyền tạm khóa tài khoản để xác minh khi phát hiện dấu hiệu gian lận, giả mạo thông tin hoặc vi phạm nghiêm trọng.',
  'Tài xế có trách nhiệm cập nhật hồ sơ, giấy tờ, thông tin phương tiện và tài khoản ngân hàng khi có thay đổi phát sinh.',
];
const DRIVER_COMMITMENT_BENEFITS = [
  'Tăng độ tin cậy hồ sơ đối tác, giúp xét duyệt quyền lợi nội bộ và chương trình thưởng nhanh hơn.',
  'Được ưu tiên tham gia chiến dịch vận hành mới tại khu vực và các chương trình truyền thông đối tác tiêu biểu.',
  'Được bảo vệ quyền lợi khi có khiếu nại nhờ thông tin cam kết, chữ ký và lịch sử thực hiện nghĩa vụ đã xác nhận.',
];
const DRIVER_COMMITMENT_CLAUSES = [
  'Cam kết phục vụ đúng giá cước hiển thị trên ứng dụng, không thỏa thuận thu thêm ngoài hệ thống nếu không có chính sách hợp lệ.',
  'Cam kết không từ chối chuyến trái quy định, không tự ý hủy chuyến vì lý do chủ quan gây ảnh hưởng trải nghiệm hành khách.',
  'Cam kết bảo mật thông tin khách hàng, không chia sẻ dữ liệu hành trình hoặc thông tin liên hệ cho bên thứ ba.',
  'Cam kết duy trì chất lượng dịch vụ tối thiểu theo tiêu chuẩn nền tảng và hợp tác trong các đợt kiểm tra định kỳ.',
  'Cam kết đồng thuận cơ chế chiết khấu 30% cước chuyến cho nền tảng SmartRide theo chính sách vận hành hiện hành.',
  'Cam kết chịu trách nhiệm pháp lý nếu cung cấp thông tin sai lệch, giả mạo chữ ký hoặc vi phạm các điều khoản đã xác nhận.',
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
const DRIVER_RESIDENCE_ADDRESS_OPTIONS = [
  {
    province: 'Đà Nẵng',
    districts: [
      { district: 'Hải Châu', wards: ['Hải Châu 1', 'Hải Châu 2', 'Hòa Cường Bắc', 'Hòa Cường Nam'] },
      { district: 'Thanh Khê', wards: ['An Khê', 'Thanh Khê Đông', 'Thanh Khê Tây', 'Vĩnh Trung'] },
      { district: 'Sơn Trà', wards: ['An Hải Bắc', 'An Hải Nam', 'Mân Thái', 'Nại Hiên Đông'] },
      { district: 'Ngũ Hành Sơn', wards: ['Mỹ An', 'Khuê Mỹ', 'Hòa Hải', 'Hòa Quý'] },
      { district: 'Liên Chiểu', wards: ['Hòa Khánh Bắc', 'Hòa Khánh Nam', 'Hòa Minh', 'Hòa Hiệp Nam'] },
      { district: 'Cẩm Lệ', wards: ['Hòa An', 'Khuê Trung', 'Hòa Xuân', 'Hòa Thọ Đông'] },
    ],
  },
  {
    province: 'Hà Nội',
    districts: [
      { district: 'Ba Đình', wards: ['Điện Biên', 'Kim Mã', 'Ngọc Hà', 'Giảng Võ'] },
      { district: 'Cầu Giấy', wards: ['Dịch Vọng', 'Nghĩa Tân', 'Quan Hoa', 'Yên Hòa'] },
      { district: 'Đống Đa', wards: ['Láng Hạ', 'Ô Chợ Dừa', 'Văn Miếu', 'Khâm Thiên'] },
      { district: 'Hoàng Mai', wards: ['Đại Kim', 'Định Công', 'Hoàng Liệt', 'Tân Mai'] },
    ],
  },
  {
    province: 'TP. Hồ Chí Minh',
    districts: [
      { district: 'Quận 1', wards: ['Bến Nghé', 'Bến Thành', 'Đa Kao', 'Cầu Ông Lãnh'] },
      { district: 'Quận 3', wards: ['Phường 1', 'Phường 3', 'Phường 7', 'Phường 14'] },
      { district: 'Thủ Đức', wards: ['Linh Xuân', 'Linh Trung', 'Hiệp Bình Chánh', 'Trường Thọ'] },
      { district: 'Bình Thạnh', wards: ['Phường 11', 'Phường 13', 'Phường 22', 'Phường 25'] },
    ],
  },
];
const DRIVER_RESIDENCE_ADDRESS_SEPARATOR = '||';
const DRIVER_BANK_ACCOUNT_SEPARATOR = '||';
const defaultProfileForm = {
  fullName: '',
  email: '',
  phone: '',
  address: '',
  dateOfBirth: '',
  gender: 'Nam',
  avatar: '',
  username: '',
};
const emailInputPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const phoneInputPattern = /^\d{8,15}$/;
const vehicleLicensePlatePattern = /^\d{2}[A-Z]{1,2}-\d{3,5}(?:\.\d{2})?$/i;
const otpInputPattern = /^\d{6}$/;
const frontendApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const backendPublicBaseUrl = frontendApiBaseUrl.replace(/\/?api\/?$/, '');
const DRIVER_FEATURE_LOCK_DEFAULT_MESSAGE =
  'Chức năng Tài xế đang bị khóa tạm thời. Đây không phải khóa tài khoản, bạn vẫn có thể dùng tài khoản ở vai trò Khách hàng.';

function sanitizePhoneDigits(value, maxLength = 15) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, maxLength);
}

function isDriverFeatureLockedState(user = null) {
  const normalizedDriverStatus = String(user?.driverStatus ?? '')
    .trim()
    .toLowerCase();

  return Boolean(user?.driverFeatureLocked) || normalizedDriverStatus === 'khoa' || normalizedDriverStatus === 'locked';
}

function isDriverSignupItemSubmitted(itemId, drafts = {}) {
  const submittedFieldName = DRIVER_SIGNUP_SUBMITTED_FIELD_BY_ITEM_ID[itemId];

  if (!submittedFieldName) {
    return false;
  }

  return Boolean(drafts?.[itemId]?.[submittedFieldName]);
}

function normalizeAppRoleCode(rawRoleCode) {
  const normalizedRoleCode = String(rawRoleCode ?? '')
    .trim()
    .toUpperCase();

  if (normalizedRoleCode === 'Q1' || normalizedRoleCode === 'Q2' || normalizedRoleCode === 'Q3') {
    return normalizedRoleCode;
  }

  const roleToken = String(rawRoleCode ?? '')
    .trim()
    .toLowerCase();

  if (roleToken.includes('admin') || roleToken.includes('quantri')) {
    return 'Q1';
  }

  if (roleToken.includes('taixe') || roleToken.includes('driver')) {
    return 'Q3';
  }

  if (roleToken.includes('khach') || roleToken.includes('customer')) {
    return 'Q2';
  }

  return '';
}

function maskEmailForDisplay(emailValue) {
  const normalizedEmail = String(emailValue ?? '').trim().toLowerCase();

  if (!normalizedEmail.includes('@')) {
    return normalizedEmail;
  }

  const [localPart, domainPart] = normalizedEmail.split('@');

  if (!localPart || !domainPart) {
    return normalizedEmail;
  }

  return `${localPart.slice(0, 2)}***@${domainPart}`;
}

function resolveAvatarUrl(avatarValue) {
  const normalizedValue = String(avatarValue ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(normalizedValue) || normalizedValue.startsWith('data:')) {
    return normalizedValue;
  }

  const normalizedPath = normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`;
  return `${backendPublicBaseUrl}${normalizedPath}`;
}

function resolveFirstNonEmptyText(...values) {
  for (const value of values) {
    const normalizedValue = String(value ?? '').trim();

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return '';
}

function isFileInstance(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function normalizeUploadedDriverAssetPath(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.startsWith('/uploads/')) {
    return normalizedValue;
  }

  return '';
}

function buildEditableProfileSnapshot(profileValue = {}) {
  return {
    fullName: String(profileValue.fullName ?? '').trim(),
    email: String(profileValue.email ?? '').trim(),
    phone: String(profileValue.phone ?? '').trim(),
    address: String(profileValue.address ?? '').trim(),
    dateOfBirth: String(profileValue.dateOfBirth ?? '').trim(),
    gender: String(profileValue.gender ?? '').trim(),
    avatar: String(profileValue.avatar ?? '').trim(),
  };
}

function parseDateForPicker(dateString) {
  const normalizedValue = String(dateString ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = parse(normalizedValue, 'yyyy-MM-dd', new Date());
  return isValid(parsedValue) ? parsedValue : null;
}

function formatDateForProfileValue(dateValue) {
  if (!(dateValue instanceof Date) || !isValid(dateValue)) {
    return '';
  }

  return format(dateValue, 'yyyy-MM-dd');
}

function parseDriverEmergencyContact(rawValue = null) {
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
      relationship: String(relationship ?? '').trim(),
      fullName: String(fullName ?? '').trim(),
      phone: String(phone ?? '').trim(),
      address: String(addressParts.join(DRIVER_EMERGENCY_CONTACT_SEPARATOR) ?? '').trim(),
    };
  }

  if (typeof rawValue === 'object') {
    return {
      relationship: String(rawValue.relationship ?? rawValue.quanHe ?? '').trim(),
      fullName: String(rawValue.fullName ?? rawValue.hoVaTen ?? '').trim(),
      phone: String(rawValue.phone ?? rawValue.sdt ?? '').trim(),
      address: String(rawValue.address ?? rawValue.diaChi ?? '').trim(),
    };
  }

  const normalizedRawValue = String(rawValue ?? '').trim();

  if (!normalizedRawValue) {
    return emptyContact;
  }

  try {
    const parsedJsonValue = JSON.parse(normalizedRawValue);
    return parseDriverEmergencyContact(parsedJsonValue);
  } catch {
    // Continue with delimiter-based fallback.
  }

  const contactParts = normalizedRawValue
    .split(DRIVER_EMERGENCY_CONTACT_SEPARATOR)
    .map((item) => String(item ?? '').trim());

  if (contactParts.length >= 4) {
    const [relationship, fullName, phone, ...addressParts] = contactParts;
    return {
      relationship,
      fullName,
      phone,
      address: String(addressParts.join(DRIVER_EMERGENCY_CONTACT_SEPARATOR) ?? '').trim(),
    };
  }

  return {
    relationship: normalizedRawValue,
    fullName: '',
    phone: '',
    address: '',
  };
}

function buildDriverEmergencyContactRaw(contactValue = {}) {
  const parsedContact = parseDriverEmergencyContact(contactValue);
  return [parsedContact.relationship, parsedContact.fullName, parsedContact.phone, parsedContact.address]
    .map((item) => String(item ?? '').trim())
    .join(` ${DRIVER_EMERGENCY_CONTACT_SEPARATOR} `);
}

function parseDriverResidenceAddress(rawValue = null) {
  const emptyAddress = {
    mode: 'droplist',
    province: '',
    district: '',
    ward: '',
    houseNumber: '',
    manualAddress: '',
  };

  if (rawValue === null || rawValue === undefined) {
    return emptyAddress;
  }

  if (Array.isArray(rawValue)) {
    const [mode, province, district, ward, houseNumber, manualAddress] = rawValue;
    return {
      mode: String(mode ?? 'droplist').trim() === 'manual' ? 'manual' : 'droplist',
      province: String(province ?? '').trim(),
      district: String(district ?? '').trim(),
      ward: String(ward ?? '').trim(),
      houseNumber: String(houseNumber ?? '').trim(),
      manualAddress: String(manualAddress ?? '').trim(),
    };
  }

  if (typeof rawValue === 'object') {
    return {
      mode: String(rawValue.mode ?? rawValue.addressMode ?? 'droplist').trim() === 'manual' ? 'manual' : 'droplist',
      province: String(rawValue.province ?? rawValue.tinh ?? '').trim(),
      district: String(rawValue.district ?? rawValue.quan ?? '').trim(),
      ward: String(rawValue.ward ?? rawValue.phuong ?? '').trim(),
      houseNumber: String(rawValue.houseNumber ?? rawValue.soNha ?? '').trim(),
      manualAddress: String(rawValue.manualAddress ?? rawValue.diaChiDayDu ?? '').trim(),
    };
  }

  const normalizedRawValue = String(rawValue ?? '').trim();

  if (!normalizedRawValue) {
    return emptyAddress;
  }

  try {
    const parsedJsonValue = JSON.parse(normalizedRawValue);
    return parseDriverResidenceAddress(parsedJsonValue);
  } catch {
    // Continue with delimiter-based fallback.
  }

  const addressParts = normalizedRawValue
    .split(DRIVER_RESIDENCE_ADDRESS_SEPARATOR)
    .map((item) => String(item ?? '').trim());

  if (addressParts.length >= 6) {
    const [mode, province, district, ward, houseNumber, ...manualAddressParts] = addressParts;
    return {
      mode: mode === 'manual' ? 'manual' : 'droplist',
      province,
      district,
      ward,
      houseNumber,
      manualAddress: String(manualAddressParts.join(DRIVER_RESIDENCE_ADDRESS_SEPARATOR) ?? '').trim(),
    };
  }

  return {
    ...emptyAddress,
    mode: 'manual',
    manualAddress: normalizedRawValue,
  };
}

function buildDriverResidenceAddressRaw(addressValue = {}) {
  const parsedAddress = parseDriverResidenceAddress(addressValue);
  return [
    parsedAddress.mode,
    parsedAddress.province,
    parsedAddress.district,
    parsedAddress.ward,
    parsedAddress.houseNumber,
    parsedAddress.manualAddress,
  ]
    .map((item) => String(item ?? '').trim())
    .join(` ${DRIVER_RESIDENCE_ADDRESS_SEPARATOR} `);
}

function buildDriverResidenceDisplayAddress(addressValue = {}) {
  const parsedAddress = parseDriverResidenceAddress(addressValue);

  if (parsedAddress.mode === 'manual') {
    return String(parsedAddress.manualAddress ?? '').trim();
  }

  return [parsedAddress.houseNumber, parsedAddress.ward, parsedAddress.district, parsedAddress.province]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function removeVietnameseDiacritics(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeBankHolderNameInput(value = '') {
  return removeVietnameseDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart();
}

function normalizeSearchKeyword(value = '') {
  return removeVietnameseDiacritics(value).toLowerCase().trim();
}

function resolveBankNameFromInput(value = '') {
  const normalizedInput = normalizeSearchKeyword(value);

  if (!normalizedInput) {
    return '';
  }

  const matchedBankName = DRIVER_BANK_NAME_OPTIONS.find(
    (bankOption) => normalizeSearchKeyword(bankOption) === normalizedInput,
  );

  return matchedBankName ?? String(value ?? '').trim();
}

function parseDriverBankAccount(rawValue = null) {
  const emptyBankAccount = {
    holderName: '',
    bankName: '',
    accountNumber: '',
  };

  if (rawValue === null || rawValue === undefined) {
    return emptyBankAccount;
  }

  if (Array.isArray(rawValue)) {
    const [holderName, bankName, accountNumber] = rawValue;
    return {
      holderName: String(holderName ?? '').trim(),
      bankName: String(bankName ?? '').trim(),
      accountNumber: String(accountNumber ?? '').trim(),
    };
  }

  if (typeof rawValue === 'object') {
    return {
      holderName: String(rawValue.holderName ?? rawValue.chuThe ?? rawValue.hoVaTenChuThe ?? '').trim(),
      bankName: String(rawValue.bankName ?? rawValue.nganHang ?? '').trim(),
      accountNumber: String(rawValue.accountNumber ?? rawValue.soTaiKhoan ?? '').trim(),
    };
  }

  const normalizedRawValue = String(rawValue ?? '').trim();

  if (!normalizedRawValue) {
    return emptyBankAccount;
  }

  try {
    const parsedJsonValue = JSON.parse(normalizedRawValue);
    return parseDriverBankAccount(parsedJsonValue);
  } catch {
    // Continue with delimiter-based fallback.
  }

  const accountParts = normalizedRawValue
    .split(DRIVER_BANK_ACCOUNT_SEPARATOR)
    .map((item) => String(item ?? '').trim());

  if (accountParts.length >= 3) {
    const [holderName, bankName, ...accountNumberParts] = accountParts;
    return {
      holderName,
      bankName,
      accountNumber: String(accountNumberParts.join(DRIVER_BANK_ACCOUNT_SEPARATOR) ?? '').trim(),
    };
  }

  return {
    ...emptyBankAccount,
    accountNumber: normalizedRawValue,
  };
}

function buildDriverBankAccountRaw(bankAccountValue = {}) {
  const parsedBankAccount = parseDriverBankAccount(bankAccountValue);
  return [parsedBankAccount.holderName, parsedBankAccount.bankName, parsedBankAccount.accountNumber]
    .map((item) => String(item ?? '').trim())
    .join(` ${DRIVER_BANK_ACCOUNT_SEPARATOR} `);
}

function buildDriverBankAccountPreview(bankAccountValue = {}) {
  const parsedBankAccount = parseDriverBankAccount(bankAccountValue);

  if (!parsedBankAccount.holderName && !parsedBankAccount.bankName && !parsedBankAccount.accountNumber) {
    return '';
  }

  const normalizedAccountNumber = String(parsedBankAccount.accountNumber ?? '').trim();
  const maskedAccountNumber =
    normalizedAccountNumber.length > 4
      ? `${'*'.repeat(Math.max(0, normalizedAccountNumber.length - 4))}${normalizedAccountNumber.slice(-4)}`
      : normalizedAccountNumber;

  return [parsedBankAccount.holderName, parsedBankAccount.bankName, maskedAccountNumber].filter(Boolean).join(' | ');
}

function normalizeIdentityDocumentNumber(value = '') {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
}

function normalizeBookingPaymentMethod(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'qr' || normalizedValue === 'wallet') {
    return normalizedValue;
  }

  return 'cash';
}

function normalizeBookingPaymentProvider(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (normalizedValue === 'momo' || normalizedValue === 'shopeepay') {
    return normalizedValue;
  }

  return 'zalopay';
}

export default function HomePage() {
  const [locationPicker, setLocationPicker] = useState({ open: false, mode: 'destination' });
  const [searchResult, setSearchResult] = useState(null);
  const [selectedRideId, setSelectedRideId] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewSelectedRideId, setPreviewSelectedRideId] = useState(null);
  const [bookingPaymentMethod, setBookingPaymentMethod] = useState('cash');
  const [bookingPaymentProvider, setBookingPaymentProvider] = useState('zalopay');
  const [bookingPaymentPanelOpen, setBookingPaymentPanelOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [driverSignupModalOpen, setDriverSignupModalOpen] = useState(false);
  const [driverDetailModalOpen, setDriverDetailModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [forgotPasswordModalOpen, setForgotPasswordModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registerFullName, setRegisterFullName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [registerVerificationCode, setRegisterVerificationCode] = useState('');
  const [registerSignupToken, setRegisterSignupToken] = useState('');
  const [registerMaskedEmail, setRegisterMaskedEmail] = useState('');
  const [registerOtpExpiresRemainingSeconds, setRegisterOtpExpiresRemainingSeconds] = useState(0);
  const [registerOtpResendRemainingSeconds, setRegisterOtpResendRemainingSeconds] = useState(0);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordVerificationCode, setForgotPasswordVerificationCode] = useState('');
  const [forgotPasswordRequestToken, setForgotPasswordRequestToken] = useState('');
  const [forgotPasswordMaskedEmail, setForgotPasswordMaskedEmail] = useState('');
  const [forgotPasswordOtpExpiresRemainingSeconds, setForgotPasswordOtpExpiresRemainingSeconds] = useState(0);
  const [forgotPasswordOtpResendRemainingSeconds, setForgotPasswordOtpResendRemainingSeconds] = useState(0);
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState('');
  const [forgotPasswordSubmitting, setForgotPasswordSubmitting] = useState(false);
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
  const [googleLoginError, setGoogleLoginError] = useState('');
  const [googleSignupLoading, setGoogleSignupLoading] = useState(false);
  const [googleSignupError, setGoogleSignupError] = useState('');
  const [credentialLoginLoading, setCredentialLoginLoading] = useState(false);
  const [credentialLoginError, setCredentialLoginError] = useState('');
  const [credentialLockRemainingSeconds, setCredentialLockRemainingSeconds] = useState(0);
  const [miniToast, setMiniToast] = useState(null);
  const [authenticatedUser, setAuthenticatedUser] = useState(null);
  const [driverFeatureLockModalOpen, setDriverFeatureLockModalOpen] = useState(false);
  const [driverFeatureLockMessage, setDriverFeatureLockMessage] = useState(DRIVER_FEATURE_LOCK_DEFAULT_MESSAGE);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [profileStatusType, setProfileStatusType] = useState('');
  const [profileForm, setProfileForm] = useState(defaultProfileForm);
  const [profileInitialSnapshot, setProfileInitialSnapshot] = useState(() => buildEditableProfileSnapshot(defaultProfileForm));
  const [profileAvatarFile, setProfileAvatarFile] = useState(null);
  const [profileAvatarPreview, setProfileAvatarPreview] = useState('');
  const [shouldReturnToDriverSignupAfterProfileUpdate, setShouldReturnToDriverSignupAfterProfileUpdate] = useState(false);
  const [currentPasswordValue, setCurrentPasswordValue] = useState('');
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePasswordBootstrapToken, setChangePasswordBootstrapToken] = useState('');
  const [changePasswordResetToken, setChangePasswordResetToken] = useState('');
  const [changePasswordStatus, setChangePasswordStatus] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [driverSelectedItemId, setDriverSelectedItemId] = useState(DRIVER_SIGNUP_ALL_ITEMS[0]?.id ?? '');
  const [driverSignupDrafts, setDriverSignupDrafts] = useState({});
  const [driverSignupStatus, setDriverSignupStatus] = useState('');
  const [driverSignupSubmitting, setDriverSignupSubmitting] = useState(false);
  const [driverDetailView, setDriverDetailView] = useState('default');
  const [driverDetailStatus, setDriverDetailStatus] = useState('');
  const [driverPortraitTermsAccepted, setDriverPortraitTermsAccepted] = useState(false);
  const [driverIdentityTermsAccepted, setDriverIdentityTermsAccepted] = useState(false);
  const [driverLicenseTermsAccepted, setDriverLicenseTermsAccepted] = useState(false);
  const [driverBackgroundTermsAccepted, setDriverBackgroundTermsAccepted] = useState(false);
  const [driverEmergencyTermsAccepted, setDriverEmergencyTermsAccepted] = useState(false);
  const [driverResidenceTermsAccepted, setDriverResidenceTermsAccepted] = useState(false);
  const [driverBankTermsAccepted, setDriverBankTermsAccepted] = useState(false);
  const [driverServiceTermsAccepted, setDriverServiceTermsAccepted] = useState(false);
  const [driverCommitmentAccepted, setDriverCommitmentAccepted] = useState(false);
  const [driverBankDropdownOpen, setDriverBankDropdownOpen] = useState(false);
  const [driverEmergencyRelationshipDropdownOpen, setDriverEmergencyRelationshipDropdownOpen] = useState(false);
  const profileAvatarInputRef = useRef(null);
  const driverSignupDraftCacheByAccountRef = useRef({});
  const skipDriverDraftCacheSyncOnceRef = useRef(false);
  const driverServiceTermsSignatureCanvasRef = useRef(null);
  const driverCommitmentSignatureCanvasRef = useRef(null);
  const driverServiceTermsSignatureStateRef = useRef({ drawing: false });
  const driverCommitmentSignatureStateRef = useRef({ drawing: false });

  const {
    activeVehicle,
    setActiveVehicle,
    scheduleEnabled,
    setScheduleEnabled,
    route,
    setRoute,
    swapRoute,
  } = useAppContext();

  const isRegisterVerificationStep = Boolean(registerSignupToken);
  const isBootstrapPasswordChangeFlow = Boolean(changePasswordBootstrapToken);
  const isPasswordResetTokenFlow = Boolean(changePasswordResetToken);
  const isTokenBasedChangePasswordFlow = isBootstrapPasswordChangeFlow || isPasswordResetTokenFlow;
  const isForgotPasswordVerificationStep = Boolean(forgotPasswordRequestToken);
  const activeDriverDraftOwnerKey = String(
    authenticatedUser?.id ?? authenticatedUser?.email ?? authenticatedUser?.username ?? '',
  )
    .trim()
    .toLowerCase();

  const openLocationPicker = (mode) => {
    setLocationPicker({ open: true, mode });
  };

  const closeLocationPicker = () => {
    setLocationPicker((current) => ({ ...current, open: false }));
  };

  const handleLocationSelect = (field, selection) => {
    const normalizedSelection =
      typeof selection === 'string'
        ? createLocationRecord(selection)
        : createLocationRecord(selection?.label, {
            position: selection?.position,
            source: selection?.source ?? 'search',
          });

    if (!normalizedSelection.label) {
      return;
    }

    setRoute((current) => ({
      ...current,
      [field]: normalizedSelection,
    }));
  };

  useEffect(() => {
    setSearchResult(null);
    setSelectedRideId(null);
    setSearchError('');
    setBookingError('');
    setBookingSuccess(null);
  }, [route.destination.label, route.pickup.label, scheduleEnabled]);

  useEffect(() => {
    void authService.warmupGoogleAuth().catch(() => {
      // Ignore warmup errors; actual login handlers still report runtime errors.
    });
  }, []);

  useEffect(() => {
    skipDriverDraftCacheSyncOnceRef.current = true;

    const resetDriverSignupState = () => {
      setDriverSelectedItemId(DRIVER_SIGNUP_ALL_ITEMS[0]?.id ?? '');
      setDriverSignupStatus('');
      setDriverSignupSubmitting(false);
      setDriverDetailModalOpen(false);
      setDriverDetailView('default');
      setDriverDetailStatus('');
      setDriverPortraitTermsAccepted(false);
      setDriverIdentityTermsAccepted(false);
      setDriverLicenseTermsAccepted(false);
      setDriverBackgroundTermsAccepted(false);
      setDriverEmergencyTermsAccepted(false);
      setDriverResidenceTermsAccepted(false);
      setDriverBankTermsAccepted(false);
      setDriverServiceTermsAccepted(false);
      setDriverCommitmentAccepted(false);
      setDriverBankDropdownOpen(false);
      setDriverEmergencyRelationshipDropdownOpen(false);
    };

    if (!activeDriverDraftOwnerKey) {
      setDriverSignupDrafts({});
      resetDriverSignupState();
      return;
    }

    const cachedDrafts = driverSignupDraftCacheByAccountRef.current[activeDriverDraftOwnerKey];
    setDriverSignupDrafts(cachedDrafts && typeof cachedDrafts === 'object' ? cachedDrafts : {});
    resetDriverSignupState();
  }, [activeDriverDraftOwnerKey]);

  useEffect(() => {
    if (skipDriverDraftCacheSyncOnceRef.current) {
      skipDriverDraftCacheSyncOnceRef.current = false;
      return;
    }

    if (!activeDriverDraftOwnerKey) {
      return;
    }

    const hasAnyDraftData = Object.values(driverSignupDrafts).some((draft) => {
      if (!draft || typeof draft !== 'object') {
        return false;
      }

      return Object.keys(draft).length > 0;
    });

    if (!hasAnyDraftData) {
      delete driverSignupDraftCacheByAccountRef.current[activeDriverDraftOwnerKey];
      return;
    }

    driverSignupDraftCacheByAccountRef.current[activeDriverDraftOwnerKey] = driverSignupDrafts;
  }, [activeDriverDraftOwnerKey, driverSignupDrafts]);

  useEffect(() => {
    if (
      !previewModalOpen &&
      !loginModalOpen &&
      !registerModalOpen &&
      !forgotPasswordModalOpen &&
      !driverSignupModalOpen &&
      !driverDetailModalOpen &&
      !profileModalOpen &&
      !changePasswordModalOpen
    ) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (changePasswordModalOpen) {
          closeChangePasswordModal();
          return;
        }

        if (forgotPasswordModalOpen) {
          closeForgotPasswordModal();
          return;
        }

        if (profileModalOpen) {
          closeProfileModal();
          return;
        }

        if (driverDetailModalOpen) {
          closeDriverDetailModal();
          return;
        }

        if (previewModalOpen) {
          closePreviewModal();
          return;
        }

        if (loginModalOpen) {
          closeLoginModal();
          return;
        }

        if (registerModalOpen) {
          closeRegisterModal();
          return;
        }

        if (driverSignupModalOpen) {
          closeDriverSignupModal();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    changePasswordModalOpen,
    driverDetailModalOpen,
    driverSignupModalOpen,
    forgotPasswordModalOpen,
    loginModalOpen,
    previewModalOpen,
    profileModalOpen,
    registerModalOpen,
  ]);

  useEffect(() => {
    if (credentialLockRemainingSeconds <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setCredentialLockRemainingSeconds((current) => {
        if (current <= 1) {
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [credentialLockRemainingSeconds]);

  useEffect(() => {
    if (registerOtpExpiresRemainingSeconds <= 0 && registerOtpResendRemainingSeconds <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setRegisterOtpExpiresRemainingSeconds((current) => (current > 0 ? current - 1 : 0));
      setRegisterOtpResendRemainingSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [registerOtpExpiresRemainingSeconds, registerOtpResendRemainingSeconds]);

  useEffect(() => {
    if (forgotPasswordOtpExpiresRemainingSeconds <= 0 && forgotPasswordOtpResendRemainingSeconds <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setForgotPasswordOtpExpiresRemainingSeconds((current) => (current > 0 ? current - 1 : 0));
      setForgotPasswordOtpResendRemainingSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [forgotPasswordOtpExpiresRemainingSeconds, forgotPasswordOtpResendRemainingSeconds]);

  useEffect(() => {
    if (!miniToast?.id) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setMiniToast((current) => (current?.id === miniToast.id ? null : current));
    }, miniToast.durationMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [miniToast]);

  const showMiniToast = (message, type = 'success', durationMs = 1600) => {
    setMiniToast({
      id: Date.now(),
      message,
      type,
      durationMs,
    });
  };

  const openDriverFeatureLockModal = (message = '') => {
    const normalizedMessage = String(message ?? '').trim();
    setDriverFeatureLockMessage(normalizedMessage || DRIVER_FEATURE_LOCK_DEFAULT_MESSAGE);
    setDriverFeatureLockModalOpen(true);
  };

  const closeDriverFeatureLockModal = () => {
    setDriverFeatureLockModalOpen(false);
  };

  const maybeShowDriverFeatureLockedNotice = (userPayload, customMessage = '') => {
    if (!isDriverFeatureLockedState(userPayload)) {
      return false;
    }

    openDriverFeatureLockModal(customMessage);
    return true;
  };

  const runRideSearch = async (vehicleOverride = activeVehicle) => {
    const pickupLabel = route.pickup.label.trim();
    const destinationLabel = route.destination.label.trim();

    if (!pickupLabel || !destinationLabel) {
      setSearchError('Vui lòng chọn điểm đón và điểm đến trước khi tìm chuyến.');
      setSearchResult(null);
      setSelectedRideId(null);
      setBookingError('');
      setBookingSuccess(null);
      return;
    }

    setSearchLoading(true);
    setSearchError('');
    setBookingError('');
    setBookingSuccess(null);

    try {
      const response = await rideService.searchRide({
        vehicle: vehicleOverride,
        scheduleEnabled,
        pickup: route.pickup,
        destination: route.destination,
      });

      setSearchResult(response);
      setSelectedRideId(response.results?.[0]?.id ?? null);
    } catch (error) {
      setSearchError(error.message || 'Không thể tìm chuyến lúc này.');
      setSelectedRideId(null);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleBookRide = async (rideIdOverride = null) => {
    const resolvedRideId = rideIdOverride ?? selectedRideId;

    if (!searchResult || !resolvedRideId) {
      setBookingError('Vui lòng chọn một hạng xe trước khi đặt.');
      setBookingSuccess(null);
      return;
    }

    setBookingLoading(true);
    setBookingError('');
    setBookingSuccess(null);

    try {
      const response = await rideService.bookRide({
        accountId: authenticatedUser?.id ?? '',
        vehicle: searchResult.vehicle,
        scheduleEnabled: searchResult.scheduleEnabled,
        pickup: searchResult.pickup,
        destination: searchResult.destination,
        selectedRideId: resolvedRideId,
        paymentMethod: normalizeBookingPaymentMethod(bookingPaymentMethod),
        paymentProvider:
          normalizeBookingPaymentMethod(bookingPaymentMethod) === 'wallet'
            ? normalizeBookingPaymentProvider(bookingPaymentProvider)
            : '',
        customerName: authenticatedUser?.name ?? authenticatedUser?.fullName ?? authenticatedUser?.email ?? 'Khach hang SmartRide',
        customerPhone: authenticatedUser?.phone ?? '',
      });

      if (resolvedRideId !== selectedRideId) {
        setSelectedRideId(resolvedRideId);
      }

      setBookingSuccess(response.booking ?? null);
    } catch (error) {
      setBookingError(error.message || 'Không thể đặt xe lúc này.');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleSearch = () => {
    void runRideSearch(activeVehicle);
  };

  const handleBookingPaymentMethodSelect = (method) => {
    const normalizedMethod = normalizeBookingPaymentMethod(method);

    setBookingPaymentMethod(normalizedMethod);
    setBookingPaymentPanelOpen(normalizedMethod !== 'cash');

    if (normalizedMethod !== 'wallet') {
      setBookingPaymentProvider('zalopay');
    }
  };

  const handleBookingPaymentPanelToggle = () => {
    setBookingPaymentPanelOpen((current) => !current);
  };

  const handleVehicleTabChange = (vehicleId) => {
    if (vehicleId === activeVehicle) {
      return;
    }

    setActiveVehicle(vehicleId);

    if (searchResult) {
      void runRideSearch(vehicleId);
    }
  };

  const displayedRideOptions = useMemo(() => {
    const apiResults = Array.isArray(searchResult?.results) ? searchResult.results : [];

    if (searchResult?.vehicle === activeVehicle && apiResults.length > 0) {
      return apiResults.map((item) => {
        const normalizedTitle = String(item.title ?? '').toLowerCase();
        const useBusIcon = normalizedTitle.includes('bus');

        return {
          id: item.id,
          title: item.title,
          subtitle: item.note || item.driver || '',
          price: item.priceFormatted,
          icon: activeVehicle === 'motorbike' ? motorbikeIcon : useBusIcon ? busIcon : carIcon,
        };
      });
    }

    return MOCKUP_RIDE_OPTIONS[activeVehicle] ?? [];
  }, [activeVehicle, searchResult]);

  useEffect(() => {
    if (!previewModalOpen) {
      return;
    }

    if (displayedRideOptions.length === 0) {
      setPreviewSelectedRideId(null);
      return;
    }

    if (!displayedRideOptions.some((item) => item.id === previewSelectedRideId)) {
      setPreviewSelectedRideId(displayedRideOptions[0].id);
    }
  }, [displayedRideOptions, previewModalOpen, previewSelectedRideId]);

  const selectedBookingPaymentMethod = BOOKING_PAYMENT_METHODS[bookingPaymentMethod] ?? BOOKING_PAYMENT_METHODS.cash;
  const selectedBookingPaymentProvider =
    BOOKING_WALLET_PROVIDERS.find((provider) => provider.id === normalizeBookingPaymentProvider(bookingPaymentProvider)) ??
    BOOKING_WALLET_PROVIDERS[0];
  const selectedBookingPaymentSummary =
    selectedBookingPaymentMethod.id === 'wallet'
      ? `${selectedBookingPaymentMethod.label} - ${selectedBookingPaymentProvider.label}`
      : selectedBookingPaymentMethod.label;
  const bookingPanelPaymentMethodId = bookingPaymentMethod === 'cash' ? 'qr' : bookingPaymentMethod;
  const bookingPanelPaymentMethod = BOOKING_PAYMENT_METHODS[bookingPanelPaymentMethodId] ?? BOOKING_PAYMENT_METHODS.qr;
  const bookingPanelPaymentSummary =
    bookingPanelPaymentMethod.id === 'wallet'
      ? `${bookingPanelPaymentMethod.label} - ${selectedBookingPaymentProvider.label}`
      : bookingPanelPaymentMethod.label;

  const activeRoutePreset = MOCKUP_ROUTE_PRESETS[activeVehicle] ?? MOCKUP_ROUTE_PRESETS.motorbike;
  const mockupPickupLabel =
    route.pickup?.source === 'default' ? activeRoutePreset.pickup : route.pickup?.label || activeRoutePreset.pickup;
  const mockupDestinationLabel =
    route.destination?.source === 'default'
      ? activeRoutePreset.destination
      : route.destination?.label || activeRoutePreset.destination;

  const activeDriverSignupItem = useMemo(
    () => DRIVER_SIGNUP_ALL_ITEMS.find((item) => item.id === driverSelectedItemId) ?? null,
    [driverSelectedItemId],
  );

  const activeDriverSignupDraft =
    activeDriverSignupItem !== null
      ? driverSignupDrafts[activeDriverSignupItem.id] ?? { requiredInfo: '', extraInfo: '' }
      : { requiredInfo: '', extraInfo: '' };

  const isPortraitDriverItem = activeDriverSignupItem?.id === DRIVER_PORTRAIT_ITEM_ID;
  const isIdentityDriverItem = activeDriverSignupItem?.id === DRIVER_IDENTITY_ITEM_ID;
  const isLicenseDriverItem = activeDriverSignupItem?.id === DRIVER_LICENSE_ITEM_ID;
  const isBackgroundDriverItem = activeDriverSignupItem?.id === DRIVER_BACKGROUND_ITEM_ID;
  const isEmergencyDriverItem = activeDriverSignupItem?.id === DRIVER_EMERGENCY_ITEM_ID;
  const isResidenceDriverItem = activeDriverSignupItem?.id === DRIVER_RESIDENCE_ITEM_ID;
  const isBankDriverItem = activeDriverSignupItem?.id === DRIVER_BANK_ITEM_ID;
  const isVehicleDriverItem = activeDriverSignupItem?.id === DRIVER_VEHICLE_ITEM_ID;
  const isServiceTermsDriverItem = activeDriverSignupItem?.id === DRIVER_TERMS_ITEM_ID;
  const isCommitmentDriverItem = activeDriverSignupItem?.id === DRIVER_COMMIT_ITEM_ID;
  const isDriverPortraitTermsStep = isPortraitDriverItem && driverDetailView === 'portrait-terms';
  const isDriverPortraitFormStep = isPortraitDriverItem && driverDetailView === 'portrait-form';
  const isDriverIdentityTermsStep = isIdentityDriverItem && driverDetailView === 'identity-terms';
  const isDriverIdentityFormStep = isIdentityDriverItem && driverDetailView === 'identity-form';
  const isDriverLicenseTermsStep = isLicenseDriverItem && driverDetailView === 'license-terms';
  const isDriverLicenseFormStep = isLicenseDriverItem && driverDetailView === 'license-form';
  const isDriverBackgroundTermsStep = isBackgroundDriverItem && driverDetailView === 'background-terms';
  const isDriverBackgroundFormStep = isBackgroundDriverItem && driverDetailView === 'background-form';
  const isDriverEmergencyTermsStep = isEmergencyDriverItem && driverDetailView === 'emergency-terms';
  const isDriverEmergencyFormStep = isEmergencyDriverItem && driverDetailView === 'emergency-form';
  const isDriverResidenceTermsStep = isResidenceDriverItem && driverDetailView === 'residence-terms';
  const isDriverResidenceFormStep = isResidenceDriverItem && driverDetailView === 'residence-form';
  const isDriverBankTermsStep = isBankDriverItem && driverDetailView === 'bank-terms';
  const isDriverBankFormStep = isBankDriverItem && driverDetailView === 'bank-form';
  const isDriverVehicleFormStep = isVehicleDriverItem && driverDetailView === 'vehicle-form';
  const isDriverServiceTermsFormStep = isServiceTermsDriverItem && driverDetailView === 'service-terms-form';
  const isDriverCommitmentFormStep = isCommitmentDriverItem && driverDetailView === 'commitment-form';
  const activeDriverPortraitPreview = String(activeDriverSignupDraft.portraitPreview ?? '').trim();
  const activeDriverIdentityFrontPreview = String(activeDriverSignupDraft.identityFrontPreview ?? '').trim();
  const activeDriverIdentityBackPreview = String(activeDriverSignupDraft.identityBackPreview ?? '').trim();
  const activeDriverIdentityNumber = normalizeIdentityDocumentNumber(activeDriverSignupDraft.identityCccd);
  const activeDriverLicenseFrontPreview = String(activeDriverSignupDraft.licenseFrontPreview ?? '').trim();
  const activeDriverLicenseBackPreview = String(activeDriverSignupDraft.licenseBackPreview ?? '').trim();
  const activeDriverBackgroundPreview = String(activeDriverSignupDraft.backgroundPreview ?? '').trim();
  const activeDriverVehicleFrontPreview = String(activeDriverSignupDraft.vehicleFrontPreview ?? '').trim();
  const activeDriverVehicleSidePreview = String(activeDriverSignupDraft.vehicleSidePreview ?? '').trim();
  const activeDriverVehicleRearPreview = String(activeDriverSignupDraft.vehicleRearPreview ?? '').trim();
  const activeDriverVehicleLicensePlate = String(activeDriverSignupDraft.vehicleLicensePlate ?? '').toUpperCase();
  const activeDriverVehicleName = String(activeDriverSignupDraft.vehicleName ?? '').trimStart();
  const activeDriverResidenceAddress = useMemo(() => {
    if (!isResidenceDriverItem) {
      return parseDriverResidenceAddress({});
    }

    const hasResidenceFieldDraft =
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceMode') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceProvince') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceDistrict') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceWard') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceHouseNumber') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'residenceManualAddress');

    if (hasResidenceFieldDraft) {
      return {
        mode: String(activeDriverSignupDraft.residenceMode ?? 'droplist') === 'manual' ? 'manual' : 'droplist',
        province: String(activeDriverSignupDraft.residenceProvince ?? ''),
        district: String(activeDriverSignupDraft.residenceDistrict ?? ''),
        ward: String(activeDriverSignupDraft.residenceWard ?? ''),
        houseNumber: String(activeDriverSignupDraft.residenceHouseNumber ?? ''),
        manualAddress: String(activeDriverSignupDraft.residenceManualAddress ?? ''),
      };
    }

    return parseDriverResidenceAddress(activeDriverSignupDraft.requiredInfo);
  }, [activeDriverSignupDraft, isResidenceDriverItem]);
  const activeDriverResidenceMode = activeDriverResidenceAddress.mode;
  const activeDriverResidenceProvince = activeDriverResidenceAddress.province;
  const activeDriverResidenceDistrict = activeDriverResidenceAddress.district;
  const activeDriverResidenceWard = activeDriverResidenceAddress.ward;
  const activeDriverResidenceHouseNumber = activeDriverResidenceAddress.houseNumber;
  const activeDriverResidenceManualAddress = activeDriverResidenceAddress.manualAddress;
  const activeDriverResidenceDistrictOptions = useMemo(() => {
    const provinceOption = DRIVER_RESIDENCE_ADDRESS_OPTIONS.find((item) => item.province === activeDriverResidenceProvince);
    return provinceOption?.districts ?? [];
  }, [activeDriverResidenceProvince]);
  const activeDriverResidenceWardOptions = useMemo(() => {
    const districtOption = activeDriverResidenceDistrictOptions.find((item) => item.district === activeDriverResidenceDistrict);
    return districtOption?.wards ?? [];
  }, [activeDriverResidenceDistrict, activeDriverResidenceDistrictOptions]);
  const activeDriverResidenceDisplayAddress = useMemo(
    () => buildDriverResidenceDisplayAddress(activeDriverResidenceAddress),
    [activeDriverResidenceAddress],
  );
  const activeDriverBankAccount = useMemo(() => {
    if (!isBankDriverItem) {
      return parseDriverBankAccount({});
    }

    const hasBankFieldDraft =
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'bankHolderName') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'bankName') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'bankAccountNumber');

    if (hasBankFieldDraft) {
      return {
        holderName: String(activeDriverSignupDraft.bankHolderName ?? ''),
        bankName: String(activeDriverSignupDraft.bankName ?? ''),
        accountNumber: String(activeDriverSignupDraft.bankAccountNumber ?? ''),
      };
    }

    return parseDriverBankAccount(activeDriverSignupDraft.requiredInfo);
  }, [activeDriverSignupDraft, isBankDriverItem]);
  const activeDriverBankHolderName = activeDriverBankAccount.holderName;
  const activeDriverBankName = activeDriverBankAccount.bankName;
  const activeDriverBankAccountNumber = activeDriverBankAccount.accountNumber;
  const activeDriverFilteredBankOptions = useMemo(() => {
    const normalizedKeyword = normalizeSearchKeyword(activeDriverBankName);

    if (!normalizedKeyword) {
      return DRIVER_BANK_NAME_OPTIONS;
    }

    return DRIVER_BANK_NAME_OPTIONS.filter((bankOption) =>
      normalizeSearchKeyword(bankOption).includes(normalizedKeyword),
    );
  }, [activeDriverBankName]);
  const activeDriverBankPreview = useMemo(
    () => buildDriverBankAccountPreview(activeDriverBankAccount),
    [activeDriverBankAccount],
  );
  const registeredDriverSignerName = resolveFirstNonEmptyText(
    profileForm.fullName,
    authenticatedUser?.fullName,
    authenticatedUser?.name,
  );
  const activeDriverServiceTermsSignerName = String(
    activeDriverSignupDraft.serviceTermsSignerName ?? registeredDriverSignerName,
  ).trim();
  const activeDriverCommitmentSignerName = String(
    activeDriverSignupDraft.commitmentSignerName ?? registeredDriverSignerName,
  ).trim();
  const activeDriverServiceTermsSignature = String(activeDriverSignupDraft.serviceTermsSignature ?? '').trim();
  const activeDriverCommitmentSignature = String(activeDriverSignupDraft.commitmentSignature ?? '').trim();
  const activeDriverEmergencyContact = useMemo(() => {
    if (!isEmergencyDriverItem) {
      return parseDriverEmergencyContact({});
    }

    const relationship = String(activeDriverSignupDraft.emergencyRelationship ?? '');
    const fullName = String(activeDriverSignupDraft.emergencyFullName ?? '');
    const phone = String(activeDriverSignupDraft.emergencyPhone ?? '');
    const address = String(activeDriverSignupDraft.emergencyAddress ?? '');

    const hasEmergencyFieldDraft =
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'emergencyRelationship') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'emergencyFullName') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'emergencyPhone') ||
      Object.prototype.hasOwnProperty.call(activeDriverSignupDraft, 'emergencyAddress');

    if (hasEmergencyFieldDraft) {
      return {
        relationship,
        fullName,
        phone,
        address,
      };
    }

    return parseDriverEmergencyContact(activeDriverSignupDraft.requiredInfo);
  }, [activeDriverSignupDraft, isEmergencyDriverItem]);
  const activeDriverEmergencyRelationship = activeDriverEmergencyContact.relationship;
  const activeDriverEmergencyFullName = activeDriverEmergencyContact.fullName;
  const activeDriverEmergencyPhone = activeDriverEmergencyContact.phone;
  const activeDriverEmergencyAddress = activeDriverEmergencyContact.address;
  const activeDriverFilteredEmergencyRelationshipOptions = useMemo(() => {
    const normalizedKeyword = normalizeSearchKeyword(activeDriverEmergencyRelationship);

    if (!normalizedKeyword) {
      return DRIVER_EMERGENCY_RELATIONSHIP_SUGGESTIONS;
    }

    return DRIVER_EMERGENCY_RELATIONSHIP_SUGGESTIONS.filter((suggestionItem) =>
      normalizeSearchKeyword(suggestionItem).includes(normalizedKeyword),
    );
  }, [activeDriverEmergencyRelationship]);
  const driverDetailTabLabel = isPortraitDriverItem
    ? isDriverPortraitTermsStep
      ? 'Điều khoản ảnh'
      : 'Ảnh chân dung'
    : isIdentityDriverItem
      ? isDriverIdentityTermsStep
        ? 'Điều khoản giấy tờ'
        : 'CMND/CCCD/Hộ chiếu'
      : isLicenseDriverItem
        ? isDriverLicenseTermsStep
          ? 'Điều khoản bằng lái'
          : 'Bằng lái xe'
        : isBackgroundDriverItem
          ? isDriverBackgroundTermsStep
            ? 'Điều khoản lý lịch'
            : 'Lý lịch tư pháp'
          : isResidenceDriverItem
            ? isDriverResidenceTermsStep
              ? 'Điều khoản tạm trú'
              : 'Địa chỉ tạm trú'
            : isBankDriverItem
              ? isDriverBankTermsStep
                ? 'Điều khoản ngân hàng'
                : 'Tài khoản ngân hàng'
              : isVehicleDriverItem
                ? 'Thông tin xe'
              : isServiceTermsDriverItem
                ? 'Điều khoản dịch vụ'
                : isCommitmentDriverItem
                  ? 'Cam kết đối tác'
              : isEmergencyDriverItem
                ? isDriverEmergencyTermsStep
                  ? 'Điều khoản liên hệ'
                  : 'Liên hệ khẩn cấp'
    : 'Biểu mẫu hồ sơ';

  const remainingDriverItems = useMemo(
    () => DRIVER_SIGNUP_ALL_ITEMS.filter((item) => !isDriverSignupItemSubmitted(item.id, driverSignupDrafts)),
    [driverSignupDrafts],
  );

  const completedDriverItems = DRIVER_SIGNUP_ALL_ITEMS.length - remainingDriverItems.length;
  const isDriverSignupReady = remainingDriverItems.length === 0;

  const updateDriverItemDraftById = (itemId, draftPatch) => {
    setDriverSignupDrafts((current) => ({
      ...current,
      [itemId]: {
        requiredInfo: current[itemId]?.requiredInfo ?? '',
        extraInfo: current[itemId]?.extraInfo ?? '',
        ...current[itemId],
        ...draftPatch,
      },
    }));
  };

  const buildSignatureCanvasPoint = (mouseEvent, canvasElement) => {
    const boundingRect = canvasElement.getBoundingClientRect();
    const scaleX = boundingRect.width > 0 ? canvasElement.width / boundingRect.width : 1;
    const scaleY = boundingRect.height > 0 ? canvasElement.height / boundingRect.height : 1;

    return {
      x: (mouseEvent.clientX - boundingRect.left) * scaleX,
      y: (mouseEvent.clientY - boundingRect.top) * scaleY,
    };
  };

  const prepareSignatureCanvasContext = (context2d) => {
    context2d.lineWidth = 2.2;
    context2d.lineJoin = 'round';
    context2d.lineCap = 'round';
    context2d.strokeStyle = '#159ca8';
  };

  const startSignatureDrawing = (canvasRef, signatureStateRef, mouseEvent) => {
    const canvasElement = canvasRef.current;

    if (!canvasElement) {
      return;
    }

    const context2d = canvasElement.getContext('2d');

    if (!context2d) {
      return;
    }

    const pointerPoint = buildSignatureCanvasPoint(mouseEvent, canvasElement);
    prepareSignatureCanvasContext(context2d);
    context2d.beginPath();
    context2d.moveTo(pointerPoint.x, pointerPoint.y);
    context2d.lineTo(pointerPoint.x, pointerPoint.y);
    context2d.stroke();
    signatureStateRef.current.drawing = true;
    mouseEvent.preventDefault();
  };

  const moveSignatureDrawing = (canvasRef, signatureStateRef, mouseEvent) => {
    if (!signatureStateRef.current.drawing) {
      return;
    }

    const canvasElement = canvasRef.current;

    if (!canvasElement) {
      return;
    }

    const context2d = canvasElement.getContext('2d');

    if (!context2d) {
      return;
    }

    const pointerPoint = buildSignatureCanvasPoint(mouseEvent, canvasElement);
    prepareSignatureCanvasContext(context2d);
    context2d.lineTo(pointerPoint.x, pointerPoint.y);
    context2d.stroke();
    mouseEvent.preventDefault();
  };

  const endSignatureDrawing = (itemId, fieldName, canvasRef, signatureStateRef) => {
    if (!signatureStateRef.current.drawing) {
      return;
    }

    signatureStateRef.current.drawing = false;
    const canvasElement = canvasRef.current;

    if (!canvasElement) {
      return;
    }

    const signatureDataUrl = canvasElement.toDataURL('image/png');
    updateDriverItemDraftById(itemId, {
      [fieldName]: signatureDataUrl,
    });
    setDriverDetailStatus('');
  };

  const clearSignatureDrawing = (itemId, fieldName, canvasRef, signatureStateRef) => {
    const canvasElement = canvasRef.current;

    if (!canvasElement) {
      return;
    }

    const context2d = canvasElement.getContext('2d');

    if (context2d) {
      context2d.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }

    signatureStateRef.current.drawing = false;
    updateDriverItemDraftById(itemId, {
      [fieldName]: '',
    });
    setDriverDetailStatus('');
  };

  const restoreSignatureToCanvas = (canvasRef, signatureDataUrl, signatureStateRef) => {
    const canvasElement = canvasRef.current;

    if (!canvasElement) {
      return;
    }

    const context2d = canvasElement.getContext('2d');

    if (!context2d) {
      return;
    }

    context2d.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (!signatureDataUrl) {
      signatureStateRef.current.drawing = false;
      return;
    }

    const signatureImage = new Image();
    signatureImage.onload = () => {
      context2d.clearRect(0, 0, canvasElement.width, canvasElement.height);
      context2d.drawImage(signatureImage, 0, 0, canvasElement.width, canvasElement.height);
    };
    signatureImage.src = signatureDataUrl;
    signatureStateRef.current.drawing = false;
  };

  useEffect(() => {
    if (!isDriverServiceTermsFormStep) {
      return;
    }

    restoreSignatureToCanvas(
      driverServiceTermsSignatureCanvasRef,
      activeDriverServiceTermsSignature,
      driverServiceTermsSignatureStateRef,
    );
  }, [activeDriverServiceTermsSignature, isDriverServiceTermsFormStep]);

  useEffect(() => {
    if (!isDriverCommitmentFormStep) {
      return;
    }

    restoreSignatureToCanvas(
      driverCommitmentSignatureCanvasRef,
      activeDriverCommitmentSignature,
      driverCommitmentSignatureStateRef,
    );
  }, [activeDriverCommitmentSignature, isDriverCommitmentFormStep]);

  const handlePrimaryBookingAction = async () => {
    if (!searchResult || searchResult.vehicle !== activeVehicle) {
      await runRideSearch(activeVehicle);
      return;
    }

    const rideIdFromPreview = searchResult.results?.some((item) => item.id === previewSelectedRideId)
      ? previewSelectedRideId
      : selectedRideId;

    await handleBookRide(rideIdFromPreview);
  };

  const openPreviewForVehicle = (vehicleId, preferredRideId = null) => {
    const resolvedVehicleId = vehicleTabs.some((tab) => tab.id === vehicleId) ? vehicleId : activeVehicle;
    const apiResults =
      searchResult?.vehicle === resolvedVehicleId && Array.isArray(searchResult?.results) ? searchResult.results : [];
    const fallbackRideOptions = MOCKUP_RIDE_OPTIONS[resolvedVehicleId] ?? [];
    const rideCandidates = apiResults.length > 0 ? apiResults : fallbackRideOptions;

    const resolvedRideId = rideCandidates.some((item) => item.id === preferredRideId)
      ? preferredRideId
      : rideCandidates[0]?.id ?? null;

    handleVehicleTabChange(resolvedVehicleId);
    setPreviewSelectedRideId(resolvedRideId);

    requestAnimationFrame(() => {
      setPreviewModalOpen(true);
    });
  };

  const handleServiceCardClick = (vehicleId) => {
    openPreviewForVehicle(vehicleId);
  };

  const handlePreviewTabChange = (vehicleId) => {
    handleVehicleTabChange(vehicleId);
    setPreviewSelectedRideId((MOCKUP_RIDE_OPTIONS[vehicleId] ?? [])[0]?.id ?? null);
  };

  const handleRideResultCardClick = (rideId) => {
    setSelectedRideId(rideId);
    openPreviewForVehicle(activeVehicle, rideId);
  };

  const handleOpenBookingForm = () => {
    openPreviewForVehicle(activeVehicle, selectedRideId ?? previewSelectedRideId ?? null);
  };

  const closePreviewModal = () => {
    setBookingPaymentMethod('cash');
    setBookingPaymentProvider('zalopay');
    setBookingPaymentPanelOpen(false);
    setPreviewModalOpen(false);
  };

  const resetRegisterVerificationState = () => {
    setRegisterSignupToken('');
    setRegisterVerificationCode('');
    setRegisterMaskedEmail('');
    setRegisterOtpExpiresRemainingSeconds(0);
    setRegisterOtpResendRemainingSeconds(0);
  };

  const resetForgotPasswordState = () => {
    setForgotPasswordRequestToken('');
    setForgotPasswordVerificationCode('');
    setForgotPasswordMaskedEmail('');
    setForgotPasswordOtpExpiresRemainingSeconds(0);
    setForgotPasswordOtpResendRemainingSeconds(0);
    setForgotPasswordError('');
    setForgotPasswordSuccess('');
  };

  const clearLoginFormState = () => {
    setLoginEmail('');
    setLoginPassword('');
    setShowLoginPassword(false);
    setCredentialLoginError('');
    setGoogleLoginError('');
    setCredentialLoginLoading(false);
  };

  const clearRegisterFormState = () => {
    setRegisterFullName('');
    setRegisterEmail('');
    setRegisterPassword('');
    setRegisterConfirmPassword('');
    setShowRegisterPassword(false);
    setShowRegisterConfirmPassword(false);
    setRegisterError('');
    setRegisterSuccess('');
    setGoogleSignupError('');
    setRegisterSubmitting(false);
    resetRegisterVerificationState();
  };

  const clearForgotPasswordFormState = () => {
    setForgotPasswordEmail('');
    setForgotPasswordSubmitting(false);
    resetForgotPasswordState();
  };

  const clearChangePasswordFormState = () => {
    setCurrentPasswordValue('');
    setNewPasswordValue('');
    setConfirmPasswordValue('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setChangePasswordBootstrapToken('');
    setChangePasswordResetToken('');
    setChangePasswordStatus('');
    setChangePasswordLoading(false);
  };

  const clearDriverSignupDraftCache = () => {
    setDriverSignupDrafts({});
    setDriverSelectedItemId(DRIVER_SIGNUP_ALL_ITEMS[0]?.id ?? '');
    setDriverSignupStatus('');
    setDriverSignupSubmitting(false);
    setDriverDetailView('default');
    setDriverDetailStatus('');
    setDriverPortraitTermsAccepted(false);
    setDriverIdentityTermsAccepted(false);
    setDriverLicenseTermsAccepted(false);
    setDriverBackgroundTermsAccepted(false);
    setDriverEmergencyTermsAccepted(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
    setDriverServiceTermsAccepted(false);
    setDriverCommitmentAccepted(false);
    setDriverBankDropdownOpen(false);
    setDriverEmergencyRelationshipDropdownOpen(false);
  };

  const openLoginModal = () => {
    void authService.warmupGoogleAuth().catch(() => {
      // Ignore warmup errors; actual login handlers still report runtime errors.
    });

    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setDriverSignupStatus('');
    setDriverSignupSubmitting(false);
    setDriverDetailModalOpen(false);
    setProfileModalOpen(false);
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupModalOpen(false);
    setLoginModalOpen(true);
  };

  const closeLoginModal = () => {
    clearLoginFormState();
    setLoginModalOpen(false);
  };

  const openRegisterModal = () => {
    void authService.warmupGoogleAuth().catch(() => {
      // Ignore warmup errors; actual login handlers still report runtime errors.
    });

    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setDriverSignupStatus('');
    setDriverSignupSubmitting(false);
    setDriverDetailModalOpen(false);
    setProfileModalOpen(false);
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    setLoginModalOpen(false);
    setDriverSignupModalOpen(false);
    setRegisterModalOpen(true);
  };

  const closeRegisterModal = () => {
    clearRegisterFormState();
    setRegisterModalOpen(false);
  };

  const openDriverSignupModal = () => {
    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setLoginModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupStatus('');
    setDriverSignupSubmitting(false);
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverDetailStatus('');
    setDriverPortraitTermsAccepted(false);
    setDriverIdentityTermsAccepted(false);
    setDriverLicenseTermsAccepted(false);
    setDriverBackgroundTermsAccepted(false);
    setDriverEmergencyTermsAccepted(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
    setDriverServiceTermsAccepted(false);
    setDriverCommitmentAccepted(false);
    setDriverBankDropdownOpen(false);
    setDriverEmergencyRelationshipDropdownOpen(false);
    setProfileModalOpen(false);
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    setDriverSelectedItemId((current) => current || DRIVER_SIGNUP_ALL_ITEMS[0]?.id || '');
    setDriverSignupModalOpen(true);
  };

  const closeDriverSignupModal = () => {
    setDriverSignupStatus('');
    setDriverSignupSubmitting(false);
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverDetailStatus('');
    setDriverPortraitTermsAccepted(false);
    setDriverIdentityTermsAccepted(false);
    setDriverLicenseTermsAccepted(false);
    setDriverBackgroundTermsAccepted(false);
    setDriverEmergencyTermsAccepted(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
    setDriverServiceTermsAccepted(false);
    setDriverCommitmentAccepted(false);
    setDriverBankDropdownOpen(false);
    setDriverEmergencyRelationshipDropdownOpen(false);
    setProfileModalOpen(false);
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setDriverSignupModalOpen(false);
  };

  const closeDriverDetailModal = () => {
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverDetailStatus('');
    setDriverPortraitTermsAccepted(false);
    setDriverIdentityTermsAccepted(false);
    setDriverLicenseTermsAccepted(false);
    setDriverBackgroundTermsAccepted(false);
    setDriverEmergencyTermsAccepted(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
    setDriverServiceTermsAccepted(false);
    setDriverCommitmentAccepted(false);
    setDriverBankDropdownOpen(false);
    setDriverEmergencyRelationshipDropdownOpen(false);
  };

  const resolveProfileIdentityPayload = () => {
    const identifier =
      authenticatedUser?.email?.trim() ||
      authenticatedUser?.username?.trim() ||
      loginEmail.trim();

    const accountId = authenticatedUser?.id ? String(authenticatedUser.id) : '';

    return {
      identifier,
      accountId,
    };
  };

  const applyProfileToForm = (profile) => {
    const normalizedProfile = {
      fullName: String(profile?.fullName ?? profile?.name ?? '').trim(),
      email: String(profile?.email ?? '').trim(),
      phone: String(profile?.phone ?? '').trim(),
      address: String(profile?.address ?? '').trim(),
      dateOfBirth: String(profile?.dateOfBirth ?? '').trim(),
      gender: String(profile?.gender ?? 'Nam').trim() || 'Nam',
      avatar: String(profile?.avatar ?? '').trim(),
      username: String(profile?.username ?? '').trim(),
    };

    setProfileForm(normalizedProfile);
    setProfileInitialSnapshot(buildEditableProfileSnapshot(normalizedProfile));
    setProfileAvatarPreview(resolveAvatarUrl(normalizedProfile.avatar));
  };

  const syncAuthenticatedUserFromProfile = (profile = null) => {
    if (!profile || typeof profile !== 'object') {
      return;
    }

    setAuthenticatedUser((current) => {
      if (!current) {
        return current;
      }

      const nextDriverStatus = String(profile.driverStatus ?? current.driverStatus ?? '').trim();
      const normalizedRoleCode = normalizeAppRoleCode(profile.roleCode);

      return {
        ...current,
        name: profile.fullName || profile.name || current.name,
        email: profile.email || current.email,
        username: profile.username || current.username,
        avatar: profile.avatar || current.avatar,
        phone: profile.phone || current.phone,
        roleCode: normalizedRoleCode || profile.roleCode || current.roleCode,
        driverStatus: nextDriverStatus,
        driverFeatureLocked:
          Boolean(profile.driverFeatureLocked) ||
          nextDriverStatus.toLowerCase() === 'khoa' ||
          nextDriverStatus.toLowerCase() === 'locked',
      };
    });
  };

  const loadProfileData = async ({ preserveStatus = false } = {}) => {
    const identityPayload = resolveProfileIdentityPayload();

    if (!identityPayload.identifier && !identityPayload.accountId) {
      setProfileStatusType('error');
      setProfileStatus('Không xác định được tài khoản để tải thông tin cá nhân.');
      return;
    }

    setProfileLoading(true);

    if (!preserveStatus) {
      setProfileStatus('');
      setProfileStatusType('');
    }

    try {
      const result = await authService.getProfile(identityPayload);
      const profile = result?.profile ?? defaultProfileForm;
      applyProfileToForm(profile);
      syncAuthenticatedUserFromProfile(profile);
    } catch (error) {
      setProfileStatusType('error');
      setProfileStatus(error.message || 'Không thể tải thông tin cá nhân.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleProfileFieldChange = (field, value) => {
    const normalizedValue = field === 'phone' ? sanitizePhoneDigits(value) : value;

    setProfileForm((current) => ({
      ...current,
      [field]: normalizedValue,
    }));
  };

  const handleProfileAvatarChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type?.startsWith('image/')) {
      setProfileStatusType('error');
      setProfileStatus('Vui lòng chọn tệp ảnh hợp lệ.');
      event.target.value = '';
      return;
    }

    if (selectedFile.size > 2 * 1024 * 1024) {
      setProfileStatusType('error');
      setProfileStatus('Kích thước ảnh tối đa là 2MB.');
      event.target.value = '';
      return;
    }

    const fileReader = new FileReader();

    fileReader.onload = () => {
      setProfileAvatarPreview(typeof fileReader.result === 'string' ? fileReader.result : '');
    };

    fileReader.readAsDataURL(selectedFile);
    setProfileAvatarFile(selectedFile);
    setProfileStatusType('info');
    setProfileStatus('Đã chọn ảnh đại diện mới. Nhấn Cập nhật để lưu thay đổi.');
    event.target.value = '';
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    const identityPayload = resolveProfileIdentityPayload();

    if (!identityPayload.identifier && !identityPayload.accountId) {
      setProfileStatusType('error');
      setProfileStatus('Không xác định được tài khoản để cập nhật.');
      return;
    }

    if (!profileForm.fullName.trim() || !profileForm.email.trim()) {
      setProfileStatusType('error');
      setProfileStatus('Họ và tên, email là bắt buộc.');
      return;
    }

    if (profileForm.phone.trim() && !phoneInputPattern.test(profileForm.phone.trim())) {
      setProfileStatusType('error');
      setProfileStatus('Số điện thoại chỉ được chứa chữ số (8-15 số).');
      return;
    }

    const currentSnapshot = buildEditableProfileSnapshot(profileForm);
    const baselineSnapshot = profileInitialSnapshot ?? buildEditableProfileSnapshot(defaultProfileForm);
    const hasProfileFieldChanges = Object.keys(currentSnapshot).some((key) => currentSnapshot[key] !== baselineSnapshot[key]);

    if (!hasProfileFieldChanges && !profileAvatarFile) {
      setProfileStatusType('info');
      setProfileStatus('Thông tin chưa được thay đổi.');
      return;
    }

    setProfileSaving(true);
    setProfileStatus('');
    setProfileStatusType('');

    try {
      let nextAvatarValue = profileForm.avatar;

      if (profileAvatarFile) {
        const uploadResult = await authService.uploadProfileAvatar(profileAvatarFile, identityPayload);
        nextAvatarValue = String(uploadResult?.avatarUrl ?? uploadResult?.profile?.avatar ?? profileForm.avatar).trim();
      }

      const updateResult = await authService.updateProfile({
        ...identityPayload,
        fullName: profileForm.fullName,
        email: profileForm.email,
        phone: profileForm.phone,
        address: profileForm.address,
        dateOfBirth: profileForm.dateOfBirth,
        gender: profileForm.gender,
        avatar: nextAvatarValue,
      });

      const updatedProfile = updateResult?.profile ?? {
        ...profileForm,
        avatar: nextAvatarValue,
      };

      applyProfileToForm(updatedProfile);
      setProfileAvatarFile(null);
      setProfileStatusType('success');
      setProfileStatus(updateResult?.message ?? 'Cập nhật thông tin cá nhân thành công.');

      syncAuthenticatedUserFromProfile(updatedProfile);

      if (shouldReturnToDriverSignupAfterProfileUpdate) {
        setShouldReturnToDriverSignupAfterProfileUpdate(false);
        setProfileModalOpen(false);
        setProfileStatus('');
        setProfileStatusType('');
        setDriverSignupModalOpen(true);
        setDriverDetailModalOpen(false);
        setDriverSignupStatus('Đã cập nhật thông tin cá nhân. Vui lòng tiếp tục hoàn tất và nộp hồ sơ tài xế.');
      }
    } catch (error) {
      setProfileStatusType('error');
      setProfileStatus(error.message || 'Không thể cập nhật thông tin cá nhân.');
    } finally {
      setProfileSaving(false);
    }
  };

  const openProfileModal = (options = {}) => {
    if (!authenticatedUser) {
      openLoginModal();
      return;
    }

    const requestedStatusMessage = String(options.statusMessage ?? '').trim();
    const shouldReturnToDriverSignup = Boolean(options.returnToDriverSignup);
    const normalizedRequestedStatusType = String(options.statusType ?? '').trim().toLowerCase();
    const requestedStatusType =
      normalizedRequestedStatusType === 'error' ||
      normalizedRequestedStatusType === 'success' ||
      normalizedRequestedStatusType === 'info'
        ? normalizedRequestedStatusType
        : 'info';

    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setLoginModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupModalOpen(false);
    setDriverDetailModalOpen(false);
    setShouldReturnToDriverSignupAfterProfileUpdate(shouldReturnToDriverSignup);
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    setProfileStatus(requestedStatusMessage);
    setProfileStatusType(requestedStatusMessage ? requestedStatusType : '');
    setProfileInitialSnapshot(buildEditableProfileSnapshot(defaultProfileForm));
    setProfileAvatarFile(null);
    setProfileModalOpen(true);
    void loadProfileData({ preserveStatus: Boolean(requestedStatusMessage) });
  };

  const closeProfileModal = () => {
    setProfileModalOpen(false);
    setShouldReturnToDriverSignupAfterProfileUpdate(false);
    setProfileStatus('');
    setProfileStatusType('');
    setProfileInitialSnapshot(buildEditableProfileSnapshot(defaultProfileForm));
    setProfileAvatarFile(null);
  };

  const openChangePasswordModal = (options = {}) => {
    const prefilledCurrentPassword = String(options.currentPassword ?? '').trim();
    const bootstrapToken = String(options.bootstrapToken ?? options.passwordChangeToken ?? '').trim();
    const passwordResetToken = String(options.resetToken ?? options.passwordResetToken ?? '').trim();
    const initialStatusMessage = String(options.statusMessage ?? '').trim();
    const hasTokenBasedAuth = Boolean(bootstrapToken || passwordResetToken);

    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setLoginModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupModalOpen(false);
    setDriverDetailModalOpen(false);
    setProfileModalOpen(false);
    setForgotPasswordModalOpen(false);
    setChangePasswordBootstrapToken(bootstrapToken);
    setChangePasswordResetToken(passwordResetToken);
    setChangePasswordStatus(initialStatusMessage);
    setCurrentPasswordValue(hasTokenBasedAuth ? '' : prefilledCurrentPassword);
    setNewPasswordValue('');
    setConfirmPasswordValue('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setChangePasswordModalOpen(true);
  };

  const closeChangePasswordModal = () => {
    clearChangePasswordFormState();
    setChangePasswordModalOpen(false);
  };

  const handleChangePasswordSubmit = (event) => {
    event.preventDefault();
    setChangePasswordStatus('');

    const usingBootstrapToken = Boolean(changePasswordBootstrapToken);
    const usingPasswordResetToken = Boolean(changePasswordResetToken);
    const hasTokenBasedAuth = usingBootstrapToken || usingPasswordResetToken;

    if ((!hasTokenBasedAuth && !currentPasswordValue) || !newPasswordValue || !confirmPasswordValue) {
      setChangePasswordStatus('Vui lòng nhập đầy đủ thông tin đổi mật khẩu.');
      return;
    }

    if (newPasswordValue !== confirmPasswordValue) {
      setChangePasswordStatus('Mật khẩu mới và nhập lại mật khẩu không khớp.');
      return;
    }

    if (newPasswordValue.trim().length < 3) {
      setChangePasswordStatus('Mật khẩu mới phải có ít nhất 3 ký tự.');
      return;
    }

    const identifier =
      authenticatedUser?.email?.trim() || authenticatedUser?.username?.trim() || loginEmail.trim() || forgotPasswordEmail.trim();

    if (!hasTokenBasedAuth && !identifier && !authenticatedUser?.id) {
      setChangePasswordStatus('Không xác định được tài khoản. Vui lòng nhập email ở màn hình đăng nhập trước.');
      return;
    }

    setChangePasswordLoading(true);

    void authService
      .changePassword({
        identifier,
        accountId: authenticatedUser?.id ?? null,
        currentPassword: currentPasswordValue,
        newPassword: newPasswordValue,
        bootstrapToken: usingBootstrapToken ? changePasswordBootstrapToken : null,
        passwordResetToken: usingPasswordResetToken ? changePasswordResetToken : null,
      })
      .then((result) => {
        setChangePasswordStatus(result?.message ?? 'Đổi mật khẩu thành công.');
        setChangePasswordBootstrapToken('');
        setChangePasswordResetToken('');
        setCurrentPasswordValue('');
        setNewPasswordValue('');
        setConfirmPasswordValue('');
      })
      .catch((error) => {
        if (usingBootstrapToken && Number(error?.status ?? 0) === 401) {
          setChangePasswordBootstrapToken('');
        }

        if (usingPasswordResetToken && Number(error?.status ?? 0) === 401) {
          setChangePasswordResetToken('');
        }

        setChangePasswordStatus(error.message || 'Không thể đổi mật khẩu lúc này.');
      })
      .finally(() => {
        setChangePasswordLoading(false);
      });
  };

  const handleLogout = () => {
    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setAuthenticatedUser(null);
    setDriverFeatureLockModalOpen(false);
    setDriverFeatureLockMessage(DRIVER_FEATURE_LOCK_DEFAULT_MESSAGE);
    clearDriverSignupDraftCache();
    setMiniToast(null);
    setLoginModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupModalOpen(false);
    setDriverDetailModalOpen(false);
    setProfileModalOpen(false);
    setProfileForm(defaultProfileForm);
    setProfileInitialSnapshot(buildEditableProfileSnapshot(defaultProfileForm));
    setProfileAvatarPreview('');
    setProfileAvatarFile(null);
    setProfileStatus('');
    setProfileStatusType('');
    setForgotPasswordModalOpen(false);
    setChangePasswordModalOpen(false);
    setCredentialLoginError('');
    setCredentialLockRemainingSeconds(0);
  };

  const handleHeroLoginButtonClick = () => {
    if (!authenticatedUser) {
      openLoginModal();
      return;
    }

    const shouldLogout = window.confirm('Bạn muốn đăng xuất khỏi tài khoản không?');

    if (shouldLogout) {
      handleLogout();
    }
  };

  const handleDriverItemSelect = (itemId) => {
    setDriverSelectedItemId(itemId);
    setDriverSignupStatus('');
    setDriverPortraitTermsAccepted(false);
    setDriverIdentityTermsAccepted(false);
    setDriverLicenseTermsAccepted(false);
    setDriverBackgroundTermsAccepted(false);
    setDriverEmergencyTermsAccepted(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
    setDriverServiceTermsAccepted(false);
    setDriverCommitmentAccepted(false);
    setDriverBankDropdownOpen(false);
    setDriverEmergencyRelationshipDropdownOpen(false);

    if (itemId === DRIVER_PORTRAIT_ITEM_ID) {
      const portraitDraft = driverSignupDrafts[DRIVER_PORTRAIT_ITEM_ID] ?? {};
      const hasPortraitSubmitted = Boolean(portraitDraft.portraitSubmitted);

      setDriverPortraitTermsAccepted(hasPortraitSubmitted);
      setDriverDetailView(hasPortraitSubmitted ? 'portrait-form' : 'portrait-terms');
    } else if (itemId === DRIVER_IDENTITY_ITEM_ID) {
      const identityDraft = driverSignupDrafts[DRIVER_IDENTITY_ITEM_ID] ?? {};
      const hasIdentitySubmitted = Boolean(identityDraft.identitySubmitted);

      setDriverIdentityTermsAccepted(hasIdentitySubmitted);
      setDriverDetailView(hasIdentitySubmitted ? 'identity-form' : 'identity-terms');
    } else if (itemId === DRIVER_LICENSE_ITEM_ID) {
      const licenseDraft = driverSignupDrafts[DRIVER_LICENSE_ITEM_ID] ?? {};
      const hasLicenseSubmitted = Boolean(licenseDraft.licenseSubmitted);

      setDriverLicenseTermsAccepted(hasLicenseSubmitted);
      setDriverDetailView(hasLicenseSubmitted ? 'license-form' : 'license-terms');
    } else if (itemId === DRIVER_BACKGROUND_ITEM_ID) {
      const backgroundDraft = driverSignupDrafts[DRIVER_BACKGROUND_ITEM_ID] ?? {};
      const hasBackgroundSubmitted = Boolean(backgroundDraft.backgroundSubmitted);

      setDriverBackgroundTermsAccepted(hasBackgroundSubmitted);
      setDriverDetailView(hasBackgroundSubmitted ? 'background-form' : 'background-terms');
    } else if (itemId === DRIVER_RESIDENCE_ITEM_ID) {
      const residenceDraft = driverSignupDrafts[DRIVER_RESIDENCE_ITEM_ID] ?? {};
      const hasResidenceSubmitted = Boolean(residenceDraft.residenceSubmitted);

      setDriverResidenceTermsAccepted(hasResidenceSubmitted);
      setDriverDetailView(hasResidenceSubmitted ? 'residence-form' : 'residence-terms');
    } else if (itemId === DRIVER_BANK_ITEM_ID) {
      const bankDraft = driverSignupDrafts[DRIVER_BANK_ITEM_ID] ?? {};
      const hasBankSubmitted = Boolean(bankDraft.bankSubmitted);

      setDriverBankTermsAccepted(hasBankSubmitted);
      setDriverDetailView(hasBankSubmitted ? 'bank-form' : 'bank-terms');
    } else if (itemId === DRIVER_VEHICLE_ITEM_ID) {
      setDriverDetailView('vehicle-form');
    } else if (itemId === DRIVER_TERMS_ITEM_ID) {
      const serviceTermsDraft = driverSignupDrafts[DRIVER_TERMS_ITEM_ID] ?? {};
      const hasServiceTermsSubmitted = Boolean(serviceTermsDraft.serviceTermsSubmitted);

      setDriverServiceTermsAccepted(
        hasServiceTermsSubmitted || Boolean(serviceTermsDraft.serviceTermsAccepted),
      );
      setDriverDetailView('service-terms-form');

      if (!serviceTermsDraft.serviceTermsSignerName && registeredDriverSignerName) {
        updateDriverItemDraftById(DRIVER_TERMS_ITEM_ID, {
          serviceTermsSignerName: registeredDriverSignerName,
        });
      }
    } else if (itemId === DRIVER_COMMIT_ITEM_ID) {
      const commitmentDraft = driverSignupDrafts[DRIVER_COMMIT_ITEM_ID] ?? {};
      const hasCommitmentSubmitted = Boolean(commitmentDraft.commitmentSubmitted);

      setDriverCommitmentAccepted(
        hasCommitmentSubmitted || Boolean(commitmentDraft.commitmentAccepted),
      );
      setDriverDetailView('commitment-form');

      if (!commitmentDraft.commitmentSignerName && registeredDriverSignerName) {
        updateDriverItemDraftById(DRIVER_COMMIT_ITEM_ID, {
          commitmentSignerName: registeredDriverSignerName,
        });
      }
    } else if (itemId === DRIVER_EMERGENCY_ITEM_ID) {
      const emergencyDraft = driverSignupDrafts[DRIVER_EMERGENCY_ITEM_ID] ?? {};
      const hasEmergencySubmitted = Boolean(emergencyDraft.emergencySubmitted);

      setDriverEmergencyTermsAccepted(hasEmergencySubmitted);
      setDriverDetailView(hasEmergencySubmitted ? 'emergency-form' : 'emergency-terms');
    } else {
      setDriverDetailView('default');
    }

    setDriverDetailStatus('');
    setDriverDetailModalOpen(true);
  };

  const handleDriverDraftChange = (field, value) => {
    if (!driverSelectedItemId) {
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [driverSelectedItemId]: {
        ...current[driverSelectedItemId],
        requiredInfo: current[driverSelectedItemId]?.requiredInfo ?? '',
        extraInfo: current[driverSelectedItemId]?.extraInfo ?? '',
        [field]: value,
      },
    }));
  };

  const handleDriverIdentityNumberChange = (value) => {
    const normalizedIdentityNumber = normalizeIdentityDocumentNumber(value);

    setDriverSignupDrafts((current) => {
      const currentIdentityDraft = current[DRIVER_IDENTITY_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };

      return {
        ...current,
        [DRIVER_IDENTITY_ITEM_ID]: {
          ...currentIdentityDraft,
          requiredInfo: String(currentIdentityDraft.requiredInfo ?? '').trim(),
          extraInfo: currentIdentityDraft.extraInfo ?? '',
          identityCccd: normalizedIdentityNumber,
        },
      };
    });

    setDriverDetailStatus('');
  };

  const handleDriverPortraitTermsConfirm = () => {
    if (!driverPortraitTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('portrait-form');
  };

  const handleDriverPortraitFileChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!/^image\//i.test(selectedFile.type)) {
      setDriverDetailStatus('Vui lòng chọn tệp ảnh hợp lệ (JPG, PNG hoặc WEBP).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const previewValue = typeof reader.result === 'string' ? reader.result : '';

      setDriverSignupDrafts((current) => ({
        ...current,
        [DRIVER_PORTRAIT_ITEM_ID]: {
          requiredInfo: selectedFile.name,
          extraInfo: current[DRIVER_PORTRAIT_ITEM_ID]?.extraInfo ?? '',
          portraitPreview: previewValue,
          portraitFileName: selectedFile.name,
          portraitFile: selectedFile,
          portraitUploadedPath: '',
        },
      }));

      setDriverDetailStatus('');
    };

    reader.onerror = () => {
      setDriverDetailStatus('Không thể đọc tệp ảnh. Vui lòng thử lại.');
    };

    reader.readAsDataURL(selectedFile);
    event.target.value = '';
  };

  const handleDriverPortraitSubmit = (event) => {
    event.preventDefault();

    const portraitDraft = driverSignupDrafts[DRIVER_PORTRAIT_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const requiredInfo = String(portraitDraft.requiredInfo ?? '').trim();

    if (!requiredInfo) {
      setDriverDetailStatus('Vui lòng chèn ảnh chân dung trước khi xác nhận nộp.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_PORTRAIT_ITEM_ID]: {
        ...current[DRIVER_PORTRAIT_ITEM_ID],
        requiredInfo,
        portraitSubmitted: true,
        extraInfo:
          String(current[DRIVER_PORTRAIT_ITEM_ID]?.extraInfo ?? '').trim() || 'Đã đọc và đồng ý điều khoản ảnh chân dung.',
      },
    }));

    setDriverSignupStatus('Đã nộp ảnh chân dung thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverPortraitTermsAccepted(false);
  };

  const handleDriverIdentityTermsConfirm = () => {
    if (!driverIdentityTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('identity-form');
  };

  const handleDriverIdentityFileChange = (side, event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!/^image\//i.test(selectedFile.type)) {
      setDriverDetailStatus('Vui lòng chọn tệp ảnh hợp lệ (JPG, PNG hoặc WEBP).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const previewValue = typeof reader.result === 'string' ? reader.result : '';
      const previewFieldName = side === 'front' ? 'identityFrontPreview' : 'identityBackPreview';
      const fileNameFieldName = side === 'front' ? 'identityFrontFileName' : 'identityBackFileName';
      const fileFieldName = side === 'front' ? 'identityFrontFile' : 'identityBackFile';
      const uploadedPathFieldName = side === 'front' ? 'identityFrontUploadedPath' : 'identityBackUploadedPath';

      setDriverSignupDrafts((current) => {
        const currentIdentityDraft = current[DRIVER_IDENTITY_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };

        return {
          ...current,
          [DRIVER_IDENTITY_ITEM_ID]: {
            ...currentIdentityDraft,
            requiredInfo: String(currentIdentityDraft.requiredInfo ?? '').trim(),
            extraInfo: currentIdentityDraft.extraInfo ?? '',
            [previewFieldName]: previewValue,
            [fileNameFieldName]: selectedFile.name,
            [fileFieldName]: selectedFile,
            [uploadedPathFieldName]: '',
          },
        };
      });

      setDriverDetailStatus('');
    };

    reader.onerror = () => {
      setDriverDetailStatus('Không thể đọc tệp ảnh. Vui lòng thử lại.');
    };

    reader.readAsDataURL(selectedFile);
    event.target.value = '';
  };

  const handleDriverIdentitySubmit = (event) => {
    event.preventDefault();

    const identityDraft = driverSignupDrafts[DRIVER_IDENTITY_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const frontFileName = String(identityDraft.identityFrontFileName ?? '').trim();
    const backFileName = String(identityDraft.identityBackFileName ?? '').trim();
    const identityNumber = normalizeIdentityDocumentNumber(identityDraft.identityCccd);

    if (!identityNumber) {
      setDriverDetailStatus('Vui lòng nhập số CMND/CCCD/Hộ chiếu trước khi xác nhận nộp.');
      return;
    }

    if (!/^\d{12}$/.test(identityNumber)) {
      setDriverDetailStatus('Số CCCD không hợp lệ (phải đúng 12 chữ số).');
      return;
    }

    if (!frontFileName || !backFileName) {
      setDriverDetailStatus('Vui lòng tải đủ 2 ảnh riêng biệt cho mặt trước và mặt sau giấy tờ.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_IDENTITY_ITEM_ID]: {
        ...current[DRIVER_IDENTITY_ITEM_ID],
        identityCccd: identityNumber,
        requiredInfo: `${identityNumber} | ${frontFileName} | ${backFileName}`,
        identitySubmitted: true,
        extraInfo:
          String(current[DRIVER_IDENTITY_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đọc và đồng ý điều khoản CMND/CCCD/Hộ chiếu.',
      },
    }));

    setDriverSignupStatus('Đã nộp giấy tờ CMND/CCCD/Hộ chiếu thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverIdentityTermsAccepted(false);
  };

  const handleDriverLicenseTermsConfirm = () => {
    if (!driverLicenseTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('license-form');
  };

  const handleDriverLicenseFileChange = (side, event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!/^image\//i.test(selectedFile.type)) {
      setDriverDetailStatus('Vui lòng chọn tệp ảnh hợp lệ (JPG, PNG hoặc WEBP).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const previewValue = typeof reader.result === 'string' ? reader.result : '';
      const previewFieldName = side === 'front' ? 'licenseFrontPreview' : 'licenseBackPreview';
      const fileNameFieldName = side === 'front' ? 'licenseFrontFileName' : 'licenseBackFileName';
      const fileFieldName = side === 'front' ? 'licenseFrontFile' : 'licenseBackFile';
      const uploadedPathFieldName = side === 'front' ? 'licenseFrontUploadedPath' : 'licenseBackUploadedPath';

      setDriverSignupDrafts((current) => {
        const currentLicenseDraft = current[DRIVER_LICENSE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };

        return {
          ...current,
          [DRIVER_LICENSE_ITEM_ID]: {
            ...currentLicenseDraft,
            requiredInfo: String(currentLicenseDraft.requiredInfo ?? '').trim(),
            extraInfo: currentLicenseDraft.extraInfo ?? '',
            [previewFieldName]: previewValue,
            [fileNameFieldName]: selectedFile.name,
            [fileFieldName]: selectedFile,
            [uploadedPathFieldName]: '',
          },
        };
      });

      setDriverDetailStatus('');
    };

    reader.onerror = () => {
      setDriverDetailStatus('Không thể đọc tệp ảnh. Vui lòng thử lại.');
    };

    reader.readAsDataURL(selectedFile);
    event.target.value = '';
  };

  const handleDriverLicenseSubmit = (event) => {
    event.preventDefault();

    const licenseDraft = driverSignupDrafts[DRIVER_LICENSE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const frontFileName = String(licenseDraft.licenseFrontFileName ?? '').trim();
    const backFileName = String(licenseDraft.licenseBackFileName ?? '').trim();

    if (!frontFileName || !backFileName) {
      setDriverDetailStatus('Vui lòng tải đủ 2 ảnh riêng biệt cho mặt trước và mặt sau bằng lái xe.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_LICENSE_ITEM_ID]: {
        ...current[DRIVER_LICENSE_ITEM_ID],
        requiredInfo: `${frontFileName} | ${backFileName}`,
        licenseSubmitted: true,
        extraInfo:
          String(current[DRIVER_LICENSE_ITEM_ID]?.extraInfo ?? '').trim() || 'Đã đọc và đồng ý điều khoản bằng lái xe.',
      },
    }));

    setDriverSignupStatus('Đã nộp bằng lái xe thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverLicenseTermsAccepted(false);
  };

  const handleDriverBackgroundTermsConfirm = () => {
    if (!driverBackgroundTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('background-form');
  };

  const handleDriverBackgroundFileChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!/^image\//i.test(selectedFile.type)) {
      setDriverDetailStatus('Vui lòng chọn tệp ảnh hợp lệ (JPG, PNG hoặc WEBP).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const previewValue = typeof reader.result === 'string' ? reader.result : '';

      setDriverSignupDrafts((current) => ({
        ...current,
        [DRIVER_BACKGROUND_ITEM_ID]: {
          requiredInfo: selectedFile.name,
          extraInfo: current[DRIVER_BACKGROUND_ITEM_ID]?.extraInfo ?? '',
          backgroundPreview: previewValue,
          backgroundFileName: selectedFile.name,
          backgroundFile: selectedFile,
          backgroundUploadedPath: '',
        },
      }));

      setDriverDetailStatus('');
    };

    reader.onerror = () => {
      setDriverDetailStatus('Không thể đọc tệp ảnh. Vui lòng thử lại.');
    };

    reader.readAsDataURL(selectedFile);
    event.target.value = '';
  };

  const handleDriverBackgroundSubmit = (event) => {
    event.preventDefault();

    const backgroundDraft = driverSignupDrafts[DRIVER_BACKGROUND_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const backgroundFileName = String(backgroundDraft.backgroundFileName ?? '').trim();

    if (!backgroundFileName) {
      setDriverDetailStatus('Vui lòng tải ảnh lý lịch tư pháp theo chiều dọc trước khi xác nhận nộp.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_BACKGROUND_ITEM_ID]: {
        ...current[DRIVER_BACKGROUND_ITEM_ID],
        requiredInfo: backgroundFileName,
        backgroundSubmitted: true,
        extraInfo:
          String(current[DRIVER_BACKGROUND_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đọc và đồng ý điều khoản lý lịch tư pháp.',
      },
    }));

    setDriverSignupStatus('Đã nộp lý lịch tư pháp thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverBackgroundTermsAccepted(false);
  };

  const handleDriverVehicleFileChange = (side, event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!/^image\//i.test(selectedFile.type)) {
      setDriverDetailStatus('Vui lòng chọn tệp ảnh xe hợp lệ (JPG, PNG hoặc WEBP).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const previewValue = typeof reader.result === 'string' ? reader.result : '';
      const previewFieldName =
        side === 'front' ? 'vehicleFrontPreview' : side === 'side' ? 'vehicleSidePreview' : 'vehicleRearPreview';
      const fileNameFieldName =
        side === 'front' ? 'vehicleFrontFileName' : side === 'side' ? 'vehicleSideFileName' : 'vehicleRearFileName';
      const fileFieldName =
        side === 'front' ? 'vehicleFrontFile' : side === 'side' ? 'vehicleSideFile' : 'vehicleRearFile';
      const uploadedPathFieldName =
        side === 'front'
          ? 'vehicleFrontUploadedPath'
          : side === 'side'
            ? 'vehicleSideUploadedPath'
            : 'vehicleRearUploadedPath';

      setDriverSignupDrafts((current) => {
        const currentVehicleDraft = current[DRIVER_VEHICLE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };

        return {
          ...current,
          [DRIVER_VEHICLE_ITEM_ID]: {
            ...currentVehicleDraft,
            requiredInfo: String(currentVehicleDraft.requiredInfo ?? '').trim(),
            extraInfo: currentVehicleDraft.extraInfo ?? '',
            [previewFieldName]: previewValue,
            [fileNameFieldName]: selectedFile.name,
            [fileFieldName]: selectedFile,
            [uploadedPathFieldName]: '',
          },
        };
      });

      setDriverDetailStatus('');
    };

    reader.onerror = () => {
      setDriverDetailStatus('Không thể đọc ảnh xe. Vui lòng thử lại.');
    };

    reader.readAsDataURL(selectedFile);
    event.target.value = '';
  };

  const handleDriverVehicleFieldChange = (field, value) => {
    setDriverSignupDrafts((current) => {
      const currentVehicleDraft = current[DRIVER_VEHICLE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
      const nextVehicleLicensePlate =
        field === 'vehicleLicensePlate'
          ? String(value ?? '')
              .toUpperCase()
              .replace(/\s+/g, ' ')
              .trimStart()
          : String(currentVehicleDraft.vehicleLicensePlate ?? '');
      const nextVehicleName =
        field === 'vehicleName' ? String(value ?? '').trimStart() : String(currentVehicleDraft.vehicleName ?? '');

      return {
        ...current,
        [DRIVER_VEHICLE_ITEM_ID]: {
          ...currentVehicleDraft,
          vehicleLicensePlate: nextVehicleLicensePlate,
          vehicleName: nextVehicleName,
          requiredInfo: String(currentVehicleDraft.requiredInfo ?? '').trim(),
        },
      };
    });

    setDriverDetailStatus('');
  };

  const handleDriverVehicleSubmit = (event) => {
    event.preventDefault();

    const vehicleDraft = driverSignupDrafts[DRIVER_VEHICLE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const frontFileName = String(vehicleDraft.vehicleFrontFileName ?? '').trim();
    const sideFileName = String(vehicleDraft.vehicleSideFileName ?? '').trim();
    const rearFileName = String(vehicleDraft.vehicleRearFileName ?? '').trim();
    const vehicleLicensePlate = String(vehicleDraft.vehicleLicensePlate ?? '').trim().toUpperCase();
    const vehicleName = String(vehicleDraft.vehicleName ?? '').trim();

    if (!frontFileName || !sideFileName || !rearFileName) {
      setDriverDetailStatus('Vui lòng tải đủ 3 ảnh xe: góc trước, góc ngang và góc sau (thấy toàn bộ xe).');
      return;
    }

    if (!vehicleLicensePlate) {
      setDriverDetailStatus('Vui lòng nhập biển số xe.');
      return;
    }

    if (!vehicleLicensePlatePattern.test(vehicleLicensePlate)) {
      setDriverDetailStatus('Biển số xe không đúng định dạng. Ví dụ hợp lệ: 43A-12345 hoặc 43A-123.45');
      return;
    }

    if (!vehicleName) {
      setDriverDetailStatus('Vui lòng nhập tên xe.');
      return;
    }

    const packedVehicleInfo = `${vehicleLicensePlate} | ${vehicleName}`;

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_VEHICLE_ITEM_ID]: {
        ...current[DRIVER_VEHICLE_ITEM_ID],
        vehicleLicensePlate,
        vehicleName,
        requiredInfo: packedVehicleInfo,
        vehicleSubmitted: true,
        extraInfo:
          String(current[DRIVER_VEHICLE_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã nộp đủ 3 ảnh xe (trước-ngang-sau) và thông tin xe.',
      },
    }));

    setDriverSignupStatus('Đã nộp thông tin xe thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
  };

  const handleDriverResidenceTermsConfirm = () => {
    if (!driverResidenceTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('residence-form');
  };

  const handleDriverResidenceFieldChange = (field, value) => {
    setDriverSignupDrafts((current) => {
      const currentResidenceDraft = current[DRIVER_RESIDENCE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
      const fallbackAddress = parseDriverResidenceAddress(currentResidenceDraft.requiredInfo);
      const nextResidenceAddress = {
        mode:
          field === 'mode'
            ? (String(value ?? '') === 'manual' ? 'manual' : 'droplist')
            : String(currentResidenceDraft.residenceMode ?? fallbackAddress.mode ?? 'droplist') === 'manual'
              ? 'manual'
              : 'droplist',
        province:
          field === 'province'
            ? String(value ?? '')
            : String(currentResidenceDraft.residenceProvince ?? fallbackAddress.province ?? ''),
        district:
          field === 'district'
            ? String(value ?? '')
            : String(currentResidenceDraft.residenceDistrict ?? fallbackAddress.district ?? ''),
        ward:
          field === 'ward' ? String(value ?? '') : String(currentResidenceDraft.residenceWard ?? fallbackAddress.ward ?? ''),
        houseNumber:
          field === 'houseNumber'
            ? String(value ?? '')
            : String(currentResidenceDraft.residenceHouseNumber ?? fallbackAddress.houseNumber ?? ''),
        manualAddress:
          field === 'manualAddress'
            ? String(value ?? '')
            : String(currentResidenceDraft.residenceManualAddress ?? fallbackAddress.manualAddress ?? ''),
      };

      if (field === 'province') {
        nextResidenceAddress.district = '';
        nextResidenceAddress.ward = '';
      }

      if (field === 'district') {
        nextResidenceAddress.ward = '';
      }

      if (field === 'mode' && nextResidenceAddress.mode === 'manual') {
        nextResidenceAddress.province = '';
        nextResidenceAddress.district = '';
        nextResidenceAddress.ward = '';
        nextResidenceAddress.houseNumber = '';
      }

      if (field === 'mode' && nextResidenceAddress.mode === 'droplist') {
        nextResidenceAddress.manualAddress = '';
      }

      return {
        ...current,
        [DRIVER_RESIDENCE_ITEM_ID]: {
          ...currentResidenceDraft,
          residenceMode: nextResidenceAddress.mode,
          residenceProvince: nextResidenceAddress.province,
          residenceDistrict: nextResidenceAddress.district,
          residenceWard: nextResidenceAddress.ward,
          residenceHouseNumber: nextResidenceAddress.houseNumber,
          residenceManualAddress: nextResidenceAddress.manualAddress,
          requiredInfo: buildDriverResidenceAddressRaw(nextResidenceAddress),
        },
      };
    });

    setDriverDetailStatus('');
  };

  const handleDriverResidenceSubmit = (event) => {
    event.preventDefault();

    const residenceDraft = driverSignupDrafts[DRIVER_RESIDENCE_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const residenceAddress = parseDriverResidenceAddress({
      mode: residenceDraft.residenceMode,
      province: residenceDraft.residenceProvince,
      district: residenceDraft.residenceDistrict,
      ward: residenceDraft.residenceWard,
      houseNumber: residenceDraft.residenceHouseNumber,
      manualAddress: residenceDraft.residenceManualAddress,
    });

    let normalizedResidenceAddress = {
      ...residenceAddress,
      mode: residenceAddress.mode === 'manual' ? 'manual' : 'droplist',
    };

    if (normalizedResidenceAddress.mode === 'manual') {
      const manualAddress = String(normalizedResidenceAddress.manualAddress ?? '').trim();

      if (!manualAddress) {
        setDriverDetailStatus('Vui lòng nhập địa chỉ một dòng nếu không chọn theo danh sách.');
        return;
      }

      normalizedResidenceAddress = {
        mode: 'manual',
        province: '',
        district: '',
        ward: '',
        houseNumber: '',
        manualAddress,
      };
    } else {
      const province = String(normalizedResidenceAddress.province ?? '').trim();
      const district = String(normalizedResidenceAddress.district ?? '').trim();
      const ward = String(normalizedResidenceAddress.ward ?? '').trim();
      const houseNumber = String(normalizedResidenceAddress.houseNumber ?? '').trim();

      if (!province || !district || !ward || !houseNumber) {
        setDriverDetailStatus('Vui lòng chọn đủ Tỉnh/Thành phố, Quận/Huyện, Phường/Xã và nhập Số nhà.');
        return;
      }

      normalizedResidenceAddress = {
        mode: 'droplist',
        province,
        district,
        ward,
        houseNumber,
        manualAddress: '',
      };
    }

    const packedResidenceInfo = buildDriverResidenceAddressRaw(normalizedResidenceAddress);

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_RESIDENCE_ITEM_ID]: {
        ...current[DRIVER_RESIDENCE_ITEM_ID],
        residenceMode: normalizedResidenceAddress.mode,
        residenceProvince: normalizedResidenceAddress.province,
        residenceDistrict: normalizedResidenceAddress.district,
        residenceWard: normalizedResidenceAddress.ward,
        residenceHouseNumber: normalizedResidenceAddress.houseNumber,
        residenceManualAddress: normalizedResidenceAddress.manualAddress,
        requiredInfo: packedResidenceInfo,
        residenceSubmitted: true,
        extraInfo:
          String(current[DRIVER_RESIDENCE_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đọc và đồng ý điều khoản địa chỉ tạm trú.',
      },
    }));

    setDriverSignupStatus('Đã nộp địa chỉ tạm trú thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
  };

  const handleDriverBankTermsConfirm = () => {
    if (!driverBankTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('bank-form');
  };

  const handleDriverBankFieldChange = (field, value) => {
    if (field === 'bankName') {
      setDriverBankDropdownOpen(true);
    }

    setDriverSignupDrafts((current) => {
      const currentBankDraft = current[DRIVER_BANK_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
      const fallbackBankAccount = parseDriverBankAccount(currentBankDraft.requiredInfo);
      const nextBankAccount = {
        holderName:
          field === 'holderName'
            ? normalizeBankHolderNameInput(value)
            : String(currentBankDraft.bankHolderName ?? fallbackBankAccount.holderName ?? ''),
        bankName:
          field === 'bankName' ? String(value ?? '') : String(currentBankDraft.bankName ?? fallbackBankAccount.bankName ?? ''),
        accountNumber:
          field === 'accountNumber'
            ? String(value ?? '').replace(/\s+/g, '')
            : String(currentBankDraft.bankAccountNumber ?? fallbackBankAccount.accountNumber ?? ''),
      };

      return {
        ...current,
        [DRIVER_BANK_ITEM_ID]: {
          ...currentBankDraft,
          bankHolderName: nextBankAccount.holderName,
          bankName: nextBankAccount.bankName,
          bankAccountNumber: nextBankAccount.accountNumber,
          requiredInfo: buildDriverBankAccountRaw(nextBankAccount),
        },
      };
    });

    setDriverDetailStatus('');
  };

  const handleDriverBankOptionSelect = (bankOption) => {
    handleDriverBankFieldChange('bankName', bankOption);
    setDriverBankDropdownOpen(false);
  };

  const handleDriverBankSubmit = (event) => {
    event.preventDefault();

    const bankDraft = driverSignupDrafts[DRIVER_BANK_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const bankAccount = parseDriverBankAccount({
      holderName: bankDraft.bankHolderName,
      bankName: bankDraft.bankName,
      accountNumber: bankDraft.bankAccountNumber,
    });

    const holderName = normalizeBankHolderNameInput(bankAccount.holderName).trim();
    const bankName = resolveBankNameFromInput(bankAccount.bankName);
    const accountNumber = String(bankAccount.accountNumber ?? '')
      .replace(/\s+/g, '')
      .trim();

    if (!holderName || !bankName || !accountNumber) {
      setDriverDetailStatus('Vui lòng điền đủ Họ và tên chủ thẻ, Ngân hàng và Số tài khoản.');
      return;
    }

    if (!/^[A-Z ]+$/.test(holderName)) {
      setDriverDetailStatus('Họ và tên chủ thẻ chỉ được nhập chữ cái không dấu và khoảng trắng.');
      return;
    }

    if (!DRIVER_BANK_NAME_OPTIONS.includes(bankName)) {
      setDriverDetailStatus('Vui lòng chọn ngân hàng từ danh sách có sẵn.');
      return;
    }

    if (!/^\d{6,25}$/.test(accountNumber)) {
      setDriverDetailStatus('Số tài khoản không hợp lệ (chỉ gồm 6-25 chữ số).');
      return;
    }

    const normalizedBankAccount = {
      holderName,
      bankName,
      accountNumber,
    };

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_BANK_ITEM_ID]: {
        ...current[DRIVER_BANK_ITEM_ID],
        bankHolderName: normalizedBankAccount.holderName,
        bankName: normalizedBankAccount.bankName,
        bankAccountNumber: normalizedBankAccount.accountNumber,
        requiredInfo: buildDriverBankAccountRaw(normalizedBankAccount),
        bankSubmitted: true,
        extraInfo:
          String(current[DRIVER_BANK_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đọc và đồng ý điều khoản tài khoản ngân hàng.',
      },
    }));

    setDriverSignupStatus('Đã nộp thông tin tài khoản ngân hàng thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverBankDropdownOpen(false);
    setDriverResidenceTermsAccepted(false);
    setDriverBankTermsAccepted(false);
  };

  const handleDriverServiceTermsSubmit = (event) => {
    event.preventDefault();

    const serviceTermsDraft = driverSignupDrafts[DRIVER_TERMS_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const signerName = String(serviceTermsDraft.serviceTermsSignerName ?? registeredDriverSignerName).trim();
    const signatureData = String(serviceTermsDraft.serviceTermsSignature ?? '').trim();

    if (!driverServiceTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản dịch vụ trước khi xác nhận.');
      return;
    }

    if (!signerName) {
      setDriverDetailStatus('Không tìm thấy Họ tên đã đăng ký. Vui lòng cập nhật hồ sơ tài khoản trước khi ký.');
      return;
    }

    if (!signatureData) {
      setDriverDetailStatus('Vui lòng ký xác nhận bằng chuột vào khung chữ ký.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_TERMS_ITEM_ID]: {
        ...current[DRIVER_TERMS_ITEM_ID],
        serviceTermsAccepted: true,
        serviceTermsSignerName: signerName,
        serviceTermsSignature: signatureData,
        serviceTermsSubmitted: true,
        requiredInfo: `Đã xác nhận Điều khoản dịch vụ và ký bởi ${signerName}.`,
        extraInfo:
          String(current[DRIVER_TERMS_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đồng ý điều khoản dịch vụ và cơ chế chiết khấu 30% cước.',
      },
    }));

    setDriverSignupStatus('Đã hoàn tất xác nhận Điều khoản dịch vụ. Bạn có thể tiếp tục mục tiếp theo.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverServiceTermsAccepted(false);
  };

  const handleDriverCommitmentSubmit = (event) => {
    event.preventDefault();

    const commitmentDraft = driverSignupDrafts[DRIVER_COMMIT_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const signerName = String(commitmentDraft.commitmentSignerName ?? registeredDriverSignerName).trim();
    const signatureData = String(commitmentDraft.commitmentSignature ?? '').trim();

    if (!driverCommitmentAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý bản Cam kết trước khi xác nhận.');
      return;
    }

    if (!signerName) {
      setDriverDetailStatus('Không tìm thấy Họ tên đã đăng ký. Vui lòng cập nhật hồ sơ tài khoản trước khi ký.');
      return;
    }

    if (!signatureData) {
      setDriverDetailStatus('Vui lòng ký xác nhận bằng chuột vào khung chữ ký.');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_COMMIT_ITEM_ID]: {
        ...current[DRIVER_COMMIT_ITEM_ID],
        commitmentAccepted: true,
        commitmentSignerName: signerName,
        commitmentSignature: signatureData,
        commitmentSubmitted: true,
        requiredInfo: `Đã ký Cam kết đối tác và đồng thuận chiết khấu 30% cước bởi ${signerName}.`,
        extraInfo:
          String(current[DRIVER_COMMIT_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã hoàn thành bản Cam kết đối tác theo chính sách SmartRide.',
      },
    }));

    setDriverSignupStatus('Đã hoàn tất bản Cam kết đối tác. Bạn có thể tiếp tục mục tiếp theo.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverCommitmentAccepted(false);
  };

  const handleServiceTermsSignatureMouseDown = (event) => {
    startSignatureDrawing(driverServiceTermsSignatureCanvasRef, driverServiceTermsSignatureStateRef, event);
  };

  const handleServiceTermsSignatureMouseMove = (event) => {
    moveSignatureDrawing(driverServiceTermsSignatureCanvasRef, driverServiceTermsSignatureStateRef, event);
  };

  const handleServiceTermsSignatureMouseUp = () => {
    endSignatureDrawing(
      DRIVER_TERMS_ITEM_ID,
      'serviceTermsSignature',
      driverServiceTermsSignatureCanvasRef,
      driverServiceTermsSignatureStateRef,
    );
  };

  const handleServiceTermsSignatureClear = () => {
    clearSignatureDrawing(
      DRIVER_TERMS_ITEM_ID,
      'serviceTermsSignature',
      driverServiceTermsSignatureCanvasRef,
      driverServiceTermsSignatureStateRef,
    );
  };

  const handleCommitmentSignatureMouseDown = (event) => {
    startSignatureDrawing(driverCommitmentSignatureCanvasRef, driverCommitmentSignatureStateRef, event);
  };

  const handleCommitmentSignatureMouseMove = (event) => {
    moveSignatureDrawing(driverCommitmentSignatureCanvasRef, driverCommitmentSignatureStateRef, event);
  };

  const handleCommitmentSignatureMouseUp = () => {
    endSignatureDrawing(
      DRIVER_COMMIT_ITEM_ID,
      'commitmentSignature',
      driverCommitmentSignatureCanvasRef,
      driverCommitmentSignatureStateRef,
    );
  };

  const handleCommitmentSignatureClear = () => {
    clearSignatureDrawing(
      DRIVER_COMMIT_ITEM_ID,
      'commitmentSignature',
      driverCommitmentSignatureCanvasRef,
      driverCommitmentSignatureStateRef,
    );
  };

  const handleDriverEmergencyTermsConfirm = () => {
    if (!driverEmergencyTermsAccepted) {
      setDriverDetailStatus('Bạn cần đồng ý điều khoản trước khi tiếp tục.');
      return;
    }

    setDriverDetailStatus('');
    setDriverDetailView('emergency-form');
  };

  const handleDriverEmergencyFieldChange = (field, value) => {
    if (field === 'relationship') {
      setDriverEmergencyRelationshipDropdownOpen(true);
    }

    setDriverSignupDrafts((current) => {
      const currentEmergencyDraft = current[DRIVER_EMERGENCY_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
      const fallbackContact = parseDriverEmergencyContact(currentEmergencyDraft.requiredInfo);
      const nextContact = {
        relationship:
          field === 'relationship'
            ? String(value ?? '')
            : String(currentEmergencyDraft.emergencyRelationship ?? fallbackContact.relationship ?? ''),
        fullName:
          field === 'fullName'
            ? String(value ?? '')
            : String(currentEmergencyDraft.emergencyFullName ?? fallbackContact.fullName ?? ''),
        phone:
          field === 'phone'
            ? sanitizePhoneDigits(value)
            : String(currentEmergencyDraft.emergencyPhone ?? fallbackContact.phone ?? ''),
        address:
          field === 'address'
            ? String(value ?? '')
            : String(currentEmergencyDraft.emergencyAddress ?? fallbackContact.address ?? ''),
      };

      return {
        ...current,
        [DRIVER_EMERGENCY_ITEM_ID]: {
          ...currentEmergencyDraft,
          emergencyRelationship: nextContact.relationship,
          emergencyFullName: nextContact.fullName,
          emergencyPhone: nextContact.phone,
          emergencyAddress: nextContact.address,
          requiredInfo: buildDriverEmergencyContactRaw(nextContact),
        },
      };
    });

    setDriverDetailStatus('');
  };

  const handleDriverEmergencyRelationshipOptionSelect = (relationshipOption) => {
    handleDriverEmergencyFieldChange('relationship', relationshipOption);
    setDriverEmergencyRelationshipDropdownOpen(false);
  };

  const handleDriverEmergencySubmit = (event) => {
    event.preventDefault();

    const emergencyDraft = driverSignupDrafts[DRIVER_EMERGENCY_ITEM_ID] ?? { requiredInfo: '', extraInfo: '' };
    const emergencyContact = parseDriverEmergencyContact({
      relationship: emergencyDraft.emergencyRelationship,
      fullName: emergencyDraft.emergencyFullName,
      phone: emergencyDraft.emergencyPhone,
      address: emergencyDraft.emergencyAddress,
    });

    if (!emergencyContact.relationship || !emergencyContact.fullName || !emergencyContact.phone || !emergencyContact.address) {
      setDriverDetailStatus('Vui lòng điền đầy đủ Quan hệ, Họ tên, Số điện thoại và Địa chỉ liên hệ khẩn cấp.');
      return;
    }

    const numericEmergencyPhone = emergencyContact.phone.replace(/\D/g, '');

    if (numericEmergencyPhone.length < 8 || numericEmergencyPhone.length > 15) {
      setDriverDetailStatus('Số điện thoại liên hệ khẩn cấp không hợp lệ (8-15 chữ số).');
      return;
    }

    setDriverSignupDrafts((current) => ({
      ...current,
      [DRIVER_EMERGENCY_ITEM_ID]: {
        ...current[DRIVER_EMERGENCY_ITEM_ID],
        emergencyRelationship: emergencyContact.relationship,
        emergencyFullName: emergencyContact.fullName,
        emergencyPhone: emergencyContact.phone,
        emergencyAddress: emergencyContact.address,
        requiredInfo: buildDriverEmergencyContactRaw(emergencyContact),
        emergencySubmitted: true,
        extraInfo:
          String(current[DRIVER_EMERGENCY_ITEM_ID]?.extraInfo ?? '').trim() ||
          'Đã đọc và đồng ý điều khoản liên hệ khẩn cấp.',
      },
    }));

    setDriverSignupStatus('Đã nộp thông tin liên hệ khẩn cấp thành công. Bạn có thể tiếp tục các mục khác.');
    setDriverDetailStatus('');
    setDriverDetailModalOpen(false);
    setDriverDetailView('default');
    setDriverEmergencyRelationshipDropdownOpen(false);
    setDriverEmergencyTermsAccepted(false);
  };

  const handleDriverDraftSave = (event) => {
    event.preventDefault();

    if (!activeDriverSignupDraft.requiredInfo.trim()) {
      setDriverSignupStatus('Vui lòng nhập thông tin Bắt buộc cho mục đang chọn.');
      return;
    }

    setDriverSignupStatus(`Đã lưu thông tin cho mục "${activeDriverSignupItem?.label ?? ''}".`);
    setDriverDetailModalOpen(false);
  };

  const buildDriverApplicationDocumentUploadFormData = () => {
    const portraitDraft = driverSignupDrafts[DRIVER_PORTRAIT_ITEM_ID] ?? {};
    const identityDraft = driverSignupDrafts[DRIVER_IDENTITY_ITEM_ID] ?? {};
    const licenseDraft = driverSignupDrafts[DRIVER_LICENSE_ITEM_ID] ?? {};
    const backgroundDraft = driverSignupDrafts[DRIVER_BACKGROUND_ITEM_ID] ?? {};
    const vehicleDraft = driverSignupDrafts[DRIVER_VEHICLE_ITEM_ID] ?? {};

    const documentUploadFormData = new FormData();
    let hasFiles = false;

    const appendIfFileExists = (fieldName, fileValue) => {
      if (!isFileInstance(fileValue)) {
        return;
      }

      documentUploadFormData.append(fieldName, fileValue);
      hasFiles = true;
    };

    appendIfFileExists('portrait', portraitDraft.portraitFile);
    appendIfFileExists('identityFront', identityDraft.identityFrontFile);
    appendIfFileExists('identityBack', identityDraft.identityBackFile);
    appendIfFileExists('licenseFront', licenseDraft.licenseFrontFile);
    appendIfFileExists('licenseBack', licenseDraft.licenseBackFile);
    appendIfFileExists('background', backgroundDraft.backgroundFile);
    appendIfFileExists('vehicleFront', vehicleDraft.vehicleFrontFile);
    appendIfFileExists('vehicleSide', vehicleDraft.vehicleSideFile);
    appendIfFileExists('vehicleRear', vehicleDraft.vehicleRearFile);

    return {
      formData: documentUploadFormData,
      hasFiles,
    };
  };

  const buildDriverApplicationPayload = ({ profileOverride = null, uploadedDocumentPaths = {} } = {}) => {
    const portraitDraft = driverSignupDrafts[DRIVER_PORTRAIT_ITEM_ID] ?? {};
    const identityDraft = driverSignupDrafts[DRIVER_IDENTITY_ITEM_ID] ?? {};
    const licenseDraft = driverSignupDrafts[DRIVER_LICENSE_ITEM_ID] ?? {};
    const backgroundDraft = driverSignupDrafts[DRIVER_BACKGROUND_ITEM_ID] ?? {};
    const emergencyDraft = driverSignupDrafts[DRIVER_EMERGENCY_ITEM_ID] ?? {};
    const residenceDraft = driverSignupDrafts[DRIVER_RESIDENCE_ITEM_ID] ?? {};
    const bankDraft = driverSignupDrafts[DRIVER_BANK_ITEM_ID] ?? {};
    const vehicleDraft = driverSignupDrafts[DRIVER_VEHICLE_ITEM_ID] ?? {};
    const normalizedUploadedDocumentPaths =
      uploadedDocumentPaths && typeof uploadedDocumentPaths === 'object' ? uploadedDocumentPaths : {};

    const accountId = String(authenticatedUser?.id ?? '').trim();
    const identifier = String(
      authenticatedUser?.email ??
        profileOverride?.email ??
        authenticatedUser?.username ??
        profileForm.email ??
        loginEmail ??
        '',
    )
      .trim()
      .toLowerCase();
    const fullName = resolveFirstNonEmptyText(
      profileOverride?.fullName,
      profileOverride?.name,
      profileForm.fullName,
      authenticatedUser?.fullName,
      authenticatedUser?.name,
    );
    const email =
      resolveFirstNonEmptyText(profileOverride?.email, profileForm.email, authenticatedUser?.email, identifier).toLowerCase();
    const phone = resolveFirstNonEmptyText(profileOverride?.phone, profileForm.phone, authenticatedUser?.phone);

    const residenceAddress = parseDriverResidenceAddress({
      mode: residenceDraft.residenceMode,
      province: residenceDraft.residenceProvince,
      district: residenceDraft.residenceDistrict,
      ward: residenceDraft.residenceWard,
      houseNumber: residenceDraft.residenceHouseNumber,
      manualAddress: residenceDraft.residenceManualAddress,
    });

    const emergencyContact = parseDriverEmergencyContact({
      relationship: emergencyDraft.emergencyRelationship,
      fullName: emergencyDraft.emergencyFullName,
      phone: emergencyDraft.emergencyPhone,
      address: emergencyDraft.emergencyAddress,
    });

    const bankAccount = parseDriverBankAccount({
      holderName: bankDraft.bankHolderName,
      bankName: bankDraft.bankName,
      accountNumber: bankDraft.bankAccountNumber,
    });

    const vehicleImages = {
      front: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleFront),
        normalizeUploadedDriverAssetPath(vehicleDraft.vehicleFrontUploadedPath),
      ),
      side: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleSide),
        normalizeUploadedDriverAssetPath(vehicleDraft.vehicleSideUploadedPath),
      ),
      rear: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.vehicleRear),
        normalizeUploadedDriverAssetPath(vehicleDraft.vehicleRearUploadedPath),
      ),
    };

    const identityImages = {
      front: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.identityFront),
        normalizeUploadedDriverAssetPath(identityDraft.identityFrontUploadedPath),
      ),
      back: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.identityBack),
        normalizeUploadedDriverAssetPath(identityDraft.identityBackUploadedPath),
      ),
    };

    const licenseImages = {
      front: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.licenseFront),
        normalizeUploadedDriverAssetPath(licenseDraft.licenseFrontUploadedPath),
      ),
      back: resolveFirstNonEmptyText(
        normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.licenseBack),
        normalizeUploadedDriverAssetPath(licenseDraft.licenseBackUploadedPath),
      ),
    };

    const portraitImage = resolveFirstNonEmptyText(
      normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.portrait),
      normalizeUploadedDriverAssetPath(portraitDraft.portraitUploadedPath),
      normalizeUploadedDriverAssetPath(portraitDraft.requiredInfo),
    );
    const licenseImage = licenseImages.front;
    const backgroundImage = resolveFirstNonEmptyText(
      normalizeUploadedDriverAssetPath(normalizedUploadedDocumentPaths.background),
      normalizeUploadedDriverAssetPath(backgroundDraft.backgroundUploadedPath),
      normalizeUploadedDriverAssetPath(backgroundDraft.requiredInfo),
    );

    const cccd = normalizeIdentityDocumentNumber(identityDraft.identityCccd);

    return {
      accountId,
      identifier,
      fullName,
      email,
      phone,
      address: buildDriverResidenceDisplayAddress(residenceAddress),
      avatar: portraitImage,
      cccd,
      licenseImage,
      backgroundImage,
      identityImages,
      licenseImages,
      bank: {
        bankName: resolveBankNameFromInput(bankAccount.bankName),
        accountNumber: String(bankAccount.accountNumber ?? '').replace(/\s+/g, ''),
        accountHolder: normalizeBankHolderNameInput(bankAccount.holderName),
      },
      emergencyContact,
      vehicleInfo: {
        name: String(vehicleDraft.vehicleName ?? '').trim(),
        licensePlate: String(vehicleDraft.vehicleLicensePlate ?? '').trim().toUpperCase(),
        image: vehicleImages.side || vehicleImages.front || vehicleImages.rear,
        images: vehicleImages,
        identityImages,
        licenseImages,
      },
    };
  };

  const handleContinueDriverSignup = async () => {
    if (driverSignupSubmitting) {
      return;
    }

    if (remainingDriverItems.length > 0) {
      const firstMissingLabel = remainingDriverItems[0]?.label ?? '';
      setDriverSignupStatus(
        `Vui lòng hoàn tất đủ ${DRIVER_SIGNUP_ALL_ITEMS.length} mục Bắt buộc. Còn thiếu ${remainingDriverItems.length} mục (${firstMissingLabel}${remainingDriverItems.length > 1 ? ', ...' : ''}).`,
      );
      return;
    }

    let applicationPayload = buildDriverApplicationPayload();

    if (!applicationPayload.accountId && !applicationPayload.identifier) {
      setDriverSignupStatus('Vui lòng đăng nhập tài khoản trước khi nộp hồ sơ tài xế.');
      openLoginModal();
      return;
    }

    if (!applicationPayload.fullName || !applicationPayload.email || !applicationPayload.phone) {
      const identityPayload = resolveProfileIdentityPayload();

      if (identityPayload.identifier || identityPayload.accountId) {
        try {
          const profileResult = await authService.getProfile(identityPayload);
          const latestProfile = profileResult?.profile ?? null;

          if (latestProfile && typeof latestProfile === 'object') {
            applyProfileToForm(latestProfile);
            syncAuthenticatedUserFromProfile(latestProfile);
            applicationPayload = buildDriverApplicationPayload({ profileOverride: latestProfile });
          }
        } catch {
          // Continue to the explicit profile update guidance below.
        }
      }
    }

    if (!applicationPayload.fullName || !applicationPayload.email || !applicationPayload.phone) {
      setDriverSignupStatus('Vui lòng cập nhật đầy đủ họ tên, email và số điện thoại trong hồ sơ trước khi nộp.');
      openProfileModal({
        statusMessage: 'Vui lòng nhập đầy đủ Họ tên, Email và Số điện thoại trước khi nộp hồ sơ tài xế.',
        statusType: 'error',
        returnToDriverSignup: true,
      });
      return;
    }

    if (!applicationPayload.cccd) {
      setDriverSignupStatus('Vui lòng bổ sung số CMND/CCCD/Hộ chiếu trong mục giấy tờ trước khi nộp hồ sơ.');
      handleDriverItemSelect(DRIVER_IDENTITY_ITEM_ID);
      return;
    }

    if (!/^\d{12}$/.test(applicationPayload.cccd)) {
      setDriverSignupStatus('Số CCCD không hợp lệ (phải đúng 12 chữ số).');
      handleDriverItemSelect(DRIVER_IDENTITY_ITEM_ID);
      return;
    }

    if (!emailInputPattern.test(applicationPayload.email)) {
      setDriverSignupStatus('Email hồ sơ không hợp lệ. Vui lòng cập nhật lại ở phần thông tin cá nhân.');
      openProfileModal({
        statusMessage: 'Email hồ sơ chưa hợp lệ. Vui lòng kiểm tra lại email trong Thông tin cá nhân.',
        statusType: 'error',
        returnToDriverSignup: true,
      });
      return;
    }

    setDriverSignupSubmitting(true);
    setDriverSignupStatus('Đang chuẩn bị và tải ảnh hồ sơ tài xế...');

    try {
      const { formData: driverDocumentUploadFormData, hasFiles: hasNewUploadFiles } =
        buildDriverApplicationDocumentUploadFormData();
      let uploadedDocumentPaths = {};

      if (hasNewUploadFiles) {
        const uploadResult = await driverSignupService.uploadApplicationDocuments(driverDocumentUploadFormData);
        uploadedDocumentPaths = uploadResult?.files ?? {};

        setDriverSignupDrafts((current) => ({
          ...current,
          [DRIVER_PORTRAIT_ITEM_ID]: {
            ...current[DRIVER_PORTRAIT_ITEM_ID],
            portraitUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.portrait),
            portraitFile: null,
          },
          [DRIVER_IDENTITY_ITEM_ID]: {
            ...current[DRIVER_IDENTITY_ITEM_ID],
            identityFrontUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.identityFront),
            identityBackUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.identityBack),
            identityFrontFile: null,
            identityBackFile: null,
          },
          [DRIVER_LICENSE_ITEM_ID]: {
            ...current[DRIVER_LICENSE_ITEM_ID],
            licenseFrontUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.licenseFront),
            licenseBackUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.licenseBack),
            licenseFrontFile: null,
            licenseBackFile: null,
          },
          [DRIVER_BACKGROUND_ITEM_ID]: {
            ...current[DRIVER_BACKGROUND_ITEM_ID],
            backgroundUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.background),
            backgroundFile: null,
          },
          [DRIVER_VEHICLE_ITEM_ID]: {
            ...current[DRIVER_VEHICLE_ITEM_ID],
            vehicleFrontUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.vehicleFront),
            vehicleSideUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.vehicleSide),
            vehicleRearUploadedPath: normalizeUploadedDriverAssetPath(uploadedDocumentPaths.vehicleRear),
            vehicleFrontFile: null,
            vehicleSideFile: null,
            vehicleRearFile: null,
          },
        }));
      }

      applicationPayload = buildDriverApplicationPayload({ uploadedDocumentPaths });

      const hasRequiredDriverImageUploads =
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.avatar)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.identityImages?.front)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.identityImages?.back)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.licenseImage)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.licenseImages?.back)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.backgroundImage)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.vehicleInfo?.images?.front)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.vehicleInfo?.images?.side)) &&
        Boolean(normalizeUploadedDriverAssetPath(applicationPayload.vehicleInfo?.images?.rear));

      if (!hasRequiredDriverImageUploads) {
        setDriverSignupStatus(
          'Ảnh hồ sơ chưa hợp lệ trên máy chủ. Vui lòng mở lại các mục ảnh và tải lại trước khi nộp hồ sơ.',
        );
        return;
      }

      setDriverSignupStatus('Đang nộp hồ sơ tài xế. Vui lòng chờ trong giây lát...');
      const result = await driverSignupService.submitApplication(applicationPayload);
      const successMessage =
        result?.message ??
        'Đã nộp hồ sơ, đang chờ duyệt từ quản trị viên. Vui lòng chú ý thông báo Email để nhận kết quả duyệt và hướng dẫn kích hoạt tài khoản tài xế.';

      setDriverSignupStatus(successMessage);
      setDriverDetailModalOpen(false);
      setDriverSignupModalOpen(false);
      showMiniToast(successMessage);
    } catch (error) {
      const statusCode = Number(error?.status ?? 0);
      const fallbackMessage = 'Không thể nộp hồ sơ tài xế lúc này. Vui lòng thử lại sau.';
      const errorMessage = String(error?.message ?? '').trim() || fallbackMessage;

      if (statusCode === 423 || /chức năng tài xế.*khóa/i.test(errorMessage)) {
        setDriverDetailModalOpen(false);
        setDriverSignupModalOpen(false);
        openDriverFeatureLockModal(errorMessage);
        return;
      }

      setDriverSignupStatus(errorMessage);
    } finally {
      setDriverSignupSubmitting(false);
    }
  };

  const openForgotPasswordModal = () => {
    clearLoginFormState();
    clearRegisterFormState();
    clearForgotPasswordFormState();
    clearChangePasswordFormState();
    setLoginModalOpen(false);
    setRegisterModalOpen(false);
    setDriverSignupModalOpen(false);
    setDriverDetailModalOpen(false);
    setProfileModalOpen(false);
    setChangePasswordModalOpen(false);
    setForgotPasswordModalOpen(true);
  };

  const closeForgotPasswordModal = () => {
    clearForgotPasswordFormState();
    setForgotPasswordModalOpen(false);
  };

  const handleForgotPasswordClick = () => {
    openForgotPasswordModal();
  };

  const handleForgotPasswordSubmit = async (event) => {
    event.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordSuccess('');

    if (isForgotPasswordVerificationStep) {
      const normalizedCode = String(forgotPasswordVerificationCode ?? '').trim();

      if (!otpInputPattern.test(normalizedCode)) {
        setForgotPasswordError('Mã OTP phải gồm đúng 6 chữ số.');
        return;
      }

      setForgotPasswordSubmitting(true);

      try {
        const result = await authService.verifyForgotPasswordCode({
          resetToken: forgotPasswordRequestToken,
          verificationCode: normalizedCode,
        });

        const passwordResetToken = String(result?.passwordResetToken ?? '').trim();

        if (!passwordResetToken) {
          throw new Error('Không thể mở phiên đặt lại mật khẩu. Vui lòng thử lại.');
        }

        setForgotPasswordModalOpen(false);
        resetForgotPasswordState();
        openChangePasswordModal({
          passwordResetToken,
          statusMessage: result?.message ?? 'Xác thực email thành công. Vui lòng đặt mật khẩu mới.',
        });
      } catch (error) {
        if (Number(error?.status ?? 0) === 410) {
          resetForgotPasswordState();
        }

        setForgotPasswordError(error.message || 'Xác thực OTP thất bại. Vui lòng thử lại.');
      } finally {
        setForgotPasswordSubmitting(false);
      }

      return;
    }

    const normalizedEmail = forgotPasswordEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setForgotPasswordError('Vui lòng nhập email đã đăng ký.');
      return;
    }

    if (!emailInputPattern.test(normalizedEmail)) {
      setForgotPasswordError('Email không đúng định dạng hợp lệ.');
      return;
    }

    setForgotPasswordSubmitting(true);

    try {
      const result = await authService.requestForgotPasswordCode({
        email: normalizedEmail,
      });

      setForgotPasswordRequestToken(String(result?.resetToken ?? ''));
      setForgotPasswordMaskedEmail(String(result?.maskedEmail ?? maskEmailForDisplay(normalizedEmail)));
      setForgotPasswordOtpExpiresRemainingSeconds(Number(result?.expiresInSeconds ?? 0));
      setForgotPasswordOtpResendRemainingSeconds(Number(result?.resendAfterSeconds ?? 0));
      setForgotPasswordVerificationCode('');
      setForgotPasswordEmail(normalizedEmail);
      setLoginEmail(normalizedEmail);
      setForgotPasswordSuccess(result?.message ?? 'Mã OTP đã được gửi. Vui lòng kiểm tra email.');
    } catch (error) {
      const responseToken = String(error?.body?.resetToken ?? '').trim();
      const responseMaskedEmail = String(error?.body?.maskedEmail ?? '').trim();
      const retryAfterSeconds = Number(error?.body?.retryAfterSeconds ?? 0);

      if (responseToken) {
        setForgotPasswordRequestToken(responseToken);
      }

      if (responseMaskedEmail) {
        setForgotPasswordMaskedEmail(responseMaskedEmail);
      }

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        setForgotPasswordOtpResendRemainingSeconds(retryAfterSeconds);
      }

      setForgotPasswordError(error.message || 'Không thể gửi mã OTP quên mật khẩu lúc này.');
    } finally {
      setForgotPasswordSubmitting(false);
    }
  };

  const handleResendForgotPasswordCode = async () => {
    if (!forgotPasswordRequestToken || forgotPasswordOtpResendRemainingSeconds > 0 || forgotPasswordSubmitting) {
      return;
    }

    setForgotPasswordSubmitting(true);
    setForgotPasswordError('');
    setForgotPasswordSuccess('');

    try {
      const result = await authService.requestForgotPasswordCode({
        resetToken: forgotPasswordRequestToken,
      });

      setForgotPasswordRequestToken(String(result?.resetToken ?? forgotPasswordRequestToken));
      setForgotPasswordMaskedEmail(String(result?.maskedEmail ?? forgotPasswordMaskedEmail));
      setForgotPasswordOtpExpiresRemainingSeconds(Number(result?.expiresInSeconds ?? 0));
      setForgotPasswordOtpResendRemainingSeconds(Number(result?.resendAfterSeconds ?? 0));
      setForgotPasswordSuccess(result?.message ?? 'Đã gửi lại mã OTP. Vui lòng kiểm tra email.');
    } catch (error) {
      const retryAfterSeconds = Number(error?.body?.retryAfterSeconds ?? 0);

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        setForgotPasswordOtpResendRemainingSeconds(retryAfterSeconds);
      }

      if (Number(error?.status ?? 0) === 410) {
        resetForgotPasswordState();
      }

      setForgotPasswordError(error.message || 'Không thể gửi lại mã OTP lúc này.');
    } finally {
      setForgotPasswordSubmitting(false);
    }
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();

    if (credentialLockRemainingSeconds > 0) {
      setCredentialLoginError(`Tài khoản đang bị khóa tạm. Vui lòng thử lại sau ${credentialLockRemainingSeconds}s.`);
      return;
    }

    if (!loginEmail.trim() || !loginPassword.trim()) {
      setCredentialLoginError('Vui lòng nhập đầy đủ email/tài khoản và mật khẩu.');
      return;
    }

    setCredentialLoginLoading(true);
    setCredentialLoginError('');
    setGoogleLoginError('');

    try {
      const result = await authService.loginWithPassword({
        identifier: loginEmail.trim(),
        password: loginPassword,
      });

      const nextUser = result?.user ?? null;

      setAuthenticatedUser(nextUser);
      setCredentialLockRemainingSeconds(0);
      showMiniToast(result?.message ?? 'Đăng nhập thành công.');
      setLoginPassword('');
      setLoginModalOpen(false);
      setRegisterModalOpen(false);

      maybeShowDriverFeatureLockedNotice(nextUser);
    } catch (error) {
      const remainingSeconds = Number(error?.body?.lockout?.remainingSeconds ?? 0);

      if (Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
        setCredentialLockRemainingSeconds(remainingSeconds);
      }

      setCredentialLoginError(error.message || 'Đăng nhập thất bại. Vui lòng thử lại.');
    } finally {
      setCredentialLoginLoading(false);
    }
  };

  const promptChangePasswordFromGoogleResult = (result) => {
    if (!result?.requiresPasswordChange) {
      return;
    }

    const passwordChangeToken = String(result?.passwordChangeToken ?? '').trim();

    openChangePasswordModal({
      bootstrapToken: passwordChangeToken,
      statusMessage:
        result?.passwordPromptMessage ??
        'Vui lòng đổi mật khẩu để bảo mật tài khoản sau khi đăng nhập bằng Google.',
    });
  };

  const handleGoogleLogin = async () => {
    setGoogleLoginLoading(true);
    setGoogleLoginError('');
    setCredentialLoginError('');

    try {
      const result = await authService.loginWithGoogle();
      const nextUser = result?.user ?? null;

      setAuthenticatedUser(nextUser);
      setLoginEmail(nextUser?.email ?? '');
      showMiniToast(result?.message ?? 'Đăng nhập thành công.');
      setLoginModalOpen(false);
      setRegisterModalOpen(false);
      maybeShowDriverFeatureLockedNotice(nextUser);
      promptChangePasswordFromGoogleResult(result);
    } catch (error) {
      setGoogleLoginError(error.message || 'Đăng nhập Google thất bại. Vui lòng thử lại.');
    } finally {
      setGoogleLoginLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setGoogleSignupLoading(true);
    setGoogleSignupError('');
    setRegisterError('');
    setRegisterSuccess('');

    try {
      const result = await authService.signupWithGoogle();
      const nextUser = result?.user ?? null;

      setAuthenticatedUser(nextUser);
      setLoginEmail(nextUser?.email ?? '');
      showMiniToast(result?.message ?? 'Đăng ký Google thành công.');
      setRegisterModalOpen(false);
      setLoginModalOpen(false);
      maybeShowDriverFeatureLockedNotice(nextUser);
      promptChangePasswordFromGoogleResult(result);
    } catch (error) {
      setGoogleSignupError(error.message || 'Đăng ký Google thất bại. Vui lòng thử lại.');
    } finally {
      setGoogleSignupLoading(false);
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setRegisterError('');
    setRegisterSuccess('');
    setGoogleSignupError('');

    if (isRegisterVerificationStep) {
      const normalizedCode = String(registerVerificationCode ?? '').trim();

      if (!otpInputPattern.test(normalizedCode)) {
        setRegisterError('Mã xác nhận phải gồm đúng 6 chữ số.');
        return;
      }

      setRegisterSubmitting(true);

      try {
        const result = await authService.verifySignupVerificationCode({
          signupToken: registerSignupToken,
          verificationCode: normalizedCode,
        });
        const nextUser = result?.user ?? null;

        setAuthenticatedUser(nextUser);
        setLoginEmail(nextUser?.email ?? registerEmail.trim().toLowerCase());
        setLoginPassword('');
        setRegisterFullName('');
        setRegisterEmail('');
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        resetRegisterVerificationState();
        setRegisterSuccess(result?.message ?? 'Đăng ký tài khoản thành công.');
        setRegisterModalOpen(false);
        setLoginModalOpen(false);
        showMiniToast(result?.message ?? 'Đăng ký tài khoản thành công.');
        maybeShowDriverFeatureLockedNotice(nextUser);
      } catch (error) {
        if (Number(error?.status ?? 0) === 410) {
          resetRegisterVerificationState();
        }

        setRegisterError(error.message || 'Xác thực mã thất bại. Vui lòng thử lại.');
      } finally {
        setRegisterSubmitting(false);
      }

      return;
    }

    if (!registerFullName.trim() || !registerEmail.trim() || !registerPassword || !registerConfirmPassword) {
      setRegisterError('Vui lòng nhập đầy đủ thông tin đăng ký.');
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      setRegisterError('Mật khẩu xác nhận không khớp.');
      return;
    }

    if (!emailInputPattern.test(registerEmail.trim())) {
      setRegisterError('Email không đúng định dạng hợp lệ.');
      return;
    }

    setRegisterSubmitting(true);

    try {
      const normalizedEmail = registerEmail.trim().toLowerCase();
      const result = await authService.requestSignupVerificationCode({
        fullName: registerFullName.trim(),
        email: normalizedEmail,
        password: registerPassword,
      });

      setRegisterSignupToken(String(result?.signupToken ?? ''));
      setRegisterMaskedEmail(String(result?.maskedEmail ?? maskEmailForDisplay(normalizedEmail)));
      setRegisterOtpExpiresRemainingSeconds(Number(result?.expiresInSeconds ?? 0));
      setRegisterOtpResendRemainingSeconds(Number(result?.resendAfterSeconds ?? 0));
      setRegisterVerificationCode('');
      setLoginEmail(normalizedEmail);
      setRegisterSuccess(result?.message ?? `Mã xác nhận đã được gửi tới ${normalizedEmail}.`);
    } catch (error) {
      const responseToken = String(error?.body?.signupToken ?? '').trim();
      const responseMaskedEmail = String(error?.body?.maskedEmail ?? '').trim();
      const retryAfterSeconds = Number(error?.body?.retryAfterSeconds ?? 0);

      if (responseToken) {
        setRegisterSignupToken(responseToken);
      }

      if (responseMaskedEmail) {
        setRegisterMaskedEmail(responseMaskedEmail);
      }

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        setRegisterOtpResendRemainingSeconds(retryAfterSeconds);
      }

      setRegisterError(error.message || 'Không thể gửi mã xác nhận đăng ký. Vui lòng thử lại.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const handleResendSignupVerificationCode = async () => {
    if (!registerSignupToken || registerOtpResendRemainingSeconds > 0 || registerSubmitting) {
      return;
    }

    setRegisterSubmitting(true);
    setRegisterError('');
    setRegisterSuccess('');

    try {
      const result = await authService.requestSignupVerificationCode({
        signupToken: registerSignupToken,
      });

      setRegisterSignupToken(String(result?.signupToken ?? registerSignupToken));
      setRegisterMaskedEmail(String(result?.maskedEmail ?? registerMaskedEmail));
      setRegisterOtpExpiresRemainingSeconds(Number(result?.expiresInSeconds ?? 0));
      setRegisterOtpResendRemainingSeconds(Number(result?.resendAfterSeconds ?? 0));
      setRegisterSuccess(result?.message ?? 'Đã gửi lại mã xác nhận. Vui lòng kiểm tra email.');
    } catch (error) {
      const retryAfterSeconds = Number(error?.body?.retryAfterSeconds ?? 0);

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        setRegisterOtpResendRemainingSeconds(retryAfterSeconds);
      }

      if (Number(error?.status ?? 0) === 410) {
        resetRegisterVerificationState();
      }

      setRegisterError(error.message || 'Không thể gửi lại mã xác nhận lúc này.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const loginButtonLabel =
    authenticatedUser?.givenName?.trim() || authenticatedUser?.name?.trim()
      ? `Xin chào, ${(authenticatedUser.givenName || authenticatedUser.name).split(' ')[0]}`
      : 'Đăng nhập';
  const normalizedUserRoleCode = normalizeAppRoleCode(authenticatedUser?.roleCode);
  const shouldShowDriverSignupButton = !authenticatedUser || normalizedUserRoleCode === 'Q2';
  const isDriverSignupButtonBlocked = !authenticatedUser;

  const handleDriverSignupButtonClick = async () => {
    if (!authenticatedUser) {
      showMiniToast('Vui lòng đăng nhập tài khoản Khách hàng để đăng ký tài xế.', 'error', 2200);
      openLoginModal();
      return;
    }

    if (normalizedUserRoleCode !== 'Q2') {
      showMiniToast('Chỉ tài khoản Khách hàng mới được đăng ký tài xế.', 'error', 2200);
      return;
    }

    if (maybeShowDriverFeatureLockedNotice(authenticatedUser)) {
      return;
    }

    const identityPayload = resolveProfileIdentityPayload();

    if (!identityPayload.identifier && !identityPayload.accountId) {
      openProfileModal({
        statusMessage: 'Không xác định được tài khoản. Vui lòng cập nhật lại hồ sơ cá nhân trước khi đăng ký tài xế.',
        statusType: 'error',
        returnToDriverSignup: true,
      });
      return;
    }

    try {
      const profileResult = await authService.getProfile(identityPayload);
      const latestProfile = profileResult?.profile ?? null;

      if (latestProfile && typeof latestProfile === 'object') {
        applyProfileToForm(latestProfile);
        syncAuthenticatedUserFromProfile(latestProfile);

        const refreshedRoleCode = normalizeAppRoleCode(latestProfile.roleCode);

        if (refreshedRoleCode && refreshedRoleCode !== 'Q2') {
          showMiniToast('Tài khoản hiện không còn vai trò Khách hàng để mở đăng ký tài xế.', 'error', 2300);
          return;
        }

        if (
          maybeShowDriverFeatureLockedNotice(
            latestProfile,
            'Chức năng Tài xế đã bị khóa bởi quản trị viên. Đây không phải khóa tài khoản, bạn vẫn dùng được chức năng Khách hàng.',
          )
        ) {
          return;
        }
      }

      const profileFullName = resolveFirstNonEmptyText(latestProfile?.fullName, latestProfile?.name, profileForm.fullName);
      const profileEmail = resolveFirstNonEmptyText(latestProfile?.email, profileForm.email).toLowerCase();
      const profilePhone = sanitizePhoneDigits(resolveFirstNonEmptyText(latestProfile?.phone, profileForm.phone));

      if (!profileFullName || !profileEmail || !profilePhone) {
        openProfileModal({
          statusMessage: 'Vui lòng điền đầy đủ Họ tên, Email và Số điện thoại trước khi mở hồ sơ đăng ký tài xế.',
          statusType: 'error',
          returnToDriverSignup: true,
        });
        return;
      }

      if (!emailInputPattern.test(profileEmail)) {
        openProfileModal({
          statusMessage: 'Email trong hồ sơ chưa đúng định dạng. Vui lòng cập nhật lại trước khi đăng ký tài xế.',
          statusType: 'error',
          returnToDriverSignup: true,
        });
        return;
      }

      if (!phoneInputPattern.test(profilePhone)) {
        openProfileModal({
          statusMessage: 'Số điện thoại trong hồ sơ chỉ được chứa chữ số (8-15 số). Vui lòng cập nhật lại.',
          statusType: 'error',
          returnToDriverSignup: true,
        });
        return;
      }
    } catch (error) {
      showMiniToast(error.message || 'Không thể kiểm tra thông tin cá nhân. Vui lòng thử lại.', 'error', 2600);
      return;
    }

    openDriverSignupModal();
  };

  return (
    <div className="page-shell">
      <Header
        isAuthenticated={Boolean(authenticatedUser)}
        accountDisplayName={authenticatedUser?.name ?? authenticatedUser?.email ?? ''}
        accountRoleCode={authenticatedUser?.roleCode ?? ''}
        onProfile={openProfileModal}
        onBooking={handleOpenBookingForm}
        onChangePassword={openChangePasswordModal}
        onLogout={handleLogout}
        onLogin={openLoginModal}
      />

      <main>
        <section className="hero-section" id="home">
          <div className="hero-overlay" aria-hidden="true" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="hero-kicker">WELCOME TO</p>
              <h1>SMARTRIDE</h1>
              <p className="hero-subtitle">Đặt xe thông minh - tối ưu mọi hành trình</p>

              <div className="hero-actions">
                <button
                  className={classNames('hero-auth-button', 'login-button', loginModalOpen && 'is-active')}
                  type="button"
                  onClick={handleHeroLoginButtonClick}
                >
                  {loginButtonLabel}
                </button>

                {shouldShowDriverSignupButton ? (
                  <button
                    className={classNames(
                      'hero-auth-button',
                      'driver-signup-button',
                      driverSignupModalOpen && 'is-active',
                      isDriverSignupButtonBlocked && 'is-blocked',
                    )}
                    type="button"
                    aria-disabled={isDriverSignupButtonBlocked}
                    onClick={handleDriverSignupButtonClick}
                  >
                    Đăng ký Tài xế
                  </button>
                ) : null}

                <button className="chatbot-shortcut" type="button" aria-label="Mở chatbot">
                  <span className="chatbot-shortcut__bubble">
                    <img className="chatbot-shortcut__icon" src={chatbotIcon} alt="" aria-hidden="true" />
                  </span>
                  <span className="chatbot-shortcut__label">CHATBOT</span>
                </button>
              </div>
            </div>

            <section className={classNames('search-card', `search-card--${activeVehicle}`)} aria-label="Tìm chuyến đi" id="legacy-booking-card">
              <div className="search-card__header">
                <button className="destination-button" type="button" onClick={() => openLocationPicker('destination')}>
                  <img className="destination-button__icon" src={locationIcon} alt="" aria-hidden="true" />
                  <span>{route.destination.label || 'Đi đâu hôm nay ?'}</span>
                </button>

                <button
                  className={classNames('schedule-pill', scheduleEnabled && 'is-active')}
                  type="button"
                  onClick={() => setScheduleEnabled((current) => !current)}
                >
                  <img className="schedule-pill__icon" src={clockIcon} alt="" aria-hidden="true" />
                  Hẹn giờ
                </button>
              </div>

              <div className="vehicle-tabs" role="tablist" aria-label="Loại phương tiện">
                {vehicleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={classNames('vehicle-tab', activeVehicle === tab.id && 'is-active')}
                    type="button"
                    onClick={() => handleVehicleTabChange(tab.id)}
                  >
                    <img className="vehicle-tab__icon" src={tab.icon} alt="" aria-hidden="true" />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="search-fields">
                <label className="search-field">
                  <img className="search-field__icon search-field__icon--origin" src={originIcon} alt="" aria-hidden="true" />
                  <div className="search-field__content">
                    <span className="search-field__label">Điểm đón</span>
                    <input
                      value={route.pickup.label}
                      onChange={(event) =>
                        setRoute((current) => ({
                          ...current,
                          pickup: createLocationRecord(event.target.value),
                        }))
                      }
                    />
                  </div>

                  <button className="search-field__action" type="button" onClick={() => openLocationPicker('pickup')}>
                    <img className="search-field__action-icon" src={locationIcon} alt="" aria-hidden="true" />
                    Bản đồ
                  </button>
                </label>

                <button className="swap-button" type="button" aria-label="Đổi điểm đón và điểm đến" onClick={swapRoute}>
                  <img className="swap-button__icon" src={swapIcon} alt="" aria-hidden="true" />
                </button>

                <label className="search-field">
                  <img className="search-field__icon search-field__icon--destination" src={pinIcon} alt="" aria-hidden="true" />
                  <div className="search-field__content">
                    <span className="search-field__label">Điểm đến</span>
                    <input
                      value={route.destination.label}
                      onChange={(event) =>
                        setRoute((current) => ({
                          ...current,
                          destination: createLocationRecord(event.target.value),
                        }))
                      }
                    />
                  </div>

                  <button className="search-field__action" type="button" onClick={() => openLocationPicker('destination')}>
                    <img className="search-field__action-icon" src={locationIcon} alt="" aria-hidden="true" />
                    Bản đồ
                  </button>
                </label>
              </div>

              <button className="search-button" type="button" onClick={handleSearch} disabled={searchLoading}>
                {searchLoading ? 'ĐANG TÌM...' : 'TÌM KIẾM'}
              </button>

              {searchLoading ? <div className="booking-results booking-results--state">Đang lấy báo giá từ API đặt chuyến...</div> : null}

              {!searchLoading && searchError ? (
                <div className="booking-results booking-results--state booking-results--error">{searchError}</div>
              ) : null}

              {!searchLoading && !searchError && searchResult ? (
                <div className="booking-results">
                  <div className="booking-results__summary">
                    <div>
                      <span>Tuyến đã chọn</span>
                      <strong>
                        {searchResult.pickup.label} → {searchResult.destination.label}
                      </strong>
                    </div>

                    <div className="booking-results__meta">
                      <span>{Number.isFinite(searchResult.routeDistanceKm) ? `${searchResult.routeDistanceKm.toFixed(1)} km` : 'Khoảng cách ước tính'}</span>
                      <span>{Number.isFinite(searchResult.estimatedDurationMinutes) ? `${searchResult.estimatedDurationMinutes} phút` : 'Ước tính thời gian'}</span>
                      <span>{searchResult.scheduleEnabled ? 'Hẹn giờ' : 'Đi ngay'}</span>
                    </div>
                  </div>

                  <RoutePreviewMap
                    pickupPosition={searchResult.pickup?.position}
                    destinationPosition={searchResult.destination?.position}
                    routeGeometry={searchResult.routeGeometry}
                    routeProvider={searchResult.routeProvider}
                  />

                  <div className="booking-results__list">
                    {searchResult.results.map((item) => (
                      <button
                        className={classNames('booking-results__item', selectedRideId === item.id && 'is-active')}
                        key={item.id}
                        type="button"
                        onClick={() => handleRideResultCardClick(item.id)}
                      >
                        <div className="booking-results__item-head">
                          <div>
                            <p>{item.title}</p>
                            <span>{item.driver}</span>
                          </div>

                          <strong className="booking-results__item-price">{item.priceFormatted}</strong>
                        </div>

                        <div className="booking-results__item-foot">
                          <span>{item.eta}</span>
                          <span>{item.note}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <p className="booking-results__hint">
                    Mở mục Đặt xe trong menu để xác nhận chuyến và chọn phương thức thanh toán.
                  </p>

                  {bookingError ? <div className="booking-results__booking-state booking-results__booking-state--error">{bookingError}</div> : null}

                  {bookingSuccess ? (
                    <div className="booking-results__booking-state booking-results__booking-state--success">
                      <strong>Đặt xe thành công</strong>
                      <span>Mã chuyến: {bookingSuccess.bookingCode}</span>
                      <span>
                        {bookingSuccess.rideTitle} - {bookingSuccess.priceFormatted}
                      </span>
                      <span>Thanh toán: {bookingSuccess.paymentSummary ?? selectedBookingPaymentSummary}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!searchLoading && !searchError && !searchResult ? (
                <div className="booking-results booking-results--state">
                  Nhập điểm đón, điểm đến rồi bấm TÌM KIẾM để nhận báo giá trực tiếp từ API.
                </div>
              ) : null}
            </section>
          </div>
        </section>

        <section className="content-section">
          <div className="container">
            <SectionHeading title="Dịch vụ xe" subtitle="SERVICES" />

            <div className="card-grid">
              {serviceCards.map((card) => (
                <button
                  className={classNames('info-card', 'info-card--selectable', activeVehicle === card.id && 'is-selected')}
                  key={card.id}
                  type="button"
                  aria-pressed={activeVehicle === card.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleServiceCardClick(card.id);
                  }}
                >
                  <img className="info-card__art" src={card.image} alt="" aria-hidden="true" />
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                  <span className="info-card__cta">
                    {activeVehicle === card.id ? 'Đang chọn cho giao diện đặt xe >>' : 'Chọn hạng xe này >>'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="content-section content-section--promo">
          <div className="container">
            <SectionHeading title="Ưu đãi nổi bật" subtitle="PROMOTIONS" />

            <div className="card-grid">
              {promoCards.map((card) => (
                <article className="promo-card" key={card.id}>
                  <img className="promo-card__banner" src={card.image} alt="" aria-hidden="true" />
                  <div className="promo-card__body">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="testimonial-section">
          <div className="testimonial-overlay" aria-hidden="true" />
          <div className="container">
            <SectionHeading title="Về chúng tôi" subtitle="ABOUT US" inverse />

            <div className="testimonial-grid">
              {testimonials.map((item) => (
                <article className="testimonial-card" key={item.id}>
                  <img className="testimonial-card__quote-icon" src={quoteIcon} alt="" aria-hidden="true" />
                  <p>{item.text}</p>
                  <strong>{item.name}</strong>
                  <div className="star-row" aria-label="Đánh giá 5 sao">
                    <img className="star-row__icon" src={starIcon} alt="" aria-hidden="true" />
                    <img className="star-row__icon" src={starIcon} alt="" aria-hidden="true" />
                    <img className="star-row__icon" src={starIcon} alt="" aria-hidden="true" />
                    <img className="star-row__icon" src={starIcon} alt="" aria-hidden="true" />
                    <img className="star-row__icon" src={starIcon} alt="" aria-hidden="true" />
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {loginModalOpen
          ? createPortal(
              <div className="login-popup-modal" role="dialog" aria-modal="true" aria-label="Đăng nhập SmartRide">
                <div className="login-popup-modal__backdrop" onClick={closeLoginModal} aria-hidden="true" />

                <div className="login-popup-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeLoginModal} aria-label="Đóng đăng nhập">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab">Đăng nhập</div>

                  <form className="login-popup-modal__form" onSubmit={handleLoginSubmit}>
                    <label className="login-popup-modal__field">
                      <span>EMAIL</span>
                      <input
                        className="login-popup-modal__input"
                        type="email"
                        value={loginEmail}
                        onChange={(event) => setLoginEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="NHẬP ĐỊA CHỈ EMAIL"
                      />
                    </label>

                    <label className="login-popup-modal__field">
                      <span>MẬT KHẨU</span>
                      <div className="login-popup-modal__password-field">
                        <input
                          className="login-popup-modal__input"
                          type={showLoginPassword ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(event) => setLoginPassword(event.target.value)}
                          autoComplete="current-password"
                          placeholder="******"
                        />

                        <button
                          className="login-popup-modal__password-toggle"
                          type="button"
                          onClick={() => setShowLoginPassword((current) => !current)}
                          aria-label={showLoginPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        >
                          <img
                            className="login-popup-modal__password-toggle-icon"
                            src={showLoginPassword ? loginHidePassIcon : loginShowPassIcon}
                            alt=""
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </label>

                    <button
                      className="login-popup-modal__continue"
                      type="submit"
                      disabled={credentialLoginLoading || credentialLockRemainingSeconds > 0}
                    >
                      {credentialLoginLoading
                        ? 'Đang đăng nhập...'
                        : credentialLockRemainingSeconds > 0
                          ? `Thử lại ${credentialLockRemainingSeconds}s`
                          : 'Tiếp tục'}
                    </button>

                    {credentialLoginError ? <p className="login-popup-modal__status login-popup-modal__status--error">{credentialLoginError}</p> : null}

                    <p className="login-popup-modal__separator">hoặc tiếp tục với</p>

                    <button className="login-popup-modal__google" type="button" onClick={() => void handleGoogleLogin()} disabled={googleLoginLoading}>
                      <span className="login-popup-modal__google-mark" aria-hidden="true">
                        <img className="login-popup-modal__google-icon" src={loginGoogleIcon} alt="" aria-hidden="true" />
                      </span>
                      <span>{googleLoginLoading ? 'ĐANG MỞ GOOGLE...' : 'GOOGLE'}</span>
                    </button>

                    {googleLoginError ? <p className="login-popup-modal__status login-popup-modal__status--error">{googleLoginError}</p> : null}

                    <div className="login-popup-modal__links">
                      <button className="login-popup-modal__link" type="button" onClick={handleForgotPasswordClick}>
                        Bạn quên mật khẩu?
                      </button>
                      <button className="login-popup-modal__link login-popup-modal__link--strong" type="button" onClick={openRegisterModal}>
                        ĐĂNG KÝ
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {forgotPasswordModalOpen
          ? createPortal(
              <div className="login-popup-modal forgot-password-modal" role="dialog" aria-modal="true" aria-label="Quên mật khẩu SmartRide">
                <div className="login-popup-modal__backdrop" onClick={closeForgotPasswordModal} aria-hidden="true" />

                <div className="login-popup-modal__window forgot-password-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeForgotPasswordModal} aria-label="Đóng quên mật khẩu">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab forgot-password-modal__tab">Quên mật khẩu</div>

                  <form className="login-popup-modal__form forgot-password-modal__form" onSubmit={handleForgotPasswordSubmit}>
                    {!isForgotPasswordVerificationStep ? (
                      <>
                        <p className="forgot-password-modal__lead">Nhập email đã đăng ký để nhận mã OTP đặt lại mật khẩu.</p>

                        <label className="login-popup-modal__field">
                          <span>EMAIL ĐÃ ĐĂNG KÝ</span>
                          <input
                            className="login-popup-modal__input"
                            type="email"
                            value={forgotPasswordEmail}
                            onChange={(event) => setForgotPasswordEmail(event.target.value)}
                            autoComplete="email"
                            placeholder="you@example.com"
                          />
                        </label>

                        <button
                          className="login-popup-modal__continue forgot-password-modal__continue"
                          type="submit"
                          disabled={forgotPasswordSubmitting}
                        >
                          {forgotPasswordSubmitting ? 'Đang gửi OTP...' : 'Nhận mã OTP'}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="forgot-password-modal__otp-note">
                          Nhập mã OTP 6 số đã gửi tới <strong>{forgotPasswordMaskedEmail || maskEmailForDisplay(forgotPasswordEmail)}</strong>.
                        </p>

                        <label className="login-popup-modal__field">
                          <span>MÃ OTP</span>
                          <input
                            className="login-popup-modal__input forgot-password-modal__otp-input"
                            type="text"
                            value={forgotPasswordVerificationCode}
                            onChange={(event) => setForgotPasswordVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="XXXXXX"
                            maxLength={6}
                          />
                        </label>

                        <p className="forgot-password-modal__otp-expiry">
                          {forgotPasswordOtpExpiresRemainingSeconds > 0
                            ? `Mã hết hạn sau ${forgotPasswordOtpExpiresRemainingSeconds}s.`
                            : 'Mã có thể đã hết hạn. Hãy gửi lại mã mới.'}
                        </p>

                        <button
                          className="login-popup-modal__continue forgot-password-modal__continue"
                          type="submit"
                          disabled={forgotPasswordSubmitting}
                        >
                          {forgotPasswordSubmitting ? 'Đang xác thực...' : 'Xác thực email'}
                        </button>

                        <div className="forgot-password-modal__actions">
                          <button
                            className="login-popup-modal__link"
                            type="button"
                            onClick={() => void handleResendForgotPasswordCode()}
                            disabled={forgotPasswordSubmitting || forgotPasswordOtpResendRemainingSeconds > 0}
                          >
                            {forgotPasswordOtpResendRemainingSeconds > 0
                              ? `Gửi lại sau ${forgotPasswordOtpResendRemainingSeconds}s`
                              : 'Gửi lại mã'}
                          </button>

                          <button
                            className="login-popup-modal__link"
                            type="button"
                            onClick={() => {
                              resetForgotPasswordState();
                              setForgotPasswordEmail(loginEmail.trim().toLowerCase());
                            }}
                            disabled={forgotPasswordSubmitting}
                          >
                            Sửa email
                          </button>
                        </div>
                      </>
                    )}

                    {forgotPasswordError ? <p className="login-popup-modal__status login-popup-modal__status--error">{forgotPasswordError}</p> : null}
                    {forgotPasswordSuccess ? <p className="login-popup-modal__status login-popup-modal__status--success">{forgotPasswordSuccess}</p> : null}

                    <div className="login-popup-modal__links forgot-password-modal__links">
                      <button className="login-popup-modal__link" type="button" onClick={openLoginModal}>
                        ĐĂNG NHẬP
                      </button>

                      <button className="login-popup-modal__link login-popup-modal__link--strong" type="button" onClick={openRegisterModal}>
                        ĐĂNG KÝ
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {profileModalOpen
          ? createPortal(
              <div className="login-popup-modal profile-popup-modal" role="dialog" aria-modal="true" aria-label="Thông tin cá nhân">
                <div className="login-popup-modal__backdrop" onClick={closeProfileModal} aria-hidden="true" />

                <div className="login-popup-modal__window profile-popup-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeProfileModal} aria-label="Đóng thông tin cá nhân">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab profile-popup-modal__tab">Thông tin cá nhân</div>

                  <form className="profile-popup-modal__body" onSubmit={handleProfileSubmit}>
                    <div className="profile-sheet">
                      <section className="profile-sheet__left" aria-label="Ảnh đại diện và thao tác">
                        <button
                          className="profile-sheet__avatar-trigger"
                          type="button"
                          onClick={() => profileAvatarInputRef.current?.click()}
                          disabled={profileLoading || profileSaving}
                          aria-label="Đổi ảnh đại diện"
                        >
                          <div className="profile-sheet__avatar-frame" aria-label="Ảnh đại diện">
                            {profileAvatarPreview ? (
                              <img className="profile-sheet__avatar-image" src={profileAvatarPreview} alt="Ảnh đại diện" />
                            ) : (
                              <div className="profile-sheet__avatar-placeholder" aria-hidden="true">
                                <img src={userIcon} alt="" />
                              </div>
                            )}
                          </div>
                        </button>

                        <input
                          ref={profileAvatarInputRef}
                          className="profile-sheet__avatar-input"
                          type="file"
                          accept="image/*"
                          onChange={handleProfileAvatarChange}
                        />

                        <div className="profile-sheet__actions">
                          <button className="profile-sheet__button profile-sheet__button--exit" type="button" onClick={closeProfileModal}>
                            Thoát
                          </button>

                          <button className="profile-sheet__button profile-sheet__button--save" type="submit" disabled={profileLoading || profileSaving}>
                            {profileSaving ? 'Đang cập nhật...' : 'Cập nhật'}
                          </button>
                        </div>
                      </section>

                      <section className="profile-sheet__right" aria-label="Thông tin chi tiết">
                        <label className="profile-sheet__field">
                          <span>Tên tài khoản</span>
                          <input
                            type="text"
                            value={profileForm.username}
                            placeholder="Tên tài khoản"
                            disabled
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Họ và tên</span>
                          <input
                            type="text"
                            value={profileForm.fullName}
                            onChange={(event) => handleProfileFieldChange('fullName', event.target.value)}
                            placeholder="Nhập họ tên"
                            disabled={profileLoading || profileSaving}
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Email</span>
                          <input
                            type="email"
                            value={profileForm.email}
                            onChange={(event) => handleProfileFieldChange('email', event.target.value)}
                            placeholder="name@example.com"
                            disabled={profileLoading || profileSaving}
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Số điện thoại</span>
                          <input
                            type="text"
                            value={profileForm.phone}
                            onChange={(event) => handleProfileFieldChange('phone', event.target.value)}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={15}
                            placeholder="09xxxxxxxx"
                            disabled={profileLoading || profileSaving}
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Địa chỉ</span>
                          <input
                            type="text"
                            value={profileForm.address}
                            onChange={(event) => handleProfileFieldChange('address', event.target.value)}
                            placeholder="Nhập địa chỉ"
                            disabled={profileLoading || profileSaving}
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Ngày sinh</span>
                          <DatePicker
                            selected={parseDateForPicker(profileForm.dateOfBirth)}
                            onChange={(selectedDate) => {
                              handleProfileFieldChange('dateOfBirth', formatDateForProfileValue(selectedDate));
                            }}
                            locale="vi-VN"
                            dateFormat="dd/MM/yyyy"
                            placeholderText="dd/mm/yyyy"
                            showMonthDropdown
                            showYearDropdown
                            dropdownMode="select"
                            maxDate={new Date()}
                            className="profile-sheet__date-input"
                            calendarClassName="profile-sheet__date-calendar"
                            popperClassName="profile-sheet__date-popper"
                            disabled={profileLoading || profileSaving}
                          />
                        </label>

                        <label className="profile-sheet__field">
                          <span>Giới tính</span>
                          <select
                            value={profileForm.gender}
                            onChange={(event) => handleProfileFieldChange('gender', event.target.value)}
                            disabled={profileLoading || profileSaving}
                          >
                            <option value="Nam">Nam</option>
                            <option value="Nữ">Nữ</option>
                            <option value="Khác">Khác</option>
                          </select>
                        </label>
                      </section>
                    </div>

                    {profileStatus ? (
                      <p
                        className={classNames(
                          'profile-sheet__status',
                          profileStatusType === 'success' && 'profile-sheet__status--success',
                          profileStatusType === 'error' && 'profile-sheet__status--error',
                          profileStatusType === 'info' && 'profile-sheet__status--info',
                        )}
                      >
                        {profileStatus}
                      </p>
                    ) : null}
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {changePasswordModalOpen
          ? createPortal(
              <div className="login-popup-modal change-password-modal" role="dialog" aria-modal="true" aria-label="Đổi mật khẩu SmartRide">
                <div className="login-popup-modal__backdrop" onClick={closeChangePasswordModal} aria-hidden="true" />

                <div className="login-popup-modal__window change-password-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeChangePasswordModal} aria-label="Đóng đổi mật khẩu">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab change-password-modal__tab">Đổi mật khẩu</div>

                  <form className="login-popup-modal__form change-password-modal__form" onSubmit={handleChangePasswordSubmit}>
                    {isTokenBasedChangePasswordFlow ? (
                      <p className="change-password-modal__hint">
                        {isBootstrapPasswordChangeFlow
                          ? 'Phiên đăng nhập Google đã xác thực mật khẩu cũ. Bạn chỉ cần nhập mật khẩu mới.'
                          : 'Bạn đã xác thực OTP qua email. Bạn chỉ cần nhập mật khẩu mới.'}
                      </p>
                    ) : null}

                    <label className="login-popup-modal__field">
                      <span>
                        {isBootstrapPasswordChangeFlow
                          ? 'MẬT KHẨU CŨ (GOOGLE)'
                          : isPasswordResetTokenFlow
                            ? 'MẬT KHẨU CŨ (OTP EMAIL)'
                            : 'MẬT KHẨU CŨ'}
                      </span>
                      <div className="login-popup-modal__password-field">
                        <input
                          className="login-popup-modal__input"
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={currentPasswordValue}
                          onChange={(event) => setCurrentPasswordValue(event.target.value)}
                          autoComplete="current-password"
                          placeholder={isTokenBasedChangePasswordFlow ? 'Đã được xác thực bảo mật' : '******'}
                          disabled={isTokenBasedChangePasswordFlow || changePasswordLoading}
                        />

                        {!isTokenBasedChangePasswordFlow ? (
                          <button
                            className="login-popup-modal__password-toggle"
                            type="button"
                            onClick={() => setShowCurrentPassword((current) => !current)}
                            aria-label={showCurrentPassword ? 'Ẩn mật khẩu cũ' : 'Hiện mật khẩu cũ'}
                          >
                            <img
                              className="login-popup-modal__password-toggle-icon"
                              src={showCurrentPassword ? loginHidePassIcon : loginShowPassIcon}
                              alt=""
                              aria-hidden="true"
                            />
                          </button>
                        ) : null}
                      </div>
                    </label>

                    <label className="login-popup-modal__field">
                      <span>MẬT KHẨU MỚI</span>
                      <div className="login-popup-modal__password-field">
                        <input
                          className="login-popup-modal__input"
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPasswordValue}
                          onChange={(event) => setNewPasswordValue(event.target.value)}
                          autoComplete="new-password"
                          placeholder="******"
                        />

                        <button
                          className="login-popup-modal__password-toggle"
                          type="button"
                          onClick={() => setShowNewPassword((current) => !current)}
                          aria-label={showNewPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                        >
                          <img
                            className="login-popup-modal__password-toggle-icon"
                            src={showNewPassword ? loginHidePassIcon : loginShowPassIcon}
                            alt=""
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </label>

                    <label className="login-popup-modal__field">
                      <span>NHẬP LẠI MẬT KHẨU</span>
                      <div className="login-popup-modal__password-field">
                        <input
                          className="login-popup-modal__input"
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPasswordValue}
                          onChange={(event) => setConfirmPasswordValue(event.target.value)}
                          autoComplete="new-password"
                          placeholder="******"
                        />

                        <button
                          className="login-popup-modal__password-toggle"
                          type="button"
                          onClick={() => setShowConfirmPassword((current) => !current)}
                          aria-label={showConfirmPassword ? 'Ẩn nhập lại mật khẩu' : 'Hiện nhập lại mật khẩu'}
                        >
                          <img
                            className="login-popup-modal__password-toggle-icon"
                            src={showConfirmPassword ? loginHidePassIcon : loginShowPassIcon}
                            alt=""
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </label>

                    <button
                      className="login-popup-modal__continue change-password-modal__confirm"
                      type="submit"
                      disabled={changePasswordLoading}
                    >
                      {changePasswordLoading ? 'Đang cập nhật...' : 'Xác nhận'}
                    </button>

                    {changePasswordStatus ? (
                      <p
                        className={classNames(
                          'login-popup-modal__status',
                          changePasswordStatus.startsWith('Đổi mật khẩu thành công') ||
                            changePasswordStatus.startsWith('Đã cập nhật') ||
                            changePasswordStatus.startsWith('Xác thực email thành công')
                            ? 'login-popup-modal__status--success'
                            : 'login-popup-modal__status--error',
                        )}
                      >
                        {changePasswordStatus}
                      </p>
                    ) : null}

                    <div className="login-popup-modal__links change-password-modal__links">
                      <button className="login-popup-modal__link" type="button" onClick={closeChangePasswordModal}>
                        Thoát
                      </button>

                      {!authenticatedUser ? (
                        <button className="login-popup-modal__link login-popup-modal__link--strong" type="button" onClick={openRegisterModal}>
                          ĐĂNG KÝ
                        </button>
                      ) : null}
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {registerModalOpen
          ? createPortal(
              <div
                className="login-popup-modal register-popup-modal"
                role="dialog"
                aria-modal="true"
                aria-label={isRegisterVerificationStep ? 'Xác thực Email SmartRide' : 'Đăng ký SmartRide'}
              >
                <div className="login-popup-modal__backdrop" onClick={closeRegisterModal} aria-hidden="true" />

                <div className="login-popup-modal__window register-popup-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeRegisterModal} aria-label="Đóng đăng ký">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab">{isRegisterVerificationStep ? 'Xác thực Email' : 'Đăng ký'}</div>

                  <form className="login-popup-modal__form" onSubmit={handleRegisterSubmit}>
                    {!isRegisterVerificationStep ? (
                      <>
                        <label className="login-popup-modal__field">
                          <span>HỌ TÊN</span>
                          <input
                            className="login-popup-modal__input"
                            type="text"
                            value={registerFullName}
                            onChange={(event) => setRegisterFullName(event.target.value)}
                            autoComplete="name"
                          />
                        </label>

                        <label className="login-popup-modal__field">
                          <span>EMAIL</span>
                          <input
                            className="login-popup-modal__input"
                            type="email"
                            value={registerEmail}
                            onChange={(event) => setRegisterEmail(event.target.value)}
                            autoComplete="email"
                          />
                        </label>

                        <label className="login-popup-modal__field">
                          <span>MẬT KHẨU</span>
                          <div className="login-popup-modal__password-field">
                            <input
                              className="login-popup-modal__input"
                              type={showRegisterPassword ? 'text' : 'password'}
                              value={registerPassword}
                              onChange={(event) => setRegisterPassword(event.target.value)}
                              autoComplete="new-password"
                              placeholder="******"
                            />

                            <button
                              className="login-popup-modal__password-toggle"
                              type="button"
                              onClick={() => setShowRegisterPassword((current) => !current)}
                              aria-label={showRegisterPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                            >
                              <img
                                className="login-popup-modal__password-toggle-icon"
                                src={showRegisterPassword ? loginHidePassIcon : loginShowPassIcon}
                                alt=""
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        </label>

                        <label className="login-popup-modal__field">
                          <span>XÁC NHẬN MẬT KHẨU</span>
                          <div className="login-popup-modal__password-field">
                            <input
                              className="login-popup-modal__input"
                              type={showRegisterConfirmPassword ? 'text' : 'password'}
                              value={registerConfirmPassword}
                              onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                              autoComplete="new-password"
                              placeholder="******"
                            />

                            <button
                              className="login-popup-modal__password-toggle"
                              type="button"
                              onClick={() => setShowRegisterConfirmPassword((current) => !current)}
                              aria-label={showRegisterConfirmPassword ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
                            >
                              <img
                                className="login-popup-modal__password-toggle-icon"
                                src={showRegisterConfirmPassword ? loginHidePassIcon : loginShowPassIcon}
                                alt=""
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        </label>

                        <button className="login-popup-modal__continue" type="submit" disabled={registerSubmitting || googleSignupLoading}>
                          {registerSubmitting ? 'Đang gửi mã...' : 'Nhận mã xác nhận'}
                        </button>

                        <p className="login-popup-modal__separator">hoặc tiếp tục với</p>

                        <button
                          className="login-popup-modal__google"
                          type="button"
                          onClick={() => void handleGoogleSignup()}
                          disabled={googleSignupLoading || registerSubmitting}
                        >
                          <span className="login-popup-modal__google-mark" aria-hidden="true">
                            <img className="login-popup-modal__google-icon" src={loginGoogleIcon} alt="" aria-hidden="true" />
                          </span>
                          <span>{googleSignupLoading ? 'ĐANG MỞ GOOGLE...' : 'GOOGLE'}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="register-popup-modal__otp-note">
                          Nhập mã xác nhận 6 số đã gửi tới <strong>{registerMaskedEmail || maskEmailForDisplay(registerEmail)}</strong>.
                        </p>

                        <label className="login-popup-modal__field">
                          <span>MÃ XÁC NHẬN</span>
                          <input
                            className="login-popup-modal__input register-popup-modal__otp-input"
                            type="text"
                            value={registerVerificationCode}
                            onChange={(event) => setRegisterVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="XXXXXX"
                            maxLength={6}
                          />
                        </label>

                        <p className="register-popup-modal__otp-expiry">
                          {registerOtpExpiresRemainingSeconds > 0
                            ? `Mã hết hạn sau ${registerOtpExpiresRemainingSeconds}s.`
                            : 'Mã có thể đã hết hạn. Hãy gửi lại mã mới.'}
                        </p>

                        <button className="login-popup-modal__continue register-popup-modal__verify-button" type="submit" disabled={registerSubmitting}>
                          {registerSubmitting ? 'Đang xác thực...' : 'Xác thực và tạo tài khoản'}
                        </button>

                        <div className="register-popup-modal__otp-actions">
                          <button
                            className="login-popup-modal__link"
                            type="button"
                            onClick={() => void handleResendSignupVerificationCode()}
                            disabled={registerSubmitting || registerOtpResendRemainingSeconds > 0}
                          >
                            {registerOtpResendRemainingSeconds > 0
                              ? `Gửi lại sau ${registerOtpResendRemainingSeconds}s`
                              : 'Gửi lại mã'}
                          </button>

                          <button
                            className="login-popup-modal__link"
                            type="button"
                            onClick={resetRegisterVerificationState}
                            disabled={registerSubmitting}
                          >
                            Sửa thông tin đăng ký
                          </button>
                        </div>
                      </>
                    )}

                    {registerError ? <p className="login-popup-modal__status login-popup-modal__status--error">{registerError}</p> : null}
                    {registerSuccess ? <p className="login-popup-modal__status login-popup-modal__status--success">{registerSuccess}</p> : null}
                    {!isRegisterVerificationStep && !registerError && !registerSuccess && googleSignupError ? (
                      <p className="login-popup-modal__status login-popup-modal__status--error">{googleSignupError}</p>
                    ) : null}

                    <div className="login-popup-modal__links register-popup-modal__links">
                      <p className="register-popup-modal__hint">Bạn đã có tài khoản?</p>
                      <button className="login-popup-modal__link login-popup-modal__link--strong" type="button" onClick={openLoginModal}>
                        ĐĂNG NHẬP
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {driverSignupModalOpen
          ? createPortal(
              <div className="login-popup-modal driver-signup-modal" role="dialog" aria-modal="true" aria-label="Đăng ký tài xế SmartRide">
                <div className="login-popup-modal__backdrop" onClick={closeDriverSignupModal} aria-hidden="true" />

                <div className="login-popup-modal__window driver-signup-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeDriverSignupModal} aria-label="Đóng đăng ký tài xế">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div className="login-popup-modal__tab driver-signup-modal__tab">Đăng ký Tài xế</div>

                  <div className="driver-signup-modal__body">
                    <p className="driver-signup-modal__lead">
                      Hoàn tất hồ sơ dưới đây để bắt đầu trở thành đối tác tài xế SmartRide.
                    </p>

                    <div className="driver-signup-modal__columns">
                      <ul className="driver-signup-modal__list" aria-label="Nhóm hồ sơ cá nhân">
                        {DRIVER_SIGNUP_ITEMS.left.map((item) => {
                          const isItemCompleted = isDriverSignupItemSubmitted(item.id, driverSignupDrafts);

                          return (
                            <li className="driver-signup-modal__list-row" key={item.id}>
                              <button
                                className={classNames('driver-signup-modal__item', driverSelectedItemId === item.id && 'is-active')}
                                type="button"
                                onClick={() => handleDriverItemSelect(item.id)}
                              >
                                <span className="driver-signup-modal__item-main">
                                  <span className="driver-signup-modal__icon-wrap" aria-hidden="true">
                                    <img className="driver-signup-modal__icon" src={item.icon} alt="" />
                                  </span>
                                  <span>{item.label}</span>
                                </span>
                                <span
                                  className={classNames(
                                    'driver-signup-modal__required-badge',
                                    isItemCompleted && 'is-completed',
                                  )}
                                >
                                  {isItemCompleted ? 'Đã nộp' : 'Bắt buộc'}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>

                      <ul className="driver-signup-modal__list" aria-label="Nhóm hồ sơ phương tiện và điều khoản">
                        {DRIVER_SIGNUP_ITEMS.right.map((item) => {
                          const isItemCompleted = isDriverSignupItemSubmitted(item.id, driverSignupDrafts);

                          return (
                            <li className="driver-signup-modal__list-row" key={item.id}>
                              <button
                                className={classNames('driver-signup-modal__item', driverSelectedItemId === item.id && 'is-active')}
                                type="button"
                                onClick={() => handleDriverItemSelect(item.id)}
                              >
                                <span className="driver-signup-modal__item-main">
                                  <span className="driver-signup-modal__icon-wrap" aria-hidden="true">
                                    <img className="driver-signup-modal__icon" src={item.icon} alt="" />
                                  </span>
                                  <span>{item.label}</span>
                                </span>
                                <span
                                  className={classNames(
                                    'driver-signup-modal__required-badge',
                                    isItemCompleted && 'is-completed',
                                  )}
                                >
                                  {isItemCompleted ? 'Đã nộp' : 'Bắt buộc'}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {driverSignupStatus ? (
                      <p
                        className={classNames(
                          'driver-signup-modal__status',
                          driverSignupStatus.startsWith('Đã') && 'driver-signup-modal__status--success',
                        )}
                      >
                        {driverSignupStatus}
                      </p>
                    ) : null}

                    <p className="driver-signup-modal__progress">
                      Đã hoàn tất {completedDriverItems}/{DRIVER_SIGNUP_ALL_ITEMS.length} mục bắt buộc.
                    </p>

                    <div className="driver-signup-modal__support">
                      <span className="driver-signup-modal__support-title">Hỗ trợ hồ sơ:</span>
                      <a className="driver-signup-modal__support-link" href="tel:19001234">
                        <img src={phoneIcon} alt="" aria-hidden="true" /> 03 2875 2800
                      </a>
                      <a className="driver-signup-modal__support-link" href="mailto:taixe@smartride.vn">
                        <img src={helpIcon} alt="" aria-hidden="true" /> nhinhi@gmail.com
                      </a>
                    </div>

                    <button
                      className={classNames('driver-signup-modal__cta', !isDriverSignupReady && 'is-disabled')}
                      type="button"
                      onClick={() => void handleContinueDriverSignup()}
                      disabled={!isDriverSignupReady || driverSignupSubmitting}
                    >
                      {driverSignupSubmitting
                        ? 'Đang nộp hồ sơ...'
                        : isDriverSignupReady
                          ? 'Nộp hồ sơ chờ duyệt'
                          : `Hoàn tất ${completedDriverItems}/${DRIVER_SIGNUP_ALL_ITEMS.length} để nộp`}
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {driverDetailModalOpen && activeDriverSignupItem
          ? createPortal(
              <div className="login-popup-modal driver-detail-modal" role="dialog" aria-modal="true" aria-label={`Biểu mẫu ${activeDriverSignupItem.label}`}>
                <div className="login-popup-modal__backdrop" onClick={closeDriverDetailModal} aria-hidden="true" />

                <div className="login-popup-modal__window driver-detail-modal__window">
                  <button className="login-popup-modal__close" type="button" onClick={closeDriverDetailModal} aria-label="Đóng biểu mẫu hồ sơ">
                    <img className="login-popup-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <div
                    className={classNames(
                      'login-popup-modal__tab',
                      'driver-detail-modal__tab',
                      isIdentityDriverItem && 'driver-detail-modal__tab--identity',
                    )}
                  >
                    {driverDetailTabLabel}
                  </div>

                  {isDriverPortraitTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-portrait-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverPortraitTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản sử dụng ảnh chân dung</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ điều khoản trước khi tải ảnh chân dung. Khi nhấn Xác nhận, bạn cam kết thông tin là trung thực.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản ảnh chân dung">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_PORTRAIT_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverPortraitTermsAccepted}
                          onChange={(event) => setDriverPortraitTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản ảnh chân dung.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverIdentityTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-identity-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverIdentityTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản CMND/CCCD/Hộ chiếu</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ điều khoản xác thực giấy tờ trước khi tải ảnh. Khi nhấn Xác nhận, bạn cam kết thông tin là đúng sự thật.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản giấy tờ tùy thân">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_IDENTITY_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverIdentityTermsAccepted}
                          onChange={(event) => setDriverIdentityTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản CMND/CCCD/Hộ chiếu.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverLicenseTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-license-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverLicenseTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản bằng lái xe</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ điều khoản xác thực bằng lái trước khi tải ảnh. Khi nhấn Xác nhận, bạn cam kết thông tin là đúng sự thật.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản bằng lái xe">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_LICENSE_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverLicenseTermsAccepted}
                          onChange={(event) => setDriverLicenseTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản bằng lái xe.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverBackgroundTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-background-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverBackgroundTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản lý lịch tư pháp</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ điều khoản xác thực lý lịch tư pháp trước khi tải ảnh. Khi nhấn Xác nhận, bạn cam kết thông tin là đúng sự thật.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản lý lịch tư pháp">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_BACKGROUND_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverBackgroundTermsAccepted}
                          onChange={(event) => setDriverBackgroundTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản lý lịch tư pháp.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverEmergencyTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-emergency-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverEmergencyTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản liên hệ khẩn cấp</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ điều khoản trước khi điền người liên hệ khẩn cấp. Khi nhấn Xác nhận, bạn cam kết thông tin là đúng sự thật.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản liên hệ khẩn cấp">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_EMERGENCY_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverEmergencyTermsAccepted}
                          onChange={(event) => setDriverEmergencyTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản liên hệ khẩn cấp.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverResidenceTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-residence-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverResidenceTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản địa chỉ tạm trú</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng xác nhận địa chỉ tạm trú thực tế. Địa chỉ này dùng để nhận thư từ, bưu phẩm, đồng phục nên cần chính xác tuyệt đối.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản địa chỉ tạm trú">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_RESIDENCE_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverResidenceTermsAccepted}
                          onChange={(event) => setDriverResidenceTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản địa chỉ tạm trú.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverBankTermsStep ? (
                    <form
                      className="driver-signup-modal__detail-form driver-bank-modal__terms-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleDriverBankTermsConfirm();
                      }}
                    >
                      <h4 className="driver-signup-modal__detail-title">Điều khoản tài khoản ngân hàng</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng cung cấp đúng thông tin tài khoản ngân hàng để hệ thống đối soát thanh toán cho Tài xế.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Điều khoản tài khoản ngân hàng">
                        <ol className="driver-portrait-modal__terms-list">
                          {DRIVER_BANK_TERMS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverBankTermsAccepted}
                          onChange={(event) => setDriverBankTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ điều khoản tài khoản ngân hàng.</span>
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận
                      </button>
                    </form>
                  ) : isDriverPortraitFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-portrait-modal__upload-form" onSubmit={handleDriverPortraitSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <div className="driver-signup-modal__detail-field">
                        <span>Chèn hoặc thay đổi ảnh chân dung</span>
                        <input
                          id="driver-portrait-file-input"
                          className="driver-portrait-modal__file-input"
                          type="file"
                          accept="image/*"
                          onChange={handleDriverPortraitFileChange}
                        />

                        <label
                          className={classNames('driver-portrait-modal__frame', activeDriverPortraitPreview && 'has-image')}
                          htmlFor="driver-portrait-file-input"
                        >
                          {activeDriverPortraitPreview ? (
                            <img src={activeDriverPortraitPreview} alt="Ảnh chân dung xem trước" />
                          ) : (
                            <span className="driver-portrait-modal__frame-placeholder">Chọn ảnh</span>
                          )}

                          <span className="driver-portrait-modal__frame-hint">
                            {activeDriverPortraitPreview ? 'Nhấn vào khung để thay đổi ảnh' : 'Nhấn vào khung để tải ảnh chân dung'}
                          </span>
                        </label>

                        {activeDriverSignupDraft.portraitFileName || activeDriverSignupDraft.requiredInfo ? (
                          <p className="driver-portrait-modal__file-name">
                            {activeDriverSignupDraft.portraitFileName || activeDriverSignupDraft.requiredInfo}
                          </p>
                        ) : null}
                      </div>

                      <label className="driver-signup-modal__detail-field">
                        <span>Ghi chú ảnh (tùy chọn)</span>
                        <textarea
                          className="driver-signup-modal__detail-textarea"
                          value={activeDriverSignupDraft.extraInfo}
                          onChange={(event) => handleDriverDraftChange('extraInfo', event.target.value)}
                          placeholder="Ví dụ: ảnh chụp tại nhà, đủ sáng, rõ mặt"
                        />
                      </label>

                      <section className="driver-portrait-modal__guide" aria-label="Hướng dẫn chụp ảnh">
                        <h5>Hướng dẫn chụp</h5>
                        <ul>
                          {DRIVER_PORTRAIT_CAPTURE_GUIDES.map((guideItem) => (
                            <li key={guideItem}>{guideItem}</li>
                          ))}
                        </ul>
                      </section>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverIdentityFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-identity-modal__upload-form" onSubmit={handleDriverIdentitySubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <label className="driver-signup-modal__detail-field">
                        <span>Số CMND/CCCD/Hộ chiếu</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          value={activeDriverIdentityNumber}
                          onChange={(event) => handleDriverIdentityNumberChange(event.target.value)}
                          placeholder="Nhập số CMND/CCCD/Hộ chiếu"
                          maxLength={12}
                        />
                      </label>

                      <div className="driver-identity-modal__frames">
                        <div className="driver-signup-modal__detail-field">
                          <span>Ảnh mặt trước giấy tờ</span>
                          <input
                            id="driver-identity-front-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverIdentityFileChange('front', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverIdentityFrontPreview && 'has-image')}
                            htmlFor="driver-identity-front-file-input"
                          >
                            {activeDriverIdentityFrontPreview ? (
                              <img src={activeDriverIdentityFrontPreview} alt="Ảnh mặt trước giấy tờ" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh mặt trước</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">Nhấn vào khung để tải hoặc đổi ảnh mặt trước</span>
                          </label>

                          {activeDriverSignupDraft.identityFrontFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.identityFrontFileName}</p>
                          ) : null}
                        </div>

                        <div className="driver-signup-modal__detail-field">
                          <span>Ảnh mặt sau giấy tờ</span>
                          <input
                            id="driver-identity-back-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverIdentityFileChange('back', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverIdentityBackPreview && 'has-image')}
                            htmlFor="driver-identity-back-file-input"
                          >
                            {activeDriverIdentityBackPreview ? (
                              <img src={activeDriverIdentityBackPreview} alt="Ảnh mặt sau giấy tờ" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh mặt sau</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">Nhấn vào khung để tải hoặc đổi ảnh mặt sau</span>
                          </label>

                          {activeDriverSignupDraft.identityBackFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.identityBackFileName}</p>
                          ) : null}
                        </div>
                      </div>

                      <label className="driver-signup-modal__detail-field">
                        <span>Ghi chú giấy tờ (tùy chọn)</span>
                        <textarea
                          className="driver-signup-modal__detail-textarea"
                          value={activeDriverSignupDraft.extraInfo}
                          onChange={(event) => handleDriverDraftChange('extraInfo', event.target.value)}
                          placeholder="Ví dụ: CCCD gắn chip, ảnh chụp trong phòng đủ sáng"
                        />
                      </label>

                      <section className="driver-identity-modal__guide" aria-label="Hướng dẫn chụp giấy tờ tùy thân">
                        <h5>Hướng dẫn chụp giấy tờ</h5>
                        <ul>
                          {DRIVER_IDENTITY_CAPTURE_GUIDES.map((guideItem) => (
                            <li key={guideItem}>{guideItem}</li>
                          ))}
                        </ul>
                      </section>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverLicenseFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-license-modal__upload-form" onSubmit={handleDriverLicenseSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <div className="driver-identity-modal__frames">
                        <div className="driver-signup-modal__detail-field">
                          <span>Ảnh mặt trước bằng lái</span>
                          <input
                            id="driver-license-front-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverLicenseFileChange('front', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverLicenseFrontPreview && 'has-image')}
                            htmlFor="driver-license-front-file-input"
                          >
                            {activeDriverLicenseFrontPreview ? (
                              <img src={activeDriverLicenseFrontPreview} alt="Ảnh mặt trước bằng lái" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh mặt trước</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">Nhấn vào khung để tải hoặc đổi ảnh mặt trước</span>
                          </label>

                          {activeDriverSignupDraft.licenseFrontFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.licenseFrontFileName}</p>
                          ) : null}
                        </div>

                        <div className="driver-signup-modal__detail-field">
                          <span>Ảnh mặt sau bằng lái</span>
                          <input
                            id="driver-license-back-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverLicenseFileChange('back', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverLicenseBackPreview && 'has-image')}
                            htmlFor="driver-license-back-file-input"
                          >
                            {activeDriverLicenseBackPreview ? (
                              <img src={activeDriverLicenseBackPreview} alt="Ảnh mặt sau bằng lái" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh mặt sau</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">Nhấn vào khung để tải hoặc đổi ảnh mặt sau</span>
                          </label>

                          {activeDriverSignupDraft.licenseBackFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.licenseBackFileName}</p>
                          ) : null}
                        </div>
                      </div>

                      <label className="driver-signup-modal__detail-field">
                        <span>Ghi chú bằng lái (tùy chọn)</span>
                        <textarea
                          className="driver-signup-modal__detail-textarea"
                          value={activeDriverSignupDraft.extraInfo}
                          onChange={(event) => handleDriverDraftChange('extraInfo', event.target.value)}
                          placeholder="Ví dụ: bằng A1 còn hiệu lực đến 2030"
                        />
                      </label>

                      <section className="driver-identity-modal__guide" aria-label="Hướng dẫn chụp bằng lái xe">
                        <h5>Hướng dẫn chụp bằng lái</h5>
                        <ul>
                          {DRIVER_LICENSE_CAPTURE_GUIDES.map((guideItem) => (
                            <li key={guideItem}>{guideItem}</li>
                          ))}
                        </ul>
                      </section>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverBackgroundFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-background-modal__upload-form" onSubmit={handleDriverBackgroundSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <div className="driver-signup-modal__detail-field">
                        <span>Ảnh lý lịch tư pháp (chiều dọc)</span>
                        <input
                          id="driver-background-file-input"
                          className="driver-background-modal__file-input"
                          type="file"
                          accept="image/*"
                          onChange={handleDriverBackgroundFileChange}
                        />

                        <label
                          className={classNames('driver-background-modal__frame', activeDriverBackgroundPreview && 'has-image')}
                          htmlFor="driver-background-file-input"
                        >
                          {activeDriverBackgroundPreview ? (
                            <img src={activeDriverBackgroundPreview} alt="Ảnh lý lịch tư pháp xem trước" />
                          ) : (
                            <span className="driver-background-modal__frame-placeholder">Chọn ảnh chiều dọc</span>
                          )}

                          <span className="driver-background-modal__frame-hint">
                            {activeDriverBackgroundPreview
                              ? 'Nhấn vào khung để thay đổi ảnh'
                              : 'Nhấn vào khung để tải ảnh lý lịch tư pháp'}
                          </span>
                        </label>

                        {activeDriverSignupDraft.backgroundFileName || activeDriverSignupDraft.requiredInfo ? (
                          <p className="driver-background-modal__file-name">
                            {activeDriverSignupDraft.backgroundFileName || activeDriverSignupDraft.requiredInfo}
                          </p>
                        ) : null}
                      </div>

                      <label className="driver-signup-modal__detail-field">
                        <span>Ghi chú lý lịch tư pháp (tùy chọn)</span>
                        <textarea
                          className="driver-signup-modal__detail-textarea"
                          value={activeDriverSignupDraft.extraInfo}
                          onChange={(event) => handleDriverDraftChange('extraInfo', event.target.value)}
                          placeholder="Ví dụ: phiếu số 1, cấp trong 3 tháng gần nhất"
                        />
                      </label>

                      <section className="driver-background-modal__guide" aria-label="Hướng dẫn chụp lý lịch tư pháp">
                        <h5>Hướng dẫn chụp lý lịch tư pháp</h5>
                        <ul>
                          {DRIVER_BACKGROUND_CAPTURE_GUIDES.map((guideItem) => (
                            <li key={guideItem}>{guideItem}</li>
                          ))}
                        </ul>
                      </section>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverEmergencyFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-emergency-modal__form" onSubmit={handleDriverEmergencySubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <label className="driver-signup-modal__detail-field">
                        <span>Quan hệ với Tài xế</span>
                        <div className="driver-bank-modal__combobox driver-emergency-modal__combobox">
                          <input
                            className="driver-signup-modal__detail-input"
                            type="text"
                            value={activeDriverEmergencyRelationship}
                            onFocus={() => setDriverEmergencyRelationshipDropdownOpen(true)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setDriverEmergencyRelationshipDropdownOpen(false);
                              }, 120);
                            }}
                            onChange={(event) => handleDriverEmergencyFieldChange('relationship', event.target.value)}
                            placeholder="Ví dụ: Cha, Mẹ, Ông, Bà..."
                          />

                          {driverEmergencyRelationshipDropdownOpen ? (
                            <div
                              className="driver-bank-modal__dropdown driver-bank-modal__dropdown--relationship"
                              role="listbox"
                              aria-label="Danh sách quan hệ với tài xế"
                            >
                              {activeDriverFilteredEmergencyRelationshipOptions.length > 0 ? (
                                activeDriverFilteredEmergencyRelationshipOptions.map((suggestionItem, index) => (
                                  <button
                                    key={suggestionItem}
                                    className={classNames(
                                      'driver-bank-modal__dropdown-option',
                                      normalizeSearchKeyword(suggestionItem) === normalizeSearchKeyword(activeDriverEmergencyRelationship) &&
                                        'is-selected',
                                    )}
                                    style={{ '--item-order': index }}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                    }}
                                    onClick={() => handleDriverEmergencyRelationshipOptionSelect(suggestionItem)}
                                  >
                                    {suggestionItem}
                                  </button>
                                ))
                              ) : (
                                <p className="driver-bank-modal__dropdown-empty">Không tìm thấy quan hệ phù hợp.</p>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <small className="driver-emergency-modal__hint">Chọn từ gợi ý hoặc nhập quan hệ khác.</small>
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Họ và Tên</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverEmergencyFullName}
                          onChange={(event) => handleDriverEmergencyFieldChange('fullName', event.target.value)}
                          placeholder="Nhập họ và tên người liên hệ khẩn cấp"
                        />
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Số Điện Thoại</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="tel"
                          value={activeDriverEmergencyPhone}
                          onChange={(event) => handleDriverEmergencyFieldChange('phone', event.target.value)}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={15}
                          placeholder="Nhập số điện thoại liên hệ khẩn cấp"
                        />
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Địa chỉ</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverEmergencyAddress}
                          onChange={(event) => handleDriverEmergencyFieldChange('address', event.target.value)}
                          placeholder="Nhập địa chỉ người liên hệ khẩn cấp"
                        />
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverResidenceFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-residence-modal__form" onSubmit={handleDriverResidenceSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <p className="driver-residence-modal__notice">
                        Lưu ý: Đây là địa chỉ dùng để nhận thư từ, bưu phẩm và đồng phục từ SmartRide. Vui lòng nhập đúng địa chỉ thật.
                      </p>

                      <label className="driver-signup-modal__detail-field">
                        <span>Chế độ nhập địa chỉ</span>

                        <div className="driver-residence-modal__mode-group" role="group" aria-label="Chế độ nhập địa chỉ tạm trú">
                          <label className="driver-residence-modal__mode-item">
                            <input
                              type="radio"
                              name="driver-residence-mode"
                              checked={activeDriverResidenceMode !== 'manual'}
                              onChange={() => handleDriverResidenceFieldChange('mode', 'droplist')}
                            />
                            <span>Chọn theo danh sách</span>
                          </label>

                          <label className="driver-residence-modal__mode-item">
                            <input
                              type="radio"
                              name="driver-residence-mode"
                              checked={activeDriverResidenceMode === 'manual'}
                              onChange={() => handleDriverResidenceFieldChange('mode', 'manual')}
                            />
                            <span>Nhập địa chỉ một dòng</span>
                          </label>
                        </div>
                      </label>

                      {activeDriverResidenceMode === 'manual' ? (
                        <label className="driver-signup-modal__detail-field">
                          <span>Địa chỉ một dòng</span>
                          <input
                            className="driver-signup-modal__detail-input"
                            type="text"
                            value={activeDriverResidenceManualAddress}
                            onChange={(event) => handleDriverResidenceFieldChange('manualAddress', event.target.value)}
                            placeholder="Ví dụ: 12 Nguyễn Văn Linh, Hải Châu 1, Hải Châu, Đà Nẵng"
                          />
                        </label>
                      ) : (
                        <>
                          <label className="driver-signup-modal__detail-field">
                            <span>Tỉnh / Thành phố</span>
                            <select
                              className="driver-signup-modal__detail-input"
                              value={activeDriverResidenceProvince}
                              onChange={(event) => handleDriverResidenceFieldChange('province', event.target.value)}
                            >
                              <option value="">Chọn Tỉnh / Thành phố</option>
                              {DRIVER_RESIDENCE_ADDRESS_OPTIONS.map((provinceOption) => (
                                <option key={provinceOption.province} value={provinceOption.province}>
                                  {provinceOption.province}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="driver-signup-modal__detail-field">
                            <span>Quận / Huyện</span>
                            <select
                              className="driver-signup-modal__detail-input"
                              value={activeDriverResidenceDistrict}
                              onChange={(event) => handleDriverResidenceFieldChange('district', event.target.value)}
                              disabled={!activeDriverResidenceProvince}
                            >
                              <option value="">Chọn Quận / Huyện</option>
                              {activeDriverResidenceDistrictOptions.map((districtOption) => (
                                <option key={districtOption.district} value={districtOption.district}>
                                  {districtOption.district}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="driver-signup-modal__detail-field">
                            <span>Phường / Xã</span>
                            <select
                              className="driver-signup-modal__detail-input"
                              value={activeDriverResidenceWard}
                              onChange={(event) => handleDriverResidenceFieldChange('ward', event.target.value)}
                              disabled={!activeDriverResidenceDistrict}
                            >
                              <option value="">Chọn Phường / Xã</option>
                              {activeDriverResidenceWardOptions.map((wardOption) => (
                                <option key={wardOption} value={wardOption}>
                                  {wardOption}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="driver-signup-modal__detail-field">
                            <span>Số nhà, tên đường</span>
                            <input
                              className="driver-signup-modal__detail-input"
                              type="text"
                              value={activeDriverResidenceHouseNumber}
                              onChange={(event) => handleDriverResidenceFieldChange('houseNumber', event.target.value)}
                              placeholder="Ví dụ: 12 Nguyễn Văn Linh"
                            />
                          </label>
                        </>
                      )}

                      {activeDriverResidenceDisplayAddress ? (
                        <p className="driver-residence-modal__preview">Địa chỉ xem trước: {activeDriverResidenceDisplayAddress}</p>
                      ) : null}

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverBankFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-bank-modal__form" onSubmit={handleDriverBankSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <p className="driver-bank-modal__notice">
                        Lưu ý: Thu nhập từ các chuyến xe hoàn tất sẽ được đối soát và chuyển về tài khoản ngân hàng này.
                      </p>

                      <label className="driver-signup-modal__detail-field">
                        <span>Họ và tên chủ thẻ (không dấu)</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverBankHolderName}
                          onChange={(event) => handleDriverBankFieldChange('holderName', event.target.value)}
                          placeholder="Ví dụ: NGUYEN VAN A"
                        />
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Ngân hàng</span>
                        <div className="driver-bank-modal__combobox">
                          <input
                            className="driver-signup-modal__detail-input"
                            type="text"
                            value={activeDriverBankName}
                            onFocus={() => setDriverBankDropdownOpen(true)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setDriverBankDropdownOpen(false);
                              }, 120);
                            }}
                            onChange={(event) => handleDriverBankFieldChange('bankName', event.target.value)}
                            placeholder="Gõ để tìm hoặc chọn ngân hàng"
                          />

                          {driverBankDropdownOpen ? (
                            <div className="driver-bank-modal__dropdown" role="listbox" aria-label="Danh sách ngân hàng">
                              {activeDriverFilteredBankOptions.length > 0 ? (
                                activeDriverFilteredBankOptions.map((bankOption, index) => (
                                  <button
                                    key={bankOption}
                                    className={classNames(
                                      'driver-bank-modal__dropdown-option',
                                      normalizeSearchKeyword(bankOption) === normalizeSearchKeyword(activeDriverBankName) &&
                                        'is-selected',
                                    )}
                                    style={{ '--item-order': index }}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                    }}
                                    onClick={() => handleDriverBankOptionSelect(bankOption)}
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

                      <label className="driver-signup-modal__detail-field">
                        <span>Số tài khoản</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          inputMode="numeric"
                          value={activeDriverBankAccountNumber}
                          onChange={(event) => handleDriverBankFieldChange('accountNumber', event.target.value)}
                          placeholder="Nhập số tài khoản ngân hàng"
                        />
                      </label>

                      {activeDriverBankPreview ? (
                        <p className="driver-residence-modal__preview">Thông tin xem trước: {activeDriverBankPreview}</p>
                      ) : null}

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverVehicleFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-vehicle-modal__upload-form" onSubmit={handleDriverVehicleSubmit}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <p className="driver-portrait-modal__lead">
                        Tải đủ 3 ảnh xe ở góc trước, ngang và sau. Mỗi ảnh phải rõ nét và thấy toàn bộ xe trong khung hình.
                      </p>

                      <div className="driver-vehicle-modal__frames">
                        <div className="driver-signup-modal__detail-field">
                          <span>Hình xe - Góc trước (thấy toàn bộ xe)</span>
                          <input
                            id="driver-vehicle-front-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverVehicleFileChange('front', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverVehicleFrontPreview && 'has-image')}
                            htmlFor="driver-vehicle-front-file-input"
                          >
                            {activeDriverVehicleFrontPreview ? (
                              <img src={activeDriverVehicleFrontPreview} alt="Ảnh xe góc trước" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh góc trước</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">
                              {activeDriverVehicleFrontPreview
                                ? 'Nhấn vào khung để thay đổi ảnh góc trước'
                                : 'Ảnh cần thấy toàn bộ phần trước của xe'}
                            </span>
                          </label>

                          {activeDriverSignupDraft.vehicleFrontFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.vehicleFrontFileName}</p>
                          ) : null}
                        </div>

                        <div className="driver-signup-modal__detail-field">
                          <span>Hình xe - Góc ngang (thấy toàn bộ xe)</span>
                          <input
                            id="driver-vehicle-side-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverVehicleFileChange('side', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverVehicleSidePreview && 'has-image')}
                            htmlFor="driver-vehicle-side-file-input"
                          >
                            {activeDriverVehicleSidePreview ? (
                              <img src={activeDriverVehicleSidePreview} alt="Ảnh xe góc ngang" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh góc ngang</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">
                              {activeDriverVehicleSidePreview
                                ? 'Nhấn vào khung để thay đổi ảnh góc ngang'
                                : 'Ảnh cần thấy toàn bộ phần thân xe'}
                            </span>
                          </label>

                          {activeDriverSignupDraft.vehicleSideFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.vehicleSideFileName}</p>
                          ) : null}
                        </div>

                        <div className="driver-signup-modal__detail-field">
                          <span>Hình xe - Góc sau (thấy toàn bộ xe)</span>
                          <input
                            id="driver-vehicle-rear-file-input"
                            className="driver-identity-modal__file-input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleDriverVehicleFileChange('rear', event)}
                          />

                          <label
                            className={classNames('driver-identity-modal__frame', activeDriverVehicleRearPreview && 'has-image')}
                            htmlFor="driver-vehicle-rear-file-input"
                          >
                            {activeDriverVehicleRearPreview ? (
                              <img src={activeDriverVehicleRearPreview} alt="Ảnh xe góc sau" />
                            ) : (
                              <span className="driver-identity-modal__frame-placeholder">Chọn ảnh góc sau</span>
                            )}

                            <span className="driver-identity-modal__frame-hint">
                              {activeDriverVehicleRearPreview
                                ? 'Nhấn vào khung để thay đổi ảnh góc sau'
                                : 'Ảnh cần thấy toàn bộ phần sau của xe'}
                            </span>
                          </label>

                          {activeDriverSignupDraft.vehicleRearFileName ? (
                            <p className="driver-identity-modal__file-name">{activeDriverSignupDraft.vehicleRearFileName}</p>
                          ) : null}
                        </div>
                      </div>

                      <label className="driver-signup-modal__detail-field">
                        <span>Biển số xe</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverVehicleLicensePlate}
                          onChange={(event) => handleDriverVehicleFieldChange('vehicleLicensePlate', event.target.value)}
                          placeholder="Ví dụ: 43A-12345"
                        />
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Tên xe</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverVehicleName}
                          onChange={(event) => handleDriverVehicleFieldChange('vehicleName', event.target.value)}
                          placeholder="Ví dụ: HONDA WAVE ALPHA"
                        />
                      </label>

                      {activeDriverVehicleLicensePlate || activeDriverVehicleName ? (
                        <p className="driver-residence-modal__preview">
                          Thông tin xem trước: {[activeDriverVehicleLicensePlate, activeDriverVehicleName].filter(Boolean).join(' | ')}
                        </p>
                      ) : null}

                      <section className="driver-identity-modal__guide" aria-label="Yêu cầu ảnh thông tin xe">
                        <h5>Yêu cầu ảnh thông tin xe</h5>
                        <ul>
                          {DRIVER_VEHICLE_CAPTURE_GUIDES.map((guideItem) => (
                            <li key={guideItem}>{guideItem}</li>
                          ))}
                        </ul>
                      </section>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverServiceTermsFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-legal-modal__form" onSubmit={handleDriverServiceTermsSubmit}>
                      <h4 className="driver-signup-modal__detail-title">Điều khoản dịch vụ dành cho Đối tác Tài xế</h4>

                      <p className="driver-portrait-modal__lead">
                        Vui lòng đọc kỹ toàn bộ điều khoản trước khi ký xác nhận. Việc ký xác nhận đồng nghĩa bạn hiểu rõ quyền lợi,
                        nghĩa vụ và chính sách đối soát thu nhập của SmartRide.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Lợi ích khi tham gia SmartRide">
                        <h5 className="driver-legal-modal__section-title">Lợi ích khi trở thành Đối tác Tài xế</h5>
                        <ul className="driver-legal-modal__list">
                          {DRIVER_SERVICE_TERMS_BENEFITS.map((benefitItem) => (
                            <li key={benefitItem}>{benefitItem}</li>
                          ))}
                        </ul>
                      </section>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Yêu cầu và điều khoản bắt buộc">
                        <h5 className="driver-legal-modal__section-title">Yêu cầu và điều khoản bắt buộc</h5>
                        <ol className="driver-legal-modal__list is-ordered">
                          {DRIVER_SERVICE_TERMS_REQUIREMENTS.map((termItem) => (
                            <li key={termItem}>{termItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverServiceTermsAccepted}
                          onChange={(event) => setDriverServiceTermsAccepted(event.target.checked)}
                        />
                        <span>Tôi đã đọc, hiểu và đồng ý toàn bộ Điều khoản dịch vụ đối tác tài xế SmartRide.</span>
                      </label>

                      <section className="driver-signature-pad" aria-label="Chữ ký xác nhận điều khoản dịch vụ">
                        <h5>Chữ ký xác nhận</h5>
                        <p className="driver-signature-pad__helper">Dùng chuột ký vào khung bên dưới để hoàn tất xác nhận.</p>

                        <canvas
                          ref={driverServiceTermsSignatureCanvasRef}
                          className="driver-signature-pad__canvas"
                          width={560}
                          height={170}
                          onMouseDown={handleServiceTermsSignatureMouseDown}
                          onMouseMove={handleServiceTermsSignatureMouseMove}
                          onMouseUp={handleServiceTermsSignatureMouseUp}
                          onMouseLeave={handleServiceTermsSignatureMouseUp}
                        />

                        <div className="driver-signature-pad__actions">
                          <button
                            className="driver-signature-pad__clear"
                            type="button"
                            onClick={handleServiceTermsSignatureClear}
                          >
                            Xóa chữ ký
                          </button>
                        </div>
                      </section>

                      <label className="driver-signup-modal__detail-field">
                        <span>Họ tên người ký (theo hồ sơ đăng ký)</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverServiceTermsSignerName}
                          readOnly
                        />
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : isDriverCommitmentFormStep ? (
                    <form className="driver-signup-modal__detail-form driver-legal-modal__form" onSubmit={handleDriverCommitmentSubmit}>
                      <h4 className="driver-signup-modal__detail-title">Cam kết Đối tác Tài xế SmartRide</h4>

                      <p className="driver-portrait-modal__lead">
                        Bản cam kết giúp bảo đảm chất lượng phục vụ và quyền lợi đối tác trên nền tảng. Vui lòng xác nhận sau khi đã đọc kỹ toàn bộ nội dung.
                      </p>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Lợi ích khi thực hiện cam kết">
                        <h5 className="driver-legal-modal__section-title">Lợi ích khi thực hiện cam kết đầy đủ</h5>
                        <ul className="driver-legal-modal__list">
                          {DRIVER_COMMITMENT_BENEFITS.map((benefitItem) => (
                            <li key={benefitItem}>{benefitItem}</li>
                          ))}
                        </ul>
                      </section>

                      <section className="driver-portrait-modal__terms-sheet" aria-label="Nội dung cam kết đối tác tài xế">
                        <h5 className="driver-legal-modal__section-title">Nội dung cam kết bắt buộc</h5>
                        <ol className="driver-legal-modal__list is-ordered">
                          {DRIVER_COMMITMENT_CLAUSES.map((clauseItem) => (
                            <li key={clauseItem}>{clauseItem}</li>
                          ))}
                        </ol>
                      </section>

                      <label className="driver-portrait-modal__agree">
                        <input
                          type="checkbox"
                          checked={driverCommitmentAccepted}
                          onChange={(event) => setDriverCommitmentAccepted(event.target.checked)}
                        />
                        <span>
                          Tôi đồng ý bản Cam kết đối tác, bao gồm nghĩa vụ tuân thủ chất lượng dịch vụ và cơ chế chiết khấu 30% cước theo chính sách SmartRide.
                        </span>
                      </label>

                      <section className="driver-signature-pad" aria-label="Chữ ký xác nhận cam kết đối tác">
                        <h5>Chữ ký xác nhận</h5>
                        <p className="driver-signature-pad__helper">Dùng chuột ký vào khung bên dưới để hoàn tất bản cam kết.</p>

                        <canvas
                          ref={driverCommitmentSignatureCanvasRef}
                          className="driver-signature-pad__canvas"
                          width={560}
                          height={170}
                          onMouseDown={handleCommitmentSignatureMouseDown}
                          onMouseMove={handleCommitmentSignatureMouseMove}
                          onMouseUp={handleCommitmentSignatureMouseUp}
                          onMouseLeave={handleCommitmentSignatureMouseUp}
                        />

                        <div className="driver-signature-pad__actions">
                          <button
                            className="driver-signature-pad__clear"
                            type="button"
                            onClick={handleCommitmentSignatureClear}
                          >
                            Xóa chữ ký
                          </button>
                        </div>
                      </section>

                      <label className="driver-signup-modal__detail-field">
                        <span>Họ tên người ký (theo hồ sơ đăng ký)</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverCommitmentSignerName}
                          readOnly
                        />
                      </label>

                      {driverDetailStatus ? <p className="driver-signup-modal__detail-status">{driverDetailStatus}</p> : null}

                      <button className="driver-signup-modal__save" type="submit">
                        Xác nhận và nộp
                      </button>
                    </form>
                  ) : (
                    <form className="driver-signup-modal__detail-form" onSubmit={handleDriverDraftSave}>
                      <h4 className="driver-signup-modal__detail-title">{activeDriverSignupItem.label}</h4>

                      <label className="driver-signup-modal__detail-field">
                        <span>Thông tin Bắt buộc</span>
                        <input
                          className="driver-signup-modal__detail-input"
                          type="text"
                          value={activeDriverSignupDraft.requiredInfo}
                          onChange={(event) => handleDriverDraftChange('requiredInfo', event.target.value)}
                          placeholder="Nhập thông tin chính cho mục đã chọn"
                        />
                      </label>

                      <label className="driver-signup-modal__detail-field">
                        <span>Thông tin bổ sung</span>
                        <textarea
                          className="driver-signup-modal__detail-textarea"
                          value={activeDriverSignupDraft.extraInfo}
                          onChange={(event) => handleDriverDraftChange('extraInfo', event.target.value)}
                          placeholder="Thêm mô tả, ghi chú hoặc thông tin mở rộng"
                        />
                      </label>

                      <button className="driver-signup-modal__save" type="submit">
                        Lưu thông tin mục này
                      </button>
                    </form>
                  )}
                </div>
              </div>,
              document.body,
            )
          : null}

        {previewModalOpen
          ? createPortal(
              <div className="booking-preview-modal" role="dialog" aria-modal="true" aria-label="Cửa sổ giao diện đặt xe mới">
                <div className="booking-preview-modal__backdrop" onClick={closePreviewModal} aria-hidden="true" />

                <div className="booking-preview-modal__window">
                  <button className="booking-preview-modal__close" type="button" onClick={closePreviewModal} aria-label="Đóng cửa sổ">
                    <img className="booking-preview-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                  </button>

                  <section className={classNames('booking-mockup-panel', `booking-mockup-panel--${activeVehicle}`)} aria-label="Giao diện đặt xe mới">
                    <div className="booking-mockup-panel__left">
                      <div className="booking-mode-row" role="group" aria-label="Loại đặt chuyến">
                        <button className="booking-mode-button is-active" type="button">
                          <img className="booking-mode-button__icon" src={locationIcon} alt="" aria-hidden="true" />
                          Đường đi
                        </button>

                        <button
                          className={classNames('booking-mode-button', scheduleEnabled && 'is-active')}
                          type="button"
                          onClick={() => setScheduleEnabled((current) => !current)}
                        >
                          <img className="booking-mode-button__icon" src={clockIcon} alt="" aria-hidden="true" />
                          Hẹn giờ
                        </button>
                      </div>

                      <div className="booking-route-box" aria-label="Điểm đón và điểm đến">
                        <button className="booking-route-row" type="button" onClick={() => openLocationPicker('pickup')}>
                          <img className="booking-route-row__icon" src={originIcon} alt="" aria-hidden="true" />
                          <span>{mockupPickupLabel}</span>
                        </button>

                        <div className="booking-route-box__divider" />

                        <button className="booking-route-row" type="button" onClick={() => openLocationPicker('destination')}>
                          <img className="booking-route-row__icon" src={pinIcon} alt="" aria-hidden="true" />
                          <span>{mockupDestinationLabel}</span>
                        </button>
                      </div>

                      <div className="booking-payment-row" aria-label="Phương thức thanh toán">
                        <button
                          className={classNames('booking-payment-chip', bookingPaymentMethod === 'cash' && 'is-active')}
                          type="button"
                          onClick={() => handleBookingPaymentMethodSelect('cash')}
                        >
                          Tiền mặt
                        </button>
                        <button
                          className={classNames('booking-payment-chip', (bookingPaymentPanelOpen || bookingPaymentMethod !== 'cash') && 'is-active')}
                          type="button"
                          onClick={handleBookingPaymentPanelToggle}
                          aria-expanded={bookingPaymentPanelOpen}
                          aria-controls="booking-payment-panel"
                        >
                          {bookingPaymentMethod === 'cash' ? 'Khác' : selectedBookingPaymentMethod.shortLabel}
                        </button>
                        <button className="booking-payment-chip" type="button">
                          Mã giảm giá
                        </button>
                      </div>

                      {bookingPaymentPanelOpen ? (
                        <section className="booking-payment-panel" id="booking-payment-panel" aria-label="Chọn phương thức thanh toán">
                          <div className="booking-payment-panel__header">
                            <div>
                              <strong>Chọn phương thức thanh toán</strong>
                              <span>{bookingPanelPaymentMethod.description}</span>
                            </div>

                            <button className="booking-payment-panel__close" type="button" onClick={() => setBookingPaymentPanelOpen(false)}>
                              Đóng
                            </button>
                          </div>

                          <div className="booking-payment-panel__visual" data-method={bookingPanelPaymentMethod.id}>
                            <div className="booking-payment-panel__qr-card" aria-hidden="true">
                              <span>QR</span>
                            </div>

                            <div className="booking-payment-panel__visual-copy">
                              <span>{bookingPanelPaymentMethod.shortLabel}</span>
                              <p>{bookingPanelPaymentMethod.description}</p>
                            </div>
                          </div>

                          <div className="booking-payment-panel__options" role="group" aria-label="Các phương thức thanh toán">
                            {BOOKING_OTHER_PAYMENT_METHODS.map((option) => (
                              <button
                                key={option.id}
                                className={classNames('booking-payment-panel__option', bookingPaymentMethod === option.id && 'is-active')}
                                type="button"
                                onClick={() => handleBookingPaymentMethodSelect(option.id)}
                              >
                                <strong>{option.label}</strong>
                                <span>{option.description}</span>
                              </button>
                            ))}
                          </div>

                          {bookingPaymentMethod === 'wallet' ? (
                            <div className="booking-payment-panel__providers" role="group" aria-label="Chọn ví điện tử">
                              {BOOKING_WALLET_PROVIDERS.map((provider) => (
                                <button
                                  key={provider.id}
                                  className={classNames('booking-payment-panel__provider', bookingPaymentProvider === provider.id && 'is-active')}
                                  type="button"
                                  onClick={() => setBookingPaymentProvider(provider.id)}
                                >
                                  {provider.label}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          <p className="booking-payment-panel__note">Đang chọn: {bookingPanelPaymentSummary}</p>
                        </section>
                      ) : null}

                      <button
                        className="booking-primary-button"
                        type="button"
                        disabled={searchLoading || bookingLoading}
                        onClick={() => {
                          void handlePrimaryBookingAction();
                        }}
                      >
                        {searchLoading ? 'Đang tìm chuyến...' : bookingLoading ? 'Đang đặt xe...' : 'Đặt xe'}
                      </button>

                      {searchError ? <p className="booking-feedback booking-feedback--error">{searchError}</p> : null}
                      {bookingError ? <p className="booking-feedback booking-feedback--error">{bookingError}</p> : null}

                      {bookingSuccess ? (
                        <p className="booking-feedback booking-feedback--success">
                          Mã chuyến {bookingSuccess.bookingCode} - {bookingSuccess.rideTitle} ({bookingSuccess.priceFormatted})
                          {' '}- Thanh toán: {bookingSuccess.paymentSummary ?? selectedBookingPaymentSummary}
                        </p>
                      ) : null}
                    </div>

                    <div className="booking-mockup-panel__right">
                      <div className="booking-top-tabs" role="tablist" aria-label="Loại phương tiện">
                        {vehicleTabs.map((tab) => (
                          <button
                            key={tab.id}
                            className={classNames('booking-top-tab', activeVehicle === tab.id && 'is-active')}
                            type="button"
                            onClick={() => handlePreviewTabChange(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="booking-option-list">
                        {displayedRideOptions.map((item) => (
                          <button
                            key={item.id}
                            className={classNames('booking-option-card', previewSelectedRideId === item.id && 'is-selected')}
                            type="button"
                            onClick={() => setPreviewSelectedRideId(item.id)}
                          >
                            <img className="booking-option-card__icon" src={item.icon} alt="" aria-hidden="true" />

                            <div className="booking-option-card__meta">
                              <p>{item.title}</p>
                              <span>{item.subtitle ? `• ${item.subtitle}` : '• 1 chỗ'}</span>
                            </div>

                            <strong className="booking-option-card__price">{item.price}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </div>,
              document.body,
            )
          : null}
      </main>

      <DestinationPickerModal
        open={locationPicker.open}
        mode={locationPicker.mode}
        value={locationPicker.mode === 'pickup' ? route.pickup.label : route.destination.label}
        onClose={closeLocationPicker}
        onSelect={(selection) => handleLocationSelect(locationPicker.mode === 'pickup' ? 'pickup' : 'destination', selection)}
      />

      <Footer />

      {driverFeatureLockModalOpen
        ? createPortal(
            <div
              className="driver-feature-lock-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Thông báo khóa chức năng tài xế"
            >
              <div className="driver-feature-lock-modal__backdrop" onClick={closeDriverFeatureLockModal} aria-hidden="true" />

              <section className="driver-feature-lock-modal__window">
                <button
                  className="driver-feature-lock-modal__close"
                  type="button"
                  onClick={closeDriverFeatureLockModal}
                  aria-label="Đóng thông báo"
                >
                  <img className="driver-feature-lock-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
                </button>

                <h3 className="driver-feature-lock-modal__title">Chức năng Tài xế đang tạm khóa</h3>

                <p className="driver-feature-lock-modal__description">{driverFeatureLockMessage}</p>

                <p className="driver-feature-lock-modal__note">
                  Tài khoản của bạn không bị khóa. Bạn vẫn sử dụng bình thường các chức năng Khách hàng.
                </p>

                <button className="driver-feature-lock-modal__confirm" type="button" onClick={closeDriverFeatureLockModal}>
                  Đã hiểu
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}

      {miniToast
        ? createPortal(
            <div
              className={classNames(
                'mini-toast',
                miniToast.type === 'error' && 'mini-toast--error',
                miniToast.type === 'success' && 'mini-toast--success',
              )}
              role="status"
              aria-live="polite"
            >
              {miniToast.message}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
