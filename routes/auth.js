import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { uploadToS3 } from '../lib/s3.js';
import multer from 'multer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import ImpersonationLog from '../models/ImpersonationLog.js';
import ImpersonationCode from '../models/ImpersonationCode.js';
import { getClientUrl, getAdminUrl } from '../lib/urls.js';
import { sendEmail } from '../lib/mailer.js';
import UserActivityLog from '../models/UserActivityLog.js';
import { emitToSuperadmins } from '../lib/socket.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'hfa_portal_secret_key_2024_@!';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/* ─── Password Reset Email Template ───────────────────────────────── */
function buildPasswordResetEmail({ name, portalName, resetUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your Password - ${portalName}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 12px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);border:1px solid #e2e8f0">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:36px 40px;text-align:center">
          <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA Logo" width="56" height="56" style="display:block;margin:0 auto 12px auto;width:56px;height:56px;border-radius:50%;object-fit:contain;background:#ffffff;padding:4px" />
          <div style="font-size:12px;color:#bbf7d0;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">Halal Food Authority</div>
          <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">${portalName}</h1>
          <p style="color:#bbf7d0;margin:6px 0 0;font-size:14px">Password Reset Request</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <h2 style="color:#0f172a;font-size:19px;font-weight:700;margin:0 0 14px">Hello, ${name}!</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px">
            We received a request to reset your password for the <strong>${portalName}</strong>. If you did not make this request, you can safely ignore this email.
          </p>

          <!-- Info box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #15803d;border-radius:8px;padding:14px 18px">
            <p style="color:#166534;font-size:13px;font-weight:700;margin:0 0 4px">⏱ This link expires in 1 hour</p>
            <p style="color:#166534;font-size:13px;line-height:1.5;margin:0">For security reasons, this reset link is single-use and will expire after 60 minutes.</p>
          </td></tr></table>

          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 28px">
            <a href="${resetUrl}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 36px;border-radius:10px;letter-spacing:0.2px;box-shadow:0 2px 8px rgba(21,128,61,0.25)">
              Reset Password
            </a>
          </td></tr></table>

          <!-- Fallback Link -->
          <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;border-top:1px solid #f1f5f9;padding-top:18px">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetUrl}" style="color:#15803d;word-break:break-all">${resetUrl}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
          <p style="color:#64748b;font-size:12px;margin:0 0 4px">&copy; ${new Date().getFullYear()} Halal Food Authority. All rights reserved.</p>
          <p style="color:#94a3b8;font-size:11px;margin:0">This is an automated system notification.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
      is_active: true,
    });

    await user.save();

    // Build the verification link using getClientUrl (safely resolves to https://hfaportal.company)
    const clientUrl = getClientUrl();
    const verificationUrl = `${clientUrl}/verify-email?token=${verificationToken}`;

    // In development when no Azure mail credentials are set, log the link and return it
    // so developers can test without a real email.
    const isDevNoAzure = (!process.env.AZURE_CLIENT_ID) &&
      (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);

    if (isDevNoAzure) {
      console.log('\n=========================================');
      console.log('[DEV — no Azure credentials] VERIFICATION LINK FOR:', email);
      console.log(verificationUrl);
      console.log('=========================================\n');
      return res.status(201).json({
        message: 'Account created. (Dev mode — no email service configured; use the link below to verify.)',
        verificationUrl,
      });
    }

    // Send the verification email via Azure Microsoft Graph
    try {
      await sendEmail({
        to: email,
        subject: 'Verify Your Email – HFA Certification Portal',
        html: buildVerificationEmail(full_name, verificationUrl),
        skipSuperadminBcc: true,
      });
      console.log('[Auth] Verification email sent to', email);
    } catch (emailErr) {
      console.error('[Auth] Verification email error for', email, ':', emailErr.message);
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

    const clientUrl = getClientUrl();
    const verificationUrl = `${clientUrl}/verify-email?token=${newToken}`;

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('[DEV] RESEND VERIFICATION LINK FOR:', email, verificationUrl);
    }

    try {
      await sendEmail({
        to: email,
        subject: 'New Verification Link – HFA Certification Portal',
        html: buildVerificationEmail(user.full_name, verificationUrl),
        skipSuperadminBcc: true,
      });
      console.log('[Auth] Re-verification email sent to', email);
    } catch (emailErr) {
      console.error('[Auth] Email error on resend-verification for', email, ':', emailErr.message);
    }

    res.json({ message: 'A new verification email has been sent. Please check your inbox.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/auth/login  (client portal — User collection only)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const searchEmail = email?.trim();
    if (!searchEmail) {
      return res.status(401).json({ error: 'Email is required' });
    }
    const escapedEmail = searchEmail.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

    // Check Admin collection first — if this email belongs to a staff account,
    // block them with a clear redirect message.
    const adminCheck = await Admin.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } },
        { username: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } },
      ]
    });
    if (adminCheck) {
      return res.status(403).json({
        error: 'Staff and administrator accounts cannot log in here. Please use the HFA Admin Portal.',
      });
    }

    const user = await User.findOne({
      email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') }
    });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email address before logging in.' });
    }

    const token = jwt.sign(
      { id: user._id, role: 'client', modelType: 'User' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    let compName = user.company_name;
    if (user.parent_client_id && !compName) {
      const parentUser = await User.findById(user.parent_client_id).select('company_name full_name');
      if (parentUser) compName = parentUser.company_name || parentUser.full_name;
    }

    // Update presence & activity tracking
    const now = new Date();
    user.last_login_at = now;
    user.last_active_at = now;
    user.is_online = true;
    await user.save();

    const clientDisplayName = compName || user.full_name || user.email;
    UserActivityLog.create({
      user_id: user._id,
      user_model: 'User',
      name: clientDisplayName,
      email: user.email,
      role: 'client',
      user_type: 'client',
      action: 'sign_in',
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent']
    }).catch(e => console.error('[ActivityLog] Client login log error:', e.message));

    // Real-time broadcast to superadmins
    emitToSuperadmins('superadmin_user_event', {
      type: 'sign_in',
      user_type: 'client',
      userId: user._id,
      name: clientDisplayName,
      email: user.email,
      role: 'client',
      timestamp: now
    });

    const clientData = {
      id: user._id,
      _id: user._id,
      email: user.email,
      full_name: user.full_name,
      company_name: compName,
      role: 'client',
      client_role: user.client_role,
      parent_client_id: user.parent_client_id,
      is_active: user.is_active,
      is_verified: user.is_verified,
      is_online: true,
      last_login_at: now
    };

    res.json({ token, user: clientData, profile: clientData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/admin/login  (admin portal only — Admin collection, username or email)
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const searchVal = username?.trim();
    if (!searchVal || !password) {
      return res.status(401).json({ error: 'Username or email and password are required' });
    }
    const escapedVal = searchVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Look ONLY in the Admin collection
    const admin = await Admin.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${escapedVal}$`, 'i') } },
        { email:    { $regex: new RegExp(`^${escapedVal}$`, 'i') } },
      ]
    });

    if (!admin) {
      return res.status(401).json({ error: 'Invalid staff credentials' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid staff credentials' });
    }

    const token = jwt.sign(
      { id: admin._id, role: admin.role, modelType: 'Admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update presence & activity tracking
    const now = new Date();
    admin.last_login_at = now;
    admin.last_active_at = now;
    admin.is_online = true;
    await admin.save();

    const adminDisplayName = admin.full_name || admin.username || 'Staff Member';
    UserActivityLog.create({
      user_id: admin._id,
      user_model: 'Admin',
      name: adminDisplayName,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      user_type: 'admin',
      action: 'sign_in',
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent']
    }).catch(e => console.error('[ActivityLog] Admin login log error:', e.message));

    // Real-time broadcast to superadmins
    emitToSuperadmins('superadmin_user_event', {
      type: 'sign_in',
      user_type: 'admin',
      userId: admin._id,
      name: adminDisplayName,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      roles: admin.roles,
      timestamp: now
    });

    const adminData = {
      id: admin._id,
      email: admin.email,
      username: admin.username,
      full_name: admin.full_name,
      role: admin.role,
      roles: admin.roles,
      can_issue_direct_certificate: Boolean(admin.can_issue_direct_certificate || admin.role === 'superadmin'),
      can_sign_logsheet: Boolean(admin.can_sign_logsheet || admin.role === 'superadmin'),
      can_review_certificate: Boolean(admin.can_review_certificate || admin.role === 'superadmin'),
      can_mark_done: Boolean(admin.can_mark_done || admin.role === 'superadmin' || (Array.isArray(admin.roles) && admin.roles.includes('superadmin'))),
      can_change_application_status: Boolean(admin.can_change_application_status || admin.role === 'superadmin' || (Array.isArray(admin.roles) && admin.roles.includes('superadmin'))),
      is_support_manager: Boolean(
        admin.is_support_manager ||
        admin.role === 'superadmin' ||
        admin.role === 'support_manager' ||
        (Array.isArray(admin.roles) && admin.roles.includes('support_manager'))
      ),
      is_online: true,
      last_login_at: now
    };

    res.json({ token, user: adminData, profile: adminData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const isModelAdmin = req.userModelType === 'Admin';
    const displayName = user.full_name || user.username || user.company_name || user.email || 'User';
    const now = new Date();

    if (isModelAdmin) {
      await Admin.findByIdAndUpdate(user._id, {
        is_online: false,
        last_logout_at: now,
        last_active_at: now
      });
    } else {
      await User.findByIdAndUpdate(user._id, {
        is_online: false,
        last_logout_at: now,
        last_active_at: now
      });
    }

    UserActivityLog.create({
      user_id: user._id,
      user_model: isModelAdmin ? 'Admin' : 'User',
      name: displayName,
      username: user.username,
      email: user.email,
      role: user.role || 'client',
      user_type: isModelAdmin ? 'admin' : 'client',
      action: 'sign_out',
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent']
    }).catch(e => console.error('[ActivityLog] Logout log error:', e.message));

    // Real-time broadcast to superadmins
    emitToSuperadmins('superadmin_user_event', {
      type: 'sign_out',
      user_type: isModelAdmin ? 'admin' : 'client',
      userId: user._id,
      name: displayName,
      username: user.username,
      email: user.email,
      role: user.role || 'client',
      timestamp: now
    });

    res.json({ message: 'Signed out successfully' });
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
  if (req.user.parent_client_id && !userJson.company_name) {
    const parentUser = await User.findById(req.user.parent_client_id).select('company_name full_name');
    if (parentUser) userJson.company_name = parentUser.company_name || parentUser.full_name;
  }
  res.json({ user: userJson, profile: userJson });
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, async (req, res) => {
  if (req.user.is_impersonation || req.is_impersonation) {
    if (req.body.phone || req.body.email || req.body.password) {
      return res.status(403).json({ error: 'Action forbidden. Impersonated sessions cannot change security-sensitive settings.' });
    }
  }

  try {
    const { full_name, company_name, phone, address, postcode, country } = req.body;
    const Model = req.userModelType === 'Admin' ? Admin : User;
    const user = await Model.findByIdAndUpdate(
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
    const avatarUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, 'avatars');
    const Model = req.userModelType === 'Admin' ? Admin : User;
    const user = await Model.findByIdAndUpdate(
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
  const { email, username, portal } = req.body;
  try {
    const rawVal = (email || username || '').trim();
    if (!rawVal) {
      return res.status(400).json({ error: 'Please enter your registered email address or username.' });
    }
    const escapedVal = rawVal.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

    let user;
    let isAdmin = false;

    // If requested from admin portal, check Admin collection first
    if (portal === 'admin') {
      user = await Admin.findOne({
        $or: [
          { email:    { $regex: new RegExp(`^${escapedVal}$`, 'i') } },
          { username: { $regex: new RegExp(`^${escapedVal}$`, 'i') } }
        ]
      });
      if (user) isAdmin = true;
    }

    if (!user) {
      user = await Admin.findOne({
        $or: [
          { email:    { $regex: new RegExp(`^${escapedVal}$`, 'i') } },
          { username: { $regex: new RegExp(`^${escapedVal}$`, 'i') } }
        ]
      });
      if (user) isAdmin = true;
    }

    if (!user) {
      user = await User.findOne({ email: { $regex: new RegExp(`^${escapedVal}$`, 'i') } });
    }

    if (!user) {
      return res.status(404).json({ error: 'No account was found with those credentials.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_password_token  = resetToken;
    user.reset_password_expiry = Date.now() + 3600000; // 1 hour
    await user.save();

    const baseUrl = (isAdmin || portal === 'admin') ? getAdminUrl(req) : getClientUrl(req);
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    const portalName = isAdmin ? 'HFA Staff Admin Portal' : 'HFA Certification Portal';
    const recipientEmail = user.email;

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log(`\n🔑 [PASSWORD RESET LINK GENERATED for ${recipientEmail}]:\n${resetUrl}\n`);
    }

    try {
      await sendEmail({
        to: recipientEmail,
        subject: `Reset Your Password - ${portalName}`,
        html: buildPasswordResetEmail({
          name: user.full_name || user.username || 'User',
          portalName,
          resetUrl,
        }),
        skipSuperadminBcc: true,
      });
      console.log(`[Auth] ✅ Password reset email dispatched to ${recipientEmail}`);
    } catch (emailErr) {
      console.error('[Auth] Password Reset Email Error:', emailErr.message);
      return res.status(500).json({ error: 'Failed to send password reset email. Please try again or contact support.' });
    }

    res.json({
      message: `A password reset link has been sent to ${recipientEmail}.`,
      resetUrl: process.env.NODE_ENV === 'development' ? resetUrl : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    // Check Admin collection first, then User (client)
    let user = await Admin.findOne({
      reset_password_token:  token,
      reset_password_expiry: { $gt: Date.now() }
    });
    if (!user) {
      user = await User.findOne({
        reset_password_token:  token,
        reset_password_expiry: { $gt: Date.now() }
      });
    }

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    user.password = password;
    user.reset_password_token  = undefined;
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
      .populate({ path: 'admin_id',  model: 'Admin', select: 'full_name email' })
      .populate({ path: 'client_id', model: 'User',  select: 'company_name full_name email' })
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
    // Target must be in the User (client) collection
    const targetClient = await User.findById(clientId);
    if (!targetClient) {
      return res.status(404).json({ error: 'Target client user not found.' });
    }

    // Generate short-lived impersonation JWT (1 hour) with modelType: 'User'
    const token = jwt.sign(
      {
        id: targetClient._id,
        role: 'client',
        modelType: 'User',
        is_impersonation: true,
        impersonated_by: req.user._id,
        admin_name: req.user.full_name,
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Generate secure opaque code (single-use)
    const code = crypto.randomBytes(32).toString('hex');

    // Save exchange code (expires in 60s)
    await new ImpersonationCode({
      code,
      token,
      admin_id: req.user._id,
      client_id: targetClient._id,
    }).save();

    // Log the start of impersonation
    await new ImpersonationLog({
      admin_id: req.user._id,
      client_id: targetClient._id,
      started_at: new Date(),
    }).save();

    res.status(201).json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
