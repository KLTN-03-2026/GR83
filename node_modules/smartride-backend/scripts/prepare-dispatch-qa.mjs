import 'dotenv/config';
import sql from 'mssql';

const DRIVER_IDS = ['TK0002', 'TK0004', 'TK0003'];
const ACTIVE_TRIP_STATUSES = ['ChoTaiXe', 'DaNhanChuyen', 'DangDen', 'DaDon', 'DangThucHien'];

function getSqlConfig() {
  const port = Number(process.env.DB_PORT || 1433);

  return {
    server: process.env.DB_HOST,
    port: Number.isFinite(port) ? port : 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() !== 'false',
      encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

function ensureEnv() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((key) => !String(process.env[key] || '').trim());

  if (missing.length > 0) {
    throw new Error(`Missing DB env vars: ${missing.join(', ')}`);
  }
}

async function main() {
  ensureEnv();
  const pool = await sql.connect(getSqlConfig());
  const tx = new sql.Transaction(pool);

  await tx.begin();

  try {
    const req = new sql.Request(tx);
    req.input('driver1', sql.VarChar(20), DRIVER_IDS[0]);
    req.input('driver2', sql.VarChar(20), DRIVER_IDS[1]);
    req.input('driver3', sql.VarChar(20), DRIVER_IDS[2]);
    req.input('cancelPayload', sql.NVarChar(500), 'q1|||system|||prepare dispatch qa');

    for (const [index, status] of ACTIVE_TRIP_STATUSES.entries()) {
      req.input(`status${index}`, sql.NVarChar(20), status);
    }

    const result = await req.query(`
      UPDATE tx
      SET
        tx.TrangThai = N'HoatDong',
        tx.KhoaTamDen = NULL,
        tx.LyDoKhoaTam = NULL,
        tx.NgayCapNhat = SYSDATETIME()
      FROM dbo.TaiXe tx
      WHERE tx.MaTK IN (@driver1, @driver2, @driver3);

      UPDATE dp
      SET
        dp.TrangThai = 'rejected',
        dp.LyDoTuChoi = N'prepare dispatch qa',
        dp.NgayPhanHoi = SYSDATETIME(),
        dp.NgayCapNhat = SYSDATETIME()
      FROM dbo.DatXeDieuPhoi dp
      WHERE dp.MaTKTaiXe IN (@driver1, @driver2, @driver3)
        AND dp.TrangThai = 'pending';

      UPDATE dx
      SET
        dx.TrangThaiChuyen = N'DaHuy',
        dx.TrangThaiThanhToan = N'ThatBai',
        dx.MaTKTaiXeDuocMoi = NULL,
        dx.MaTBThongBaoTaiXe = NULL,
        dx.LyDoHuy = @cancelPayload,
        dx.NgayCapNhat = SYSDATETIME()
      FROM dbo.DatXe dx
      INNER JOIN dbo.TaiXe td
        ON td.MaTK IN (@driver1, @driver2, @driver3)
       AND (
          LOWER(ISNULL(dx.MaTKTaiXeDuocMoi, '')) = LOWER(ISNULL(td.MaTK, ''))
          OR LOWER(ISNULL(dx.MaTX, '')) = LOWER(ISNULL(td.CCCD, ''))
       )
      WHERE dx.TrangThaiChuyen IN (@status0, @status1, @status2, @status3, @status4);

      UPDATE tt
      SET
        tt.TrangThaiThanhToan = N'ThatBai',
        tt.GatewayLastReturnCode = COALESCE(tt.GatewayLastReturnCode, -1)
      FROM dbo.ThanhToan tt
      INNER JOIN dbo.DatXe dx ON dx.MaChuyen = tt.MaChuyen
      WHERE dx.LyDoHuy = @cancelPayload
        AND tt.TrangThaiThanhToan <> N'ThatBai';

      SELECT
        SUM(CASE WHEN tx.MaTK IN (@driver1, @driver2, @driver3) AND tx.TrangThai = N'HoatDong' THEN 1 ELSE 0 END) AS readyDrivers,
        SUM(CASE WHEN dp.MaTKTaiXe IN (@driver1, @driver2, @driver3) AND dp.TrangThai = 'rejected' THEN 1 ELSE 0 END) AS cleanedDispatchRows,
        SUM(CASE WHEN dx.LyDoHuy = @cancelPayload THEN 1 ELSE 0 END) AS cancelledTrips
      FROM dbo.TaiXe tx
      LEFT JOIN dbo.DatXeDieuPhoi dp ON dp.MaTKTaiXe = tx.MaTK
      LEFT JOIN dbo.DatXe dx ON LOWER(ISNULL(dx.MaTKTaiXeDuocMoi, '')) = LOWER(ISNULL(tx.MaTK, ''));
    `);

    await tx.commit();

    console.log(JSON.stringify({ success: true, summary: result.recordset?.[0] ?? {} }, null, 2));
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error?.message || 'unknown' }, null, 2));
  process.exit(1);
});
