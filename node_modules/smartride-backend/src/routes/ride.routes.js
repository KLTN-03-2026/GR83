import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
	bookRideController,
	createTripIssueReportController,
	getTripIssueReportMetaController,
	getTripHistoryController,
	getTripInvoiceController,
	getTripMessagesController,
	getAdminDriverViolationDetailController,
	searchRideController,
	streamRideEventsController,
	sendTripMessageController,
	listAdminDriverViolationsController,
	submitRideRatingController,
	updateTripStatusController,
	getAdminComplaintDetailController,
	listAdminComplaintRequestsController,
	updateAdminComplaintDetailController,
	updateAdminDriverViolationController,
} from '../controllers/ride.controller.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const complaintUploadDirectory = path.resolve(__dirname, '../../uploads/complaints');

fs.mkdirSync(complaintUploadDirectory, { recursive: true });

const complaintUpload = multer({
	storage: multer.diskStorage({
		destination(request, file, callback) {
			callback(null, complaintUploadDirectory);
		},
		filename(request, file, callback) {
			const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
			const safeName = path.basename(file.originalname || 'attachment', extension).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
			callback(null, `${Date.now()}-${safeName}${extension}`);
		},
	}),
	limits: {
		fileSize: 5 * 1024 * 1024,
		files: 1,
	},
	fileFilter(request, file, callback) {
		if (!file.mimetype?.startsWith('image/')) {
			const error = new Error('Chỉ hỗ trợ tệp ảnh JPG, PNG hoặc WEBP tối đa 5MB.');
			error.statusCode = 400;
			callback(error);
			return;
		}

		callback(null, true);
	},
});

function complaintUploadMiddleware(request, response, next) {
	complaintUpload.single('attachment')(request, response, (error) => {
		if (!error) {
			next();
			return;
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			const oversizeError = new Error('Ảnh đính kèm chỉ được tối đa 5MB.');
			oversizeError.statusCode = 400;
			next(oversizeError);
			return;
		}

		error.statusCode = error.statusCode ?? 400;
		next(error);
	});
}

router.get('/stream', streamRideEventsController);
router.get('/:bookingCode/issues/meta', getTripIssueReportMetaController);
router.post('/:bookingCode/issues', complaintUploadMiddleware, createTripIssueReportController);
router.get('/:bookingCode/invoice', getTripInvoiceController);
router.get('/issues/admin', listAdminComplaintRequestsController);
router.get('/issues/admin/:complaintId', getAdminComplaintDetailController);
router.patch('/issues/admin/:complaintId', updateAdminComplaintDetailController);
router.get('/violations/admin', listAdminDriverViolationsController);
router.get('/violations/admin/:violationId', getAdminDriverViolationDetailController);
router.patch('/violations/admin/:violationId', updateAdminDriverViolationController);
router.get('/:bookingCode/messages', getTripMessagesController);
router.post('/:bookingCode/messages', sendTripMessageController);
router.patch('/:bookingCode/status', updateTripStatusController);
router.post('/:bookingCode/rating', submitRideRatingController);
router.get('/history', getTripHistoryController);
router.post('/search', searchRideController);
router.post('/book', bookRideController);

export default router;
