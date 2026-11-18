class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
    // F-53: an unexpected error's detail (stack, database message) goes to
    // the server log only. A deliberate ApiError (e.g. the 502 for a dial
    // the provider refused) keeps its plain message.
    if (!(err instanceof ApiError)) return res.status(status).json({ error: 'Something went wrong' });
  }
  res.status(status).json({ error: err.message || 'Request failed' });
}

function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound, ApiError };
