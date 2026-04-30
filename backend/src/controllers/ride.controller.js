import { bookRide, getTripHistory, getTripInvoice, searchRides, submitRideRating, updateTripStatus } from '../services/ride.service.js';
import {
  createTripIssueReport,
  getAdminComplaintDetail,
  getTripIssueReportMeta,
  listAdminComplaintRequests,
  updateAdminComplaintDetail,
} from '../services/complaint.service.js';
import { getTripMessages, sendTripMessage } from '../services/tripChat.service.js';
import { subscribeRideEvents } from '../services/ride.realtime.service.js';

function sendKnownRideError(response, error) {
  if (!error?.statusCode) {
    return false;
  }

  response.status(error.statusCode).json({
    success: false,
    message: error.message,
    ...(error.details ?? {}),
  });

  return true;
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeRoleCode(value) {
  const normalizedValue = normalizeText(value).toUpperCase();

  if (normalizedValue === 'Q1' || normalizedValue === 'Q2' || normalizedValue === 'Q3') {
    return normalizedValue;
  }

  const roleToken = normalizeText(value).toLowerCase();

  if (roleToken.includes('driver') || roleToken.includes('taixe')) {
    return 'Q3';
  }

  if (roleToken.includes('customer') || roleToken.includes('khach')) {
    return 'Q2';
  }

  if (roleToken.includes('admin') || roleToken.includes('quantri')) {
    return 'Q1';
  }

  return '';
}

function shouldDeliverRideEventToClient(event, accountId, roleCode) {
  const normalizedRoleCode = normalizeRoleCode(roleCode);
  const normalizedAccountId = normalizeText(accountId);
  const eventType = normalizeText(event?.type ?? '').toLowerCase();
  const eventCustomerAccountId = normalizeText(event?.customerAccountId ?? event?.booking?.customerAccountId);
  const eventDriverAccountId = normalizeText(event?.driverAccountId ?? event?.booking?.driverAccountId);
  const eventTripStatus = normalizeText(event?.tripStatus ?? event?.booking?.tripStatus).toLowerCase();

  if (normalizedRoleCode === 'Q3') {
    if (eventType === 'ride.booking.created') {
      if (!normalizedAccountId || !eventCustomerAccountId) {
        return true;
      }

      return eventCustomerAccountId !== normalizedAccountId;
    }

    if (eventType === 'ride.trip.status.updated') {
      if (eventTripStatus === 'danhanchuyen' || eventTripStatus === 'dahuy' || eventTripStatus === 'cancelled') {
        if (!normalizedAccountId || !eventCustomerAccountId) {
          return true;
        }

        return eventCustomerAccountId !== normalizedAccountId;
      }

      if (!normalizedAccountId || !eventDriverAccountId) {
        return false;
      }

      return eventDriverAccountId === normalizedAccountId;
    }

    if (eventType === 'ride.trip.rating.updated') {
      if (!normalizedAccountId || !eventDriverAccountId) {
        return false;
      }

      return eventDriverAccountId === normalizedAccountId;
    }
  }

  if (normalizedRoleCode === 'Q2') {
    if (!normalizedAccountId || !eventCustomerAccountId) {
      return false;
    }

    return eventCustomerAccountId === normalizedAccountId;
  }

  if (eventType === 'ride.trip.message.created') {
    if (normalizedRoleCode === 'Q3') {
      return Boolean(normalizedAccountId && eventDriverAccountId && eventDriverAccountId === normalizedAccountId);
    }

    if (normalizedRoleCode === 'Q2') {
      return Boolean(normalizedAccountId && eventCustomerAccountId && eventCustomerAccountId === normalizedAccountId);
    }
  }

  return normalizedRoleCode === 'Q1' || !normalizedRoleCode;
}

export async function streamRideEventsController(request, response, next) {
  try {
    const accountId = normalizeText(request.query?.accountId);
    const roleCode = normalizeRoleCode(request.query?.roleCode ?? request.query?.role);

    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders?.();
    response.write(': ride-event-stream connected\n\n');

    const unsubscribe = subscribeRideEvents((event) => {
      if (!shouldDeliverRideEventToClient(event, accountId, roleCode)) {
        return;
      }

      response.write(`event: ${normalizeText(event?.type ?? 'ride.event') || 'ride.event'}\n`);
      response.write(`data: ${JSON.stringify(event ?? {})}\n\n`);
    });

    const heartbeatTimerId = setInterval(() => {
      if (!response.writableEnded) {
        response.write(': heartbeat\n\n');
      }
    }, 25_000);

    if (typeof heartbeatTimerId.unref === 'function') {
      heartbeatTimerId.unref();
    }

    const cleanup = () => {
      clearInterval(heartbeatTimerId);
      unsubscribe();

      if (!response.writableEnded) {
        response.end();
      }
    };

    request.on('close', cleanup);
    request.on('aborted', cleanup);
  } catch (error) {
    next(error);
  }
}

export async function searchRideController(request, response, next) {
  try {
    const result = await searchRides(request.body);
    response.json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function bookRideController(request, response, next) {
  try {
    const result = await bookRide(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getTripHistoryController(request, response, next) {
  try {
    const result = await getTripHistory(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getTripInvoiceController(request, response, next) {
  try {
    const result = await getTripInvoice({
      ...request.query,
      bookingCode: request.params.bookingCode ?? request.query?.bookingCode,
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateTripStatusController(request, response, next) {
  try {
    const result = await updateTripStatus({
      ...request.body,
      bookingCode: request.params.bookingCode ?? request.body?.bookingCode,
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function submitRideRatingController(request, response, next) {
  try {
    const result = await submitRideRating({
      ...request.body,
      bookingCode: request.params.bookingCode ?? request.body?.bookingCode,
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getTripIssueReportMetaController(request, response, next) {
  try {
    const result = await getTripIssueReportMeta(request.params.bookingCode, request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createTripIssueReportController(request, response, next) {
  try {
    const attachmentUrl = request.file?.filename ? `/uploads/complaints/${request.file.filename}` : '';
    const result = await createTripIssueReport(request.params.bookingCode, {
      ...request.body,
      attachmentUrl,
    });

    response.status(201).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listAdminComplaintRequestsController(request, response, next) {
  try {
    const result = await listAdminComplaintRequests(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getAdminComplaintDetailController(request, response, next) {
  try {
    const result = await getAdminComplaintDetail(request.params.complaintId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateAdminComplaintDetailController(request, response, next) {
  try {
    const result = await updateAdminComplaintDetail(request.params.complaintId, request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getTripMessagesController(request, response, next) {
  try {
    const result = await getTripMessages({
      ...request.query,
      bookingCode: request.params.bookingCode ?? request.query?.bookingCode,
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function sendTripMessageController(request, response, next) {
  try {
    const result = await sendTripMessage({
      ...request.body,
      bookingCode: request.params.bookingCode ?? request.body?.bookingCode,
    });

    response.status(201).json(result);
  } catch (error) {
    if (sendKnownRideError(response, error)) {
      return;
    }

    next(error);
  }
}
