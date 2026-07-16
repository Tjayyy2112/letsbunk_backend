import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../db/models/User.js';
import Settings from '../db/models/Settings.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_super_secret_key_123';

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
};

// Register
router.post('/register', async (req, res) => {
  const { email, password, name, recoveryKey } = req.body;

  if (!email || !password || !recoveryKey) {
    return res.status(400).json({ error: 'Email, password, and recovery key are required' });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Hash recovery key
    const recoveryHash = await bcrypt.hash(recoveryKey, salt);

    const user = await User.create({
      email: email.toLowerCase(),
      password_hash: hash,
      name: name || '',
      recovery_key_hash: recoveryHash
    });

    await Settings.create({ user_id: user._id, target_attendance: 75, notifications: true });

    const token = generateToken(user._id);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Forgot Password (Reset)
router.post('/forgot-password', async (req, res) => {
  const { email, recoveryKey, newPassword } = req.body;

  if (!email || !recoveryKey || !newPassword) {
    return res.status(400).json({ error: 'Email, recovery key, and new password are required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.recovery_key_hash) {
      return res.status(400).json({ error: 'Recovery key not configured for this user. Please set it in settings.' });
    }

    const isMatch = await bcrypt.compare(recoveryKey, user.recovery_key_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid recovery key' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    user.password_hash = hash;
    await user.save();

    res.json({ ok: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change Password (from Settings)
router.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  try {
    const user = await User.findById(req.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    user.password_hash = hash;
    await user.save();

    res.json({ ok: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change Recovery Key (from Settings)
router.put('/change-recovery-key', authMiddleware, async (req, res) => {
  const { currentPassword, recoveryKey } = req.body;

  if (!currentPassword || !recoveryKey) {
    return res.status(400).json({ error: 'Current password and new recovery key are required' });
  }

  try {
    const user = await User.findById(req.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const salt = await bcrypt.genSalt(10);
    const recoveryHash = await bcrypt.hash(recoveryKey, salt);

    user.recovery_key_hash = recoveryHash;
    await user.save();

    res.json({ ok: true, message: 'Recovery key updated successfully' });
  } catch (err) {
    console.error('Change recovery key error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
