import {
  createNotification,
  deleteNotification,
  getNotification,
  listNotifications,
  updateNotification,
} from '../services/notification.service.js';

function sendKnownNotificationError(response, error) {
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

export async function listNotificationsController(request, response, next) {
  try {
    const result = await listNotifications(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownNotificationError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getNotificationController(request, response, next) {
  try {
    const result = await getNotification(request.params.notificationId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownNotificationError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createNotificationController(request, response, next) {
  try {
    const result = await createNotification(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownNotificationError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateNotificationController(request, response, next) {
  try {
    const result = await updateNotification(request.params.notificationId, request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownNotificationError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function deleteNotificationController(request, response, next) {
  try {
    const result = await deleteNotification(request.params.notificationId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownNotificationError(response, error)) {
      return;
    }

    next(error);
  }
}
