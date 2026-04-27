import sql from 'mssql';
import { env } from '../config/env.js';

let sqlServerPoolPromise = null;
let sqlServerPoolFailure = null;
let sqlServerPoolFailureAt = 0;

function normalizeSqlValue(value) {
  return String(value ?? '').trim();
}

function splitSqlServerHost(hostValue) {
  const normalizedHost = normalizeSqlValue(hostValue);

  if (!normalizedHost) {
    return { server: '', instanceName: '' };
  }

  const separatorIndex = normalizedHost.indexOf('\\');

  if (separatorIndex === -1) {
    return { server: normalizedHost, instanceName: '' };
  }

  return {
    server: normalizedHost.slice(0, separatorIndex).trim(),
    instanceName: normalizedHost.slice(separatorIndex + 1).trim(),
  };
}

export function getSqlServerConnectionTarget() {
  const hostParts = splitSqlServerHost(env.dbHost);
  const explicitInstanceName = normalizeSqlValue(env.dbInstanceName);
  const server = hostParts.server || normalizeSqlValue(env.dbHost);
  const instanceName = explicitInstanceName || hostParts.instanceName;

  return {
    server,
    instanceName,
    port: instanceName ? undefined : env.dbPort,
  };
}

export function isSqlServerConfigured() {
  return Boolean(env.dbHost && env.dbName && env.dbUser && env.dbPassword);
}

function getSqlServerConfig() {
  if (!isSqlServerConfigured()) {
    throw new Error('Thiếu cấu hình SQL Server. Cần DB_HOST, DB_NAME, DB_USER, DB_PASSWORD trong backend/.env.');
  }

  const connectionTarget = getSqlServerConnectionTarget();

  const config = {
    server: connectionTarget.server,
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

  if (connectionTarget.instanceName) {
    config.options.instanceName = connectionTarget.instanceName;
  } else {
    config.port = connectionTarget.port;
  }

  return config;
}

function getSqlServerConnectionRetryCooldownMs() {
  const cooldownMs = Number(env.dbConnectionRetryCooldownMs ?? 30000);

  return Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : 30000;
}

function isSqlServerConnectionError(error) {
  const message = String(error?.message ?? '');

  return error?.code === 'ETIMEOUT'
    || error?.code === 'SQLSERVER_CONNECTION_COOLDOWN'
    || /Failed to connect to/i.test(message)
    || /SQL Server connection unavailable/i.test(message);
}

function createSqlServerConnectionCooldownError(cause) {
  const cooldownMs = getSqlServerConnectionRetryCooldownMs();
  const elapsedMs = Math.max(0, Date.now() - sqlServerPoolFailureAt);
  const retryAfterMs = Math.max(0, cooldownMs - elapsedMs);
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const error = new Error(`SQL Server connection unavailable. Retry in ${retryAfterSeconds}s.`);

  error.code = 'SQLSERVER_CONNECTION_COOLDOWN';
  error.retryAfterMs = retryAfterMs;
  error.cause = cause;

  return error;
}

export async function getSqlServerPool() {
  if (!sqlServerPoolPromise) {
    if (sqlServerPoolFailure && isSqlServerConnectionError(sqlServerPoolFailure)) {
      const cooldownMs = getSqlServerConnectionRetryCooldownMs();
      const elapsedMs = Date.now() - sqlServerPoolFailureAt;

      if (elapsedMs < cooldownMs) {
        throw createSqlServerConnectionCooldownError(sqlServerPoolFailure);
      }

      sqlServerPoolFailure = null;
      sqlServerPoolFailureAt = 0;
    }

    const config = getSqlServerConfig();
    const pool = new sql.ConnectionPool(config);

    sqlServerPoolPromise = pool.connect()
      .then((connectedPool) => {
        sqlServerPoolFailure = null;
        sqlServerPoolFailureAt = 0;

        return connectedPool;
      })
      .catch((error) => {
        sqlServerPoolPromise = null;
        sqlServerPoolFailure = error;
        sqlServerPoolFailureAt = Date.now();
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
