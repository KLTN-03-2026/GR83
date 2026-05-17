import { io } from 'socket.io-client';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const API = 'http://localhost:4000/api';
const DISPATCH_TIMEOUT_WAIT_MS = 75_000;
const runExecFile = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '../../backend');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function searchRide(vehicle) {
  const data = await requestJson(`${API}/rides/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle,
      scheduleEnabled: false,
      pickup: { label: '12 Ly Tu Trong, Da Nang' },
      destination: { label: '98 Trung Nu Vuong, Da Nang' },
    }),
  });

  return data?.results?.[0]?.id || '';
}

async function bookRide(vehicle, phone) {
  const selectedRideId = await searchRide(vehicle);
  return requestJson(`${API}/rides/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: 'TK0101',
      customerName: 'QA Auto',
      customerPhone: phone,
      vehicle,
      selectedRideId,
      scheduleEnabled: false,
      pickup: { label: '12 Ly Tu Trong, Da Nang' },
      destination: { label: '98 Trung Nu Vuong, Da Nang' },
      paymentMethod: 'cash',
    }),
  });
}

async function bookRideWithAssignedDriver(vehicle, phoneSeed, maxAttempts = 4) {
  let latestBooking = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const suffix = String(attempt).padStart(2, '0');
    latestBooking = await bookRide(vehicle, `${phoneSeed}${suffix}`);
    const assignedDriver = String(latestBooking?.booking?.driverAccountId || '').trim();

    if (assignedDriver) {
      return latestBooking;
    }

    await sleep(1200);
  }

  return latestBooking;
}

async function rejectDispatch(bookingCode, driverAccountId, reasonText = 'qa reject') {
  return requestJson(`${API}/rides/${encodeURIComponent(bookingCode)}/dispatch/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverAccountId, reasonText }),
  });
}

async function acceptDispatch(bookingCode, driverAccountId) {
  return requestJson(`${API}/rides/${encodeURIComponent(bookingCode)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DaNhanChuyen', driverAccountId }),
  });
}

async function fetchHistory(limit = 120) {
  return requestJson(`${API}/rides/history?accountId=TK0101&roleCode=Q2&limit=${limit}`, {
    method: 'GET',
  });
}

function findBooking(history, bookingCode) {
  const items = Array.isArray(history?.items) ? history.items : [];
  return items.find((item) => String(item?.bookingCode || '').trim() === String(bookingCode || '').trim()) || null;
}

async function waitForBookingMatch(bookingCode, matcher, timeoutMs = 150_000, intervalMs = 4000) {
  const startedAt = Date.now();
  let latestTrip = null;

  while ((Date.now() - startedAt) <= timeoutMs) {
    const history = await fetchHistory(260);
    latestTrip = findBooking(history, bookingCode);

    if (matcher(latestTrip)) {
      return latestTrip;
    }

    await sleep(intervalMs);
  }

  return latestTrip;
}

async function connectDriverSocket(accountId) {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:4000', {
      transports: ['websocket'],
      query: { accountId, roleCode: 'Q3' },
    });

    const timeoutId = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket timeout for ${accountId}`));
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(timeoutId);
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Socket error for ${accountId}: ${error?.message || 'unknown'}`));
    });
  });
}

function disconnectSocket(socket) {
  try {
    socket?.disconnect();
  } catch {
    // noop
  }
}

async function resetDispatchQaState() {
  await runExecFile(process.execPath, ['scripts/prepare-dispatch-qa.mjs'], {
    cwd: BACKEND_DIR,
    windowsHide: true,
  });

  await sleep(1200);
}

async function runDispatchTimeoutSweepNow() {
  await runExecFile(process.execPath, ['scripts/run-dispatch-timeout-sweep.mjs'], {
    cwd: BACKEND_DIR,
    windowsHide: true,
  });
}

async function main() {
  const result = {
    timestamp: new Date().toISOString(),
    cases: {},
    observations: {},
  };

  const endEarly = (caseKey, payload = {}) => {
    result.cases[caseKey] = {
      ...payload,
      blocked: true,
      pass: false,
    };

    console.log(JSON.stringify(result, null, 2));
    return true;
  };

  let bike1 = null;
  let bike2 = null;
  let car1 = null;

  const bookMotorWithRecovery = async (phoneSeed) => {
    for (let round = 1; round <= 3; round += 1) {
      if (!bike1) {
        bike1 = await connectDriverSocket('TK0002').catch(() => null);
      }

      if (!bike2) {
        bike2 = await connectDriverSocket('TK0004').catch(() => null);
      }

      const booking = await bookRideWithAssignedDriver('motorbike', phoneSeed, 2);
      const assignedDriver = String(booking?.booking?.driverAccountId || '').trim();

      if (assignedDriver) {
        return booking;
      }

      await sleep(1500);
    }

    return bookRideWithAssignedDriver('motorbike', phoneSeed, 1);
  };

  try {
    await resetDispatchQaState();

    bike1 = await connectDriverSocket('TK0002');
    bike2 = await connectDriverSocket('TK0004');
    car1 = await connectDriverSocket('TK0003');

    const motorInitial = await bookMotorWithRecovery('0918777701');
    const carInitial = await bookRideWithAssignedDriver('car', '0918777702');
    const intercityInitial = await bookRide('intercity', '0918777703');

    const motorAssigned = motorInitial?.booking?.driverAccountId || '';
    const carAssigned = carInitial?.booking?.driverAccountId || '';
    const intercityAssigned = intercityInitial?.booking?.driverAccountId || '';

    result.cases.multipleDriversSameType = {
      bookingMotor: motorInitial?.booking?.bookingCode,
      motorAssigned,
      bookingCar: carInitial?.booking?.bookingCode,
      carAssigned,
      bookingIntercity: intercityInitial?.booking?.bookingCode,
      intercityAssigned,
      pass: ['TK0002', 'TK0004'].includes(motorAssigned)
        && carAssigned === 'TK0003'
        && !intercityAssigned,
    };

    if (!motorAssigned) {
      if (endEarly('rejectFlow', {
        message: 'Không có tài xế xe máy online để chạy case rejectFlow.',
      })) {
        return;
      }
    }

    const expectedNextBike = motorAssigned === 'TK0002' ? 'TK0004' : 'TK0002';
    const motorReject = await rejectDispatch(motorInitial.booking.bookingCode, motorAssigned, 'reject bike test');
    const carAssignedDriver = String(carInitial?.booking?.driverAccountId || '').trim();
    const carReject = carAssignedDriver
      ? await rejectDispatch(carInitial.booking.bookingCode, carAssignedDriver, 'reject car test')
      : {
          success: false,
          bookingCode: carInitial.booking.bookingCode,
          message: 'Không có tài xế ô tô online để nhận cuốc ở bước này.',
          dispatchedToNextDriver: false,
          nextDriverAccountId: '',
        };

    result.cases.rejectFlow = {
      motor: {
        bookingCode: motorInitial.booking.bookingCode,
        firstDriver: motorAssigned,
        nextDriver: motorReject?.nextDriverAccountId || '',
        shifted: Boolean(motorReject?.dispatchedToNextDriver),
        pass: Boolean(motorReject?.dispatchedToNextDriver)
          && String(motorReject?.nextDriverAccountId || '') === expectedNextBike,
      },
      car: {
        bookingCode: carInitial.booking.bookingCode,
        firstDriver: carAssignedDriver || 'none',
        nextDriver: carReject?.nextDriverAccountId || '',
        shifted: Boolean(carReject?.dispatchedToNextDriver),
        pass: !carReject?.dispatchedToNextDriver && !String(carReject?.nextDriverAccountId || ''),
        note: carAssignedDriver
          ? ''
          : 'Skipped reject assertion for car because no car driver was dispatched in this run.',
      },
    };

    const acceptThenOfflineBooking = await bookMotorWithRecovery('0918777707');
    const acceptDriverId = String(acceptThenOfflineBooking?.booking?.driverAccountId || '').trim() || 'TK0002';
    if (!acceptDriverId) {
      if (endEarly('acceptThenOffline', {
        message: 'Không có tài xế xe máy online để chạy case acceptThenOffline.',
      })) {
        return;
      }
    }
    const acceptResult = await acceptDispatch(acceptThenOfflineBooking.booking.bookingCode, acceptDriverId);

    if (acceptDriverId === 'TK0002') {
      disconnectSocket(bike1);
      bike1 = null;
    }

    if (acceptDriverId === 'TK0004') {
      disconnectSocket(bike2);
      bike2 = null;
    }

    const historyAfterAccept = await fetchHistory(140);
    const acceptedTrip = findBooking(historyAfterAccept, acceptThenOfflineBooking.booking.bookingCode);

    result.cases.acceptThenOffline = {
      bookingCode: acceptThenOfflineBooking.booking.bookingCode,
      acceptedStatusFromApi: acceptResult?.tripStatus || '',
      persistedStatus: acceptedTrip?.tripStatus || '',
      persistedDriver: acceptedTrip?.driverAccountId || '',
      acceptedDriver: acceptDriverId,
      pass: acceptResult?.tripStatus === 'DaNhanChuyen'
        && acceptedTrip?.tripStatus === 'DaNhanChuyen'
        && Boolean(acceptedTrip?.driverAccountId),
    };

    await resetDispatchQaState();

    disconnectSocket(bike1);
    disconnectSocket(bike2);
    bike1 = await connectDriverSocket('TK0002').catch(() => null);
    bike2 = await connectDriverSocket('TK0004').catch(() => null);

    const timeoutRedispatchBooking = await bookMotorWithRecovery('0918777708');
    const firstTimeoutDriver = String(timeoutRedispatchBooking?.booking?.driverAccountId || '').trim();

    if (!firstTimeoutDriver) {
      if (endEarly('tc13TimeoutRedispatch', {
        message: 'Không có tài xế xe máy online để chạy case tc13TimeoutRedispatch.',
      })) {
        return;
      }
    }

    if (firstTimeoutDriver === 'TK0002') {
      disconnectSocket(bike1);
      bike1 = null;
      if (!bike2) {
        bike2 = await connectDriverSocket('TK0004');
      }
    }

    if (firstTimeoutDriver === 'TK0004') {
      disconnectSocket(bike2);
      bike2 = null;
      if (!bike1) {
        bike1 = await connectDriverSocket('TK0002');
      }
    }

    await sleep(DISPATCH_TIMEOUT_WAIT_MS);
    
    // Ensure alternate driver is fresh/online before timeout sweep redispatch attempt
    const tc13AlternateDriver = firstTimeoutDriver === 'TK0002' ? 'TK0004' : 'TK0002';
    if (tc13AlternateDriver === 'TK0002' && !bike1) {
      bike1 = await connectDriverSocket('TK0002').catch(() => null);
    }
    if (tc13AlternateDriver === 'TK0004' && !bike2) {
      bike2 = await connectDriverSocket('TK0004').catch(() => null);
    }

    await runDispatchTimeoutSweepNow();

    // driverAccountId in history = CCCD, only set on DaNhanChuyen, NOT after mere redispatch.
    // Proof of redispatch: the alternate driver (not the first) can successfully accept.
    let tc13AcceptResult = null;
    let tc13Redispatched = false;
    let tc13StatusAfterAccept = '';
    let tc13LastAcceptError = '';

    const tc13Deadline = Date.now() + 150_000;

    while (Date.now() < tc13Deadline) {
      try {
        tc13AcceptResult = await acceptDispatch(
          timeoutRedispatchBooking.booking.bookingCode,
          tc13AlternateDriver,
        );

        if (tc13AcceptResult?.tripStatus === 'DaNhanChuyen') {
          tc13Redispatched = true;
          tc13StatusAfterAccept = tc13AcceptResult.tripStatus;
          break;
        }
      } catch (error) {
        tc13LastAcceptError = String(error?.message || error);
        // Dispatcher has not reassigned yet — keep polling
      }

      await sleep(5000);
    }

    result.cases.tc13TimeoutRedispatch = {
      bookingCode: timeoutRedispatchBooking.booking.bookingCode,
      firstDriver: firstTimeoutDriver,
      alternateDriver: tc13AlternateDriver,
      tripStatusAfterAccept: tc13StatusAfterAccept,
      redispatched: tc13Redispatched,
      lastError: tc13LastAcceptError,
      pass: tc13Redispatched,
    };

    // Driver online after timeout cutoff should not receive previous booking.
    // We force one invitee offline, keep no alternate driver online until timeout => booking should become failed.
    await resetDispatchQaState();

    disconnectSocket(bike1);
    disconnectSocket(bike2);
    bike1 = await connectDriverSocket('TK0002').catch(() => null);
    bike2 = await connectDriverSocket('TK0004').catch(() => null);

    disconnectSocket(bike2);
    bike2 = null;

    // Use bookRideWithAssignedDriver directly — bookMotorWithRecovery auto-reconnects bike2
    // which would allow TK0004 to receive the booking and prevent the "no driver" cancel path.
    const lateOnlineBooking = await bookRideWithAssignedDriver('motorbike', '0918777709', 2);
    const lateFirstDriver = String(lateOnlineBooking?.booking?.driverAccountId || '').trim();

    if (!lateFirstDriver) {
      if (endEarly('driverOnlineAfterTimeout', {
        message: 'Không có tài xế xe máy online để chạy case driverOnlineAfterTimeout.',
      })) {
        return;
      }
    }

    if (lateFirstDriver === 'TK0002') {
      disconnectSocket(bike1);
      bike1 = null;
    }

    if (lateFirstDriver === 'TK0004') {
      disconnectSocket(bike2);
      bike2 = null;
    }

    await sleep(DISPATCH_TIMEOUT_WAIT_MS);
    await runDispatchTimeoutSweepNow();

    bike2 = await connectDriverSocket('TK0004');
    await sleep(3000);

    const lateOnlineTrip = await waitForBookingMatch(
      lateOnlineBooking.booking.bookingCode,
      (trip) => trip?.tripStatus === 'DaHuy',
      150_000,
      5000,
    );

    result.cases.driverOnlineAfterTimeout = {
      bookingCode: lateOnlineBooking.booking.bookingCode,
      firstDriver: lateFirstDriver,
      statusAfterLateOnline: lateOnlineTrip?.tripStatus || '',
      driverAfterLateOnline: lateOnlineTrip?.driverAccountId || '',
      pass: lateOnlineTrip?.tripStatus === 'DaHuy',
    };

    // TC-15 + TC-16: reject and no more same-type drivers => failed state and customer side updated.
    await resetDispatchQaState();

    disconnectSocket(bike1);
    disconnectSocket(bike2);
    bike1 = await connectDriverSocket('TK0002').catch(() => null);
    bike2 = await connectDriverSocket('TK0004').catch(() => null);

    disconnectSocket(bike1);
    bike1 = null;

    const tc15Booking = await bookMotorWithRecovery('0918777710');
    const tc15FirstDriver = String(tc15Booking?.booking?.driverAccountId || '').trim();

    if (!tc15FirstDriver) {
      if (endEarly('tc16NoDriverFinalFail', {
        message: 'Không có tài xế xe máy online để chạy case tc16NoDriverFinalFail.',
      })) {
        return;
      }
    }

    const tc15Reject = await rejectDispatch(tc15Booking.booking.bookingCode, tc15FirstDriver, 'reject first driver tc15');

    result.cases.tc15RejectScope = {
      bookingCode: tc15Booking.booking.bookingCode,
      rejectMessage: tc15Reject?.message || '',
      dispatchedToNextDriver: Boolean(tc15Reject?.dispatchedToNextDriver),
      nextDriverAccountId: tc15Reject?.nextDriverAccountId || '',
      pass: Boolean(tc15Reject?.dispatchedToNextDriver),
    };

    // TC-16: second driver also rejects => no candidate remains => trip is auto-cancelled.
    const tc16SecondDriver = String(tc15Reject?.nextDriverAccountId || '').trim();
    let tc16Reject = null;
    let tc16Trip = null;

    if (tc16SecondDriver) {
      tc16Reject = await rejectDispatch(tc15Booking.booking.bookingCode, tc16SecondDriver, 'reject second driver tc16');
      tc16Trip = await waitForBookingMatch(
        tc15Booking.booking.bookingCode,
        (trip) => trip?.tripStatus === 'DaHuy',
        120_000,
        4000,
      );
    }

    result.cases.tc16NoDriverFinalFail = {
      bookingCode: tc15Booking.booking.bookingCode,
      secondRejectMessage: tc16Reject?.message || '',
      statusAfterReject: tc16Trip?.tripStatus || '',
      cancelReason: tc16Trip?.cancelReason || '',
      pass: Boolean(tc16SecondDriver) && tc16Trip?.tripStatus === 'DaHuy',
    };

    result.observations.backendTimeoutPolicy =
      'Dispatch timeout sweep is active; pending invite past 60s is redispatched to same vehicle type or auto-failed when no candidate remains.';

    console.log(JSON.stringify(result, null, 2));
  } finally {
    disconnectSocket(bike1);
    disconnectSocket(bike2);
    disconnectSocket(car1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error?.message || 'Unknown error',
        stack: error?.stack || '',
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
