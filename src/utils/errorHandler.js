const { ValidationError } = require('./validation');

/**
 * Standard error response formatter
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

/**
 * Formats error for API response
 * @param {Error} error - The error to format
 * @returns {Object} - Formatted error response
 */
const formatErrorResponse = (error) => {
  const response = {
    success: false,
    error: {
      message: error.message || 'An unexpected error occurred',
      code: error.code || 'INTERNAL_ERROR',
    },
  };

  if (error instanceof ValidationError) {
    response.error.field = error.field;
    response.error.code = 'VALIDATION_ERROR';
  }

  return response;
};

/**
 * Express middleware for handling errors
 * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  let statusCode = 500;
  
  if (err instanceof AppError) {
    statusCode = err.statusCode;
  } else if (err instanceof ValidationError) {
    statusCode = 400;
  }

  const response = formatErrorResponse(err);
  res.status(statusCode).json(response);
};

/**
 * Wraps async route handlers to catch errors
 * @param {Function} fn - The async function to wrap
 * @returns {Function} - Wrapped function
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Safely executes a function and handles errors
 * @param {Function} fn - The function to execute
 * @param {*} defaultValue - Default value to return on error
 * @returns {*} - Result or default value
 */
const safeExecute = async (fn, defaultValue = null) => {
  try {
    return await fn();
  } catch (error) {
    console.error('Safe execute error:', error);
    return defaultValue;
  }
};

/**
 * Creates a standardized logger
 * @param {string} context - The context/module name
 * @returns {Object} - Logger functions
 */
const createLogger = (context) => {
  const formatMessage = (level, message, data = null) => {
    const timestamp = new Date().toISOString();
    const logData = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${logData}`;
  };

  return {
    info: (message, data) => console.log(formatMessage('info', message, data)),
    warn: (message, data) => console.warn(formatMessage('warn', message, data)),
    error: (message, data) => console.error(formatMessage('error', message, data)),
    debug: (message, data) => {
      if (process.env.NODE_ENV === 'development') {
        console.debug(formatMessage('debug', message, data));
      }
    },
  };
};

module.exports = {
  AppError,
  formatErrorResponse,
  errorHandler,
  asyncHandler,
  safeExecute,
  createLogger,
};