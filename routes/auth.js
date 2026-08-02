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
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

/* ─── Email template ─────────────────────────────────────────────── */
function buildVerificationEmail(fullName, verificationUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
          <div style="font-size:13px;color:#bbf7d0;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Halal Food Authority</div>
          <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:800;letter-spacing:-0.5px">HFA Certification Portal</h1>
          <p style="color:#bbf7d0;margin:10px 0 0;font-size:14px">Email Verification</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:40px">
          <h2 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 16px">Hello, ${fullName}!</h2>
          <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 24px">
            Thank you for registering with the <strong>HFA Certification Portal</strong>. To activate your account and begin your certification journey, please verify your email address by clicking the button below.
          </p>

          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 32px">
            <a href="${verificationUrl}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px;letter-spacing:0.2px">
              ✓ Verify Email Address
            </a>
          </td></tr></table>

          <!-- Info box -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:18px 20px;margin-bottom:24px">
            <p style="color:#166534;font-size:13px;font-weight:600;margin:0 0 6px">⏱ This link expires in 24 hours</p>
            <p style="color:#166534;font-size:13px;margin:0">After expiry, you can request a new verification link from the login page.</p>
          </td></tr></table>

          <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:24px 0 0;text-align:center">
            If the button above doesn't work, copy and paste this link into your browser:<br>
            <a href="${verificationUrl}" style="color:#15803d;word-break:break-all">${verificationUrl}</a>
          </p>
          <p style="color:#cbd5e1;font-size:11px;text-align:center;margin:12px 0 0">
            If you did not create an account, you can safely ignore this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px;margin:0">© ${new Date().getFullYear()} Halal Food Authority · All rights reserved</p>
          <p style="color:#cbd5e1;font-size:11px;margin:6px 0 0">This email was sent because you registered at the HFA Portal.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}


router.post('/register', async (req, res) => {
  const { email, password, full_name, company_name, phone, country } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = new User({
      email,
      password,
      full_name,
      company_name,
      phone,
      country,
      role: 'client',
      verification_token: verificationToken,
      verification_token_expiry: verificationExpiry,
      is_verified: false,
    });

    await user.save();

    // Build the verification link using the production URL (always)
    const clientUrl = process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173';
    const verificationUrl = `${clientUrl}/verify-email?token=${verificationToken}`;

    // In development when no Resend key is set, log the link and return it
    // so developers can test without a real email. In production this block
    // is never reached because RESEND_API_KEY is always present on Render.
    const isDevNoResend = (!process.env.RESEND_API_KEY) &&
      (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);

    if (isDevNoResend) {
      console.log('\n=========================================');
      console.log('[DEV — no Resend key] VERIFICATION LINK FOR:', email);
      console.log(verificationUrl);
      console.log('=========================================\n');
      return res.status(201).json({
        message: 'Account created. (Dev mode — no Resend key; use the link below to verify.)',
        verificationUrl,
      });
    }

    // Also log in development when Resend IS present (useful to verify without email client)
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('\n=========================================');
      console.log('[DEV] EMAIL VERIFICATION LINK FOR:', email);
      console.log(verificationUrl);
      console.log('=========================================\n');
    }

    // Send the real verification email via Resend
    try {
      const emailResponse = await resend.emails.send({
        from: emailFrom,
        to: email,
        subject: 'Verify Your Email – HFA Certification Portal',
        html: buildVerificationEmail(full_name, verificationUrl),
      });
      if (emailResponse.error) {
        console.error('[Resend] Verification email error for', email, ':', emailResponse.error);
      } else {
        console.log('[Resend] Verification email sent to', email, '| id:', emailResponse.data?.id);
      }
    } catch (emailErr) {
      console.error('[Resend] SMTP/connection error for', email, ':', emailErr.message);
    }

    res.status(201).json({
      message: 'Account created! Please check your email to verify your account.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({ verification_token: req.params.token });

    if (!user) {
      return res.status(400).json({ error: 'This verification link is invalid or has already been used. Please request a new one.' });
    }

    if (user.verification_token_expiry && user.verification_token_expiry < new Date()) {
      // Token expired — clear it so it cannot be retried
      user.verification_token = undefined;
      user.verification_token_expiry = undefined;
      await user.save();
      return res.status(400).json({ error: 'This verification link has expired (links are valid for 24 hours). Please request a new one.' });
    }

    user.is_verified = true;
    user.verification_token = undefined;
    user.verification_token_expiry = undefined;
    await user.save();

    res.json({ message: 'Email verified successfully! You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/resend-verification  (rate-limited: once per 60 seconds per email)
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const user = await User.findOne({ email });

    // Always return 200 to avoid leaking whether an account exists
    if (!user || user.role !== 'client') {
      return res.json({ message: 'If that email is registered and unverified, a new link has been sent.' });
    }
    if (user.is_verified) {
      return res.json({ message: 'This account is already verified. Please log in.' });
    }

    // Rate-limit: block if a token was issued within the last 60 seconds
    const COOLDOWN_MS = 60 * 1000;
    if (
      user.verification_token_expiry &&
      user.verification_token_expiry > new Date(Date.now() + 24 * 60 * 60 * 1000 - COOLDOWN_MS)
    ) {
      return res.status(429).json({ error: 'Please wait at least 60 seconds before requesting another verification email.' });
    }

    // Issue a fresh token
    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.verification_token = newToken;
    user.verification_token_expiry = newExpiry;
    await user.save();

    const clientUrl = process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173';
    const verificationUrl = `${clientUrl}/verify-email?token=${newToken}`;

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('[DEV] RESEND VERIFICATION LINK FOR:', email, verificationUrl);
    }

    try {
      const emailResponse = await resend.emails.send({
        from: emailFrom,
        to: email,
        subject: 'New Verification Link – HFA Certification Portal',
        html: buildVerificationEmail(user.full_name, verificationUrl),
      });
      if (emailResponse.error) {
        console.error('[Resend] Resend-verification error for', email, ':', emailResponse.error);
      } else {
        console.log('[Resend] Re-verification email sent to', email, '| id:', emailResponse.data?.id);
      }
    } catch (emailErr) {
      console.error('[Resend] SMTP error on resend-verification for', email, ':', emailErr.message);
    }

    res.json({ message: 'A new verification email has been sent. Please check your inbox.' });
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
    // Look up by username or email for staff accounts
    const searchVal = username?.trim();
    const user = await User.findOne({
      $or: [
        { username: searchVal },
        { email: searchVal?.toLowerCase() }
      ]
    });

    if (!user || !['admin', 'superadmin', 'food_tech_manager', 'food_tech', 'inspector'].includes(user.role) || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid staff credentials' });
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
        from: emailFrom,
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
