import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRoutes from './routes/index.js';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFoundMiddleware } from './middlewares/notFound.middleware.js';

export const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDirectory = path.resolve(__dirname, '../uploads');

const allowedOrigins = String(env.corsOrigin ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

function isLocalhostOrigin(origin) {
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

app.use(
	cors({
		origin(origin, callback) {
			if (!origin) {
				callback(null, true);
				return;
			}

			if (allowedOrigins.includes(origin) || isLocalhostOrigin(origin)) {
				callback(null, true);
				return;
			}

			callback(new Error(`CORS blocked for origin ${origin}`));
		},
	}),
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use('/uploads', express.static(uploadsDirectory));
app.use('/api', apiRoutes);
app.use(notFoundMiddleware);
app.use(errorHandler);
