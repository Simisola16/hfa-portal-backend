import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import multer from 'multer';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import crypto from 'crypto';
import ImpersonationLog from '../models/ImpersonationLog.js';
import ImpersonationCode from '../models/ImpersonationCode.js';

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
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
  const userJson = req.user.toObject ? req.user.toObject() : req.user;
  if (req.user.is_impersonation) {
    userJson.is_impersonation = true;
    userJson.admin_name = req.user.admin_name;
  }
  res.json({ user: userJson, profile: userJson });
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, async (req, res) => {
  if (req.user.is_impersonation || req.is_impersonation) {
    // Check if security sensitive fields are being updated
    if (req.body.phone || req.body.email || req.body.password) {
      return res.status(403).json({ error: 'Action forbidden. Impersonated sessions cannot change security-sensitive settings.' });
    }
  }

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
  if (req.user.is_impersonation || req.is_impersonation) {
    return res.status(403).json({ error: 'Action forbidden. Impersonated sessions cannot change profile avatar.' });
  }

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

// POST /api/auth/impersonate/exchange (Exchanges single-use opaque code for JWT)
router.post('/impersonate/exchange', async (req, res) => {
  console.log('EXCHANGE BODY RECEIVED:', req.body);
  const { code } = req.body;
  console.log('EXCHANGE CODE EXTRACTED:', code);
  if (!code) {
    return res.status(400).json({ error: 'Exchange code is required.' });
  }

  try {
    const codeRecord = await ImpersonationCode.findOne({ code });
    if (!codeRecord) {
      return res.status(401).json({ error: 'Invalid or expired impersonation code.' });
    }

    const { token, client_id, admin_id } = codeRecord;

    // Delete the code immediately so it cannot be reused (Single-Use!)
    await ImpersonationCode.deleteOne({ _id: codeRecord._id });

    // Find the client user details to return in payload
    const clientUser = await User.findById(client_id);
    if (!clientUser) {
      return res.status(404).json({ error: 'Client account not found.' });
    }

    res.json({
      token,
      user: {
        id: clientUser._id,
        email: clientUser.email,
        full_name: clientUser.full_name,
        company_name: clientUser.company_name,
        role: clientUser.role,
        is_impersonation: true,
        impersonated_by: admin_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/impersonate/end (Ends impersonation session, updates log ended_at)
router.post('/impersonate/end', authenticateToken, async (req, res) => {
  if (!req.user.is_impersonation) {
    return res.status(400).json({ error: 'No active impersonation session to end.' });
  }

  try {
    // Update the log record to set ended_at
    await ImpersonationLog.findOneAndUpdate(
      { admin_id: req.user.impersonated_by, client_id: req.user._id, ended_at: { $exists: false } },
      { ended_at: new Date() },
      { sort: { started_at: -1 } }
    );

    res.json({ message: 'Impersonation session ended successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/impersonate/logs (Admin-only audit trail list)
router.get('/impersonate/logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logs = await ImpersonationLog.find()
      .populate('admin_id', 'full_name email')
      .populate('client_id', 'company_name full_name email')
      .sort({ started_at: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/impersonate/:clientId (Admin only)
router.post('/impersonate/:clientId', authenticateToken, requireAdmin, async (req, res) => {
  const { clientId } = req.params;

  // EXPLICIT SECURITY CHECK: Reject if requesting token is already an impersonated session
  if (req.user.is_impersonation || req.is_impersonation) {
    return res.status(403).json({ error: 'Nested impersonation is forbidden. You cannot impersonate a client while already using an impersonated session.' });
  }

  try {
    const targetClient = await User.findById(clientId);
    if (!targetClient) {
      return res.status(404).json({ error: 'Target client user not found.' });
    }
    if (targetClient.role !== 'client') {
      return res.status(400).json({ error: 'Impersonation is restricted to client accounts only.' });
    }

    // Generate short-lived impersonation JWT (1 hour)
    const token = jwt.sign(
      { 
        id: targetClient._id, 
        role: 'client', 
        is_impersonation: true, 
        impersonated_by: req.user._id,
        admin_name: req.user.full_name 
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Generate secure opaque code (single-use)
    const code = crypto.randomBytes(32).toString('hex');

    // Save exchange code (expires in 60s)
    await new ImpersonationCode({
      code,
      token,
      admin_id: req.user._id,
      client_id: targetClient._id
    }).save();

    // Log the start of impersonation
    await new ImpersonationLog({
      admin_id: req.user._id,
      client_id: targetClient._id,
      started_at: new Date()
    }).save();

    res.status(201).json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
