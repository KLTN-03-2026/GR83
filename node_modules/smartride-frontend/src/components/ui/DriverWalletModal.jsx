import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeIcon } from '../../assets/icons';
import { driverWalletService } from '../../services/driverWalletService';
import { connectRideEventStream } from '../../services/rideRealtimeService';

const WALLET_POLL_INTERVAL_MS = 8000;

const TOPUP_OPTIONS = [100000, 200000, 300000, 500000, 1000000, 2000000];
const TRANSFER_OPTIONS = [50000, 100000, 200000, 500000];

const TOPUP_METHODS = [
  {
    id: 'momo',
    title: 'Ví điện tử MoMo',
    subtitle: 'Thanh toán nhanh chóng',
    badge: 'MoMo',
  },
  {
    id: 'zalopay',
    title: 'ZaloPay',
    subtitle: 'Thanh toán qua ZaloPay',
    badge: 'ZaloPay',
  },
  {
    id: 'atm',
    title: 'Thẻ ATM nội địa',
    subtitle: 'Hỗ trợ thẻ ATM các ngân hàng',
    badge: 'ATM',
  },
  {
    id: 'bank',
    title: 'Chuyển khoản ngân hàng',
    subtitle: 'Chuyển khoản qua ngân hàng',
    badge: 'BANK',
  },
];

function formatVnd(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '0 đ';
  }

  return `${new Intl.NumberFormat('vi-VN').format(numericValue)} đ`;
}

function formatSignedVnd(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '+0 đ';
  }

  const prefix = numericValue >= 0 ? '+' : '-';
  return `${prefix}${new Intl.NumberFormat('vi-VN').format(Math.abs(numericValue))} đ`;
}

function sanitizeDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // SQL Server dùng SYSDATETIME() (giờ địa phương UTC+7) nhưng tedious serialize thành chuỗi Z.
  // Giá trị UTC trong Date thực ra chứa giờ Việt Nam → hiển thị theo UTC để tránh cộng thêm 7h.
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function mapTransactionToViewModel(item = {}) {
  const type = String(item.type ?? '').trim().toLowerCase();
  const amount = Number(item.amount ?? 0);

  let title = 'Giao dịch ví';
  let description = String(item.description ?? '').trim() || 'Không có mô tả';

  if (type === 'topup') {
    title = 'Nạp tiền';
  } else if (type === 'transfer') {
    title = 'Chuyển tiền';
    if (!description && item.recipientPhone) {
      description = `Chuyển đến ${item.recipientPhone}`;
    }
  } else if (type === 'receive') {
    title = 'Nhận tiền';
    if (!description && item.senderPhone) {
      description = `Nhận từ ${item.senderPhone}`;
    }
  }

  return {
    id: item.id ?? `${type}-${item.createdAt ?? Date.now()}`,
    type: type || 'adjustment',
    title,
    description,
    amount,
    occurredAt: formatDateTime(item.createdAt),
  };
}

export default function DriverWalletModal({
  open = false,
  onClose,
  driverId = '',
  driverName = '',
  onNotify,
  onOpenIncomeReport,
}) {
  const [balanceAmount, setBalanceAmount] = useState(0);
  const [showBalance, setShowBalance] = useState(true);
  const [activeScreen, setActiveScreen] = useState('overview');
  const [topupAmount, setTopupAmount] = useState(200000);
  const [topupMethod, setTopupMethod] = useState('momo');
  const [transferPhone, setTransferPhone] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const walletLoadInFlightRef = useRef(false);

  const resolvedDriverId = String(driverId ?? '').trim();

  const loadWalletData = useCallback(async ({ silent = false } = {}) => {
    if (!resolvedDriverId) {
      return;
    }

    if (walletLoadInFlightRef.current) {
      return;
    }

    walletLoadInFlightRef.current = true;

    if (!silent) {
      setIsLoading(true);
      setErrorMessage('');
    }

    try {
      const response = await driverWalletService.getWallet(resolvedDriverId);
      const nextBalance = Number(response?.wallet?.balance ?? 0);
      const nextTransactions = Array.isArray(response?.transactions) ? response.transactions : [];
      setBalanceAmount(Number.isFinite(nextBalance) ? nextBalance : 0);
      setTransactions(nextTransactions.map(mapTransactionToViewModel));
    } catch (error) {
      const message = error?.message || 'Không thể tải thông tin ví lúc này.';
      if (!silent) {
        setErrorMessage(message);
        onNotify?.(message, 'error', 2800);
      }
    } finally {
      walletLoadInFlightRef.current = false;

      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [onNotify, resolvedDriverId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        if (activeScreen !== 'overview') {
          setActiveScreen('overview');
          return;
        }

        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activeScreen, onClose, open]);

  useEffect(() => {
    if (!open) {
      setActiveScreen('overview');
      setTopupAmount(200000);
      setTopupMethod('momo');
      setTransferPhone('');
      setTransferAmount('');
      setTransferNote('');
      setHistoryFilter('all');
      setShowBalance(true);
      setErrorMessage('');
      return;
    }

    void loadWalletData();

    const pollId = window.setInterval(() => {
      void loadWalletData({ silent: true });
    }, WALLET_POLL_INTERVAL_MS);

    return () => {
      clearInterval(pollId);
    };
  }, [loadWalletData, open, resolvedDriverId]);

  useEffect(() => {
    if (!open || !resolvedDriverId) {
      return undefined;
    }

    const disconnect = connectRideEventStream({
      accountId: resolvedDriverId,
      roleCode: 'Q3',
      onEvent: (eventPayload) => {
        const eventType = String(eventPayload?.type ?? '').trim().toLowerCase();

        if (!eventType.startsWith('ride.')) {
          return;
        }

        const booking = eventPayload?.booking ?? eventPayload?.payload?.booking ?? {};
        const bookingDriverId = String(booking?.driverAccountId ?? booking?.driverId ?? '').trim();

        if (!bookingDriverId || bookingDriverId === resolvedDriverId) {
          void loadWalletData({ silent: true });
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [loadWalletData, open, resolvedDriverId]);

  const filteredHistoryItems = useMemo(() => {
    if (historyFilter === 'all') {
      return transactions;
    }

    return transactions.filter((item) => item.type === historyFilter);
  }, [historyFilter, transactions]);

  const resolvedDriverName = String(driverName ?? '').trim() || 'Tài xế SmartRide';

  const handleSubmitTopup = async () => {
    if (!resolvedDriverId || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await driverWalletService.topup(resolvedDriverId, {
        amount: topupAmount,
        method: topupMethod,
      });

      onNotify?.(response?.message || 'Nạp tiền thành công.', 'success', 2000);
      setActiveScreen('history');
      await loadWalletData();
    } catch (error) {
      onNotify?.(error?.message || 'Không thể nạp tiền lúc này.', 'error', 2800);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitTransfer = async () => {
    if (!resolvedDriverId || isSubmitting) {
      return;
    }

    const amount = Number(sanitizeDigits(transferAmount));

    if (!transferPhone || !amount || amount <= 0) {
      onNotify?.('Vui lòng nhập đầy đủ số điện thoại và số tiền chuyển.', 'error', 2800);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await driverWalletService.transfer(resolvedDriverId, {
        recipientPhone: transferPhone,
        amount,
        description: transferNote,
      });

      onNotify?.(response?.message || 'Chuyển tiền thành công.', 'success', 2200);
      setTransferAmount('');
      setTransferNote('');
      setActiveScreen('history');
      await loadWalletData();
    } catch (error) {
      onNotify?.(error?.message || 'Không thể chuyển tiền lúc này.', 'error', 2800);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="driver-wallet-modal" role="dialog" aria-modal="true" aria-label="Ví tài xế">
      <div className="driver-wallet-modal__backdrop" onClick={() => onClose?.()} aria-hidden="true" />

      <section className="driver-wallet-modal__window">
        <button className="driver-wallet-modal__close" type="button" onClick={() => onClose?.()} aria-label="Đóng ví tài xế">
          <img className="driver-wallet-modal__close-icon" src={closeIcon} alt="" aria-hidden="true" />
        </button>

        <header className="driver-wallet-modal__hero">
          <h3>Ví tài xế</h3>
        </header>

        <div className="driver-wallet-modal__layout">
          <aside className="driver-wallet-modal__driver-card" aria-label="Thông tin tài xế">
            <div className="driver-wallet-modal__avatar" aria-hidden="true">
              <span>o/</span>
            </div>
            <strong>{resolvedDriverName}</strong>
          </aside>

          <section className="driver-wallet-modal__summary" aria-label="Thông tin ví">
            <h4>Tiền trong ví</h4>

            <div className="driver-wallet-modal__balance-row">
              <span>{showBalance ? formatVnd(balanceAmount) : '..... đ'}</span>
              <button
                className="driver-wallet-modal__toggle-balance"
                type="button"
                onClick={() => setShowBalance((current) => !current)}
                aria-label={showBalance ? 'Ẩn số dư' : 'Hiện số dư'}
              >
                {showBalance ? 'Ẩn' : 'Hiện'}
              </button>
            </div>

            {isLoading ? <p className="driver-wallet-flow-modal__history-empty">Đang tải dữ liệu ví...</p> : null}
            {!isLoading && errorMessage ? <p className="driver-wallet-flow-modal__history-empty">{errorMessage}</p> : null}

            <div className="driver-wallet-modal__actions" role="group" aria-label="Chức năng ví tài xế">
              <button type="button" onClick={() => setActiveScreen('topup')}>$ Nạp tiền</button>
              <button type="button" onClick={() => setActiveScreen('transfer')}>$ Chuyển tiền</button>
              <button
                type="button"
                onClick={() => {
                  onOpenIncomeReport?.();
                }}
              >
                $ Báo cáo thu nhập
              </button>
              <button type="button" onClick={() => setActiveScreen('history')}>Lịch sử</button>
            </div>
          </section>
        </div>
      </section>

      {activeScreen !== 'overview' ? (
        <div className="driver-wallet-flow-modal" role="dialog" aria-modal="true" aria-label="Chi tiết giao dịch ví">
          <div className="driver-wallet-flow-modal__backdrop" onClick={() => setActiveScreen('overview')} aria-hidden="true" />

          <section className="driver-wallet-flow-modal__window">
            <header className="driver-wallet-flow-modal__header">
              <button className="driver-wallet-flow-modal__back" type="button" onClick={() => setActiveScreen('overview')} aria-label="Quay lại ví tài xế">
                {'<'}
              </button>
              <strong>
                {activeScreen === 'topup'
                  ? 'Nạp tiền'
                  : activeScreen === 'transfer'
                    ? 'Chuyển tiền'
                    : activeScreen === 'history'
                      ? 'Lịch sử giao dịch'
                      : 'Báo cáo thu nhập'}
              </strong>
              <button className="driver-wallet-flow-modal__dismiss" type="button" onClick={() => setActiveScreen('overview')} aria-label="Đóng màn hình con">
                x
              </button>
            </header>

            {activeScreen === 'topup' ? (
              <div className="driver-wallet-flow-modal__content">
                <article className="driver-wallet-flow-modal__balance-card">
                  <p>Số dư ví hiện tại</p>
                  <strong>{formatVnd(balanceAmount)}</strong>
                </article>

                <div className="driver-wallet-flow-modal__section">
                  <h5>Chọn số tiền nạp</h5>
                  <div className="driver-wallet-flow-modal__chip-grid">
                    {TOPUP_OPTIONS.map((option) => (
                      <button
                        key={option}
                        className={`driver-wallet-flow-modal__chip${topupAmount === option ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => setTopupAmount(option)}
                      >
                        {formatVnd(option)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="driver-wallet-flow-modal__section">
                  <h5>Phương thức thanh toán</h5>
                  <div className="driver-wallet-flow-modal__method-list" role="radiogroup" aria-label="Phương thức nạp tiền">
                    {TOPUP_METHODS.map((method) => (
                      <button
                        key={method.id}
                        className={`driver-wallet-flow-modal__method${topupMethod === method.id ? ' is-active' : ''}`}
                        type="button"
                        role="radio"
                        aria-checked={topupMethod === method.id}
                        onClick={() => setTopupMethod(method.id)}
                      >
                        <span className="driver-wallet-flow-modal__method-badge">{method.badge}</span>
                        <span className="driver-wallet-flow-modal__method-copy">
                          <strong>{method.title}</strong>
                          <small>{method.subtitle}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <button className="driver-wallet-flow-modal__submit" type="button" onClick={handleSubmitTopup} disabled={isSubmitting}>
                  {isSubmitting ? 'Đang xử lý...' : 'Xác nhận nạp tiền'}
                </button>
              </div>
            ) : null}

            {activeScreen === 'transfer' ? (
              <div className="driver-wallet-flow-modal__content">
                <article className="driver-wallet-flow-modal__balance-card">
                  <p>Số dư khả dụng</p>
                  <strong>{formatVnd(balanceAmount)}</strong>
                </article>

                <div className="driver-wallet-flow-modal__section">
                  <h5>Thông tin người nhận</h5>
                  <label className="driver-wallet-flow-modal__field">
                    <span>Số điện thoại</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={transferPhone}
                      onChange={(event) => setTransferPhone(sanitizeDigits(event.target.value).slice(0, 15))}
                      placeholder="Nhập số điện thoại người nhận"
                    />
                  </label>
                </div>

                <div className="driver-wallet-flow-modal__section">
                  <h5>Số tiền chuyển</h5>
                  <label className="driver-wallet-flow-modal__field">
                    <span>Số tiền</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={transferAmount}
                      onChange={(event) => setTransferAmount(sanitizeDigits(event.target.value))}
                      placeholder="Nhập số tiền"
                    />
                  </label>

                  <div className="driver-wallet-flow-modal__chip-grid driver-wallet-flow-modal__chip-grid--compact">
                    {TRANSFER_OPTIONS.map((option) => (
                      <button
                        key={option}
                        className="driver-wallet-flow-modal__chip"
                        type="button"
                        onClick={() => setTransferAmount(String(option))}
                      >
                        {formatVnd(option)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="driver-wallet-flow-modal__section">
                  <h5>Nội dung (không bắt buộc)</h5>
                  <label className="driver-wallet-flow-modal__field">
                    <input
                      type="text"
                      value={transferNote}
                      onChange={(event) => setTransferNote(event.target.value.slice(0, 120))}
                      placeholder="Nhập nội dung chuyển tiền"
                    />
                  </label>
                </div>

                <button className="driver-wallet-flow-modal__submit" type="button" onClick={handleSubmitTransfer} disabled={isSubmitting}>
                  {isSubmitting ? 'Đang xử lý...' : 'Xác nhận chuyển tiền'}
                </button>
              </div>
            ) : null}

            {activeScreen === 'history' ? (
              <div className="driver-wallet-flow-modal__content">
                <article className="driver-wallet-flow-modal__balance-card">
                  <p>Số dư hiện tại</p>
                  <strong>{formatVnd(balanceAmount)}</strong>
                </article>

                <div className="driver-wallet-flow-modal__history-filters" role="group" aria-label="Bộ lọc lịch sử giao dịch">
                  <button className={historyFilter === 'all' ? 'is-active' : ''} type="button" onClick={() => setHistoryFilter('all')}>
                    Tất cả
                  </button>
                  <button className={historyFilter === 'topup' ? 'is-active' : ''} type="button" onClick={() => setHistoryFilter('topup')}>
                    Nạp tiền
                  </button>
                  <button className={historyFilter === 'transfer' ? 'is-active' : ''} type="button" onClick={() => setHistoryFilter('transfer')}>
                    Chuyển tiền
                  </button>
                  <button className={historyFilter === 'receive' ? 'is-active' : ''} type="button" onClick={() => setHistoryFilter('receive')}>
                    Nhận tiền
                  </button>
                </div>

                <div className="driver-wallet-flow-modal__history-list">
                  {filteredHistoryItems.length > 0 ? (
                    filteredHistoryItems.map((item) => (
                      <article key={item.id} className="driver-wallet-flow-modal__history-item">
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.description}</p>
                          <span>{item.occurredAt || 'Không rõ thời gian'}</span>
                        </div>

                        <em className={item.amount >= 0 ? 'is-positive' : 'is-negative'}>{formatSignedVnd(item.amount)}</em>
                      </article>
                    ))
                  ) : (
                    <p className="driver-wallet-flow-modal__history-empty">Không có dữ liệu giao dịch</p>
                  )}
                </div>
              </div>
            ) : null}

            {activeScreen === 'income-report' ? (
              <div className="driver-wallet-flow-modal__content driver-wallet-flow-modal__content--center">
                <h5>Báo cáo thu nhập</h5>
                <p>Chức năng đã được chuyển sang popup Quản lý thu nhập.</p>
                <button className="driver-wallet-flow-modal__submit" type="button" onClick={() => onOpenIncomeReport?.()}>
                  Mở quản lý thu nhập
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
