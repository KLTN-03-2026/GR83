import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import sql from 'mssql';

const root = process.cwd();
const backendDir = path.join(root, 'backend');
dotenv.config({ path: path.join(backendDir, '.env') });

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = String(v).trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

function splitBatchesByGo(scriptText) {
  const lines = scriptText.split(/\r?\n/);
  const batches = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*GO\s*(?:--.*)?$/i.test(line)) {
      const text = current.join('\n').trim();
      if (text) batches.push(text);
      current = [];
      continue;
    }
    current.push(line);
  }
  const tail = current.join('\n').trim();
  if (tail) batches.push(tail);
  return batches;
}

async function runScript(pool, scriptPath, label) {
  const content = await fs.readFile(scriptPath, 'utf8');
  const batches = splitBatchesByGo(content);
  console.log(`[${label}] batches: ${batches.length}`);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    try {
      await pool.request().query(batch);
    } catch (error) {
      console.error(`[${label}] failed at batch ${i + 1}/${batches.length}`);
      console.error(error?.message || error);
      throw error;
    }
  }
  console.log(`[${label}] completed`);
}

const server = process.env.DB_INSTANCE_NAME
  ? `${process.env.DB_HOST || 'localhost'}\\${process.env.DB_INSTANCE_NAME}`
  : (process.env.DB_HOST || 'localhost');

const config = {
  server,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || undefined,
  user: process.env.DB_USER || undefined,
  password: process.env.DB_PASSWORD || undefined,
  options: {
    encrypt: parseBool(process.env.DB_ENCRYPT, false),
    trustServerCertificate: parseBool(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    enableArithAbort: true,
  },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 60000),
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 60000),
};

if (!process.env.DB_NAME) {
  throw new Error('DB_NAME is empty in backend/.env');
}

let pool;
try {
  pool = await sql.connect(config);
  console.log(`[DB] connected to ${config.server}/${config.database}`);

  await runScript(pool, path.join(backendDir, 'text', 'db.txt'), 'schema');
  await runScript(pool, path.join(backendDir, 'text', 'insert.txt'), 'seed');

  const fkCheck = await pool.request().query(`
    SELECT fk.name AS fkName
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.DatXeDieuPhoi') AND fk.name = N'FK_DatXeDieuPhoi_TaiXe'
    UNION ALL
    SELECT fk.name AS fkName
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.HoiThoaiChatbot') AND fk.name = N'FK_ChatbotConversation_Quyen';
  `);

  const missing = ['FK_DatXeDieuPhoi_TaiXe', 'FK_ChatbotConversation_Quyen'].filter(
    (name) => !fkCheck.recordset.some((r) => r.fkName === name),
  );

  if (missing.length > 0) {
    throw new Error(`Missing FK(s): ${missing.join(', ')}`);
  }

  console.log('[VERIFY] required FKs are present');
} finally {
  if (pool) await pool.close();
}
