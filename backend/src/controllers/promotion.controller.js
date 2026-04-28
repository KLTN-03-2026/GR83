import {
  createPromotion,
  deletePromotion,
  getPromotion,
  listPromotions,
  updatePromotion,
} from '../services/promotion.service.js';
import { broadcastAdminEvent } from '../services/ride.realtime.service.js';

function sendKnownPromotionError(response, error) {
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

export async function listPromotionsController(request, response, next) {
  try {
    const result = await listPromotions(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownPromotionError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getPromotionController(request, response, next) {
  try {
    const result = await getPromotion(request.params.promotionId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownPromotionError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createPromotionController(request, response, next) {
  try {
    const result = await createPromotion(request.body);
    broadcastAdminEvent('admin.promotion.changed', { action: 'create', promotionId: result?.promotion?.id ?? result?.id });
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownPromotionError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updatePromotionController(request, response, next) {
  try {
    const result = await updatePromotion(request.params.promotionId, request.body);
    broadcastAdminEvent('admin.promotion.changed', { action: 'update', promotionId: request.params.promotionId });
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownPromotionError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function deletePromotionController(request, response, next) {
  try {
    const result = await deletePromotion(request.params.promotionId);
    broadcastAdminEvent('admin.promotion.changed', { action: 'delete', promotionId: request.params.promotionId });
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownPromotionError(response, error)) {
      return;
    }

    next(error);
  }
}