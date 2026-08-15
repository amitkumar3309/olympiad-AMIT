export class ApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Not authenticated'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Not authorized'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message);
  }

  /**
   * An upstream provider failed. Distinct from 500 on purpose: this backend is working,
   * something it depends on is not, and the caller's retry has a real chance of
   * succeeding where a retry against a genuine 500 usually does not.
   */
  static badGateway(message: string): ApiError {
    return new ApiError(502, message);
  }

  /**
   * A capability this deployment has not been configured for — an unset API key rather
   * than a broken request. 503 rather than 500 because nothing is wrong with the code
   * or the request, and rather than 400 because the caller did nothing incorrect.
   */
  static serviceUnavailable(message: string): ApiError {
    return new ApiError(503, message);
  }
}
