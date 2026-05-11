const API = 'http://localhost:4000/api';
const DRIVERS = ['TK0002', 'TK0004', 'TK0003'];
const ACTIVE_STATUSES = new Set(['ChoTaiXe', 'DaNhanChuyen', 'DangDen', 'DaDon', 'DangThucHien']);

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }

  return data;
}

for (const driver of DRIVERS) {
  const history = await requestJson(`${API}/rides/history?accountId=${driver}&roleCode=Q3&limit=200`);
  const items = Array.isArray(history?.items)
    ? history.items.filter((item) => ACTIVE_STATUSES.has(String(item?.tripStatus || '')))
    : [];

  for (const item of items) {
    try {
      await requestJson(`${API}/rides/${encodeURIComponent(item.bookingCode)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DaHuy',
          driverAccountId: driver,
          cancelledByRoleCode: 'Q1',
          cancelledByAccountId: 'system',
          cancelReason: 'cleanup before dispatch QA',
        }),
      });
    } catch (error) {
      console.log(JSON.stringify({ driver, bookingCode: item.bookingCode, skipped: true, reason: error?.message || 'unknown' }));
    }
  }

  console.log(JSON.stringify({ driver, activeBefore: items.length }));
}
