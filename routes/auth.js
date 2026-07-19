import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import multer from 'multer';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

import crypto from 'crypto';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, company_name, phone, country } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const user = new User({
      email,
      password,
      full_name,
      company_name,
      phone,
      country,
      role: 'client',
      verification_token: verificationToken,
      is_verified: false
    });

    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/verify-email?token=${verificationToken}`;
    
    // Always print verification link in development to simplify testing
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('\n=========================================');
      console.log('[DEVELOPMENT] EMAIL VERIFICATION LINK FOR:', email);
      console.log(verificationUrl);
      console.log('=========================================\n');
    }

    try {
      const emailResponse = await resend.emails.send({
        from: 'HFA Portal <info@theyoungpioneers.com>',
        to: email,
        subject: 'Verify Your Email - HFA Portal',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:32px">
            <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
              <h1 style="color:white;margin:0;font-size:28px">Halal Food Authority</h1>
              <p style="color:#bbf7d0;margin-top:8px">Email Verification Required</p>
            </div>
            <div style="background:white;border-radius:12px;padding:32px">
              <h2 style="color:#166534">Hello, ${full_name}!</h2>
              <p style="color:#4b5563">Thank you for registering. Please verify your email address to activate your account and access the portal.</p>
              <div style="text-align:center;margin:32px 0">
                <a href="${verificationUrl}" style="background:#15803d;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">Verify Email Address</a>
              </div>
              <p style="color:#94a3b8;font-size:12px;text-align:center">If the button above doesn't work, copy and paste this link into your browser:<br>${verificationUrl}</p>
            </div>
          </div>
        `,
      });
      
      if (emailResponse.error) {
        console.error('Resend API Error during registration:', emailResponse.error);
      } else {
        console.log('Verification email sent successfully:', emailResponse);
      }
    } catch (emailErr) {
      console.error('Resend Email SMTP/Connection Error:', emailErr);
    }

    res.status(201).json({
      message: 'Account created! Please check your email to verify your account.',
      verificationUrl: (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) ? verificationUrl : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({ verification_token: req.params.token });
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });

    user.is_verified = true;
    user.verification_token = undefined;
    await user.save();

    res.json({ message: 'Email verified successfully! You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login  (client portal — unchanged)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_verified && user.role !== 'admin') {
      return res.status(403).json({ error: 'Please verify your email address before logging in.' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      profile: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/admin/login  (admin portal only — username + password, role must be 'admin')
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Look up by username only — this field only exists on admin accounts
    const user = await User.findOne({ username });

    // Reject if: user not found, wrong password, OR not an admin role.
    // Use a single generic message to avoid info leakage.
    if (!user || user.role !== 'admin' || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      },
      profile: {
        id: user._id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/auth/profile
router.get('/profile', authenticateToken, async (req, res) => {
  res.json({ user: req.user, profile: req.user });
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { full_name, company_name, phone, address, postcode, country } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { full_name, company_name, phone, address, postcode, country, updated_at: new Date() },
      { new: true }
    );
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile/avatar
router.put('/profile/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    // Upload to MongoDB GridFS
    const avatarUrl = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar_url: avatarUrl },
      { new: true }
    );
    res.json({ user, avatar_url: avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_password_token = resetToken;
    user.reset_password_expiry = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetUrl = `${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    try {
      await resend.emails.send({
        from: 'HFA Portal <info@theyoungpioneers.com>',
        to: email,
        subject: 'Reset Your Password - HFA Portal',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:32px">
            <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
              <h1 style="color:white;margin:0;font-size:28px">Halal Food Authority</h1>
              <p style="color:#bbf7d0;margin-top:8px">Password Reset Request</p>
            </div>
            <div style="background:white;border-radius:12px;padding:32px">
              <h2 style="color:#166534">Hello, ${user.full_name}!</h2>
              <p style="color:#4b5563">We received a request to reset your password. If you didn't make this request, you can safely ignore this email.</p>
              <div style="text-align:center;margin:32px 0">
                <a href="${resetUrl}" style="background:#15803d;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">Reset Password</a>
              </div>
              <p style="color:#94a3b8;font-size:12px;text-align:center">This link will expire in 1 hour.<br>If the button doesn't work, copy and paste this link:<br>${resetUrl}</p>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Resend Reset Email Error:', emailErr);
    }

    res.json({ message: 'Password reset link sent to your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const user = await User.findOne({
      reset_password_token: token,
      reset_password_expiry: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    user.password = password;
    user.reset_password_token = undefined;
    user.reset_password_expiry = undefined;
    await user.save();

    res.json({ message: 'Password reset successful! You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
