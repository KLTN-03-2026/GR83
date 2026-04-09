import { bookRide, searchRides } from '../services/ride.service.js';

export async function searchRideController(request, response, next) {
  try {
    const result = await searchRides(request.body);
    response.json(result);
  } catch (error) {
    if (error.statusCode === 400) {
      response.status(400).json({
        success: false,
        message: error.message,
      });
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
    if (error.statusCode === 400) {
      response.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }

    next(error);
  }
}
