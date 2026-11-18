const express = require('express');
const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const { token, user } = await authService.login(email, password);
    res.json({ token, user });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await authService.getById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  })
);

router.put(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email } = req.body;
    const user = await authService.updateProfile(req.user.sub, { name, email });
    res.json({ user });
  })
);

module.exports = router;
