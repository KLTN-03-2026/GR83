import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
  acknowledgeDriverVehicleChangeResolutionController,
  approveVehicleChangeRequestController,
  approveDriverController,
  createDriverSupportRequestController,
  createVehicleChangeRequestController,
  createDriverController,
  getDriverSupportOverviewController,
  getDriverProfileController,
  getDriverWalletController,
  getVehicleChangeRequestDetailController,
  listDriverSupportRequestsController,
  listDriverVehicleChangeResolutionsController,
  listDriverWalletTransactionsController,
  listDriversController,
  listPendingVehicleChangeRequestsController,
  lockDriverController,
  registerDriverApplicationController,
  rejectVehicleChangeRequestController,
  rejectDriverController,
  topupDriverWalletController,
  transferDriverWalletController,
  unlockDriverController,
  uploadDriverDocumentsController,
  updateDriverController,
} from '../controllers/driver.controller.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const driverUploadRootDirectory = path.resolve(__dirname, '../../uploads/drivers');
const driverUploadFieldDirectories = {
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

Object.values(driverUploadFieldDirectories).forEach((directoryName) => {
  fs.mkdirSync(path.join(driverUploadRootDirectory, directoryName), { recursive: true });
});

const driverDocumentsStorage = multer.diskStorage({
  destination(request, file, callback) {
    const uploadDirectoryName = driverUploadFieldDirectories[file.fieldname] ?? 'misc';
    const uploadDirectory = path.join(driverUploadRootDirectory, uploadDirectoryName);
    fs.mkdirSync(uploadDirectory, { recursive: true });
    callback(null, uploadDirectory);
  },
  filename(request, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeFileName = path.basename(file.originalname || 'document', extension).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
    callback(null, `${Date.now()}-${safeFileName}${extension}`);
  },
});

const driverDocumentsUpload = multer({
  storage: driverDocumentsStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 12,
  },
  fileFilter(request, file, callback) {
    if (!file.mimetype?.startsWith('image/')) {
      const fileTypeError = new Error('Chỉ chấp nhận tệp ảnh khi tải hồ sơ tài xế.');
      fileTypeError.statusCode = 400;
      callback(fileTypeError);
      return;
    }

    callback(null, true);
  },
});

function driverDocumentsUploadMiddleware(request, response, next) {
  driverDocumentsUpload.fields(
    Object.keys(driverUploadFieldDirectories).map((fieldName) => ({
      name: fieldName,
      maxCount: 1,
    })),
  )(request, response, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      const oversizeError = new Error('Mỗi ảnh hồ sơ tài xế chỉ được tối đa 5MB.');
      oversizeError.statusCode = 400;
      next(oversizeError);
      return;
    }

    error.statusCode = error.statusCode ?? 400;
    next(error);
  });
}

router.get('/', listDriversController);
router.post('/', createDriverController);
router.post('/applications', registerDriverApplicationController);
router.post('/upload-documents', driverDocumentsUploadMiddleware, uploadDriverDocumentsController);
router.put('/:driverId', updateDriverController);
router.patch('/:driverId/approve', approveDriverController);
router.patch('/:driverId/reject', rejectDriverController);
router.patch('/:driverId/lock', lockDriverController);
router.patch('/:driverId/unlock', unlockDriverController);
router.get('/:driverId/profile', getDriverProfileController);
router.get('/:driverId/wallet', getDriverWalletController);
router.get('/:driverId/wallet/transactions', listDriverWalletTransactionsController);
router.post('/:driverId/wallet/topup', topupDriverWalletController);
router.post('/:driverId/wallet/transfer', transferDriverWalletController);
router.get('/:driverId/support-overview', getDriverSupportOverviewController);
router.get('/:driverId/support-requests', listDriverSupportRequestsController);
router.post('/:driverId/support-requests', createDriverSupportRequestController);
router.post('/:driverId/vehicle-change-requests', createVehicleChangeRequestController);
router.get('/:driverId/vehicle-change-requests/resolutions', listDriverVehicleChangeResolutionsController);
router.patch(
  '/:driverId/vehicle-change-requests/:requestId/acknowledge',
  acknowledgeDriverVehicleChangeResolutionController,
);
router.get('/vehicle-change-requests/pending', listPendingVehicleChangeRequestsController);
router.get('/vehicle-change-requests/:requestId', getVehicleChangeRequestDetailController);
router.patch('/vehicle-change-requests/:requestId/approve', approveVehicleChangeRequestController);
router.patch('/vehicle-change-requests/:requestId/reject', rejectVehicleChangeRequestController);

export default router;
