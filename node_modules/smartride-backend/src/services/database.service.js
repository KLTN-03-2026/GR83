import sql from 'mssql';
import { env } from '../config/env.js';

let sqlServerPoolPromise = null;

export function isSqlServerConfigured() {
  return Boolean(env.dbHost && env.dbName && env.dbUser && env.dbPassword);
}

function getSqlServerConfig() {
  if (!isSqlServerConfigured()) {
    throw new Error('Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.');
  }

  return {
    server: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    user: env.dbUser,
    password: env.dbPassword,
    options: {
      encrypt: env.dbEncrypt,
      trustServerCertificate: env.dbTrustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: env.dbPoolMax,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: env.dbConnectionTimeoutMs,
    requestTimeout: env.dbRequestTimeoutMs,
  };
}

export async function getSqlServerPool() {
  if (!sqlServerPoolPromise) {
    const config = getSqlServerConfig();
    const pool = new sql.ConnectionPool(config);

    sqlServerPoolPromise = pool.connect().catch((error) => {
      sqlServerPoolPromise = null;
      throw error;
    });
  }

  return sqlServerPoolPromise;
}

export async function testSqlServerConnection() {
  const pool = await getSqlServerPool();
  const queryResult = await pool.request().query('SELECT DB_NAME() AS databaseName, GETDATE() AS serverTime;');
  const row = queryResult.recordset?.[0] ?? {};

  return {
    databaseName: row.databaseName ?? env.dbName,
    serverTime: row.serverTime ?? null,
  };
}
