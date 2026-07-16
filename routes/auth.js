import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import User from '../db/models/User.js';
import Settings from '../db/models/Settings.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_super_secret_key_123';

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
};

// nodemailer Transporter config
const transporterConfig = {
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  connectionTimeout: 10000, // 10 seconds connection timeout
  socketTimeout: 10000,     // 10 seconds socket timeout
};

if (process.env.SMTP_HOST === 'smtp.gmail.com') {
  transporterConfig.service = 'gmail';
} else {
  transporterConfig.host = process.env.SMTP_HOST || '';
  transporterConfig.port = parseInt(process.env.SMTP_PORT || '587');
  transporterConfig.secure = process.env.SMTP_SECURE === 'true';
}

const transporter = nodemailer.createTransport(transporterConfig);

// Register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const user = await User.create({
      email: email.toLowerCase(),
      password_hash: hash,
      name: name || ''
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

// Send OTP
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.reset_otp = otp;
    user.reset_otp_expires = expires;
    user.reset_otp_attempts = 0;
    await user.save();

    const resendApiKey = process.env.RESEND_API_KEY;
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const brevoApiKey = process.env.BREVO_API_KEY;
    const smtpConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

    const emailSubject = "Let'sBunk Password Reset Code";
    const emailHtml = `<div style="font-family: sans-serif; padding: 20px; background: #07110F; color: #FFFFFF; border-radius: 12px; max-width: 480px;">
                 <h2 style="color: #8ED8CC;">Let'sBunk Password Reset</h2>
                 <p>You requested to reset your password. Use the following 6-digit verification code:</p>
                 <div style="font-size: 28px; font-weight: bold; background: rgba(142,216,204,0.1); border: 1px dashed #8ED8CC; color: #8ED8CC; padding: 12px; border-radius: 8px; text-align: center; margin: 20px 0; letter-spacing: 4px;">
                   ${otp}
                 </div>
                 <p style="font-size: 12px; color: #a0a0a0;">This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
               </div>`;
    const emailText = `Your password reset code is ${otp}. It will expire in 10 minutes.`;

    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "noreply@letsbunk.app";
    const fromName = process.env.SMTP_FROM_NAME || "Let'sBunk";

    if (brevoApiKey) {
      // Use Brevo HTTP API (Free 300 emails/day to ANY recipient without domain verification!)
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': brevoApiKey
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: user.email }],
          subject: emailSubject,
          htmlContent: emailHtml
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Brevo API returned an error');
      }
      res.json({ ok: true, message: 'OTP sent successfully to your email.' });
    } else if (sendgridApiKey) {
      // Use SendGrid HTTP API (Free 100 emails/day to ANY recipient using a Single Sender verified Gmail!)
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sendgridApiKey}`
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: user.email }] }],
          from: { email: fromEmail, name: fromName },
          subject: emailSubject,
          content: [
            { type: 'text/plain', value: emailText },
            { type: 'text/html', value: emailHtml }
          ]
        })
      });

      if (!response.ok) {
        const resText = await response.text();
        throw new Error(resText || 'SendGrid API returned an error');
      }
      res.json({ ok: true, message: 'OTP sent successfully to your email.' });
    } else if (resendApiKey) {
      // Use Resend HTTP API
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: process.env.SMTP_FROM || `${fromName} <onboarding@resend.dev>`,
          to: user.email,
          subject: emailSubject,
          text: emailText,
          html: emailHtml
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Resend API returned an error');
      }
      res.json({ ok: true, message: 'OTP sent successfully to your email.' });
    } else if (smtpConfigured) {
      // Use traditional SMTP
      const mailOptions = {
        from: process.env.SMTP_FROM || `"${fromName}" <${fromEmail}>`,
        to: user.email,
        subject: emailSubject,
        text: emailText,
        html: emailHtml
      };
      await transporter.sendMail(mailOptions);
      res.json({ ok: true, message: 'OTP sent successfully to your email.' });
    } else {
      // Developer fallback logging OTP to console
      console.log(`\n==========================================`);
      console.log(`[DEVELOPER FALLBACK] No email API or SMTP configured.`);
      console.log(`OTP Code for ${user.email}: ${otp}`);
      console.log(`==========================================\n`);
      res.json({ ok: true, message: 'SMTP/API not configured. OTP printed to server console logs.' });
    }
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please check server logs.' });
  }
});

// Reset Password (Verify OTP and save new password)
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.reset_otp || !user.reset_otp_expires) {
      return res.status(400).json({ error: 'No active password reset request found. Please request a new code.' });
    }

    if (new Date() > user.reset_otp_expires) {
      user.reset_otp = null;
      user.reset_otp_expires = null;
      await user.save();
      return res.status(400).json({ error: 'OTP code has expired. Please request a new code.' });
    }

    if (user.reset_otp_attempts >= 3) {
      user.reset_otp = null;
      user.reset_otp_expires = null;
      await user.save();
      return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    if (user.reset_otp !== otp.trim()) {
      user.reset_otp_attempts += 1;
      await user.save();
      return res.status(401).json({ error: `Invalid OTP code. Attempts remaining: ${3 - user.reset_otp_attempts}` });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    user.password_hash = hash;
    user.reset_otp = null;
    user.reset_otp_expires = null;
    user.reset_otp_attempts = 0;
    await user.save();

    res.json({ ok: true, message: 'Password reset successfully!' });
  } catch (err) {
    console.error('Reset password error:', err);
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

export default router;
