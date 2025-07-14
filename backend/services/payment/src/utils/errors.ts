export class AppError extends Error {
  public statusCode: number;
  public errors?: any[];

  constructor(message: string, statusCode: number, errors?: any[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const handleError = (error: any): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    error.message || 'Internal server error',
    error.statusCode || 500
  );
};