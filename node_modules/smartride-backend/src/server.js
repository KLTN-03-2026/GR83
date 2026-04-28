import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { isSqlServerConfigured } from './services/database.service.js';
import { ensureNotificationSchema } from './services/notification.service.js';
import { ensurePromotionSchema } from './services/promotion.service.js';
import { ensureDriverSchema } from './services/driver.service.js';
import { startNotificationScheduler } from './services/notification.scheduler.js';
import { ensureRideSchema } from './services/ride.service.js';
import { Server } from 'socket.io';
import { connectRideEventBroker, registerRideSocketServer } from './services/ride.realtime.service.js';

const allowedOrigins = String(env.corsOrigin ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function createCorsOriginChecker() {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin) || isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Socket.IO blocked for origin ${origin}`));
  };
}

function isSqlDeadlockError(error) {
  if (!error) {
    return false;
  }

  if (Number(error?.number) === 1205) {
    return true;
  }

  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('deadlock victim') || message.includes('was deadlocked on lock resources');
}

async function runSchemaSetupStep(label, setupFn, { retryOnDeadlock = 2 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryOnDeadlock + 1; attempt += 1) {
    try {
      await setupFn();
      return { ok: true, label };
    } catch (error) {
      lastError = error;

      if (!isSqlDeadlockError(error) || attempt > retryOnDeadlock) {
        break;
      }
    }
  }

  return {
    ok: false,
    label,
    error: lastError,
  };
}

function bootstrapSqlServerSchemas() {
  void (async () => {
    const setupSteps = [
      { label: 'thông báo', setupFn: ensureNotificationSchema, onSuccess: startNotificationScheduler },
      { label: 'ưu đãi', setupFn: ensurePromotionSchema },
      { label: 'chuyến xe', setupFn: ensureRideSchema },
      { label: 'tài xế', setupFn: ensureDriverSchema },
    ];

    const failedResults = [];

    for (const step of setupSteps) {
      const result = await runSchemaSetupStep(step.label, step.setupFn);

      if (!result.ok) {
        failedResults.push(result);
        continue;
      }

      if (typeof step.onSuccess === 'function') {
        step.onSuccess();
      }
    }

    if (failedResults.length > 0) {
      const failedLabels = failedResults.map((item) => item.label).join(', ');
      const firstError = failedResults[0]?.error;
      const errorMessage = firstError?.message ? `: ${firstError.message}` : '';

      console.warn(
        `Không thể đồng bộ schema SQL Server khi khởi động backend (${failedLabels}). Ứng dụng vẫn tiếp tục chạy.${errorMessage}`,
      );
    }
  })();
}

async function bootstrap() {
  if (isSqlServerConfigured()) {
    bootstrapSqlServerSchemas();
  }

  const httpServer = createServer(app);
  const socketServer = new Server(httpServer, {
    cors: {
      origin: createCorsOriginChecker(),
    },
  });

  registerRideSocketServer(socketServer);

  httpServer.listen(env.port, () => {
    void connectRideEventBroker();
    console.log(`SmartRide backend listening on http://localhost:${env.port}`);
  });
}

void bootstrap();
