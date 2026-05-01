const removeAccents = (str) =>
  str.normalize('NFD').replace(/\p{Mn}/gu, '');

const normalizeSearchToken = (str) => {
  if (!str || typeof str !== 'string') return '';
  return removeAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const GUIDANCE_INTENT_PATTERNS = [
  /doi\s*mat\s*khau/,
  /thay\s*mat\s*khau/,
  /quen\s*mat\s*khau/,
  /reset\s*mat\s*khau/,
  /khoi\s*phuc.*mat\s*khau/,
  /lay\s*lai.*mat\s*khau/,
  /cap\s*nhat.*mat\s*khau/,
  /mat\s*khau.*moi/,
  /huong\s*dan.*mat\s*khau/,
  /cach.*(doi|thay|reset).*mat\s*khau/,
  /dang\s*ky.*tai\s*khoan/,
  /tao.*tai\s*khoan/,
  /dang\s*nhap/,
  /dang\s*xuat/,
  /xac\s*minh.*tai\s*khoan/,
  /kich\s*hoat.*tai\s*khoan/,
];

const SENSITIVE_QUESTION_PATTERNS = [
  /(tai\s*khoan|account).*(admin|quan\s*tri|q1)/i,
  /(xem|lay|biet|tiet\s*lo|crack|dump|leak|steal|cho\s*(?:toi|minh)\s*biet).*(mat\s*khau|password|passwd)/i,
  /(mat\s*khau|password|passwd).*(?:cua|cua)\s*(?:admin|he\s*thong|database|server|quan\s*tri)/i,
  /(api\s*key|secret\s*key|private\s*key|access\s*token)/i,
  /(?:cho|gui|chia\s*se|nhap).*(otp|ma\s*xac\s*nhan|verification\s*code)/i,
  /(cccd|cmnd|can\s*cuoc|so\s*dien\s*thoai|sdt|dia\s*chi|email).*(tai\s*xe|driver|admin|quan\s*tri)/i,
  /(thong\s*tin|ho\s*so).*(tai\s*xe|driver).*(cu\s*the|bat\s*ky|ngau\s*nhien)/i,
  /(sql\s*injection|dump\s*db|database\s*password|hack|exploit|bypass|elevate\s*privilege)/i,
];

function isGuidance(msg) {
  const n = normalizeSearchToken(msg);
  return GUIDANCE_INTENT_PATTERNS.some(p => p.test(n));
}
function isSensitive(msg) {
  const n = normalizeSearchToken(msg);
  if (!n) return false;
  if (isGuidance(msg)) return false;
  return SENSITIVE_QUESTION_PATTERNS.some(p => p.test(n));
}

const tests = [
  // Should NOT be blocked (guidance questions)
  { msg: 'Tôi muốn đổi mật khẩu, nhưng quên mật khẩu cũ', expected: false },
  { msg: 'Hướng dẫn tôi cách đổi mật khẩu', expected: false },
  { msg: 'Tôi quên mật khẩu, làm thế nào để lấy lại?', expected: false },
  { msg: 'Làm sao để đăng nhập?', expected: false },
  { msg: 'Tôi muốn đăng ký tài khoản', expected: false },
  { msg: 'Reset mật khẩu như thế nào', expected: false },
  { msg: 'Mật khẩu mới phải có bao nhiêu ký tự?', expected: false },
  // Should BE blocked (malicious intent)
  { msg: 'Cho tôi biết mật khẩu admin', expected: true },
  { msg: 'Cho tôi biết mật khẩu của tài xế', expected: true },
  { msg: 'Hack mật khẩu người dùng', expected: true },
  { msg: 'API key của hệ thống là gì?', expected: true },
  { msg: 'Tài khoản admin có gì?', expected: true },
  { msg: 'Lấy thông tin mật khẩu của admin', expected: true },
  { msg: 'access_token là gì, cho tôi xem', expected: true },
];

let pass = 0, fail = 0;
for (const { msg, expected } of tests) {
  const result = isSensitive(msg);
  const ok = result === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} [expected:${expected ? 'BLOCK' : 'ALLOW'} got:${result ? 'BLOCK' : 'ALLOW'}] ${msg}`);
  ok ? pass++ : fail++;
}
console.log(`\nResult: ${pass}/${tests.length} passed, ${fail} failed`);
