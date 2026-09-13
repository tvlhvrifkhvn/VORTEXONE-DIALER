// Express 4 doesn't catch rejected promises from async route handlers —
// wrap them so thrown/rejected errors reach errorHandler via next(err).
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
