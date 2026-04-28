import {
  acknowledgeDriverVehicleChangeResolution,
  approveVehicleChangeRequest,
  approveDriver,
  createVehicleChangeRequest,
  createDriver,
  getDriverProfile,
  getDriverWallet,
  getVehicleChangeRequestDetail,
  listDrivers,
  listDriverVehicleChangeResolutions,
  listDriverWalletTransactions,
  listPendingVehicleChangeRequests,
  lockDriver,
  registerDriverApplication,
  rejectVehicleChangeRequest,
  rejectDriver,
  topupDriverWallet,
  transferDriverWallet,
  unlockDriver,
  updateDriver,
} from '../services/driver.service.js';
import { broadcastAdminEvent } from '../services/ride.realtime.service.js';

const uploadedDriverDocumentDirectories = {
  portrait: 'portraits',
  identityFront: 'identities',
  identityBack: 'identities',
  licenseFront: 'licenses',
  licenseBack: 'licenses',
  background: 'backgrounds',
  vehicleFront: 'vehicles',
  vehicleSide: 'vehicles',
  vehicleRear: 'vehicles',
};

function sendKnownDriverError(response, error) {
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

export async function listDriversController(request, response, next) {
  try {
    const result = await listDrivers(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createDriverController(request, response, next) {
  try {
    const result = await createDriver(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function registerDriverApplicationController(request, response, next) {
  try {
    const result = await registerDriverApplication(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function uploadDriverDocumentsController(request, response, next) {
  try {
    const uploadedFiles = request.files ?? {};

    if (Object.keys(uploadedFiles).length === 0) {
      response.status(400).json({
        success: false,
        message: 'Vui lòng tải lên ít nhất một tệp ảnh hồ sơ tài xế.',
      });
      return;
    }

    const uploadedDocumentUrls = Object.entries(uploadedDriverDocumentDirectories).reduce(
      (accumulator, [fieldName, directory]) => {
        const uploadedFile = Array.isArray(uploadedFiles[fieldName]) ? uploadedFiles[fieldName][0] : null;

        if (uploadedFile?.filename) {
          accumulator[fieldName] = `/uploads/drivers/${directory}/${uploadedFile.filename}`;
        }

        return accumulator;
      },
      {},
    );

    response.status(200).json({
      success: true,
      message: 'Đã tải tệp hồ sơ tài xế thành công.',
      files: uploadedDocumentUrls,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateDriverController(request, response, next) {
  try {
    const result = await updateDriver(request.params.driverId, request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function approveDriverController(request, response, next) {
  try {
    const result = await approveDriver(request.params.driverId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function rejectDriverController(request, response, next) {
  try {
    const result = await rejectDriver(request.params.driverId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function lockDriverController(request, response, next) {
  try {
    const driverId = request.params.driverId;
    const result = await lockDriver(driverId);
    broadcastAdminEvent('admin.account.changed', { action: 'locked', accountId: String(driverId) });
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function unlockDriverController(request, response, next) {
  try {
    const result = await unlockDriver(request.params.driverId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getDriverProfileController(request, response, next) {
  try {
    const result = await getDriverProfile(request.params.driverId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getDriverWalletController(request, response, next) {
  try {
    const result = await getDriverWallet(request.params.driverId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listDriverWalletTransactionsController(request, response, next) {
  try {
    const result = await listDriverWalletTransactions(request.params.driverId, request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function topupDriverWalletController(request, response, next) {
  try {
    const result = await topupDriverWallet(request.params.driverId, request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function transferDriverWalletController(request, response, next) {
  try {
    const result = await transferDriverWallet(request.params.driverId, request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createVehicleChangeRequestController(request, response, next) {
  try {
    const result = await createVehicleChangeRequest(request.params.driverId, request.body);

    broadcastAdminEvent('admin.driver.vehicle-change', {
      action: 'requested',
      request: result.request,
    });

    response.status(201).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listPendingVehicleChangeRequestsController(request, response, next) {
  try {
    const result = await listPendingVehicleChangeRequests();
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getVehicleChangeRequestDetailController(request, response, next) {
  try {
    const result = await getVehicleChangeRequestDetail(request.params.requestId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function approveVehicleChangeRequestController(request, response, next) {
  try {
    const result = await approveVehicleChangeRequest(request.params.requestId, {
      ...request.body,
      approvedByAccountId: request.body?.approvedByAccountId ?? request.body?.adminAccountId,
    });

    broadcastAdminEvent('admin.driver.vehicle-change', {
      action: 'resolved',
      request: result.request,
      outcome: 'approved',
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function rejectVehicleChangeRequestController(request, response, next) {
  try {
    const result = await rejectVehicleChangeRequest(request.params.requestId, {
      ...request.body,
      approvedByAccountId: request.body?.approvedByAccountId ?? request.body?.adminAccountId,
    });

    broadcastAdminEvent('admin.driver.vehicle-change', {
      action: 'resolved',
      request: result.request,
      outcome: 'rejected',
      message: result.request?.rejectReason || 'Yêu cầu thay đổi thông tin xe đã bị từ chối.',
    });

    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listDriverVehicleChangeResolutionsController(request, response, next) {
  try {
    const result = await listDriverVehicleChangeResolutions(request.params.driverId, request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function acknowledgeDriverVehicleChangeResolutionController(request, response, next) {
  try {
    const result = await acknowledgeDriverVehicleChangeResolution(request.params.driverId, request.params.requestId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownDriverError(response, error)) {
      return;
    }

    next(error);
  }
}
