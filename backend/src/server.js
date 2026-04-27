import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { isSqlServerConfigured } from './services/database.service.js';
import { ensureNotificationSchema } from './services/notification.service.js';
import { ensurePromotionSchema } from './services/promotion.service.js';
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

function bootstrapSqlServerSchemas() {
  const notificationSchemaPromise = ensureNotificationSchema();
  const promotionSchemaPromise = ensurePromotionSchema();
  const rideSchemaPromise = ensureRideSchema();
  let warningLogged = false;

  const logStartupSchemaWarning = (failedSchemas, error) => {
    if (warningLogged) {
      return;
    }

    warningLogged = true;

    const schemaSuffix = Array.isArray(failedSchemas) && failedSchemas.length > 0
      ? ` (${failedSchemas.join(', ')})`
      : '';
    const errorMessage = error?.message ? `: ${error.message}` : '';

    console.warn(
      `Không thể đồng bộ schema SQL Server khi khởi động backend${schemaSuffix}. Ứng dụng vẫn tiếp tục chạy.${errorMessage}`,
    );
  };

  void notificationSchemaPromise
    .then(() => {
      startNotificationScheduler();
    })
    .catch((error) => {
      logStartupSchemaWarning(['thông báo'], error);
    });

  void Promise.allSettled([notificationSchemaPromise, promotionSchemaPromise, rideSchemaPromise])
    .then(([notificationResult, promotionResult, rideResult]) => {
      const failedSchemas = [];

      if (notificationResult.status === 'rejected') {
        failedSchemas.push('thông báo');
      }

      if (promotionResult.status === 'rejected') {
        failedSchemas.push('ưu đãi');
      }

      if (rideResult.status === 'rejected') {
        failedSchemas.push('chuyến xe');
      }

      if (failedSchemas.length > 0) {
        const firstError = notificationResult.status === 'rejected'
          ? notificationResult.reason
          : promotionResult.status === 'rejected'
            ? promotionResult.reason
            : rideResult.reason;

        logStartupSchemaWarning(failedSchemas, firstError);
      }
    });
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
