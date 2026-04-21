import { asyncHandler } from '../utils/asyncHandler.js';
import { getDatabaseHealthStatus, getHealthStatus } from '../services/health.service.js';

export function healthController(request, response) {
  response.json(getHealthStatus());
}

export const databaseHealthController = asyncHandler(async (request, response) => {
  const healthStatus = await getDatabaseHealthStatus();
  response.status(healthStatus.success ? 200 : 503).json(healthStatus);
});
