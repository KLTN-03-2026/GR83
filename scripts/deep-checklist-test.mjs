const base = 'http://127.0.0.1:4000/api';

const results = [];
const ctx = {};

async function callApi(method, path, body = null) {
  const url = `${base}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    const rawText = await response.text();
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { rawText };
    }

    return {
      ok: response.ok,
      status: response.status,
      body: data,
      error: response.ok ? null : (data?.message || rawText || `HTTP ${response.status}`),
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error?.message || 'Unknown fetch error',
      url,
    };
  }
}

function addCheck(module, step, resp, assertFn, expected) {
  let pass = false;
  let detail = '';

  try {
    pass = Boolean(assertFn(resp));
  } catch (error) {
    pass = false;
    detail = error?.message || 'Assertion error';
  }

  if (!detail) {
    detail = resp.ok ? String(resp.body?.message || 'OK') : String(resp.body?.message || resp.error || 'Request failed');
  }

  results.push({ module, step, pass, httpStatus: resp.status, expected, detail });
}

function printResults() {
  for (const item of results) {
    const mark = item.pass ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${item.module} | ${item.step} | HTTP ${item.httpStatus} | ${item.detail}`);
  }

  const byModuleMap = new Map();
  for (const item of results) {
    if (!byModuleMap.has(item.module)) {
      byModuleMap.set(item.module, { module: item.module, pass: 0, fail: 0, total: 0 });
    }

    const group = byModuleMap.get(item.module);
    group.total += 1;
    if (item.pass) group.pass += 1;
    else group.fail += 1;
  }

  const summary = {
    total: results.length,
    pass: results.filter((x) => x.pass).length,
    fail: results.filter((x) => !x.pass).length,
    byModule: Array.from(byModuleMap.values()),
  };

  console.log('---SUMMARY---');
  console.log(JSON.stringify(summary, null, 2));
}

async function run() {
  const stamp = Date.now();
  const uniqueDigits = String(stamp).slice(-10);
  const uniqueCccd = `2${uniqueDigits.slice(0, 9)}11`;
  const uniqueBankAccount = `79${String(stamp).slice(-8)}`;

  // 1) Auth
  let resp = await callApi('POST', '/auth/login', { identifier: 'admin@smartride.local', password: '123' });
  addCheck('Auth', 'Login admin', resp, (r) => r.ok && r.body?.success === true && r.body?.user?.id === 'TK0001', 'Dang nhap admin thanh cong');

  resp = await callApi('POST', '/auth/login', { identifier: 'hoangthie@smartride.local', password: '123' });
  addCheck('Auth', 'Login tai xe TK0006', resp, (r) => r.ok && r.body?.success === true && r.body?.user?.id === 'TK0006', 'Dang nhap tai xe thanh cong');

  resp = await callApi('GET', '/auth/profile?accountId=TK0001');
  addCheck('Auth', 'Lay profile admin', resp, (r) => r.ok && r.body?.success === true && r.body?.profile?.id === 'TK0001', 'Lay profile theo accountId');

  // 2) Driver application + admin approval
  const tempPhone = `0929${String(stamp).slice(-6)}`;
  const tempEmail = `driver.app.${stamp}@smartride.local`;
  const tempUser = `driver_app_${stamp}`;

  resp = await callApi('POST', '/auth/accounts', {
    username: tempUser,
    fullName: 'Test Driver Applicant',
    email: tempEmail,
    phone: tempPhone,
    roleCode: 'Q2',
    status: 'HoatDong',
    address: 'Hai Chau, Da Nang',
    gender: 'Nam',
  });
  addCheck('Dang ky tai xe', 'Tao account customer tam', resp, (r) => r.ok && r.body?.success === true && r.body?.account?.id, 'Tao account moi de nop ho so');
  ctx.tempAccountId = resp.ok ? String(resp.body?.account?.id || '') : '';

  resp = await callApi('POST', '/drivers/applications', {
    accountId: ctx.tempAccountId,
    identifier: tempEmail,
    fullName: 'Test Driver Applicant',
    phone: tempPhone,
    email: tempEmail,
    avatar: '/uploads/avatars/test-driver-applicant.png',
    address: 'Hai Chau, Da Nang',
    cccd: uniqueCccd,
    backgroundImage: '/uploads/drivers/backgrounds/test-driver-lylich.png',
    identityImages: {
      front: '/uploads/drivers/identities/test-driver-id-front.png',
      back: '/uploads/drivers/identities/test-driver-id-back.png',
    },
    licenseImages: {
      front: '/uploads/drivers/licenses/test-driver-license-front.png',
      back: '/uploads/drivers/licenses/test-driver-license-back.png',
    },
    vehicleInfo: {
      licensePlate: '43G-54321',
      vehicleType: 'car',
      vehicleName: 'Mazda 3',
      brand: 'Mazda',
      model: '3 AT',
      color: 'Do',
      year: '2022',
      seatCount: '4',
      images: {
        front: '/uploads/drivers/vehicles/test-driver-car-front.png',
        side: '/uploads/drivers/vehicles/test-driver-car-side.png',
        rear: '/uploads/drivers/vehicles/test-driver-car-rear.png',
      },
    },
    emergencyContact: {
      relationship: 'Anh',
      fullName: 'Nguyen Van Emergency',
      phone: '0934444555',
      address: 'Thanh Khe, Da Nang',
    },
    bank: {
      accountHolder: 'Test Driver Applicant',
      accountNumber: uniqueBankAccount,
      bankName: 'Vietcombank',
    },
  });
  addCheck('Dang ky tai xe', 'Nop ho so tai xe', resp, (r) => r.ok && r.body?.success === true && r.body?.driver?.id, 'Nop ho so cho duyet thanh cong');
  ctx.newDriverId = resp.ok ? String(resp.body?.driver?.id || '') : '';

  if (ctx.newDriverId) {
    resp = await callApi('PATCH', `/drivers/${encodeURIComponent(ctx.newDriverId)}/approve`);
    addCheck('Admin duyet ho so', 'Duyet tai xe moi', resp, (r) => r.ok && r.body?.success === true && r.body?.driver?.status === 'active', 'Ho so chuyen active');

    resp = await callApi('GET', `/drivers/${encodeURIComponent(ctx.newDriverId)}/profile`);
    addCheck('Admin duyet ho so', 'Kiem tra profile sau duyet', resp, (r) => r.ok && r.body?.success === true && r.body?.driver?.vehicleInfo?.vehicleType === 'car', 'Vehicle info dung sau duyet');
  } else {
    results.push({
      module: 'Admin duyet ho so',
      step: 'Bo qua duyet vi nop ho so that bai',
      pass: false,
      httpStatus: 0,
      expected: 'Co newDriverId',
      detail: 'Khong tao duoc ho so tai xe moi',
    });
  }

  // 3) Driver wallet
  const driverIdForWallet = ctx.newDriverId || 'TK0006';

  resp = await callApi('GET', `/drivers/${encodeURIComponent(driverIdForWallet)}/wallet`);
  addCheck('Vi tai xe', 'Lay vi tai xe', resp, (r) => r.ok && r.body?.success === true && r.body?.wallet?.driverId === driverIdForWallet, 'Lay vi thanh cong');

  resp = await callApi('POST', `/drivers/${encodeURIComponent(driverIdForWallet)}/wallet/topup`, {
    amount: 45000,
    method: 'momo',
    referenceCode: `TOPUP-${stamp}`,
  });
  addCheck('Vi tai xe', 'Nap vi tai xe', resp, (r) => r.ok && r.body?.success === true && Number(r.body?.transaction?.amount) > 0, 'Ghi nhan topup');

  resp = await callApi('POST', `/drivers/${encodeURIComponent(driverIdForWallet)}/wallet/transfer`, {
    recipientPhone: '0901111111',
    amount: 10000,
    description: 'Test transfer driver wallet',
  });
  addCheck('Vi tai xe', 'Chuyen tien vi tai xe', resp, (r) => r.ok && r.body?.success === true && Number(r.body?.transaction?.amount) < 0, 'Ghi nhan transfer');

  // 4) Customer wallet
  resp = await callApi('GET', '/customers/TK0101/wallet');
  addCheck('Vi khach hang', 'Lay vi khach hang', resp, (r) => r.ok && r.body?.success === true && r.body?.wallet?.customerId === 'TK0101', 'Lay vi customer');

  resp = await callApi('POST', '/customers/TK0101/wallet/topup', {
    amount: 30000,
    method: 'momo',
    referenceCode: `C-TOPUP-${stamp}`,
  });
  addCheck(
    'Vi khach hang',
    'Nap vi khach hang',
    resp,
    (r) => r.ok && r.body?.success === true && Number(r.body?.wallet?.balance) >= 0,
    'Topup customer',
  );

  resp = await callApi('POST', '/customers/TK0101/wallet/transfer', {
    recipientPhone: '0910000002',
    amount: 7000,
    description: 'Test transfer customer wallet',
  });
  addCheck('Vi khach hang', 'Chuyen tien vi khach hang', resp, (r) => r.ok && r.body?.success === true && Number(r.body?.transaction?.amount) < 0, 'Transfer customer');

  // 5) Ride booking
  resp = await callApi('POST', '/rides/search', {
    vehicle: 'car',
    scheduleEnabled: false,
    pickup: {
      label: 'San bay Da Nang',
      address: 'San bay Da Nang',
      position: { lat: 16.0439, lng: 108.1983 },
    },
    destination: {
      label: 'Cau Rong Da Nang',
      address: 'Cau Rong Da Nang',
      position: { lat: 16.0615, lng: 108.2277 },
    },
  });
  addCheck('Ride booking', 'Tim chuyen / bao gia', resp, (r) => r.ok && r.body?.success === true && Array.isArray(r.body?.results) && r.body.results.length > 0, 'Tim duoc danh sach xe');

  let selectedRideId = '';
  if (resp.ok && Array.isArray(resp.body?.results) && resp.body.results.length > 0) {
    selectedRideId = String(resp.body.results[0].id || '');
    ctx.searchResp = resp.body;
  }

  if (selectedRideId) {
    resp = await callApi('POST', '/rides/book', {
      accountId: 'TK0101',
      vehicle: ctx.searchResp.vehicle,
      scheduleEnabled: Boolean(ctx.searchResp.scheduleEnabled),
      pickup: ctx.searchResp.pickup,
      destination: ctx.searchResp.destination,
      selectedRideId,
      paymentMethod: 'cash',
      paymentProvider: '',
      customerName: 'Pham Thi D',
      customerPhone: '0910000001',
    });
    addCheck('Ride booking', 'Dat chuyen', resp, (r) => r.ok && r.body?.success === true && r.body?.booking?.bookingCode, 'Tao booking thanh cong');

    const bookingCode = resp.ok ? String(resp.body?.booking?.bookingCode || '') : '';
    if (bookingCode) {
      resp = await callApi('GET', `/rides/${encodeURIComponent(bookingCode)}/payment-status?accountId=TK0101`);
      addCheck('Ride booking', 'Kiem tra trang thai thanh toan', resp, (r) => r.ok && r.body?.success === true, 'Lay payment status');
    }
  }

  // 6) Notification
  resp = await callApi('GET', '/notifications?recipient=customer&status=all');
  addCheck('Notification', 'Danh sach thong bao', resp, (r) => r.ok && r.body?.success === true && Array.isArray(r.body?.notifications), 'Lay list thong bao');

  const sendAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  resp = await callApi('POST', '/notifications', {
    title: `Thong bao test ${stamp}`,
    content: 'Noi dung test thong bao',
    recipient: 'customer',
    accountId: 'TK0101',
    sendAt,
  });
  addCheck('Notification', 'Tao thong bao', resp, (r) => r.ok && r.body?.success === true && Number(r.body?.notification?.id) > 0, 'Tao thong bao thanh cong');

  const createdNotiId = resp.ok ? Number(resp.body?.notification?.id || 0) : 0;
  if (createdNotiId > 0) {
    resp = await callApi('PUT', `/notifications/${createdNotiId}`, {
      title: `Thong bao test ${stamp} - updated`,
      content: 'Noi dung da cap nhat',
      recipient: 'customer',
      accountId: 'TK0101',
      status: 'scheduled',
      sendAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    });
    addCheck('Notification', 'Cap nhat thong bao', resp, (r) => r.ok && r.body?.success === true && String(r.body?.notification?.title || '').includes('updated'), 'Cap nhat thong bao thanh cong');

    resp = await callApi('DELETE', `/notifications/${createdNotiId}`);
    addCheck('Notification', 'Xoa thong bao test', resp, (r) => r.ok && r.body?.success === true, 'Xoa thong bao test thanh cong');
  }

  printResults();
}

run().catch((error) => {
  console.error('Fatal test error:', error?.message || error);
  process.exitCode = 1;
});
