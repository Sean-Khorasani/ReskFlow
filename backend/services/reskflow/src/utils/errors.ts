export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 400, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 404, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code?: string) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code?: string) {
    super(message, 403, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Too many requests', code?: string) {
    super(message, 429, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable', code?: string) {
    super(message, 503, code);
  }
}

// Delivery-specific errors
export class DeliveryError extends AppError {
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message, statusCode, code);
  }
}

export class DeliveryNotFoundError extends NotFoundError {
  constructor(reskflowId: string) {
    super(`Delivery with ID ${reskflowId} not found`, 'DELIVERY_NOT_FOUND');
  }
}

export class DeliveryAlreadyAssignedError extends ConflictError {
  constructor(reskflowId: string) {
    super(`Delivery ${reskflowId} is already assigned to a driver`, 'DELIVERY_ALREADY_ASSIGNED');
  }
}

export class DeliveryNotAssignedError extends ValidationError {
  constructor(reskflowId: string) {
    super(`Delivery ${reskflowId} is not assigned to any driver`, 'DELIVERY_NOT_ASSIGNED');
  }
}

export class DeliveryStatusError extends ValidationError {
  constructor(currentStatus: string, requiredStatus: string) {
    super(
      `Invalid reskflow status. Current: ${currentStatus}, Required: ${requiredStatus}`,
      'INVALID_DELIVERY_STATUS'
    );
  }
}

export class DeliveryTimeoutError extends DeliveryError {
  constructor(reskflowId: string) {
    super(
      `Delivery ${reskflowId} has timed out and could not be assigned`,
      408,
      'DELIVERY_TIMEOUT'
    );
  }
}

export class DeliveryLocationError extends ValidationError {
  constructor(message: string) {
    super(message, 'INVALID_DELIVERY_LOCATION');
  }
}

// Driver-specific errors
export class DriverError extends AppError {
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message, statusCode, code);
  }
}

export class DriverNotFoundError extends NotFoundError {
  constructor(driverId: string) {
    super(`Driver with ID ${driverId} not found`, 'DRIVER_NOT_FOUND');
  }
}

export class DriverNotAvailableError extends ConflictError {
  constructor(driverId: string) {
    super(`Driver ${driverId} is not available for reskflow assignment`, 'DRIVER_NOT_AVAILABLE');
  }
}

export class DriverAlreadyAssignedError extends ConflictError {
  constructor(driverId: string) {
    super(`Driver ${driverId} is already assigned to another reskflow`, 'DRIVER_ALREADY_ASSIGNED');
  }
}

export class DriverOutOfRangeError extends ValidationError {
  constructor(driverId: string, distance: number) {
    super(
      `Driver ${driverId} is out of reskflow range (${distance}km)`,
      'DRIVER_OUT_OF_RANGE'
    );
  }
}

export class DriverLocationError extends ValidationError {
  constructor(message: string) {
    super(message, 'INVALID_DRIVER_LOCATION');
  }
}

export class DriverCapacityExceededError extends ConflictError {
  constructor(driverId: string) {
    super(`Driver ${driverId} has reached maximum reskflow capacity`, 'DRIVER_CAPACITY_EXCEEDED');
  }
}

// Route and Maps errors
export class RouteError extends AppError {
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message, statusCode, code);
  }
}

export class RouteCalculationError extends RouteError {
  constructor(origin: string, destination: string) {
    super(
      `Failed to calculate route from ${origin} to ${destination}`,
      422,
      'ROUTE_CALCULATION_FAILED'
    );
  }
}

export class InvalidLocationError extends ValidationError {
  constructor(location: string) {
    super(`Invalid location provided: ${location}`, 'INVALID_LOCATION');
  }
}

export class GoogleMapsApiError extends ServiceUnavailableError {
  constructor(message: string) {
    super(`Google Maps API error: ${message}`, 'GOOGLE_MAPS_API_ERROR');
  }
}

export class RouteOptimizationError extends RouteError {
  constructor(message: string) {
    super(`Route optimization failed: ${message}`, 422, 'ROUTE_OPTIMIZATION_FAILED');
  }
}

// Tracking errors
export class TrackingError extends AppError {
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message, statusCode, code);
  }
}

export class TrackingNotFoundError extends NotFoundError {
  constructor(reskflowId: string) {
    super(`Tracking information for reskflow ${reskflowId} not found`, 'TRACKING_NOT_FOUND');
  }
}

export class InvalidTrackingDataError extends ValidationError {
  constructor(message: string) {
    super(`Invalid tracking data: ${message}`, 'INVALID_TRACKING_DATA');
  }
}

export class TrackingUpdateError extends TrackingError {
  constructor(reskflowId: string, reason: string) {
    super(
      `Failed to update tracking for reskflow ${reskflowId}: ${reason}`,
      422,
      'TRACKING_UPDATE_FAILED'
    );
  }
}

// WebSocket errors
export class WebSocketError extends AppError {
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message, statusCode, code);
  }
}

export class WebSocketConnectionError extends WebSocketError {
  constructor(message: string) {
    super(`WebSocket connection error: ${message}`, 503, 'WEBSOCKET_CONNECTION_ERROR');
  }
}

export class WebSocketAuthError extends UnauthorizedError {
  constructor(message: string = 'WebSocket authentication failed') {
    super(message, 'WEBSOCKET_AUTH_ERROR');
  }
}

// External service errors
export class ExternalServiceError extends ServiceUnavailableError {
  constructor(service: string, message: string) {
    super(`${service} service error: ${message}`, 'EXTERNAL_SERVICE_ERROR');
  }
}

export class OrderServiceError extends ExternalServiceError {
  constructor(message: string) {
    super('Order', message);
  }
}

export class UserServiceError extends ExternalServiceError {
  constructor(message: string) {
    super('User', message);
  }
}

export class NotificationServiceError extends ExternalServiceError {
  constructor(message: string) {
    super('Notification', message);
  }
}

// Database errors
export class DatabaseError extends AppError {
  constructor(message: string, code?: string) {
    super(`Database error: ${message}`, 500, code || 'DATABASE_ERROR');
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor() {
    super('Failed to connect to database', 'DATABASE_CONNECTION_ERROR');
  }
}

export class DatabaseQueryError extends DatabaseError {
  constructor(query: string, error: string) {
    super(`Query failed: ${query} - ${error}`, 'DATABASE_QUERY_ERROR');
  }
}

// Business logic errors
export class BusinessLogicError extends ValidationError {
  constructor(message: string, code?: string) {
    super(message, code || 'BUSINESS_LOGIC_ERROR');
  }
}

export class DeliveryWindowExpiredError extends BusinessLogicError {
  constructor(reskflowId: string) {
    super(
      `Delivery window has expired for reskflow ${reskflowId}`,
      'DELIVERY_WINDOW_EXPIRED'
    );
  }
}

export class InsufficientDriversError extends BusinessLogicError {
  constructor(area: string) {
    super(
      `Insufficient drivers available in area: ${area}`,
      'INSUFFICIENT_DRIVERS'
    );
  }
}

export class DeliveryDistanceTooFarError extends BusinessLogicError {
  constructor(distance: number, maxDistance: number) {
    super(
      `Delivery distance (${distance}km) exceeds maximum allowed distance (${maxDistance}km)`,
      'DELIVERY_DISTANCE_TOO_FAR'
    );
  }
}

export class DeliverySchedulingError extends BusinessLogicError {
  constructor(message: string) {
    super(`Delivery scheduling error: ${message}`, 'DELIVERY_SCHEDULING_ERROR');
  }
}

// Helper function to check if error is operational
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

// Helper function to format error for API response
export function formatErrorResponse(error: Error) {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
      },
    };
  }

  return {
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    },
  };
}