import crypto from 'node:crypto';
import sql from 'mssql';
import { env } from '../config/env.js';
import { getSqlServerPool, isSqlServerConfigured } from './database.service.js';

const CHAT_MESSAGE_MAX_LENGTH = 2000;
const CHAT_HISTORY_DEFAULT_LIMIT = 80;
const CHAT_HISTORY_MAX_LIMIT = 200;
const RECENT_CONVERSATIONS_LIMIT = 10;
const ALL_CONVERSATIONS_DEFAULT_LIMIT = 80;

// Patterns that identify LEGITIMATE account management guidance questions.
// These exempt the message from sensitive detection even if it contains credential-related words.
const GUIDANCE_INTENT_PATTERNS = [
  /doi\s*mat\s*khau/,          // đổi mật khẩu
  /thay\s*mat\s*khau/,         // thay mật khẩu
  /quen\s*mat\s*khau/,         // quên mật khẩu
  /reset\s*mat\s*khau/,        // reset mật khẩu
  /khoi\s*phuc.*mat\s*khau/,   // khôi phục mật khẩu
  /lay\s*lai.*mat\s*khau/,     // lấy lại mật khẩu
  /cap\s*nhat.*mat\s*khau/,    // cập nhật mật khẩu
  /mat\s*khau.*moi/,           // mật khẩu mới
  /huong\s*dan.*mat\s*khau/,   // hướng dẫn mật khẩu
  /cach.*(doi|thay|reset).*mat\s*khau/, // cách đổi/thay/reset mật khẩu
  /dang\s*ky.*tai\s*khoan/,    // đăng ký tài khoản
  /tao.*tai\s*khoan/,          // tạo tài khoản
  /dang\s*nhap/,               // đăng nhập
  /dang\s*xuat/,               // đăng xuất
  /xac\s*minh.*tai\s*khoan/,   // xác minh tài khoản
  /kich\s*hoat.*tai\s*khoan/,  // kích hoạt tài khoản
];

// Patterns that identify genuinely SENSITIVE / malicious queries.
// Only flag when user is trying to OBTAIN, EXPOSE, or EXPLOIT credentials/data.
const SENSITIVE_QUESTION_PATTERNS = [
  // Accessing admin account or system internals
  /(tai\s*khoan|account).*(admin|quan\s*tri|q1)/i,
  // Trying to extract/view/steal a password — but NOT asking how to manage own password
  /(xem|lay|biet|tiet\s*lo|crack|dump|leak|steal|cho\s*(?:toi|minh)\s*biet).*(mat\s*khau|password|passwd)/i,
  /(mat\s*khau|password|passwd).*(?:cua|của)\s*(?:admin|he\s*thong|database|server|quan\s*tri)/i,
  // API key, secret key, private key, access token (not OTP in normal support context)
  /(api\s*key|secret\s*key|private\s*key|access\s*token)/i,
  // OTP fraud / phishing attempts
  /(?:cho|gui|chia\s*se|nhap).*(otp|ma\s*xac\s*nhan|verification\s*code)/i,
  // Driver/admin personal data extraction
  /(cccd|cmnd|can\s*cuoc|so\s*dien\s*thoai|sdt|dia\s*chi|email).*(tai\s*xe|driver|admin|quan\s*tri)/i,
  /(thong\s*tin|ho\s*so).*(tai\s*xe|driver).*(cu\s*the|bat\s*ky|ngau\s*nhien)/i,
  // Attack patterns
  /(sql\s*injection|dump\s*db|database\s*password|hack|exploit|bypass|elevate\s*privilege)/i,
];

let assistantChatSchemaPromise = null;
let lastGeminiFailureReason = '';
let geminiQuotaBlockedUntilMs = 0;
let lastGeminiRetryAfterSeconds = 0;
let lastGeminiResolvedModel = '';

function parseRetryAfterSecondsFromGeminiError(payloadOrText = '') {
  const rawText = typeof payloadOrText === 'string'
    ? payloadOrText
    : JSON.stringify(payloadOrText ?? {});

  const match = rawText.match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?)s/i);

  if (!match?.[1]) {
    return 0;
  }

  const parsedSeconds = Number(match[1]);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return 0;
  }

  return Math.ceil(parsedSeconds);
}

function buildGeminiModelCandidates() {
  const preferredModel = (normalizeText(env.geminiModel) || 'gemini-2.0-flash').replace(/^models\//i, '');
  const configuredCandidates = String(env.geminiModelCandidates ?? '')
    .split(',')
    .map((item) => normalizeText(item).replace(/^models\//i, ''))
    .filter(Boolean);

  return Array.from(new Set([
    preferredModel,
    ...configuredCandidates,
  ]));
}

const FAQ_ENTRIES = [
  {
    keywords: ['dat xe', 'goi xe', 'book xe', 'dat chuyen'],
    answer: 'Bạn mở ô tìm chuyến, chọn điểm đón và điểm đến, sau đó bấm Tìm chuyến rồi xác nhận Đặt xe. Hệ thống sẽ ghép tài xế phù hợp gần bạn.',
  },
  {
    keywords: ['gia cuoc', 'cuoc phi', 'bao nhieu tien', 'gia tien'],
    answer: 'Giá cước phụ thuộc quãng đường, loại xe, thời điểm và ưu đãi đang áp dụng. Bạn có thể xem giá ước tính ngay trên thẻ kết quả trước khi đặt chuyến.',
  },
  {
    keywords: ['huy chuyen', 'huy xe', 'cancel'],
    answer: 'Bạn mở màn hình trạng thái chuyến và chọn Hủy chuyến. Nếu chuyến đã có tài xế hoặc đang thực hiện, có thể phát sinh chính sách phí hủy theo quy định hiện hành.',
  },
  {
    keywords: ['thanh toan', 'tra tien', 'vnpay', 'tien mat'],
    answer: 'SmartRide hỗ trợ tiền mặt và thanh toán trực tuyến (ví dụ VNPay). Bạn có thể chọn phương thức thanh toán trước khi xác nhận đặt chuyến.',
  },
  {
    keywords: ['khuyen mai', 'ma giam gia', 'uu dai'],
    answer: 'Bạn có thể nhập mã ưu đãi hoặc chọn thẻ khuyến mãi trong màn hình đặt chuyến trước khi xác nhận. Hệ thống sẽ tự tính lại giá sau giảm.',
  },
  {
    keywords: ['danh gia', 'cho sao', 'phan hoi tai xe'],
    answer: 'Sau khi chuyến hoàn thành, popup Đánh giá sẽ hiển thị để bạn chấm sao và gửi nhận xét. Đánh giá sẽ được lưu vào hệ thống để cải thiện chất lượng dịch vụ.',
  },
  {
    keywords: ['lien he', 'hotro', 'cskh', 'bao loi'],
    answer: 'Bạn có thể dùng mục Hỗ trợ/Báo lỗi chuyến để gửi phản hồi chi tiết. Hệ thống sẽ lưu nội dung và đội ngũ CSKH sẽ xử lý theo mức độ ưu tiên.',
  },
  {
    keywords: ['doi mat khau', 'thay mat khau', 'quen mat khau', 'lay lai mat khau', 'reset mat khau', 'khoi phuc mat khau'],
    answer: 'Để đổi mật khẩu: vào Tài khoản → Bảo mật → Đổi mật khẩu, nhập mật khẩu hiện tại và mật khẩu mới rồi xác nhận. Nếu quên mật khẩu, chọn "Quên mật khẩu" ở màn hình đăng nhập để nhận liên kết khôi phục qua email hoặc số điện thoại đã đăng ký.',
  },
  {
    keywords: ['dang nhap', 'dang xuat', 'dang ky tai khoan', 'tao tai khoan', 'xac minh tai khoan'],
    answer: 'Để đăng nhập vào SmartRide, nhập email hoặc số điện thoại cùng mật khẩu. Nếu chưa có tài khoản, chọn Đăng ký và điền thông tin. Để đăng xuất, vào Tài khoản → Đăng xuất.',
  },
  {
    keywords: ['loai xe', 'xe may', 'xe tai', 'oto', 'lien tinh', 'ghep tuyen', 'loai chuyen'],
    answer: 'SmartRide hỗ trợ nhiều loại chuyến: xe máy, ô tô, xe ghép, và tuyến liên tỉnh. Bạn chọn loại xe phù hợp ngay trong màn hình đặt chuyến trước khi xác nhận.',
  },
  {
    keywords: ['tai xe bi', 'tai xe khong den', 'tai xe huy', 'khieu nai', 'phan nan'],
    answer: 'Nếu tài xế không đến đúng giờ hoặc có vấn đề trong chuyến, bạn dùng nút Báo lỗi/Khiếu nại trong màn hình chi tiết chuyến để ghi nhận. Đội ngũ CSKH sẽ xem xét và phản hồi trong thời gian sớm nhất.',
  },
];

const BOOKING_GUIDE_STEPS = [
  {
    id: 1,
    title: 'Nhập điểm đón và điểm đến',
    instruction: 'Mở ô tìm chuyến, nhập điểm đón và điểm đến thật cụ thể để hệ thống ước tính lộ trình và giá.',
  },
  {
    id: 2,
    title: 'Chọn loại xe',
    instruction: 'Chọn nhóm xe phù hợp nhu cầu như Xe máy, Ô tô hoặc Xe liên tỉnh.',
  },
  {
    id: 3,
    title: 'Chọn hạng xe',
    instruction: 'Trong nhóm xe đã chọn, chọn hạng xe như tiết kiệm, vip hoặc plus theo ngân sách.',
  },
  {
    id: 4,
    title: 'Chọn phương thức thanh toán',
    instruction: 'Chọn thanh toán tiền mặt hoặc online trước khi xác nhận chuyến.',
  },
  {
    id: 5,
    title: 'Chọn mã giảm giá',
    instruction: 'Nếu có mã ưu đãi, áp dụng ở bước này để hệ thống cập nhật giá cuối cùng.',
  },
  {
    id: 6,
    title: 'Xác nhận đặt xe',
    instruction: 'Kiểm tra lại thông tin chuyến rồi bấm Đặt xe để gửi yêu cầu tới tài xế.',
  },
];

const BOOKING_STEP_HINTS = [
  { stepId: 1, patterns: [/diem\s*don/, /diem\s*den/, /dia\s*chi\s*don/, /dia\s*chi\s*den/, /nhap\s*tuyen/] },
  { stepId: 2, patterns: [/chon\s*loai\s*xe/, /xe\s*may/, /o\s*to/, /lien\s*tinh/] },
  { stepId: 3, patterns: [/chon\s*hang\s*xe/, /tiet\s*kiem/, /vip/, /plus/, /minibus/, /bus/] },
  { stepId: 4, patterns: [/thanh\s*toan/, /tien\s*mat/, /online/, /vnpay/] },
  { stepId: 5, patterns: [/ma\s*giam/, /khuyen\s*mai/, /uu\s*dai/, /voucher/] },
  { stepId: 6, patterns: [/xac\s*nhan\s*dat\s*xe/, /dat\s*xe\s*ngay/, /gui\s*yeu\s*cau\s*xe/] },
];

function createValidationError(message, details = undefined) {
  const error = new Error(message);
  error.statusCode = 400;

  if (details) {
    error.details = details;
  }

  return error;
}

function createUnauthorizedError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function createForbiddenError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function createServerError(message) {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSearchToken(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

function normalizeRoleCode(value) {
  const normalizedValue = normalizeText(value).toUpperCase();

  if (normalizedValue === 'Q1' || normalizedValue === 'Q2' || normalizedValue === 'Q3') {
    return normalizedValue;
  }

  const roleToken = normalizeSearchToken(value);

  if (roleToken.includes('admin') || roleToken.includes('quantri')) {
    return 'Q1';
  }

  if (roleToken.includes('driver') || roleToken.includes('taixe')) {
    return 'Q3';
  }

  if (roleToken.includes('customer') || roleToken.includes('khach')) {
    return 'Q2';
  }

  return '';
}

function normalizeLimit(value, defaultLimit = CHAT_HISTORY_DEFAULT_LIMIT) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return defaultLimit;
  }

  return Math.max(1, Math.min(CHAT_HISTORY_MAX_LIMIT, Math.round(normalizedValue)));
}

function normalizeConversationScope(value) {
  const token = normalizeSearchToken(value);
  return token === 'all' || token === 'tatca' ? 'all' : 'recent';
}

function normalizeConversationKeyword(value) {
  return normalizeText(value).slice(0, 120);
}

function requireAccountId(payload = {}, message = 'Vui lòng đăng nhập để sử dụng chatbot.') {
  const accountId = normalizeText(payload?.accountId);

  if (!accountId) {
    throw createUnauthorizedError(message);
  }

  return accountId;
}

function sanitizeConversationTitle(messageText) {
  const trimmed = normalizeText(messageText);

  if (!trimmed) {
    return 'Hội thoại mới';
  }

  return trimmed.slice(0, 120);
}

function buildChatMessageResponse(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.messageId ?? 0) || 0,
    conversationId: normalizeText(row.conversationId),
    senderRole: normalizeText(row.senderRole).toLowerCase(),
    text: normalizeText(row.messageText),
    provider: normalizeText(row.provider).toLowerCase(),
    model: normalizeText(row.modelName),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
  };
}

function buildConversationResponse(row) {
  if (!row) {
    return null;
  }

  return {
    conversationId: normalizeText(row.conversationId),
    accountId: normalizeText(row.accountId),
    roleCode: normalizeText(row.roleCode),
    title: normalizeText(row.title) || 'Hội thoại mới',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
  };
}

function findFaqAnswer(messageText) {
  const messageToken = normalizeSearchToken(messageText);
  const normalizedMessageForTermMatch = ` ${messageToken
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

  if (!messageToken) {
    return '';
  }

  for (const entry of FAQ_ENTRIES) {
    if ((entry.keywords ?? []).some((keyword) => {
      const normalizedKeyword = normalizeSearchToken(keyword)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!normalizedKeyword) {
        return false;
      }

      // Phrase keywords keep partial match for natural language questions.
      if (normalizedKeyword.includes(' ')) {
        return messageToken.includes(normalizedKeyword);
      }

      // Single-word keywords must match whole words only.
      return normalizedMessageForTermMatch.includes(` ${normalizedKeyword} `);
    })) {
      return normalizeText(entry.answer);
    }
  }

  return '';
}

function buildBookingGuideOverviewAnswer() {
  return `Quy trình đặt xe trên SmartRide gồm 6 bước: ${BOOKING_GUIDE_STEPS
    .map((step) => `${step.id}) ${step.title}`)
    .join('; ')}.`;
}

function hashTextToSeed(value) {
  const token = normalizeSearchToken(value);
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) - hash) + token.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function pickVariant(items, seed) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  return items[seed % items.length];
}

function detectStepFromText(messageText) {
  const token = normalizeSearchToken(messageText);

  if (!token) {
    return 0;
  }

  const explicitStepMatch = token.match(/buoc\s*([1-6])/);

  if (explicitStepMatch?.[1]) {
    return Number(explicitStepMatch[1]);
  }

  for (const entry of BOOKING_STEP_HINTS) {
    if (entry.patterns.some((pattern) => pattern.test(token))) {
      return entry.stepId;
    }
  }

  return 0;
}

function buildBookingGuideAnswer(messageText, historyMessages = []) {
  const messageToken = normalizeSearchToken(messageText);

  if (!messageToken) {
    return '';
  }

  const bookingIntentPattern = /(dat\s*xe|goi\s*xe|book\s*xe|tim\s*chuyen|buoc\s*tiep\s*theo|roi\s*sao|huong\s*dan\s*dat\s*xe|cach\s*dat\s*xe)/;

  if (!bookingIntentPattern.test(messageToken)) {
    return '';
  }

  if (/(tong\s*quan|toan\s*bo\s*buoc|cac\s*buoc|6\s*buoc)/.test(messageToken)) {
    return buildBookingGuideOverviewAnswer();
  }

  const seed = hashTextToSeed(messageText);
  const stepFromCurrentMessage = detectStepFromText(messageText);
  const latestKnownStep = stepFromCurrentMessage || detectStepFromText(
    [...historyMessages]
      .reverse()
      .map((item) => normalizeText(item?.text ?? item?.messageText))
      .find((text) => text) || '',
  );

  const completedStepMatchers = [
    { pattern: /(da|toi\s*da|minh\s*da).*(nhap|chon).*(diem\s*don|diem\s*den|dia\s*chi)/, completedStep: 1 },
    { pattern: /(da|toi\s*da|minh\s*da).*(chon).*(loai\s*xe|xe\s*may|o\s*to|lien\s*tinh)/, completedStep: 2 },
    { pattern: /(da|toi\s*da|minh\s*da).*(chon).*(hang\s*xe|tiet\s*kiem|vip|plus|minibus|bus)/, completedStep: 3 },
    { pattern: /(da|toi\s*da|minh\s*da).*(chon).*(thanh\s*toan|tien\s*mat|online|vnpay)/, completedStep: 4 },
    { pattern: /(da|toi\s*da|minh\s*da).*(chon|nhap).*(ma\s*giam|khuyen\s*mai|uu\s*dai|voucher)/, completedStep: 5 },
  ];

  const completedMatch = completedStepMatchers.find((entry) => entry.pattern.test(messageToken));

  let targetStepId = latestKnownStep || 1;

  if (completedMatch) {
    targetStepId = Math.min(6, completedMatch.completedStep + 1);
  }

  if (/(buoc\s*tiep\s*theo|tiep\s*theo\s*la\s*gi|roi\s*sao)/.test(messageToken) && latestKnownStep > 0) {
    targetStepId = Math.min(6, latestKnownStep + 1);
  }

  const targetStep = BOOKING_GUIDE_STEPS.find((step) => step.id === targetStepId) || BOOKING_GUIDE_STEPS[0];

  if (targetStep.id >= 6 && /(xong|hoan\s*tat|xac\s*nhan|dat\s*xe\s*roi)/.test(messageToken)) {
    return 'Bạn đã ở bước cuối. Chỉ cần kiểm tra lại thông tin chuyến và bấm Đặt xe để hệ thống tìm tài xế phù hợp gần bạn.';
  }

  const intros = [
    `Bạn đang hợp lý ở bước này, tiếp theo là bước ${targetStep.id}: ${targetStep.title}.`,
    `Mình gợi ý bạn chuyển sang bước ${targetStep.id}: ${targetStep.title}.`,
    `Bước kế tiếp của bạn là bước ${targetStep.id}: ${targetStep.title}.`,
  ];

  const closings = [
    'Nếu muốn, mình có thể hướng dẫn luôn bước sau đó.',
    'Bạn làm xong bước này thì nhắn mình, mình chỉ tiếp bước kế tiếp.',
    'Nếu bạn đang phân vân lựa chọn, mình có thể gợi ý phương án nhanh nhất.',
  ];

  return `${pickVariant(intros, seed)} ${targetStep.instruction} ${pickVariant(closings, seed + 7)}`;
}

function buildFallbackAnswer(messageText = '') {
  const seed = hashTextToSeed(messageText);
  const intros = [
    'Mình đã hiểu yêu cầu của bạn.',
    'Mình nắm được câu hỏi của bạn rồi.',
    'Mình đã ghi nhận nội dung bạn vừa gửi.',
  ];
  const guidance = [
    'Bạn có thể hỏi mình về đặt xe, theo dõi chuyến, giá cước, thanh toán, khuyến mãi hoặc khiếu nại tài xế.',
    'Bạn có thể nói rõ hơn mục tiêu (ví dụ: đặt xe ngay, hỏi phí, đổi thanh toán, áp mã giảm) để mình hỗ trợ đúng trọng tâm.',
    'Bạn cứ mô tả tình huống cụ thể, mình sẽ đưa hướng dẫn theo từng bước ngay trong SmartRide.',
  ];

  return `${pickVariant(intros, seed)} ${pickVariant(guidance, seed + 3)}`;
}

function buildSensitiveRefusalAnswer() {
  return 'Xin lỗi, mình không thể cung cấp thông tin nhạy cảm hoặc dữ liệu riêng tư của hệ thống/người dùng. Nếu bạn cần hỗ trợ hợp lệ, vui lòng cung cấp mã chuyến và gửi yêu cầu qua kênh hỗ trợ chính thức trong ứng dụng.';
}

function isGuidanceQuestion(messageText) {
  const normalizedMessage = normalizeSearchToken(messageText);

  if (!normalizedMessage) {
    return false;
  }

  return GUIDANCE_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

function isSensitiveQuestion(messageText) {
  const normalizedMessage = normalizeSearchToken(messageText);

  if (!normalizedMessage) {
    return false;
  }

  // Legitimate guidance/how-to questions about account features are never sensitive.
  if (isGuidanceQuestion(messageText)) {
    return false;
  }

  return SENSITIVE_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

function buildGeminiSystemInstruction() {
  return [
    'Bạn là trợ lý AI của SmartRide.',
    'Mục tiêu: trả lời linh hoạt theo ngữ cảnh hội thoại, tự nhiên, rõ ràng, đúng ngữ cảnh website/app SmartRide.',
    'Chỉ trả lời các vấn đề liên quan SmartRide: tài khoản, đặt xe, chuyến đi, thanh toán, khuyến mãi, hỗ trợ, đánh giá.',
    'Ưu tiên hướng dẫn thao tác theo từng bước khi người dùng hỏi cách dùng tính năng trên website/app.',
    'Quy trình đặt xe mặc định gồm 6 bước: 1) Nhập điểm đón và điểm đến; 2) Chọn loại xe; 3) Chọn hạng xe; 4) Chọn phương thức thanh toán; 5) Chọn mã giảm giá; 6) Xác nhận đặt xe.',
    'Khi người dùng hỏi bước tiếp theo, hãy xác định bước hiện tại từ hội thoại rồi đưa bước kế tiếp cụ thể.',
    'Khi người dùng nhắn ngắn hoặc mơ hồ (ví dụ: "gợi ý giúp tôi", "tiếp theo sao"), phải suy luận từ ngữ cảnh hội thoại gần nhất để trả lời đúng ý định.',
    'Không trả lời rập khuôn; thay đổi cách diễn đạt phù hợp nhưng vẫn chính xác.',
    'Tuyệt đối không cung cấp thông tin nhạy cảm: tài khoản/mật khẩu admin, token, key, dữ liệu riêng tư tài xế/khách hàng, thông tin hệ thống nội bộ.',
    'Không tiết lộ thông tin tài xế cụ thể nếu không có ngữ cảnh hợp lệ từ chuyến của chính người hỏi.',
    'Nếu thiếu thông tin, yêu cầu người dùng cung cấp thêm chi tiết thay vì bịa dữ liệu.',
    'Không đưa thông tin ngoài phạm vi sản phẩm SmartRide khi không chắc chắn.',
  ].join(' ');
}

function toGeminiContents(historyMessages = []) {
  const items = [];

  for (const message of historyMessages) {
    const sender = normalizeText(message?.senderRole).toLowerCase();
    const text = normalizeText(message?.text ?? message?.messageText);

    if (!text) {
      continue;
    }

    if (sender === 'assistant') {
      items.push({ role: 'model', parts: [{ text }] });
      continue;
    }

    if (sender === 'user') {
      items.push({ role: 'user', parts: [{ text }] });
    }
  }

  return items.slice(-18);
}

async function generateGeminiAnswer(historyMessages = []) {
  lastGeminiFailureReason = '';
  lastGeminiRetryAfterSeconds = 0;
  lastGeminiResolvedModel = '';

  const apiKey = normalizeText(env.geminiApiKey);

  if (!apiKey) {
    lastGeminiFailureReason = 'missing-key';
    return '';
  }

  const now = Date.now();
  if (geminiQuotaBlockedUntilMs > now) {
    lastGeminiFailureReason = 'quota';
    lastGeminiRetryAfterSeconds = Math.max(1, Math.ceil((geminiQuotaBlockedUntilMs - now) / 1000));
    return '';
  }

  const modelCandidates = buildGeminiModelCandidates();
  const apiVersion = 'v1beta';
  const timeoutMs = Number(env.geminiTimeoutMs);
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 9000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  try {
    for (const modelName of modelCandidates) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: buildGeminiSystemInstruction() }],
            },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 500,
              topP: 0.9,
            },
            contents: toGeminiContents(historyMessages),
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const responseText = await response.text();

        if (response.status === 429) {
          const depletedCredits = /prepayment\s+credits\s+are\s+depleted|billing/i.test(responseText);

          if (depletedCredits) {
            geminiQuotaBlockedUntilMs = 0;
            lastGeminiRetryAfterSeconds = 0;
            lastGeminiFailureReason = 'billing-exhausted';
            return '';
          }

          let retryAfterSeconds = 60;

          const retryAfterHeaderValue = normalizeText(response.headers.get('retry-after'));
          const retryAfterHeaderAsNumber = Number(retryAfterHeaderValue);

          if (Number.isFinite(retryAfterHeaderAsNumber) && retryAfterHeaderAsNumber > 0) {
            retryAfterSeconds = Math.ceil(retryAfterHeaderAsNumber);
          } else {
            const retryAfterDateMs = Date.parse(retryAfterHeaderValue);
            if (Number.isFinite(retryAfterDateMs) && retryAfterDateMs > Date.now()) {
              retryAfterSeconds = Math.max(1, Math.ceil((retryAfterDateMs - Date.now()) / 1000));
            } else {
              const parsedRetryAfter = parseRetryAfterSecondsFromGeminiError(responseText);
              if (parsedRetryAfter > 0) {
                retryAfterSeconds = parsedRetryAfter;
              }
            }
          }

          geminiQuotaBlockedUntilMs = Date.now() + retryAfterSeconds * 1000;
          lastGeminiRetryAfterSeconds = retryAfterSeconds;
          lastGeminiFailureReason = 'quota';
          return '';
        }

        if (response.status === 401 || response.status === 403) {
          const invalidKey = /unregistered callers|api key|api_key|permission_denied/i.test(responseText);
          lastGeminiFailureReason = invalidKey ? 'invalid-key' : 'auth';
          continue;
        }

        if (response.status === 400 || response.status === 404) {
          const modelNotFound = /model[^\n]*not\s*found|is\s*not\s*found|unsupported\s*model/i.test(responseText);
          if (modelNotFound) {
            lastGeminiFailureReason = 'model-not-found';
            continue;
          }
        }

        if (!lastGeminiFailureReason) {
          lastGeminiFailureReason = 'http-error';
        }

        continue;
      }

      const payload = await response.json();
      const parts = payload?.candidates?.[0]?.content?.parts;

      if (!Array.isArray(parts)) {
        continue;
      }

      const answer = parts
        .map((part) => normalizeText(part?.text))
        .filter(Boolean)
        .join('\n');

      const normalizedAnswer = normalizeText(answer);

      if (normalizedAnswer) {
        geminiQuotaBlockedUntilMs = 0;
        lastGeminiFailureReason = '';
        lastGeminiRetryAfterSeconds = 0;
        lastGeminiResolvedModel = modelName;
        return normalizedAnswer;
      }
    }

    return '';
  } catch (error) {
    if (error?.name === 'AbortError') {
      lastGeminiFailureReason = 'timeout';
    } else if (!lastGeminiFailureReason) {
      lastGeminiFailureReason = 'network-error';
    }

    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureAssistantChatSchema() {
  if (!isSqlServerConfigured()) {
    throw createServerError('Thiếu cấu hình cơ sở dữ liệu để vận hành chatbot.');
  }

  if (!assistantChatSchemaPromise) {
    assistantChatSchemaPromise = (async () => {
      const pool = await getSqlServerPool();

      await pool.request().query(`
        IF OBJECT_ID(N'dbo.ChatbotConversation', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.ChatbotConversation (
            ConversationId VARCHAR(40) NOT NULL,
            AccountId VARCHAR(20) NOT NULL,
            RoleCode VARCHAR(4) NULL,
            Title NVARCHAR(200) NULL,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ChatbotConversation_CreatedAt DEFAULT SYSUTCDATETIME(),
            UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ChatbotConversation_UpdatedAt DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_ChatbotConversation PRIMARY KEY (ConversationId),
            CONSTRAINT FK_ChatbotConversation_TaiKhoan FOREIGN KEY (AccountId)
              REFERENCES dbo.TaiKhoan(MaTK)
              ON UPDATE CASCADE ON DELETE CASCADE
          );
        END;

        IF OBJECT_ID(N'dbo.ChatbotMessage', N'U') IS NULL
        BEGIN
          CREATE TABLE dbo.ChatbotMessage (
            MessageId BIGINT IDENTITY(1,1) NOT NULL,
            ConversationId VARCHAR(40) NOT NULL,
            SenderRole VARCHAR(20) NOT NULL,
            MessageText NVARCHAR(4000) NOT NULL,
            Provider VARCHAR(40) NULL,
            ModelName VARCHAR(120) NULL,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ChatbotMessage_CreatedAt DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_ChatbotMessage PRIMARY KEY (MessageId),
            CONSTRAINT FK_ChatbotMessage_Conversation FOREIGN KEY (ConversationId)
              REFERENCES dbo.ChatbotConversation(ConversationId)
              ON DELETE CASCADE
          );
        END;

        -- Add FK on ChatbotConversation → TaiKhoan if missing (table existed before FK was defined)
        IF OBJECT_ID(N'dbo.ChatbotConversation', N'U') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys
            WHERE name = N'FK_ChatbotConversation_TaiKhoan'
              AND parent_object_id = OBJECT_ID(N'dbo.ChatbotConversation')
          )
        BEGIN
          ALTER TABLE dbo.ChatbotConversation
            ADD CONSTRAINT FK_ChatbotConversation_TaiKhoan
            FOREIGN KEY (AccountId) REFERENCES dbo.TaiKhoan(MaTK)
            ON UPDATE CASCADE ON DELETE CASCADE;
        END;

        -- Add FK on ChatbotMessage → ChatbotConversation if missing
        IF OBJECT_ID(N'dbo.ChatbotMessage', N'U') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys
            WHERE name = N'FK_ChatbotMessage_Conversation'
              AND parent_object_id = OBJECT_ID(N'dbo.ChatbotMessage')
          )
        BEGIN
          ALTER TABLE dbo.ChatbotMessage
            ADD CONSTRAINT FK_ChatbotMessage_Conversation
            FOREIGN KEY (ConversationId) REFERENCES dbo.ChatbotConversation(ConversationId)
            ON DELETE CASCADE;
        END;

        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE name = N'IX_ChatbotConversation_Account_UpdatedAt'
            AND object_id = OBJECT_ID(N'dbo.ChatbotConversation')
        )
        BEGIN
          CREATE INDEX IX_ChatbotConversation_Account_UpdatedAt
          ON dbo.ChatbotConversation(AccountId, UpdatedAt DESC);
        END;

        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE name = N'IX_ChatbotMessage_Conversation_CreatedAt'
            AND object_id = OBJECT_ID(N'dbo.ChatbotMessage')
        )
        BEGIN
          CREATE INDEX IX_ChatbotMessage_Conversation_CreatedAt
          ON dbo.ChatbotMessage(ConversationId, CreatedAt ASC);
        END;
      `);
    })().catch((error) => {
      assistantChatSchemaPromise = null;
      throw error;
    });
  }

  return assistantChatSchemaPromise;
}

async function readConversationById(connection, conversationId) {
  const result = await connection
    .request()
    .input('conversationId', sql.VarChar(40), conversationId)
    .query(`
      SELECT TOP 1
        ConversationId AS conversationId,
        AccountId AS accountId,
        RoleCode AS roleCode,
        Title AS title,
        CreatedAt AS createdAt,
        UpdatedAt AS updatedAt
      FROM dbo.ChatbotConversation
      WHERE ConversationId = @conversationId;
    `);

  return result.recordset?.[0] ?? null;
}

function assertConversationAccess(conversationRow, accountId) {
  if (!conversationRow) {
    return;
  }

  const ownerAccountId = normalizeText(conversationRow.accountId).toLowerCase();
  const requesterAccountId = normalizeText(accountId).toLowerCase();

  if (!ownerAccountId || !requesterAccountId) {
    return;
  }

  if (ownerAccountId !== requesterAccountId) {
    throw createForbiddenError('Bạn không có quyền truy cập hội thoại này.');
  }
}

async function createConversation(connection, { conversationId, accountId, roleCode, title }) {
  const resolvedConversationId = normalizeText(conversationId) || crypto.randomUUID();

  const insertResult = await connection
    .request()
    .input('conversationId', sql.VarChar(40), resolvedConversationId)
    .input('accountId', sql.VarChar(20), normalizeText(accountId) || null)
    .input('roleCode', sql.VarChar(4), normalizeRoleCode(roleCode) || null)
    .input('title', sql.NVarChar(200), normalizeText(title) || 'Hội thoại mới')
    .query(`
      INSERT INTO dbo.ChatbotConversation (
        ConversationId,
        AccountId,
        RoleCode,
        Title,
        CreatedAt,
        UpdatedAt
      )
      OUTPUT
        inserted.ConversationId AS conversationId,
        inserted.AccountId AS accountId,
        inserted.RoleCode AS roleCode,
        inserted.Title AS title,
        inserted.CreatedAt AS createdAt,
        inserted.UpdatedAt AS updatedAt
      VALUES (
        @conversationId,
        @accountId,
        @roleCode,
        @title,
        SYSUTCDATETIME(),
        SYSUTCDATETIME()
      );
    `);

  return insertResult.recordset?.[0] ?? null;
}

async function findLatestConversationByAccount(connection, accountId) {
  const normalizedAccountId = normalizeText(accountId);

  if (!normalizedAccountId) {
    return null;
  }

  const result = await connection
    .request()
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .query(`
      SELECT TOP 1
        ConversationId AS conversationId,
        AccountId AS accountId,
        RoleCode AS roleCode,
        Title AS title,
        CreatedAt AS createdAt,
        UpdatedAt AS updatedAt
      FROM dbo.ChatbotConversation
      WHERE AccountId = @accountId
      ORDER BY UpdatedAt DESC, CreatedAt DESC;
    `);

  return result.recordset?.[0] ?? null;
}

async function resolveConversation(connection, { conversationId, accountId, roleCode, title, createIfMissing = true }) {
  const normalizedConversationId = normalizeText(conversationId);

  if (normalizedConversationId) {
    const existingConversation = await readConversationById(connection, normalizedConversationId);

    if (existingConversation) {
      assertConversationAccess(existingConversation, accountId);
      return existingConversation;
    }

    if (!createIfMissing) {
      return null;
    }

    return createConversation(connection, {
      conversationId: normalizedConversationId,
      accountId,
      roleCode,
      title,
    });
  }

  const latestConversation = await findLatestConversationByAccount(connection, accountId);

  if (latestConversation || !createIfMissing) {
    return latestConversation;
  }

  return createConversation(connection, {
    accountId,
    roleCode,
    title,
  });
}

async function listConversationMessages(connection, conversationId, limit = CHAT_HISTORY_DEFAULT_LIMIT) {
  const normalizedLimit = normalizeLimit(limit);

  const result = await connection
    .request()
    .input('conversationId', sql.VarChar(40), conversationId)
    .input('limit', sql.Int, normalizedLimit)
    .query(`
      SELECT *
      FROM (
        SELECT TOP (@limit)
          MessageId AS messageId,
          ConversationId AS conversationId,
          SenderRole AS senderRole,
          MessageText AS messageText,
          Provider AS provider,
          ModelName AS modelName,
          CreatedAt AS createdAt
        FROM dbo.ChatbotMessage
        WHERE ConversationId = @conversationId
        ORDER BY CreatedAt DESC, MessageId DESC
      ) AS recentMessages
      ORDER BY CreatedAt ASC, MessageId ASC;
    `);

  return (result.recordset ?? [])
    .map((row) => buildChatMessageResponse(row))
    .filter(Boolean);
}

async function listConversations(connection, {
  accountId,
  scope = 'recent',
  keyword = '',
  limit = ALL_CONVERSATIONS_DEFAULT_LIMIT,
} = {}) {
  const normalizedAccountId = normalizeText(accountId);

  if (!normalizedAccountId) {
    return [];
  }

  const normalizedScope = normalizeConversationScope(scope);
  const normalizedKeyword = normalizeConversationKeyword(keyword);
  const normalizedLimit = normalizeLimit(
    limit,
    normalizedScope === 'recent' ? RECENT_CONVERSATIONS_LIMIT : ALL_CONVERSATIONS_DEFAULT_LIMIT,
  );
  const effectiveLimit = normalizedScope === 'recent'
    ? Math.min(normalizedLimit, RECENT_CONVERSATIONS_LIMIT)
    : normalizedLimit;

  const result = await connection
    .request()
    .input('accountId', sql.VarChar(20), normalizedAccountId)
    .input('keyword', sql.NVarChar(120), normalizedKeyword || null)
    .input('limit', sql.Int, effectiveLimit)
    .query(`
      SELECT TOP (@limit)
        ConversationId AS conversationId,
        AccountId AS accountId,
        RoleCode AS roleCode,
        Title AS title,
        CreatedAt AS createdAt,
        UpdatedAt AS updatedAt
      FROM dbo.ChatbotConversation
      WHERE AccountId = @accountId
        AND (
          @keyword IS NULL
          OR LTRIM(RTRIM(@keyword)) = ''
          OR LOWER(ISNULL(Title, '')) LIKE N'%' + LOWER(@keyword) + N'%'
        )
      ORDER BY UpdatedAt DESC, CreatedAt DESC;
    `);

  return (result.recordset ?? [])
    .map((row) => buildConversationResponse(row))
    .filter(Boolean);
}

async function updateConversationTitle(connection, conversationId, title) {
  const result = await connection
    .request()
    .input('conversationId', sql.VarChar(40), conversationId)
    .input('title', sql.NVarChar(200), normalizeText(title) || 'Hội thoại mới')
    .query(`
      UPDATE dbo.ChatbotConversation
      SET
        Title = @title,
        UpdatedAt = SYSUTCDATETIME()
      OUTPUT
        inserted.ConversationId AS conversationId,
        inserted.AccountId AS accountId,
        inserted.RoleCode AS roleCode,
        inserted.Title AS title,
        inserted.CreatedAt AS createdAt,
        inserted.UpdatedAt AS updatedAt
      WHERE ConversationId = @conversationId;
    `);

  return result.recordset?.[0] ?? null;
}

async function removeConversation(connection, conversationId) {
  const result = await connection
    .request()
    .input('conversationId', sql.VarChar(40), conversationId)
    .query(`
      DELETE FROM dbo.ChatbotConversation
      OUTPUT deleted.ConversationId AS conversationId
      WHERE ConversationId = @conversationId;
    `);

  return normalizeText(result.recordset?.[0]?.conversationId);
}

async function insertConversationMessage(connection, {
  conversationId,
  senderRole,
  text,
  provider = '',
  model = '',
}) {
  const insertResult = await connection
    .request()
    .input('conversationId', sql.VarChar(40), conversationId)
    .input('senderRole', sql.VarChar(20), normalizeText(senderRole).toLowerCase() || 'user')
    .input('messageText', sql.NVarChar(4000), normalizeText(text))
    .input('provider', sql.VarChar(40), normalizeText(provider) || null)
    .input('modelName', sql.VarChar(120), normalizeText(model) || null)
    .query(`
      INSERT INTO dbo.ChatbotMessage (
        ConversationId,
        SenderRole,
        MessageText,
        Provider,
        ModelName,
        CreatedAt
      )
      OUTPUT
        inserted.MessageId AS messageId,
        inserted.ConversationId AS conversationId,
        inserted.SenderRole AS senderRole,
        inserted.MessageText AS messageText,
        inserted.Provider AS provider,
        inserted.ModelName AS modelName,
        inserted.CreatedAt AS createdAt
      VALUES (
        @conversationId,
        @senderRole,
        @messageText,
        @provider,
        @modelName,
        SYSUTCDATETIME()
      );

      UPDATE dbo.ChatbotConversation
      SET
        UpdatedAt = SYSUTCDATETIME(),
        Title = CASE
          WHEN @senderRole = 'user' AND (Title IS NULL OR LTRIM(RTRIM(Title)) = '' OR Title = N'Hội thoại mới')
            THEN LEFT(@messageText, 120)
          ELSE Title
        END
      WHERE ConversationId = @conversationId;
    `);

  return buildChatMessageResponse(insertResult.recordset?.[0] ?? null);
}

async function generateAssistantAnswer(historyMessages) {
  const latestUserMessage = [...historyMessages]
    .reverse()
    .find((item) => normalizeText(item?.senderRole).toLowerCase() === 'user');

  const userText = normalizeText(latestUserMessage?.text ?? latestUserMessage?.messageText);

  const geminiAnswer = await generateGeminiAnswer(historyMessages);

  if (geminiAnswer) {
    return {
      text: geminiAnswer,
      provider: 'gemini',
      model: lastGeminiResolvedModel || (normalizeText(env.geminiModel) || 'gemini-2.0-flash').replace(/^models\//i, ''),
    };
  }

  const bookingGuideAnswer = buildBookingGuideAnswer(userText, historyMessages);
  const faqAnswer = findFaqAnswer(userText);
  const localFallbackAnswer = bookingGuideAnswer || faqAnswer || buildFallbackAnswer(userText);

  if (localFallbackAnswer) {
    return {
      text: localFallbackAnswer,
      provider: 'local-fallback',
      model: `fallback-${lastGeminiFailureReason || 'default'}`,
    };
  }

  return {
    text: lastGeminiFailureReason === 'quota'
      ? `Xin lỗi, trợ lý AI Gemini tạm hết quota trong thời điểm này.${lastGeminiRetryAfterSeconds > 0 ? ` Vui lòng thử lại sau khoảng ${lastGeminiRetryAfterSeconds} giây.` : ' Vui lòng thử lại sau ít phút.'}`
      : lastGeminiFailureReason === 'billing-exhausted'
        ? 'Xin lỗi, tín dụng/prepay của Gemini API trong project này đã hết. Vui lòng nạp tín dụng hoặc bật billing rồi thử lại.'
      : lastGeminiFailureReason === 'invalid-key' || lastGeminiFailureReason === 'auth' || lastGeminiFailureReason === 'missing-key'
        ? 'Xin lỗi, trợ lý AI Gemini hiện chưa khả dụng do API key chưa hợp lệ hoặc chưa được cấp quyền cho Gemini API. Quản trị viên cần tạo API key mới trong Google AI Studio (hoặc bật Generative Language API đúng project) rồi cập nhật GEMINI_API_KEY.'
        : lastGeminiFailureReason === 'timeout'
          ? 'Xin lỗi, trợ lý AI Gemini phản hồi chậm ở thời điểm này. Bạn vui lòng gửi lại câu hỏi giúp mình.'
          : 'Xin lỗi, trợ lý AI Gemini hiện chưa khả dụng tạm thời. Bạn vui lòng thử lại sau ít phút.',
    provider: 'gemini',
    model: 'gemini-unavailable',
  };
}

export async function getAssistantChatHistory(payload = {}) {
  await ensureAssistantChatSchema();

  const accountId = requireAccountId(payload);
  const roleCode = normalizeRoleCode(payload?.roleCode ?? payload?.role);
  const conversationId = normalizeText(payload?.conversationId);
  const limit = normalizeLimit(payload?.limit);

  const pool = await getSqlServerPool();
  const conversation = await resolveConversation(pool, {
    conversationId,
    accountId,
    roleCode,
    createIfMissing: true,
    title: 'Hội thoại mới',
  });

  if (!conversation) {
    throw createServerError('Không thể khởi tạo hội thoại chatbot.');
  }

  const [messages, recentConversations] = await Promise.all([
    listConversationMessages(pool, normalizeText(conversation.conversationId), limit),
    listConversations(pool, { accountId, scope: 'recent', limit: RECENT_CONVERSATIONS_LIMIT }),
  ]);

  return {
    success: true,
    message: 'Lấy lịch sử chatbot thành công.',
    conversation: buildConversationResponse(conversation),
    recentConversations,
    messages,
  };
}

export async function listAssistantConversations(payload = {}) {
  await ensureAssistantChatSchema();

  const accountId = requireAccountId(payload);
  const roleCode = normalizeRoleCode(payload?.roleCode ?? payload?.role);
  const scope = normalizeConversationScope(payload?.scope ?? payload?.tab);
  const keyword = normalizeConversationKeyword(payload?.keyword ?? payload?.q);
  const limit = normalizeLimit(payload?.limit, scope === 'recent' ? RECENT_CONVERSATIONS_LIMIT : ALL_CONVERSATIONS_DEFAULT_LIMIT);

  if (roleCode && roleCode !== 'Q2' && roleCode !== 'Q3' && roleCode !== 'Q1') {
    throw createValidationError('Vai trò tài khoản không hợp lệ.');
  }

  const pool = await getSqlServerPool();
  const items = await listConversations(pool, {
    accountId,
    scope,
    keyword,
    limit,
  });

  return {
    success: true,
    message: 'Lấy danh sách hội thoại thành công.',
    scope,
    keyword,
    items,
  };
}

export async function renameAssistantConversation(payload = {}) {
  await ensureAssistantChatSchema();

  const conversationId = normalizeText(payload?.conversationId);
  const accountId = requireAccountId(payload);
  const nextTitle = normalizeText(payload?.title ?? payload?.name);

  if (!conversationId) {
    throw createValidationError('Thiếu mã phiên hội thoại cần đổi tên.');
  }

  if (!nextTitle) {
    throw createValidationError('Tiêu đề phiên hội thoại không được để trống.');
  }

  if (nextTitle.length > 200) {
    throw createValidationError('Tiêu đề phiên hội thoại không vượt quá 200 ký tự.');
  }

  const pool = await getSqlServerPool();
  const conversation = await readConversationById(pool, conversationId);

  if (!conversation) {
    throw createValidationError('Không tìm thấy phiên hội thoại cần đổi tên.');
  }

  assertConversationAccess(conversation, accountId);

  const updatedConversation = await updateConversationTitle(pool, conversationId, nextTitle);

  return {
    success: true,
    message: 'Đổi tên phiên hội thoại thành công.',
    conversation: buildConversationResponse(updatedConversation ?? conversation),
  };
}

export async function deleteAssistantConversation(payload = {}) {
  await ensureAssistantChatSchema();

  const conversationId = normalizeText(payload?.conversationId);
  const accountId = requireAccountId(payload);

  if (!conversationId) {
    throw createValidationError('Thiếu mã phiên hội thoại cần xóa.');
  }

  const pool = await getSqlServerPool();
  const conversation = await readConversationById(pool, conversationId);

  if (!conversation) {
    throw createValidationError('Không tìm thấy phiên hội thoại cần xóa.');
  }

  assertConversationAccess(conversation, accountId);

  const deletedConversationId = await removeConversation(pool, conversationId);

  return {
    success: true,
    message: 'Xóa phiên hội thoại thành công.',
    conversationId: deletedConversationId || conversationId,
  };
}

export async function askAssistantChat(payload = {}) {
  await ensureAssistantChatSchema();

  const accountId = requireAccountId(payload);
  const roleCode = normalizeRoleCode(payload?.roleCode ?? payload?.role);
  const conversationId = normalizeText(payload?.conversationId);
  const messageText = normalizeText(payload?.message ?? payload?.question ?? payload?.text);

  if (!messageText) {
    throw createValidationError('Vui lòng nhập câu hỏi cho trợ lý AI.');
  }

  if (messageText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw createValidationError(`Nội dung câu hỏi không vượt quá ${CHAT_MESSAGE_MAX_LENGTH} ký tự.`);
  }

  const isSensitiveRequest = isSensitiveQuestion(messageText);

  const startedAt = Date.now();
  const pool = await getSqlServerPool();

  const conversation = await resolveConversation(pool, {
    conversationId,
    accountId,
    roleCode,
    createIfMissing: true,
    title: sanitizeConversationTitle(messageText),
  });

  if (!conversation) {
    throw createServerError('Không thể tạo hội thoại chatbot.');
  }

  assertConversationAccess(conversation, accountId);

  const resolvedConversationId = normalizeText(conversation.conversationId);

  const userMessage = await insertConversationMessage(pool, {
    conversationId: resolvedConversationId,
    senderRole: 'user',
    text: messageText,
    provider: 'client',
    model: 'user-input',
  });

  const historyMessages = await listConversationMessages(pool, resolvedConversationId, 14);
  const assistantAnswer = isSensitiveRequest
    ? {
        text: buildSensitiveRefusalAnswer(),
        provider: 'policy',
        model: 'sensitive-guard',
      }
    : await generateAssistantAnswer(historyMessages);

  const assistantMessage = await insertConversationMessage(pool, {
    conversationId: resolvedConversationId,
    senderRole: 'assistant',
    text: assistantAnswer.text,
    provider: assistantAnswer.provider,
    model: assistantAnswer.model,
  });

  const elapsedMs = Date.now() - startedAt;

  return {
    success: true,
    message: 'Trợ lý AI đã phản hồi.',
    conversation: buildConversationResponse({
      ...conversation,
      updatedAt: new Date(),
      title: conversation.title || sanitizeConversationTitle(messageText),
    }),
    userMessage,
    assistantMessage,
    responseMeta: {
      elapsedMs,
      provider: assistantMessage?.provider ?? assistantAnswer.provider,
      model: assistantMessage?.model ?? assistantAnswer.model,
    },
  };
}
