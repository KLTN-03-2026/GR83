import { isSqlServerConfigured } from './database.service.js';
import { syncDueNotifications } from './notification.service.js';
import { runTimedOutDispatchSweep } from './ride.service.js';

const DEFAULT_INTERVAL_MS = 60_000;

let schedulerTimerId = null;
let sweepPromise = null;

async function runNotificationSweep() {
  if (sweepPromise) {
    return sweepPromise;
  }

  sweepPromise = (async () => {
    try {
      const [notificationResult, dispatchTimeoutResult] = await Promise.all([
        syncDueNotifications(),
        runTimedOutDispatchSweep(),
      ]);

      if (notificationResult.updatedCount > 0) {
        console.log(
          `[notifications] Đã chuyển ${notificationResult.updatedCount} thông báo đến hạn sang trạng thái đã gửi.`,
        );
      }

      if (dispatchTimeoutResult?.processedCount > 0) {
        console.log(
          `[dispatch-timeout] Đã xử lý ${dispatchTimeoutResult.processedCount} cuốc quá hạn (${dispatchTimeoutResult.redispatchedCount} điều phối lại, ${dispatchTimeoutResult.cancelledCount} hủy do hết tài xế).`,
        );
      }

      return {
        notificationResult,
        dispatchTimeoutResult,
      };
    } catch (error) {
      const message = String(error?.message ?? error);
      const logMessage = error?.code === 'ETIMEOUT' || /Failed to connect to/i.test(message)
        ? `[scheduler] Không thể đồng bộ định kỳ: ${message}`
        : '[scheduler] Không thể đồng bộ định kỳ.';

      console.error(logMessage);
      return null;
    } finally {
      sweepPromise = null;
    }
  })();

  return sweepPromise;
}

export function startNotificationScheduler(options = {}) {
  if (schedulerTimerId) {
    return schedulerTimerId;
  }

  if (!isSqlServerConfigured()) {
    console.warn('[notifications] Bỏ qua bộ lập lịch vì chưa cấu hình SQL Server.');
    return null;
  }

  const intervalMs = Number(options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const normalizedIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;

  void runNotificationSweep();

  schedulerTimerId = setInterval(() => {
    void runNotificationSweep();
  }, normalizedIntervalMs);

  if (typeof schedulerTimerId.unref === 'function') {
    schedulerTimerId.unref();
  }

  console.log(
    `[notifications] Bộ lập lịch thông báo đã khởi chạy với chu kỳ ${Math.round(normalizedIntervalMs / 1000)} giây.`,
  );

  return schedulerTimerId;
}

export function stopNotificationScheduler() {
  if (!schedulerTimerId) {
    return;
  }

  clearInterval(schedulerTimerId);
  schedulerTimerId = null;
}

export async function runNotificationSchedulerOnce() {
  return runNotificationSweep();
}