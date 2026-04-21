import {
  approveDriver,
  createDriver,
  listDrivers,
  lockDriver,
  registerDriverApplication,
  rejectDriver,
  unlockDriver,
  updateDriver,
} from '../services/driver.service.js';

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
    const result = await lockDriver(request.params.driverId);
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
