import { isSqlServerConfigured } from './database.service.js';
import { syncDueNotifications } from './notification.service.js';

const DEFAULT_INTERVAL_MS = 60_000;

let schedulerTimerId = null;
let sweepPromise = null;

async function runNotificationSweep() {
  if (sweepPromise) {
    return sweepPromise;
  }

  sweepPromise = (async () => {
    try {
      const result = await syncDueNotifications();

      if (result.updatedCount > 0) {
        console.log(
          `[notifications] Đã chuyển ${result.updatedCount} thông báo đến hạn sang trạng thái đã gửi.`,
        );
      }

      return result;
    } catch (error) {
      console.error('[notifications] Không thể đồng bộ thông báo đến hạn:', error);
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