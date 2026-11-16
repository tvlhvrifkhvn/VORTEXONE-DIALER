const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const config = require('../config');

/** Best-effort JWT decode for rate-limit keying only — falls back to IP for
 * unauthenticated requests (e.g. the login attempt itself) or an invalid
 * token, rather than rejecting the request (that's requireAuth's job). */
function userOrIpKey(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      return `user:${payload.sub}`;
    } catch {
      // fall through to IP-based keying
    }
  }
  return `ip:${req.ip}`;
}

// Tests only (NODE_ENV=test, set by tests/run.js): RATE_LIMIT_API_MAX and
// RATE_LIMIT_LOGIN_MAX raise the two limits for the safety-net suite. Outside
// tests they are ignored and the limits below always apply.
function maxFor(envName, normal) {
  if (process.env.NODE_ENV !== 'test') return normal;
  const raised = Number(process.env[envName]);
  return Number.isInteger(raised) && raised > 0 ? raised : normal;
}

// 5 login attempts per minute per IP.
const LOGIN_MAX = 5;
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: maxFor('RATE_LIMIT_LOGIN_MAX', LOGIN_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in a minute.' },
});

// 100 requests per minute per user (falls back to per-IP when unauthenticated).
const API_MAX = 100;
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: maxFor('RATE_LIMIT_API_MAX', API_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests — slow down and try again shortly.' },
});

module.exports = { loginLimiter, apiLimiter, maxFor, LOGIN_MAX, API_MAX };
