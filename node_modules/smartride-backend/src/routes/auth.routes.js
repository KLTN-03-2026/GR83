import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
	changePasswordController,
	createAccountController,
	deleteAccountController,
	credentialLoginController,
	getAccountDetailsController,
	getProfileController,
	listAccountsController,
	googleLoginController,
	googleSignupController,
	lockAccountController,
	requestForgotPasswordCodeController,
	requestSignupVerificationCodeController,
	updateProfileAvatarController,
	updateAccountController,
	updateProfileController,
	unlockAccountController,
	verifyForgotPasswordCodeController,
	verifySignupVerificationCodeController,
} from '../controllers/auth.controller.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarUploadDir = path.resolve(__dirname, '../../uploads/avatars');

fs.mkdirSync(avatarUploadDir, { recursive: true });

const avatarStorage = multer.diskStorage({
	destination(request, file, callback) {
		callback(null, avatarUploadDir);
	},
	filename(request, file, callback) {
		const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
		const safeIdentifier = String(
			request.params.accountId ?? request.body.accountId ?? request.body.identifier ?? 'guest',
		)
			.replace(/[^a-zA-Z0-9_-]/g, '-')
			.slice(0, 40);
		callback(null, `${Date.now()}-${safeIdentifier}${extension}`);
	},
});

const avatarUpload = multer({
	storage: avatarStorage,
	limits: {
		fileSize: 2 * 1024 * 1024,
	},
	fileFilter(request, file, callback) {
		if (!file.mimetype?.startsWith('image/')) {
			const fileTypeError = new Error('Chỉ chấp nhận tệp ảnh cho avatar.');
			fileTypeError.statusCode = 400;
			callback(fileTypeError);
			return;
		}

		callback(null, true);
	},
});

function avatarUploadMiddleware(request, response, next) {
	avatarUpload.single('avatar')(request, response, (error) => {
		if (!error) {
			next();
			return;
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			const oversizeError = new Error('Kích thước ảnh tối đa là 2MB.');
			oversizeError.statusCode = 400;
			next(oversizeError);
			return;
		}

		error.statusCode = error.statusCode ?? 400;
		next(error);
	});
}

router.post('/login', credentialLoginController);
router.post('/signup', verifySignupVerificationCodeController);
router.post('/signup/request-code', requestSignupVerificationCodeController);
router.post('/forgot-password/request-code', requestForgotPasswordCodeController);
router.post('/forgot-password/verify-code', verifyForgotPasswordCodeController);
router.post('/change-password', changePasswordController);
router.get('/profile', getProfileController);
router.get('/accounts', listAccountsController);
router.get('/accounts/:accountId', getAccountDetailsController);
router.post('/accounts', createAccountController);
router.put('/accounts/:accountId', avatarUploadMiddleware, updateAccountController);
router.delete('/accounts/:accountId', deleteAccountController);
router.patch('/accounts/:accountId/lock', lockAccountController);
router.patch('/accounts/:accountId/unlock', unlockAccountController);
router.put('/profile', updateProfileController);
router.post('/profile/avatar', avatarUploadMiddleware, updateProfileAvatarController);
router.post('/google-login', googleLoginController);
router.post('/google-signup', googleSignupController);

export default router;
