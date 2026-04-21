import { env } from '../config/env.js';
import { isSqlServerConfigured, testSqlServerConnection } from './database.service.js';

export function getHealthStatus() {
  return {
    success: true,
    message: 'SmartRide API is running',
    timestamp: new Date().toISOString(),
  };
}

export async function getDatabaseHealthStatus() {
  const timestamp = new Date().toISOString();

  if (!isSqlServerConfigured()) {
    return {
      success: false,
      message: 'Thiếu cấu hình SQL Server trong backend/.env.',
      configured: false,
      expectedEnv: ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'],
      timestamp,
    };
  }

  try {
    const connectionInfo = await testSqlServerConnection();

    return {
      success: true,
      message: 'SQL Server connected',
      configured: true,
      connection: {
        server: env.dbHost,
        database: connectionInfo.databaseName,
        serverTime: connectionInfo.serverTime,
      },
      timestamp,
    };
  } catch (error) {
    return {
      success: false,
      message: 'SQL Server connection failed',
      configured: true,
      connection: {
        server: env.dbHost,
        database: env.dbName,
      },
      error: error.message,
      timestamp,
    };
  }
}
