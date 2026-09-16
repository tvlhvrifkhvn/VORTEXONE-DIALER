const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { ApiError } = require('../middleware/errorHandler');

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function login(email, password) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, 'Invalid email or password');

  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

  return { token, user: toPublicUser(user) };
}

async function getById(userId) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/** Updates the logged-in user's display name and/or email. Powers the
 * Settings page's Profile section. */
async function updateProfile(userId, { name, email }) {
  if (!name || !email) {
    throw new ApiError(400, 'name and email are required');
  }
  try {
    const { rows } = await db.query(
      'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
      [name, email, userId]
    );
    if (!rows[0]) throw new ApiError(404, 'User not found');
    return toPublicUser(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'That email is already in use');
    throw err;
  }
}

module.exports = { login, getById, updateProfile };
